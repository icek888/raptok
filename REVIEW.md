# RapTok Backend — Code Review Report

**Date:** 2026-08-16
**Scope:** `/backend/` — all Python modules, `Dockerfile`, `docker-compose.yml`
**Reviewer:** Automated analysis

---

## ✅ What Works Well

1. **Clean service layer separation** — Each domain (downloader, fragment_selector, bpm_detector, speech_recognizer, subtitle_generator, video_renderer, forced_alignment, thumbnail_generator) is in its own module under `services/`. `main.py` is purely a routing layer. This is good architecture for an MVP.

2. **Pydantic v2 models with field validation** — `models/schemas.py` uses `Field(ge=…, le=…)` constraints on fragment parameters (`count`, `min_frag`, `max_frag`, `beat_division`). This prevents wildly invalid requests at the schema level before any logic runs.

3. **Graceful ffmpeg fallback in renderer** — `video_renderer.py:61-75`: if `-c copy` extraction fails (codec mismatch), it falls back to re-encoding with libx264. Same pattern for concat (`video_renderer.py:90-103`). This is a pragmatic approach for handling mixed-source videos.

4. **Whisper tuning for music** — `speech_recognizer.py:48`: `vad_filter=False` with an explanatory comment. VAD would cut off singing/rapping as non-speech. This was a real bug fix, not a guess. Also `condition_on_previous_text=False` prevents hallucination loops.

5. **BPM octave correction** — `bpm_detector.py:38-43`: auto-halves if >140, doubles if <50. Correct for the hip-hop/rap genre target where 70-95 BPM is typical.

6. **Forced alignment with 3-tier strategy** — `forced_alignment.py:57-76`: exact match → DTW → proportional distribution. DTW implementation (`forced_alignment.py:79-130`) is correct O(n·m) dynamic programming with traceback. The 2× ratio guard (`forced_alignment.py:90`) prevents wasted computation on wildly mismatched inputs.

7. **Config via env vars** — `config.py` supports `RAPTOK_TEMP_DIR`, `RAPTOK_OUTPUT_DIR`, `RAPTOK_FFMPEG_PRESET`, `RAPTOK_FFMEG_CRF`, `RAPTOK_WHISPER_MODEL`, `RAPTOK_WHISPER_DEVICE`. Docker compose wires these up correctly.

8. **Model caching** — `speech_recognizer.py:8-19`: Whisper model is loaded once and cached in `_model`. Correct — loading the model on every request would be catastrophically slow.

9. **Dockerfile is lean** — Uses `python:3.11-slim`, installs only necessary system deps, pip install layer is cached before code copy. Deno is installed for yt-dlp YouTube extraction.

10. **ASS subtitle generation** — `subtitle_generator.py:190-332`: comprehensive karaoke mode with `word_by_word`, `line_highlight`, `single_word`, and `auto` modes. Auto-detection of long lines (`>30` chars or `>6` words) with chunking fallback. This is genuinely well-engineered for the use case.

---

## ⚠️ Issues Found

### 🔴 CRITICAL

#### C1. Path Traversal — File Download/Thumbnail Endpoints
**Files:** `main.py:178-205`

```python
@app.get("/api/download/{filename}")
async def download_file(filename: str):
    filepath = OUTPUT_DIR / filename  # ← no sanitization
```

`filename` comes directly from the URL path. A request to `/api/download/../../etc/passwd` will resolve to a path outside `OUTPUT_DIR`. The `Path /` operator doesn't prevent `..` traversal — `Path("output") / "../../etc/passwd"` resolves to `../../etc/passwd` relative to CWD.

**Same issue at:**
- `main.py:187-193` — `/api/thumbnail/{filename}` (TEMP_DIR)
- `main.py:198-205` — `/api/audio-preview/{filename}` (TEMP_DIR, and this one does a substring match: `if filename in f.name` which is even worse — `filename="."` matches everything)

**Fix:**
```python
filepath = (OUTPUT_DIR / filename).resolve()
if not filepath.is_relative_to(OUTPUT_DIR):
    raise HTTPException(status_code=403, detail="Invalid path")
```

#### C2. Arbitrary File Read via `audio_path` / `video_path` Parameters
**Files:** `main.py:88-91` (thumbnails), `main.py:112-160` (render), `main.py:210-217` (BPM), `main.py:222-272` (audio-info), `main.py:277-323` (beat-sync), `main.py:328-335` (transcribe), `main.py:340-444` (transcribe-fragment)

Every endpoint that takes `audio_path` or `video_path` passes it directly to ffmpeg/librosa/whisper without validation. A user can point to any file on the server's filesystem:

- `/api/bpm` with `audio_path="/etc/passwd"` — librosa will attempt to load it (may error, but confirms file existence via error messages)
- `/api/transcribe` with `audio_path="/app/main.py"` — whisper will attempt to process arbitrary files
- `/api/render` with `video_path="/app/main.py"` — ffmpeg will try to read it

**Fix:** Validate that paths are within `TEMP_DIR` or `OUTPUT_DIR`:
```python
def _validate_media_path(path: str) -> Path:
    p = Path(path).resolve()
    allowed = [TEMP_DIR.resolve(), OUTPUT_DIR.resolve()]
    if not any(p.is_relative_to(base) for base in allowed):
        raise HTTPException(status_code=403, detail="Path outside allowed directories")
    return p
```

#### C3. Unrestricted CORS
**File:** `main.py:29-34`

```python
allow_origins=["*"],
allow_methods=["*"],
allow_headers=["*"],
```

Combined with no authentication, any website on the internet can call this API. Since the API can download arbitrary URLs (SSRF), read/write files on the server, and execute ffmpeg, this is a serious attack surface for a public-facing deployment at `jimmy.hotloads.llc`.

**Fix:** Restrict `allow_origins` to the actual frontend domain: `["https://jimmy.hotloads.llc"]`.

#### C4. No Authentication or Authorization
**File:** entire `main.py`

There is zero auth. Anyone who can reach the API can:
- Download arbitrary videos from any URL (SSRF — the server fetches whatever URL you give it)
- Upload files to the server's filesystem
- Render videos (consuming CPU/GPU for minutes per request)
- Read file paths via error messages
- Fill up disk with temp files

**Fix:** Add at minimum an API key middleware, or better, a proper auth layer (JWT, OAuth).

---

### 🟠 HIGH

#### H1. SSRF via Download Endpoint
**File:** `main.py:46-54`, `downloader.py:43-56`

`download_video(req.url)` takes any URL. The server will:
- Fetch it via `yt-dlp` (YouTube)
- Fetch it via `urllib.request.urlopen` (rezka)
- Fetch it via `ffmpeg` (direct URL)

An attacker can use the server to:
- Scan internal network (`http://169.254.169.254/` on cloud — AWS metadata endpoint)
- Fetch internal services (`http://localhost:8000/api/health`)
- Exfiltrate data via DNS/HTTP

**Fix:** Validate URLs against an allowlist of domains (youtube.com, youtu.be, rezka.ag, hdrezka). Block private IP ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `127.0.0.0/8`).

#### H2. Blocking I/O in Async Handlers
**Files:** every `async def` endpoint in `main.py`

All endpoints are declared `async def` but call blocking operations:
- `subprocess.run()` (ffmpeg, ffprobe, yt-dlp) — `downloader.py:70`, `video_renderer.py:61,73,90,101,136`, `main.py:129,362`, `thumbnail_generator.py:23`
- `librosa.load()` (loads entire audio file into memory) — `bpm_detector.py:19`, `main.py:227`
- `WhisperModel.transcribe()` (CPU-heavy, can take 10-60s) — `speech_recognizer.py:44`
- `shutil.copyfileobj()` — `main.py:173`
- `urllib.request.urlopen()` — `downloader.py:96,125`

In FastAPI, `async def` handlers run on the main event loop. Blocking calls will **freeze the entire server** for all concurrent requests. A single render request (`subprocess.run` with `timeout=300`) blocks the event loop for up to 5 minutes.

**Fix:** Either:
- (a) Change all handlers to `def` (not `async def`) — FastAPI will run them in a threadpool automatically.
- (b) Use `await asyncio.to_thread(...)` or `run_in_executor` for blocking calls.
- (c) Use `asyncio.create_subprocess_exec` for subprocess calls.

Option (a) is the simplest and most correct for this codebase since none of the handlers actually use `await` for anything.

#### H3. File Upload — No Size Limit, No Content-Type Validation
**File:** `main.py:163-175`

```python
@app.post("/api/upload/audio")
async def upload_audio(file: UploadFile = File(...)):
    ...
    with open(audio_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
```

Issues:
- **No file size limit** — an attacker can upload a 100GB file and fill the disk.
- **No content-type check** — filename says `.mp3` but the file could be anything.
- **Filename not sanitized** — `file.filename` is user-controlled. `{job_id}_{file.filename}` could contain `../` or other dangerous characters. If `file.filename` is `../../app/main.py`, it writes to `main.py`.
- **`shutil.copyfileobj` in async handler** — blocks the event loop (see H2).

**Fix:**
```python
MAX_UPLOAD_SIZE = 100 * 1024 * 1024  # 100 MB
ALLOWED_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}

safe_name = Path(file.filename).name  # strip path components
ext = Path(safe_name).suffix.lower()
if ext not in ALLOWED_EXTENSIONS:
    raise HTTPException(400, f"File type {ext} not allowed")

audio_path = TEMP_DIR / f"{job_id}_{safe_name}"
# Stream with size check
total = 0
with open(audio_path, "wb") as f:
    while chunk := file.file.read(1024 * 1024):
        total += len(chunk)
        if total > MAX_UPLOAD_SIZE:
            os.unlink(audio_path)
            raise HTTPException(413, "File too large")
        f.write(chunk)
```

#### H4. Temp File Cleanup — No Automatic Cleanup, Disk Will Fill
**Files:** `downloader.py`, `thumbnail_generator.py`, `subtitle_generator.py`, `video_renderer.py`, `main.py`

Temp files are created but never cleaned up:
- Downloaded videos: `TEMP_DIR / f"{job_id}.mp4"` — never deleted
- Thumbnails: `TEMP_DIR / f"{job_id}_{ts}.jpg"` — never deleted
- ASS subtitle files: `TEMP_DIR / f"{job_id}.ass"` — never deleted
- Uploaded audio: `TEMP_DIR / f"{job_id}_{filename}"` — never deleted
- Render work dir: cleaned up in `video_renderer.py:139` ✅ — but only on success. If `subprocess.run` raises `TimeoutExpired`, the `shutil.rmtree` line is never reached (it's after the subprocess call but before the error check — actually, looking again, it IS before the returncode check, so timeout exceptions will skip it).

Wait — let me re-examine `video_renderer.py:136-144`:
```python
result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
# Clean up work dir
shutil.rmtree(work_dir, ignore_errors=True)  # ← runs even on failure ✅
if result.returncode != 0:
    raise RuntimeError(...)  # ← but work_dir is already cleaned ✅
```

Actually `shutil.rmtree` runs before the error check, so work_dir IS cleaned. ✅ But the final output MP4 in `OUTPUT_DIR` is never cleaned, and all temp files accumulate.

The `tmp/` directory already shows accumulation: multiple `audio_*.mp3`, `*.mp4`, `*.jpg`, `*.ass` files in the project listing.

**Fix:** Add a periodic cleanup task (background thread or cron) that deletes temp files older than N hours. Also clean up downloaded videos after render completes.

#### H5. Subprocess Timeout Without Temp File Cleanup
**File:** `main.py:127-152`

```python
with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
    tmp_audio = tmp.name
subprocess.run([...], capture_output=True, timeout=120)
audio_path = tmp_audio
```

If `subprocess.run` raises `TimeoutExpired`, the `except Exception` at line 159 catches it, but `tmp_audio` is never cleaned up. The cleanup at lines 147-152 only runs if the render succeeds.

Same issue at `main.py:358-377` — `tmp_fragment` is cleaned at line 376 but if `subprocess.run` at line 362 times out, the except block at line 443 catches it without cleanup.

**Fix:** Use try/finally for temp file cleanup:
```python
try:
    subprocess.run([...], timeout=120)
    ...
finally:
    if os.path.exists(tmp_audio):
        os.unlink(tmp_audio)
```

---

### 🟡 MEDIUM

#### M1. `audio-preview` Endpoint — Substring Match on Filename
**File:** `main.py:198-205`

```python
for f in TEMP_DIR.iterdir():
    if filename in f.name:
        return FileResponse(str(f), media_type="audio/mpeg")
```

`filename` is user input. If `filename="."`, it matches every file (every filename contains `.`). If `filename="a"`, it matches the first file containing `a`. This is both a security issue (serve any file) and a correctness issue (returns wrong file).

**Fix:** Use exact match: `if f.name == filename:`

#### M2. Global `random.seed()` Side Effect
**File:** `fragment_selector.py:18-19`

```python
if seed is not None:
    random.seed(seed)
```

This sets the global random state, affecting all subsequent `random` calls across the application (not just this function). In a web server handling concurrent requests, this causes non-deterministic interference between requests.

**Fix:** Use a local `random.Random` instance:
```python
rng = random.Random(seed) if seed is not None else random
frag_dur = rng.uniform(min_frag, max_frag)
pick_point = rng.uniform(...)
```

#### M3. `librosa.load` Called Twice for Audio-Info
**File:** `main.py:222-272`

`api_audio_info` calls `librosa.load()` at line 227, then calls `detect_bpm(req.audio_path)` at line 231, which calls `librosa.load()` again at `bpm_detector.py:19`. The audio file is loaded from disk and decoded twice. For a 4-minute song, this wastes several seconds and ~100MB of memory.

**Fix:** Load once, pass the loaded array to `detect_bpm` (refactor to accept `y, sr` instead of path).

#### M4. Render Endpoint — Inline Imports
**File:** `main.py:125-126, 350-351, 393, 385-386`

```python
import tempfile
import subprocess
```

These imports are inside the function body, scattered across multiple endpoints. While Python caches imports, this is poor practice — it hides dependencies and makes it harder to audit the import graph.

**Fix:** Move all imports to the top of `main.py`.

#### M5. Whisper Model Not Thread-Safe Under Concurrent Access
**File:** `speech_recognizer.py:12-19`

The `_model` global is shared. If two requests call `transcribe_audio` simultaneously, both will use the same `WhisperModel` instance. faster-whisper's `transcribe()` is not guaranteed thread-safe — this could cause crashes or corrupted output.

**Fix:** Use a `threading.Lock` around the transcribe call, or use a thread pool with `max_workers=1` for transcription tasks.

#### M6. No Error Handling for Missing `ffprobe`/`ffmpeg`/`yt-dlp` Binaries
**Files:** all service modules

If `ffmpeg` or `ffprobe` is not installed, `subprocess.run` raises `FileNotFoundError`, which propagates up as an unhandled 500 error with a confusing message. The Dockerfile installs them, but for local dev or alternative deployments, there's no graceful error.

**Fix:** Add startup health check or catch `FileNotFoundError` specifically with a clear error message.

#### M7. `_jobs` Dict Grows Unbounded
**File:** `main.py:37`

```python
_jobs: dict = {}
```

The `_jobs` dict stores video info on each `/api/analyze` call (line 51) but is never read by any other endpoint and never cleaned up. It will grow indefinitely in memory until the process restarts.

**Fix:** Either remove it (it's dead code — no endpoint reads from it) or add a TTL-based eviction.

#### M8. Render Output Filename Collision
**File:** `video_renderer.py:106`

```python
output_path = OUTPUT_DIR / f"raptok_{job_id}.mp4"
```

`job_id` is `uuid.uuid4().hex[:12]` — 12 hex chars = 48 bits = ~281 trillion possibilities. Collision probability is negligible. However, if a collision does occur, the existing file is silently overwritten with `-y` flag. Not a real concern but worth noting for completeness.

#### M9. `transcribe-fragment` Endpoint — Dead Code Path
**File:** `main.py:388-402`

When `end <= start` (no fragment extraction), the code falls through to:
```python
frag_dur = 0.0
if end > start:  # ← always False here
    frag_dur = end - start
else:
    # ffprobe the full audio file
    probe = sp.run(["ffprobe", ...], ...)
    frag_dur = float(probe.stdout.strip())
```

But `fragment_path` was set to `audio_path` at line 355, and the ffprobe at line 395 probes `fragment_path` which equals `audio_path`. This works, but the logic is convoluted — the `if end > start` check at line 390 is redundant since we already know `end <= start` from the outer `if` at line 357.

---

### 🟢 LOW

#### L1. Duplicate `_tokenize_lyrics` Function
**Files:** `subtitle_generator.py:7-9`, `forced_alignment.py:19-22`

Both define `_tokenize_lyrics` with identical logic. Should be in a shared utility module.

#### L2. Unused `RenderStatus` Model
**File:** `models/schemas.py:99-104`

`RenderStatus` is defined but never used — the render endpoint returns a plain dict (`main.py:154-158`).

#### L3. Unused `VideoSource` in Fragment Logic
**File:** `models/schemas.py:7-10`

`VideoSource` enum is used in `downloader.py` but the `direct` case doesn't distinguish between mp4 and m3u8 in the source field — both return `VideoSource.direct`.

#### L4. `_get_alignment` Function Unused
**File:** `video_renderer.py:147-149`

`_get_alignment()` is defined but never called. The alignment logic is duplicated inside `generate_ass()` in `subtitle_generator.py:209-210`.

#### L5. `get_render_duration` Function Unused
**File:** `video_renderer.py:152-154`

Defined but never called from any endpoint.

#### L6. Inconsistent Error Response Format
**Files:** various endpoints

Some endpoints raise `HTTPException(400)`, others `HTTPException(500)`. The `/api/thumbnails` endpoint (line 99-100) catches errors per-thumbnail and returns them in the response body, while other endpoints let exceptions propagate. There's no consistent error envelope.

#### L7. No Request ID / Correlation ID
No request ID is generated for logging or debugging. In production, it's impossible to trace a failed render back to the specific request.

#### L8. Docker — Running as Root
**File:** `Dockerfile`

No `USER` directive — the app runs as root inside the container. If there's a vulnerability (see C1-C4), the attacker has root access in the container.

**Fix:** Add a non-root user:
```dockerfile
RUN useradd -m appuser
USER appuser
```

#### L9. Docker — No Health Check
**File:** `Dockerfile`

No `HEALTHCHECK` instruction. The `/health` endpoint exists but Docker won't use it to detect a hung process.

**Fix:**
```dockerfile
HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:8000/health || exit 1
```

---

## 📋 Missing Features

### 1. **Authentication & Authorization** (CRITICAL)
No auth whatsoever. Anyone can use the API. Needs at minimum API key auth, ideally JWT or OAuth for multi-user.

### 2. **Rate Limiting** (HIGH)
No rate limiting on any endpoint. A single user can:
- Queue 100 render requests (each takes 1-5 minutes of CPU)
- Upload unlimited files
- Download unlimited videos

Traefik has a `ratelimit` middleware configured in `docker-compose.yml:17-19` (100 avg, 50 burst) but this applies to the **frontend** router, not the **backend API** router (`raptok-api` at line 35 has no rate limit middleware).

**Fix:** Add the rate limit middleware to `raptok-api` router in docker-compose.yml.

### 3. **Asynchronous Render Pipeline** (HIGH)
Rendering is synchronous — the client waits up to 5 minutes for the response. If the connection drops, the render is wasted. Should be:
1. `POST /api/render` → returns `job_id` immediately with status "queued"
2. Background worker (Celery, RQ, or even `asyncio.create_task`) processes the render
3. `GET /api/render/{job_id}/status` → returns progress
4. `GET /api/download/{filename}` → download when complete

The `_jobs` dict and `RenderStatus` model suggest this was planned but never implemented.

### 4. **Persistent Storage / Database** (MEDIUM)
No database. Job state is in-memory (`_jobs` dict), lost on restart. For production:
- Store job metadata (source URL, fragments, render status) in SQLite/Postgres
- Store rendered video metadata with expiry timestamps

### 5. **File Lifecycle Management** (MEDIUM)
No automatic cleanup of temp/output files. Disk will fill up over time. Needs:
- TTL-based cleanup of temp files (e.g., delete after 1 hour)
- Configurable output retention (e.g., delete after 24 hours or N downloads)
- Disk space monitoring

### 6. **Webhook / Notification on Render Completion** (LOW)
For async render, client needs to know when rendering is done. Options:
- Polling `/api/render/{job_id}/status`
- WebSocket notification
- Webhook callback URL

### 7. **Input Validation for URLs** (HIGH)
`AnalyzeRequest.url` accepts any string. No URL format validation, no domain allowlist, no scheme check (`http`/`https` only).

### 8. **Logging & Monitoring** (MEDIUM)
No structured logging. `print()` is not used either — errors are only returned to the client. No metrics (request count, render duration, error rate). For production:
- Structured JSON logging (structlog or loguru)
- Prometheus metrics endpoint
- Sentry/error tracking integration

### 9. **API Versioning** (LOW)
All routes are `/api/...` with no version prefix. Should be `/api/v1/...` to allow breaking changes without breaking existing clients.

### 10. **Tests** (HIGH)
Zero test files found. No `tests/` directory, no pytest config, no test dependencies in `requirements.txt`. For a project deployed to production, this is a significant risk.

---

## 💡 Recommendations

### Immediate (do now)

1. **Fix path traversal** (C1) — 5-line fix per endpoint, critical security hole
2. **Restrict CORS** (C3) — change `allow_origins=["*"]` to the actual domain
3. **Fix audio-preview substring match** (M1) — change `in` to `==`
4. **Add API key auth** (C4) — simple middleware, huge security improvement
5. **Add rate limiting to backend router** in docker-compose.yml (Missing #2)
6. **Fix file upload security** (H3) — size limit, filename sanitization, extension check

### Short-term (this week)

7. **Convert `async def` to `def`** (H2) — simplest fix for blocking I/O, no code restructuring needed
8. **Add URL validation/allowlist** (H1) — prevent SSRF
9. **Add temp file cleanup** (H4) — cron or background task
10. **Add Docker non-root user and healthcheck** (L8, L9)
11. **Fix `random.seed` global side effect** (M2)

### Medium-term (next sprint)

12. **Implement async render pipeline** (Missing #3) — biggest UX improvement
13. **Add database for job persistence** (Missing #4) — SQLite is sufficient for MVP
14. **Add basic tests** — at minimum integration tests for each endpoint
15. **Add structured logging** (Missing #8)
16. **Fix duplicate librosa load** (M3)
17. **Add Whisper thread safety** (M5)

### Architecture Notes

The codebase is well-structured for an MVP that was "rapidly iterated (v0.1 to v1.5) over a single day." The service layer separation is the right foundation. The main architectural gap is the lack of a job/queue layer between the API and the heavy processing (render, transcription, BPM detection). Adding this would solve multiple issues simultaneously: async render, rate limiting at the job level, and resource management.

The `_jobs` dict and `RenderStatus` model in `schemas.py` indicate the async render pattern was anticipated. Implementing it should be the top medium-term priority.

---

## Summary by Severity

| Severity | Count | Key Items |
|----------|-------|-----------|
| 🔴 Critical | 4 | Path traversal, arbitrary file read, CORS wildcard, no auth |
| 🟠 High | 5 | SSRF, blocking I/O in async, unsafe upload, no cleanup, temp file leak |
| 🟡 Medium | 9 | Substring match, global seed, duplicate librosa load, inline imports, thread safety, no binary check, unbounded dict, filename collision, dead code |
| 🟢 Low | 9 | Duplication, unused models/functions, inconsistent errors, no request ID, root container, no healthcheck |
| 📋 Missing | 10 | Auth, rate limiting, async render, DB, file lifecycle, webhooks, URL validation, logging, API versioning, tests |