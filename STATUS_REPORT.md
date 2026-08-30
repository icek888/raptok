# RapTok — Project Status Report
**Version:** v2.2  
**Date:** 2026-08-29  
**Repository:** https://github.com/icek888/raptok  
**Tag:** `v2.2` (commit `4350bcd`)  
**Server:** jimmy.hotloads.llc (46.19.99.150) — CPU only, 20 cores, 125GB RAM  

---

## 1. Project Overview

RapTok — TikTok-style rap video generator. 5-step workflow:

```
Input → Fragments → Subtitles → Preview → Render
 (0)       (1)        (2)        (3)      (4)
```

| Step | Description | Key Components |
|------|-------------|----------------|
| **0. Input** | YouTube/Rezka/Direct URL + audio upload + lyrics | InputPanel, downloader.py |
| **1. Fragments** | Select video fragments (random or beat-synced) | FragmentEditor, fragment_selector.py, auto_cut.py |
| **2. Subtitles** | Transcribe audio → edit words → style subtitles | SubtitleEditor, speech_recognizer.py, forced_alignment.py |
| **3. Preview** | Concat fragments + audio + subtitles preview | VideoPreviewEditor, TimelinePreview, PreviewFrame |
| **4. Render** | Final 1080×1920 30fps TikTok render | RenderPanel, video_renderer.py |

---

## 2. Architecture

### Backend (Python / FastAPI)

```
backend/                          # 4777 lines total
├── main.py                       #   78 lines — thin entry point (app + CORS + auth middleware + routers)
├── config.py                     #   25 lines — paths, ffmpeg settings, output format
├── models/
│   └── schemas.py                #  285 lines — Pydantic models (all request/response types)
├── routers/                      # API endpoints (9 routers)
│   ├── auth.py                   #  141 lines — login, logout, auth-check (HMAC session cookies)
│   ├── health.py                 #   16 lines — /health, /api/health, /api/templates
│   ├── files.py                  #   57 lines — serve video/audio/thumbnail/download/upload
│   ├── video.py                  #   67 lines — analyze, fragments/select, fragments/replace, thumbnails
│   ├── subtitles.py              #   76 lines — split, word-split, adjust
│   ├── audio.py                  #  112 lines — bpm, audio-info, track-analysis, beat-sync
│   ├── transcription.py          #  189 lines — transcribe, transcribe-full, SSE stream, stem-separate
│   ├── render.py                 #  190 lines — render, prepare-preview
│   └── features.py               #  120 lines — feature flags, emotion, genre, auto-cut, snap-to-beats
└── services/                     # Business logic (15 services)
    ├── audio_analyzer.py         #  419 lines — mood, energy, genre, hook, sections (librosa)
    ├── subtitle_generator.py     #  450 lines — ASS subtitle generation, templates
    ├── forced_alignment.py       #  387 lines — DTW lyric-to-audio alignment
    ├── speech_recognizer.py      #  190 lines — WhisperX transcription + word timestamps
    ├── video_renderer.py         #  215 lines — ffmpeg concat + scale + blur + burn subtitles
    ├── stem_separator.py         #  259 lines — vocal/instrumental separation (audio-separator)
    ├── downloader.py             #  209 lines — YouTube/Rezka/Direct video download
    ├── genre_template.py         #  230 lines — HF genre classification → auto template (NEW)
    ├── emotion_style.py          #  225 lines — Music2Emo → auto subtitle style (NEW)
    ├── beat_effects.py           #  227 lines — zoom/flash/shake on beats (ffmpeg) (NEW)
    ├── auto_cut.py               #  171 lines — smart cut at energy peaks + snap to beats (NEW)
    ├── vocal_enhance.py          #  124 lines — Resemble/ClearerVoice/ffmpeg denoise (NEW)
    ├── bpm_detector.py           #  109 lines — BPM detection + beat tracking (librosa)
    ├── fragment_selector.py      #   77 lines — random fragment selection + replace
    ├── features.py               #   87 lines — FeatureFlags dataclass (env-var toggles) (NEW)
    └── thumbnail_generator.py    #   26 lines — ffmpeg thumbnail extraction
```

### Frontend (React 19 / TypeScript / TailwindCSS 4)

```
frontend/src/                     # 4906 lines total
├── main.tsx                      #   10 lines — React entry
├── App.tsx                       #  349 lines — state management, step flow, auth gate
├── types.ts                      #  196 lines — TypeScript interfaces
├── api/
│   └── client.ts                 #  283 lines — API client (all endpoints + features)
├── components/
│   ├── SubtitleEditor.tsx        # 1033 lines — transcription, word editing, style controls
│   ├── VideoPreviewEditor.tsx    #  686 lines — preview with concat video + audio + subs
│   ├── TimelinePreview.tsx       #  599 lines — timeline with waveform, fragments, subtitles
│   ├── FeaturePanel.tsx          #  475 lines — AI enhancement sidebar (NEW)
│   ├── FragmentEditor.tsx        #  295 lines — fragment selection + beat sync
│   ├── TrackAnalysisPanel.tsx    #  256 lines — mood/energy/genre display
│   ├── PreviewFrame.tsx          #  235 lines — video preview frame with live subtitles
│   ├── InputPanel.tsx            #  154 lines — URL input + audio upload + lyrics
│   ├── RenderPanel.tsx           #  135 lines — render button + progress + download
│   └── Login.tsx                 #   95 lines — auth login form (NEW)
└── utils/
    ├── colors.ts                 #   30 lines — ASS color conversion
    ├── templates.ts              #   46 lines — render template definitions
    ├── format.ts                 #   15 lines — time formatting
    └── constants.ts              #   14 lines — UI constants
```

### Infrastructure

```
Docker Compose:
├── raptok-frontend    — nginx:stable, serves frontend/dist (read-only)
├── raptok-backend     — python:3.11-slim + ffmpeg 7.x + deno + WhisperX
├── Traefik            — TLS, routing, rate limiting (100 avg / 50 burst)
└── Volumes:
    ├── ./backend       → /app (hot reload)
    ├── ./output        → /output (rendered videos)
    ├── ./tmp           → /tmp/raptok (temp files, cron cleanup 4:00 daily)
    └── ./frontend/public/fonts → /usr/share/fonts/truetype/custom (Cyrillic)
```

---

## 3. API Endpoints (30 total)

### Core (12)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/templates` | GET | Render templates list |
| `/api/analyze` | POST | Analyze video (URL → VideoInfo) |
| `/api/fragments/select` | POST | Select random fragments |
| `/api/fragments/replace` | POST | Replace single fragment |
| `/api/thumbnails` | POST | Generate thumbnails |
| `/api/render` | POST | Final render (1080×1920) |
| `/api/prepare-preview` | POST | Prepare preview clip (concat + audio + subs) |
| `/api/upload/audio` | POST | Upload audio file |
| `/api/video/{filename}` | GET | Serve video file |
| `/api/audio-preview/{filename}` | GET | Serve audio file |
| `/api/download/{filename}` | GET | Download rendered video |

### Audio (4)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/bpm` | POST | Detect BPM + extract beats |
| `/api/audio-info` | POST | Audio info (duration, BPM, RMS, suggested start) |
| `/api/track-analysis` | POST | Deep analysis (mood, energy, genre, hook, sections) |
| `/api/beat-sync` | POST | Beat-synced fragment selection |

### Subtitles (3)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/subtitles/split` | POST | Split lyrics into subtitle lines |
| `/api/subtitles/word-split` | POST | Word-level split |
| `/api/subtitles/adjust` | POST | Adjust subtitle timing |

### Transcription (4)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/transcribe` | POST | WhisperX transcription |
| `/api/transcribe-full` | POST | Full transcription with alignment |
| `/api/transcribe-full-stream` | POST | SSE streaming transcription |
| `/api/stem-separate` | POST | Vocal/instrumental separation |

### Auth (3)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/login` | POST | Login (username + password → session cookie) |
| `/api/auth/logout` | POST | Logout (clear session) |
| `/api/auth/check` | GET | Check session validity |

### Features (5) — NEW in v2.2
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/features` | GET | Feature flags status |
| `/api/features/emotion` | POST | Analyze emotion → recommended style |
| `/api/features/genre` | POST | Classify genre → recommended template |
| `/api/features/auto-cut` | POST | Smart cut at energy peaks |
| `/api/features/snap-to-beats` | POST | Snap fragments to beat positions |

---

## 4. Component Status

### Backend Services

| Service | Status | Notes |
|---------|--------|-------|
| `audio_analyzer.py` | ✅ Active | librosa-based mood/energy/genre/hook/sections |
| `subtitle_generator.py` | ✅ Active | ASS generation, 3 templates (Cinematic, Big Words, Neon Pop) |
| `forced_alignment.py` | ✅ Active | DTW alignment for lyrics → audio sync |
| `speech_recognizer.py` | ✅ Active | WhisperX, default model=small, large-v3 for quality |
| `video_renderer.py` | ✅ Active | ffmpeg concat + scale + blur + burn + beat effects hook |
| `stem_separator.py` | ✅ Active | audio-separator (Kim_Vocal_2 model) |
| `downloader.py` | ✅ Active | yt-dlp + deno (YouTube, Rezka, Direct) |
| `bpm_detector.py` | ✅ Active | librosa beat_track + octave correction |
| `fragment_selector.py` | ✅ Active | Random selection + replace |
| `thumbnail_generator.py` | ✅ Active | ffmpeg thumbnail extraction |
| `features.py` | ✅ Active | FeatureFlags dataclass, env-var toggles |
| `beat_effects.py` | ⚠️ Implemented | zoom/flash/shake ffmpeg filters. **Not tested in render yet** |
| `emotion_style.py` | ⚠️ Implemented | Music2Emo integration. **Music2Emo NOT installed** — falls back to heuristic |
| `genre_template.py` | ⚠️ Implemented | HF genre model. **transformers NOT installed** — falls back to heuristic |
| `auto_cut.py` | ⚠️ Implemented | Smart cut + snap. **Not integrated in FragmentEditor UI** |
| `vocal_enhance.py` | ⚠️ Implemented | **Disabled by default** (RAPTOK_VOCAL_ENHANCE=0) |

### Frontend Components

| Component | Status | Notes |
|-----------|--------|-------|
| `App.tsx` | ✅ Active | Auth gate, step flow, state management |
| `InputPanel.tsx` | ✅ Active | URL input, audio upload, lyrics |
| `FragmentEditor.tsx` | ✅ Active | Random + beat-sync fragment selection |
| `SubtitleEditor.tsx` | ✅ Active | Transcription, word editing, style controls |
| `VideoPreviewEditor.tsx` | ✅ Active | Backend concat preview (video + audio + subs) |
| `TimelinePreview.tsx` | ✅ Active | Waveform, fragment markers, subtitle timeline |
| `PreviewFrame.tsx` | ✅ Active | Video frame with live CSS subtitles |
| `TrackAnalysisPanel.tsx` | ✅ Active | Mood/energy/genre display (inside SubtitleEditor) |
| `RenderPanel.tsx` | ✅ Active | Render button, progress, download |
| `Login.tsx` | ✅ Active | Auth login form |
| `FeaturePanel.tsx` | ⚠️ Partial | UI built, but placement needs rework (see §6) |

---

## 5. Duplicate Functionality Analysis

### 5.1 Genre Detection — 🔴 DUPLICATE (3 implementations)

| Location | Function | Method | Used? |
|----------|----------|--------|-------|
| `audio_analyzer.py:340` | `guess_genre()` | Heuristic (tempo, bass, ZCR, centroid) | ✅ Called by `analyze_track()` → `/api/track-analysis` |
| `genre_template.py:119` | `classify_genre()` | HF model `dima806/music_genres_classification` | ✅ Called by `/api/features/genre` |
| `genre_template.py:177` | `_fallback_genre()` | Calls `audio_analyzer.analyze_track()` → `guess_genre()` | ✅ Fallback when HF model unavailable |

**Problem:** `classify_genre()` and `_fallback_genre()` both ultimately call `analyze_track()` which calls `guess_genre()`. When HF model is not installed, the genre result comes from `guess_genre()` via two different code paths. The HF model path also loads audio a third time (`librosa.load` at sr=16000).

**Audio loading duplication:**
- `bpm_detector.py:19` → `librosa.load(audio_path, sr=22050)`
- `audio_analyzer.py:54` → `librosa.load(audio_path, sr=22050)`
- `genre_template.py:142` → `librosa.load(audio_path, sr=16000)`

Same audio file loaded 3 times at different sample rates.

**Recommendation:** Merge `genre_template.py` into `audio_analyzer.py`. `analyze_track()` already returns `genre_hint` — add `recommended_template` to its output. Remove `genre_template.py` as separate service. One `librosa.load` for all analysis.

### 5.2 Mood / Emotion Detection — 🔴 DUPLICATE (3 implementations)

| Location | Function | Method | Used? |
|----------|----------|--------|-------|
| `audio_analyzer.py:202` | `classify_mood()` | Heuristic (energy, valence, aggressiveness, brightness, key) | ✅ Called by `analyze_track()` |
| `emotion_style.py:111` | `analyze_emotion()` | Music2Emo model | ✅ Called by `/api/features/emotion` |
| `emotion_style.py:164` | `_fallback_emotion()` | Calls `audio_analyzer.analyze_track()` → `classify_mood()` | ✅ Fallback |

**Problem:** Same pattern as genre. `analyze_emotion()` calls Music2Emo, falls back to `analyze_track()` → `classify_mood()`. Three different mood labels in the codebase:
1. `classify_mood()` → "Dark Hype", "Upbeat", "Intense", "Energetic", "Melancholic", "Chill", "Moody", "Balanced"
2. `emotion_style.py MOOD_STYLE_MAP` → "angry", "excited", "happy", "sad", "relaxed", "neutral"
3. Music2Emo model → returns its own mood labels

**Recommendation:** Merge `emotion_style.py` into `audio_analyzer.py`. `analyze_track()` already returns mood + mood_scores. Add `recommended_style` to output. Remove separate emotion service.

### 5.3 BPM / Beat Detection — 🟡 PARTIAL DUPLICATE

| Location | Function | Method | Used? |
|----------|----------|--------|-------|
| `bpm_detector.py:7` | `detect_bpm()` | `librosa.beat.beat_track()` + octave correction | ✅ `/api/bpm`, `/api/beat-sync` |
| `audio_analyzer.py:124` | inline | `librosa.feature.tempo()` (no beat_track) | ✅ Inside `analyze_track()` |

**Problem:** `bpm_detector.py` uses `beat_track()` (returns beat timestamps). `audio_analyzer.py` uses `tempo()` (returns only BPM number, no beats). Both load the same audio file independently.

**Recommendation:** `audio_analyzer.py` should call `bpm_detector.detect_bpm()` instead of inline `librosa.feature.tempo()`. This gives `analyze_track()` access to beat timestamps too (useful for `auto_cut.py` and `beat_effects.py`).

### 5.4 Fragment Selection — 🟡 PARTIAL DUPLICATE

| Location | Function | Method | Used? |
|----------|----------|--------|-------|
| `fragment_selector.py:6` | `select_fragments()` | Random selection | ✅ `/api/fragments/select` |
| `auto_cut.py:94` | `smart_cut()` | Energy peaks + beat snapping | ✅ `/api/features/auto-cut` |
| `routers/audio.py:77` | `/api/beat-sync` | Beat-aligned selection (calls `bpm_detector.get_beat_aligned_starts`) | ✅ Beat sync endpoint |

**Problem:** Three different fragment selection algorithms. `beat-sync` and `auto_cut.smart_cut()` overlap — both select fragments using beats. `beat-sync` uses beat positions, `smart_cut` uses energy peaks + beats.

**Recommendation:** Unify. `auto_cut.smart_cut()` should supersede `beat-sync` endpoint. Or: `beat-sync` should call `auto_cut.smart_cut()` internally.

### 5.5 Vocal Enhancement — 🟢 NOT DUPLICATE

`vocal_enhance.py` has 3 methods (resemble, clearervoice, ffmpeg) but they're alternatives, not duplicates. Only one runs based on config. ✅ Clean.

---

## 6. Pending Work

### Discussed & Agreed (not yet implemented)

| # | Task | Priority | Status |
|---|------|----------|--------|
| 1 | **Merge emotion + genre → one "AI Style" component** on Subtitles step | High | Discussed, not started |
| 2 | **Move Auto Cut + Snap to Fragments step** (sidebar) | High | Discussed, not started |
| 3 | **Beat Effects toggle on Preview step** | High | Discussed, not started |
| 4 | **Vocal Enhance as background option** (SNR check) | Medium | Discussed, not started |
| 5 | **Preview improvement** — beat markers on timeline, full preview with effects | High | Discussed, not started |
| 6 | **Install Music2Emo** in Docker container | Medium | Requirements identified, not installed |
| 7 | **WhisperX large-v3** as default model | Medium | User preference noted, env var exists |
| 8 | **FeaturePanel placement rework** — move from Render to Preview/Fragments | High | Discussed, not started |

### Known Issues

| # | Issue | Severity | Location |
|---|-------|----------|----------|
| 1 | Path traversal — `/api/download/{filename}` no `..` check | 🔴 Critical | `files.py` |
| 2 | SSRF — downloader passes URL to ffmpeg without validation | 🔴 Critical | `downloader.py` |
| 3 | CORS still `*` in main.py | 🟠 High | `main.py:15` |
| 4 | Docker runs as root | 🟠 High | `Dockerfile` |
| 5 | No upload size limit | 🟠 High | `files.py:49` |
| 6 | `beat_effects.py` not tested in actual render | 🟡 Medium | `video_renderer.py:122` |
| 7 | `auto_cut.py` not wired to FragmentEditor UI | 🟡 Medium | `FeaturePanel.tsx` |
| 8 | Docker container writable layer = 24.3 GB (pip cache, model cache) | 🟡 Medium | Container |
| 9 | `genre_template.py` and `emotion_style.py` duplicate `audio_analyzer.py` | 🟡 Medium | See §5 |
| 10 | Traefik dashboard exposed on :8080 without auth | 🟢 Low | Infrastructure |

### Version History

| Tag | Date | Key Changes |
|-----|------|-------------|
| v1.5.0 | earlier | Initial working version |
| v1.6.0 | earlier | Beat sync + BPM detection |
| v1.8 | earlier | WhisperX transcription + word timestamps |
| v2.0 | earlier | Preview editor + timeline |
| v2.1 | 2026-08-28 | Preview concat fix, style override, deep track analysis |
| **v2.2** | **2026-08-29** | **Auth system, 5 AI features (modular), FeaturePanel UI, main.py refactor, security audit** |

---

## 7. Summary

**RapTok v2.2** is a functional TikTok video generator with:
- 30 API endpoints across 9 routers
- 15 backend services (4777 lines)
- 11 frontend components (4906 lines)
- Auth system with session cookies
- 5 modular AI features (toggile via env vars)
- 3 render templates (Cinematic, Big Words, Neon Pop)
- WhisperX transcription with word-level timestamps
- Beat-synced fragment selection
- Deep audio analysis (mood, energy, genre, hook, sections)

**Main technical debt:**
- Genre detection duplicated 3× (should merge into `audio_analyzer.py`)
- Mood/emotion detection duplicated 3× (same pattern)
- BPM detected 2× independently (should share `bpm_detector.py`)
- Fragment selection has 3 overlapping algorithms
- Audio file loaded up to 3× per analysis request
- 5 new AI features implemented but not fully integrated in UI
- Preview step needs beat markers + effects toggle

**Next milestone (v2.3):** Merge duplicates, finalize FeaturePanel placement, install Music2Emo, improve preview.