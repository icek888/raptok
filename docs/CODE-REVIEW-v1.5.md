# RapTok — Code Review & Audit Report

**Date:** 2026-08-16  
**Version:** v1.5 (uncommitted)  
**Repository:** https://github.com/icek888/raptok  
**Deployment:** https://jimmy.hotloads.llc (Traefik + Docker Compose)

---

## 📊 Project Overview

| Metric | Value |
|---|---|
| Backend LOC | 2,051 (11 Python files) |
| Frontend LOC | 2,259 (10 TSX/TS files) |
| Total LOC | ~4,310 |
| Disk usage | 125 MB (project) + 46 MB (tmp) |
| Git commits | 5 (last: v0.1 MVP) |
| Uncommitted changes | 11 modified + 7 untracked files |
| Tests | ❌ None |
| CI/CD | ❌ None |
| README | ❌ None |
| API endpoints | 15+ |

---

## ✅ What Works Well

### Backend
- **FastAPI + Pydantic** — proper schema validation on all endpoints
- **Service separation** — bpm_detector, speech_recognizer, subtitle_generator, forced_alignment, video_renderer, downloader, fragment_selector, thumbnail_generator
- **Docker deployment** — python:3.11-slim + ffmpeg + deno, Traefik SSL
- **BPM detection** — librosa beat tracking with octave correction (>140 → /2)
- **Forced alignment** — 3 strategies (direct, DTW, proportional) + BPM-aware fallback
- **Whisper integration** — faster-whisper with VAD disabled for music/rap
- **ASS karaoke** — 4 display modes (auto, line_highlight, word_by_word, single_word)
- **Audio fragment selection** — RMS energy analysis, suggested 60s window

### Frontend
- **React 19 + TypeScript** — type-safe API client
- **Component structure** — InputPanel, FragmentEditor, SubtitleEditor, TimelinePreview, RenderPanel
- **Unified audio playback** — single audio element, synchronized preview
- **Live style preview** — SubtitleStyle applied to video overlay in real-time
- **Timeline** — waveform, beats, fragments, subtitles, word markers, playhead, drag handles
- **Word editor** — per-word timing, insert/delete, live subtitle regeneration
- **Sync adjustment** — global stretch (0.25x-3.0x) + offset (-10s/+10s)

### Infrastructure
- **Traefik** — automatic HTTPS via Let's Encrypt
- **Docker Compose** — frontend (nginx) + backend (uvicorn)
- **Cron cleanup** — daily tmp cleanup at 4:00 AM

---

## ⚠️ Issues Found

### 🔴 Critical

| # | Issue | File | Description |
|---|---|---|---|
| 1 | **Uncommitted work** | git | v0.2-v1.5 changes (18 files) not committed. Risk of total loss. |
| 2 | **No auth** | backend/main.py | All endpoints publicly accessible. Anyone can upload/render. |
| 3 | **Path traversal** | backend/main.py | `audio_path` / `video_path` passed directly from frontend. No sanitization. `../../../etc/passwd` possible. |
| 4 | **No file upload validation** | backend/main.py | `/api/upload/audio` — no file type check, no size limit. |
| 5 | **Blocking async handlers** | backend/main.py | All endpoints are `async def` but call blocking I/O (subprocess, librosa, whisper). Event loop blocked. |

### 🟠 High

| # | Issue | File | Description |
|---|---|---|---|
| 6 | **No rate limiting** | backend | No limit on API calls. DoS possible. |
| 7 | **Temp file leak in container** | backend | `/tmp/raptok/` grows indefinitely inside container. Host cron cleans host tmp, but container tmp is separate. |
| 8 | **Synchronous render** | backend/main.py | `/api/render` blocks for 30-120s. No progress feedback, no async job queue. |
| 9 | **No error recovery** | backend | If ffmpeg crashes mid-render, temp files left behind. No cleanup on exception. |
| 10 | **Prop drilling** | frontend/App.tsx | 10+ props passed through to SubtitleEditor. No Context API. |
| 11 | **Unused component** | StyleEditor.tsx | 140 LOC, still imported nowhere. Dead code. |

### 🟡 Medium

| # | Issue | File | Description |
|---|---|---|---|
| 12 | **No git tags** | git | No version tags. Hard to track releases. |
| 13 | **__pycache__ in repo** | backend | `.pyc` files not gitignored properly. |
| 14 | **No CORS config** | backend/main.py | No explicit CORS middleware. Works because Traefik same-origin. |
| 15 | **Hardcoded constants** | backend | Whisper model="base", max 8 words/line, 30 char threshold. Not configurable. |
| 16 | **No undo/redo** | frontend | Word edits are destructive. No history stack. |
| 17 | **No mobile responsive** | frontend | UI designed for desktop. Subtitle editor unusable on mobile. |
| 18 | **Duplicate IIFE pattern** | TimelinePreview.tsx | `{(() => { ... })()}` repeated. Should be extracted to component. |
| 19 | **API client error handling** | frontend/src/api/client.ts | No retry, no timeout, no error parsing. Raw fetch errors. |
| 20 | **Whisper model cache** | backend | Model downloaded on first call. Cold start = 10-30s delay. No pre-download. |

### 🟢 Low

| # | Issue | File | Description |
|---|---|---|---|
| 21 | **No .env support** | backend/config.py | Hardcoded config. No environment variable loading. |
| 22 | **No health check in Docker** | docker-compose.yml | No HEALTHCHECK instruction. |
| 23 | **No volume mounts** | docker-compose.yml | No persistent storage. Container restart = lost tmp files. |
| 24 | **README missing** | root | No setup instructions, no API docs. |
| 25 | **No logging** | backend | No structured logging. print() only. |
| 26 | **TypeScript any** | frontend | Several `any` types in event handlers. |

---

## 📋 Missing Features

### Must-Have (Before Monetization)

| Priority | Feature | Description |
|---|---|---|
| P0 | **Authentication** | JWT or API key. User accounts. Per-user file isolation. |
| P0 | **Path sanitization** | Validate all file paths. Restrict to temp dir. |
| P0 | **File upload limits** | Max 50MB, audio only (mp3, wav, flac, ogg). |
| P0 | **Async render queue** | Background render jobs with progress polling. Redis + Celery or simple job dict. |
| P0 | **Git commit + tags** | Commit v1.5, tag as `v1.5.0`. |
| P1 | **Rate limiting** | 10 req/min per IP. slowapi or Traefik middleware. |
| P1 | **Render progress API** | `/api/render/{job_id}/status` → percentage, ETA. |
| P1 | **Output management** | Rendered videos stored per-user, 14-day TTL. |
| P1 | **README + API docs** | Setup guide, API reference, architecture diagram. |

### Should-Have (Growth)

| Priority | Feature | Description |
|---|---|---|
| P2 | **Whisper model selection** | tiny/base/medium/large — user choice. Tradeoff speed vs accuracy. |
| P2 | **Video preview during render** | WebSocket or SSE for real-time progress. |
| P2 | **Subtitle export** | Download .ass / .srt separately. |
| P2 | **Preset templates** | Save style presets (font, color, size, position). |
| P2 | **Undo/redo** | History stack for word edits. |
| P2 | **Mobile responsive** | Touch-friendly timeline, collapsible panels. |
| P2 | **CI/CD** | GitHub Actions: lint, test, build, deploy. |

### Nice-to-Have (Future)

| Priority | Feature | Description |
|---|---|---|
| P3 | **Multi-language UI** | Russian/English toggle. |
| P3 | **Video effects** | Zoom, shake, flash on beat. Glitch transitions. |
| P3 | **Collaboration** | Share project link, co-edit. |
| P3 | **Analytics** | Render count, popular styles, user retention. |
| P3 | **Watermark removal** | Premium feature — remove RapTok watermark. |
| P3 | **Rezka.ag integration** | Direct m3u8 parsing from movie pages. |

---

## 🏗️ Architecture Assessment

### Current State

```
Frontend (React)  ──HTTP──▶  Backend (FastAPI)
     │                           │
  nginx:80                   uvicorn:8000
     │                           │
  Traefik :443  ◄──────────►  Traefik labels
```

### Issues

1. **No database** — all state in memory + temp files
2. **No queue** — render blocks the event loop
3. **No persistence** — container restart = lost everything
4. **No auth layer** — fully open API

### Recommended Architecture (v2.0)

```
Frontend (React)
     │
  Traefik :443
     │
  Backend (FastAPI)  ──▶  Redis (job queue + cache)
     │                      │
  Worker (Celery)  ◄────────┘
     │
  ffmpeg + whisper
     │
  PostgreSQL (users, projects, renders)
  S3/MinIO (video/audio storage)
```

---

## 📈 Code Quality Metrics

| Metric | Score | Notes |
|---|---|---|
| **Type Safety** | 7/10 | Backend: Pydantic ✅, Frontend: TS ✅, but `any` in places |
| **Error Handling** | 4/10 | try/catch exists but swallows errors silently |
| **Test Coverage** | 0/10 | No tests at all |
| **Documentation** | 1/10 | Docs exist in /docs but no README, no API reference |
| **Security** | 2/10 | No auth, path traversal, no upload validation |
| **Performance** | 5/10 | Blocking async, no caching, no job queue |
| **Maintainability** | 6/10 | Clean service separation, but prop drilling |
| **Deployability** | 7/10 | Docker Compose works, but no CI/CD |

**Overall: 4/10** — Functional MVP, not production-ready.

---

## 💡 Top 5 Recommendations (Immediate)

1. **Git commit NOW** — `git add -A && git commit -m "feat: v1.5 — auto-fit karaoke, style controls, deno, BPM-aware sync"` + `git tag v1.5.0`

2. **Path sanitization** — Add `os.path.realpath()` check + restrict to `TEMP_DIR`:
```python
def _safe_path(path: str) -> str:
    real = os.path.realpath(path)
    if not real.startswith(str(TEMP_DIR)):
        raise HTTPException(403, "Path outside allowed directory")
    return real
```

3. **File upload validation** — Check extension + size:
```python
ALLOWED = {'.mp3', '.wav', '.flac', '.ogg', '.m4a'}
MAX_SIZE = 50 * 1024 * 1024  # 50MB
```

4. **Async render** — Return job_id immediately, poll for status:
```python
# POST /api/render → {"job_id": "abc123"}
# GET /api/render/abc123/status → {"progress": 45, "status": "rendering"}
```

5. **README** — At minimum: what it is, how to run, API endpoints, architecture.

---

## 📝 API Endpoints Inventory

| Endpoint | Method | Status | Notes |
|---|---|---|---|
| `/health` | GET | ✅ | Basic health check |
| `/api/health` | GET | ✅ | Alias |
| `/api/analyze` | POST | ✅ | Video analysis (yt-dlp) |
| `/api/upload/audio` | POST | ✅ | Audio upload (needs validation) |
| `/api/audio-info` | POST | ✅ | BPM, RMS, beats, duration |
| `/api/audio-preview/{filename}` | GET | ✅ | Serve audio file |
| `/api/bpm` | POST | ✅ | BPM detection |
| `/api/beat-sync` | POST | ✅ | Beat-aligned fragments |
| `/api/fragments/select` | POST | ✅ | Auto-select fragments |
| `/api/fragments/replace` | POST | ✅ | Replace fragment |
| `/api/thumbnails` | POST | ✅ | Generate thumbnails |
| `/api/thumbnail/{filename}` | GET | ✅ | Serve thumbnail |
| `/api/transcribe` | POST | ✅ | Full transcription |
| `/api/transcribe-fragment` | POST | ✅ | Fragment transcription + forced alignment |
| `/api/subtitles/split` | POST | ✅ | Line-based split |
| `/api/subtitles/word-split` | POST | ✅ | Word-level split |
| `/api/subtitles/adjust` | POST | ✅ | Stretch + offset adjustment |
| `/api/render` | POST | ✅ | Render video (synchronous, blocking) |
| `/api/download/{filename}` | GET | ✅ | Download rendered video |

---

## 🎯 Version History

| Version | Date | Key Changes |
|---|---|---|
| v0.1 | 2026-08-07 | MVP: FastAPI + ffmpeg + React UI |
| v0.2 | 2026-08-16 | BPM detection, speech recognition, karaoke sync |
| v0.3 | 2026-08-16 | Audio fragment selection, timeline preview |
| v0.4 | 2026-08-16 | BPM octave correction, audio_start in render |
| v0.5 | 2026-08-16 | Drag handles, transcribe-fragment, word-split offset |
| v0.6 | 2026-08-16 | Forced alignment (direct/DTW/proportional) |
| v0.7 | 2026-08-16 | Double audio_start fix, separate dialogue lines |
| v0.8 | 2026-08-16 | VAD disabled, fragment_duration fallback, cron cleanup |
| v0.9 | 2026-08-16 | Stretch/offset UI, word editor, insert/delete |
| v1.0 | 2026-08-16 | Synchronized preview, unified audio, live regen |
| v1.1 | 2026-08-16 | BPM-aware distribution, user line breaks |
| v1.2 | 2026-08-16 | Display modes (line_highlight, word_by_word) |
| v1.3 | 2026-08-16 | Style controls in editor, style in preview |
| v1.4 | 2026-08-16 | Removed Style step, 4 steps total |
| v1.5 | 2026-08-16 | Auto-fit karaoke (auto/single_word), deno for yt-dlp |

---

*Generated by Hermes Agent — 2026-08-16*