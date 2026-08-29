"""Authentication router: login, logout, session management."""
import os
import time
import json
import hmac
import hashlib
import logging
from pathlib import Path
from fastapi import APIRouter, Request, Response, HTTPException
from pydantic import BaseModel
from config import TEMP_DIR

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Config ──
SESSION_COOKIE = "raptok_session"
SESSION_MAX_AGE = 30 * 24 * 3600  # 30 days
SECRET_KEY = os.environ.get("RAPTOK_SECRET", "raptok-secret-2026-change-me")

# ── Users (in-memory, static) ──
USERS = {
    "admin": {
        "password": "raptok2026!",
        "role": "admin",
    },
    "adminvadik": {
        "password": "vadik2026!",
        "role": "admin",
    },
}

# ── Session store: {session_token: {username, ip, expires}} ──
# Persist to disk so sessions survive restarts
SESSIONS_FILE = TEMP_DIR / ".sessions.json"
_sessions: dict = {}

def _load_sessions():
    """Load sessions from disk."""
    global _sessions
    try:
        if SESSIONS_FILE.exists():
            data = json.loads(SESSIONS_FILE.read_text())
            # Expire old sessions
            now = time.time()
            _sessions = {k: v for k, v in data.items() if v.get("expires", 0) > now}
    except Exception:
        _sessions = {}

def _save_sessions():
    """Persist sessions to disk."""
    try:
        SESSIONS_FILE.write_text(json.dumps(_sessions))
    except Exception as e:
        logger.warning(f"Failed to save sessions: {e}")

_load_sessions()


def _make_token(username: str, ip: str) -> str:
    """Create a signed session token."""
    payload = f"{username}:{ip}:{int(time.time())}"
    sig = hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}:{sig}"


def _verify_token(token: str) -> dict | None:
    """Verify a session token. Returns {username, ip, expires} or None."""
    try:
        parts = token.split(":")
        if len(parts) < 4:
            return None
        username, ip, ts, sig = parts[0], parts[1], parts[2], ":".join(parts[3:])
        payload = f"{username}:{ip}:{ts}"
        expected_sig = hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return None
        session = _sessions.get(token)
        if not session or session.get("expires", 0) < time.time():
            return None
        return session
    except Exception:
        return None


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/api/auth/login")
async def login(req: LoginRequest, request: Request, response: Response):
    """Login with username/password. Creates a session cookie."""
    user = USERS.get(req.username)
    if not user or not hmac.compare_digest(user["password"], req.password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Get real client IP (behind Traefik proxy)
    forwarded = request.headers.get("x-forwarded-for")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "unknown")
    token = _make_token(req.username, ip)
    _sessions[token] = {
        "username": req.username,
        "ip": ip,
        "expires": int(time.time()) + SESSION_MAX_AGE,
    }
    _save_sessions()

    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/",
    )
    logger.info(f"Login: {req.username} from {ip}")
    return {"username": req.username, "role": user["role"]}


@router.post("/api/auth/logout")
async def logout(request: Request, response: Response):
    """Logout and clear session."""
    token = request.cookies.get(SESSION_COOKIE)
    if token and token in _sessions:
        del _sessions[token]
        _save_sessions()
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"status": "ok"}


@router.get("/api/auth/check")
async def auth_check(request: Request):
    """Check if current session is valid. Also auto-login by IP."""
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        session = _verify_token(token)
        if session:
            return {"authenticated": True, "username": session["username"]}

    # Auto-login by IP: if a session exists for this IP, reuse it
    forwarded = request.headers.get("x-forwarded-for")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "unknown")
    for t, s in _sessions.items():
        if s.get("ip") == ip and s.get("expires", 0) > time.time():
            return {"authenticated": True, "username": s["username"]}

    raise HTTPException(status_code=401, detail="Not authenticated")