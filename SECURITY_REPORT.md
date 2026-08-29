# RapTok Security Audit Report
**Date:** 2026-08-29
**Auditor:** Hermes AI
**Target:** RapTok (jimmy.hotloads.llc) — TikTok Content Maker for Rappers
**Stack:** FastAPI + React 19 + Traefik + Docker

---

## Executive Summary

| Metric | Value |
|---|---|
| **Overall Score** | **4/10 — High Risk** |
| Critical vulnerabilities | 3 |
| High vulnerabilities | 4 |
| Medium vulnerabilities | 5 |
| Low vulnerabilities | 3 |
| **Status** | ❌ NOT production-ready |

The application is functional but has critical security gaps. It runs as root in Docker, has no authentication, no SSRF protection, and multiple path traversal vectors. Below is the full breakdown.

---

## 🔴 CRITICAL Vulnerabilities

### C1. No Authentication / Authorization
**File:** `main.py` (all routers)
**Risk:** Anyone can call any API endpoint, including render (CPU-intensive), transcription (WhisperX — 48s CPU), and file serving.

**Impact:**
- Anonymous abuse: anyone can trigger ffmpeg/WhisperX = CPU DoS
- Anonymous file upload (arbitrary files to /tmp/raptok)
- Anonymous file download (any rendered video)

**Fix:** Add API key or JWT auth middleware:
```python
# main.py
from fastapi import Depends, Security
from fastapi.security import APIKeyHeader

api_key_header = APIKeyHeader(name="X-API-Key")
VALID_KEYS = {"your-secret-key"}

async def verify_key(key: str = Security(api_key_header)):
    if key not in VALID_KEYS:
        raise HTTPException(401, "Invalid API key")
```

### C2. SSRF — Server-Side Request Forgery
**File:** `services/downloader.py:56` — `_download_direct()`
**Risk:** The `url` parameter is passed directly to ffmpeg without validation. An attacker can supply internal URLs:
```
POST /api/analyze
{"url": "http://169.254.169.254/latest/meta-data/"}  # AWS metadata
POST /api/analyze
{"url": "http://localhost:8000/api/health"}            # localhost
POST /api/analyze
{"url": "file:///etc/passwd"}                          # local file
```

**Impact:** Internal network scanning, metadata service access, reading local files.

**Fix:**
```python
from urllib.parse import urlparse
import ipaddress

def validate_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False
    # Block internal IPs
    try:
        ip = ipaddress.ip_address(parsed.hostname)
        if ip.is_private or ip.is_loopback or ip.is_link_local:
            return False
    except ValueError:
        pass  # hostname is domain, not IP
    # Block localhost variants
    if parsed.hostname in ("localhost", "0.0.0.0", "::1"):
        return False
    return True
```

### C3. Path Traversal — Multiple Endpoints
**File:** `routers/files.py`

Three endpoints have path traversal issues:

1. **`/api/download/{filename}`** (line 12): NO validation at all. `../../etc/passwd` works.
2. **`/api/thumbnail/{filename}`** (line 32): NO validation. `../../etc/passwd` works.
3. **`/api/audio-preview/{filename}`** (line 41): Uses `filename in f.name` — substring match. `preview` matches ANY file containing "preview".

Only `/api/video/{filename}` has proper validation (`..` and `/` checks).

**Impact:** Read arbitrary files from the server.

**Fix:**
```python
import os
from pathlib import Path

def safe_join(base: Path, filename: str) -> Path:
    """Safely join filename to base directory, preventing path traversal."""
    filepath = (base / filename).resolve()
    if not str(filepath).startswith(str(base.resolve())):
        raise HTTPException(400, "Invalid filename")
    return filepath
```

Apply to ALL file-serving endpoints.

---

## 🟠 HIGH Vulnerabilities

### H1. Docker Runs as Root
**File:** `backend/Dockerfile`
**Risk:** Container runs as root. If an attacker gets RCE, they have full root inside the container.

**Fix:**
```dockerfile
RUN useradd -m -u 1000 raptok
USER raptok
```

### H2. No File Upload Validation
**File:** `routers/files.py:50` — `upload_audio()`
**Risk:** No file type validation, no size limit. An attacker can upload:
- Executables (.sh, .py)
- Huge files (fill disk)
- Malicious filenames (path traversal via `../../tmp/evil.mp3`)

**Fix:**
```python
MAX_UPLOAD_SIZE = 100 * 1024 * 1024  # 100MB
ALLOWED_EXTENSIONS = {".mp3", ".wav", ".m4a", ".flac", ".ogg"}

async def upload_audio(file: UploadFile = File(...)):
    # Validate extension
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"File type {ext} not allowed")
    
    # Sanitize filename
    safe_name = os.path.basename(file.filename)
    
    # Write with size limit
    audio_path = TEMP_DIR / f"{job_id}_{safe_name}"
    total = 0
    with open(audio_path, "wb") as f:
        while chunk := file.file.read(8192):
            total += len(chunk)
            if total > MAX_UPLOAD_SIZE:
                os.unlink(audio_path)
                raise HTTPException(413, "File too large")
            f.write(chunk)
```

### H3. CORS Wildcard `*`
**File:** `main.py:18`
**Risk:** `allow_origins=["*"]` means any website can make API calls. Combined with no auth, any malicious site can trigger renders, uploads, downloads.

**Fix:**
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://jimmy.hotloads.llc"],  # Only your frontend
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
```

### H4. No Rate Limiting on Heavy Endpoints
**File:** `docker-compose.yml` — Traefik labels
**Risk:** Traefik rate limit is `average=100, burst=50` per second — that's per-IP but the limit applies to frontend nginx, not backend. Heavy endpoints (`/api/render`, `/api/transcribe-full-stream`, `/api/stem-separate`) have no individual limits. An attacker can:
- Launch 50 concurrent renders (CPU exhaustion)
- Launch 50 concurrent transcriptions (memory exhaustion — WhisperX loads models)

**Fix:** Add per-endpoint rate limiting in FastAPI:
```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@router.post("/api/render")
@limiter.limit("2/minute")  # Max 2 renders per minute per IP
async def api_render(request: Request, req: RenderRequest):
    ...
```

---

## 🟡 MEDIUM Vulnerabilities

### M1. No Security Headers in nginx
**File:** `nginx-internal.conf`
**Risk:** Missing: Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security.

**Fix:**
```nginx
server {
    # ...existing config...
    
    add_header X-Frame-Options "DENY";
    add_header X-Content-Type-Options "nosniff";
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self';" always;
}
```

### M2. Error Details Leaked to Client
**File:** All routers — `HTTPException(status_code=500, detail=str(e))`
**Risk:** Internal exception messages (file paths, library errors, stack traces) are sent to the client. An attacker learns about the server's internals.

**Fix:**
```python
logger.exception("Internal error")
raise HTTPException(status_code=500, detail="Internal server error")
```

### M3. No Input Length Validation on Lyrics/Text Fields
**File:** `models/schemas.py` — `RenderRequest`, `TranscribeRequest`
**Risk:** `video_path`, `audio_path`, `lyrics` fields are `str` with no max_length. An attacker can send:
- 1MB of lyrics → memory exhaustion in forced_alignment
- 10MB of text → WhisperX crash or hang

**Fix:**
```python
class TranscribeRequest(BaseModel):
    audio_path: str = Field(..., max_length=500)
    language: str = Field(default="en", max_length=10)
```

### M4. ffmpeg concat demuxer — `-safe 0` flag
**File:** `routers/render.py:115`
**Risk:** `-safe 0` disables ffmpeg's path safety checks on the concat file. While the concat file is generated server-side (not user-controlled), if `video_path` contains special characters, it could inject into the concat file.

**Fix:** Validate `video_path` to ensure it's a real file in TEMP_DIR:
```python
def validate_video_path(path: str) -> str:
    filepath = Path(path).resolve()
    if not str(filepath).startswith(str(TEMP_DIR.resolve())):
        raise HTTPException(400, "Invalid video path")
    if not filepath.exists():
        raise HTTPException(404, "Video file not found")
    return str(filepath)
```

### M5. Docker Socket Exposed to Traefik
**File:** Traefik container mounts `/var/run/docker.sock` (read-only)
**Risk:** While read-only, the socket still allows container enumeration. An attacker who compromises Traefik can see all containers, their labels, and network config.

**Fix:** Use a Traefik socket proxy (e.g., `tecnativa/docker-socket-proxy`) that only exposes the needed API endpoints.

---

## 🟢 LOW Vulnerabilities

### L1. Traefik API Dashboard Enabled
**File:** Traefik CMD — `--api=true --api.insecure=true`
**Risk:** Traefik dashboard is accessible on port 8080 without auth. Exposes routing info.

**Fix:** Disable API or protect with auth:
```yaml
--api=true
--api.insecure=false  # Remove this
--api.dashboard=true  # Keep behind auth
```

### L2. No HTTPS Redirect on Backend Direct
**File:** `docker-compose.yml` — Backend exposed via Traefik on `websecure` only
**Risk:** Backend has no direct port exposure — good. But Traefik also listens on `:80` and redirects to HTTPS. This is correct.

**Status:** ✅ OK (Traefik redirects HTTP→HTTPS)

### L3. No Log Rotation / Monitoring
**Risk:** `docker logs` can grow indefinitely. No log size limit, no log rotation, no alerting.

**Fix:** Add logging config to docker-compose:
```yaml
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
```

---

## Security Scorecard

| Category | Score | Notes |
|---|---|---|
| **Authentication** | 0/10 | None at all |
| **Input Validation** | 3/10 | Some Field constraints, but paths/URLs unchecked |
| **Path Traversal** | 2/10 | Only 1 of 4 file endpoints validated |
| **SSRF Protection** | 0/10 | Direct URL to ffmpeg without validation |
| **Rate Limiting** | 3/10 | Traefik global only, no per-endpoint |
| **CORS** | 1/10 | Wildcard `*` |
| **Docker Security** | 3/10 | Root user, no resource limits |
| **Frontend Security** | 7/10 | No XSS/eval found, but no CSP header |
| **HTTPS/TLS** | 8/10 | Traefik + Let's Encrypt ✅ |
| **Error Handling** | 3/10 | Internal errors leaked to client |
| **File Upload** | 2/10 | No validation, no size limit |
| **Logging/Monitoring** | 4/10 | Basic logging, no rotation |
| **Overall** | **4/10** | ❌ High Risk |

---

## Priority Fix Order

1. **🔴 C1 — Add API key auth** (1 hour)
2. **🔴 C2 — SSRF validation** (30 min)
3. **🔴 C3 — Path traversal fix** (30 min)
4. **🟠 H1 — Docker non-root user** (15 min)
5. **🟠 H2 — File upload validation** (30 min)
6. **🟠 H3 — CORS restrict** (5 min)
7. **🟠 H4 — Per-endpoint rate limiting** (1 hour)
8. **🟡 M1 — Security headers** (15 min)
9. **🟡 M2 — Error masking** (30 min)
10. **🟡 M3 — Input length limits** (30 min)

**Estimated time to fix all:** ~4-5 hours

---

## What's Already Good ✅

- HTTPS via Traefik + Let's Encrypt
- No `dangerouslySetInnerHTML`, `eval()`, or `innerHTML` in frontend
- No hardcoded secrets/API keys in frontend code
- Pydantic models with some field constraints (ge/le on counts)
- subprocess.run (not shell=True) — no direct shell injection
- Frontend dist mounted read-only in nginx
- Docker socket mounted read-only in Traefik
- Traefik `exposedbydefault=false` — only labeled services exposed
- `yt-dlp` handles YouTube URLs safely (yt-dlp has its own validation)
- `/api/video/{filename}` has path traversal check (`..` and `/`)
- No SQL injection risk (no database)