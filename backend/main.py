"""RapTok API — main FastAPI app (thin entry point)."""
import logging
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from routers import auth, health, files, video, subtitles, audio, transcription, render, features, projects, admin
from routers.auth import SESSION_COOKIE, _verify_token, _sessions
import time

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="RapTok API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://jimmy.hotloads.llc"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    allow_credentials=True,
)

# ── Auth middleware ──
# Public paths that don't require authentication
PUBLIC_PATHS = {
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/check",
    "/api/health",
    "/health",
    "/docs",
    "/openapi.json",
    "/",
    "/api/plans",
}

# File-serving paths that require auth
PROTECTED_PREFIXES = ["/api/"]


def _get_client_ip(request: Request) -> str:
    """Get real client IP, respecting X-Forwarded-For from Traefik."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Allow public paths
        if path in PUBLIC_PATHS or path.startswith("/api/auth/"):
            return await call_next(request)

        # Allow non-API paths (static files served by nginx, not FastAPI)
        if not path.startswith("/api/"):
            return await call_next(request)

        # Check session cookie — this is the only auth method
        token = request.cookies.get(SESSION_COOKIE)
        if token:
            session = _verify_token(token)
            if session:
                return await call_next(request)

        # Not authenticated
        return JSONResponse(status_code=401, content={"detail": "Not authenticated"})


app.add_middleware(AuthMiddleware)

# Register all routers
for r in (auth, health, files, video, subtitles, audio, transcription, render, features, projects, admin):
    app.include_router(r.router)

logger.info("RapTok API started — routers: auth, health, files, video, subtitles, audio, transcription, render, features, projects, admin")