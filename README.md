# RapTok — TikTok Content Maker for Rappers

> Transform music videos into TikTok-ready vertical clips with synchronized karaoke subtitles.

## Overview

RapTok is a full-stack web application that automates the creation of TikTok-style
vertical videos (9:16, 1080×1920) from music sources. It downloads video, separates
vocals, transcribes lyrics with word-level timing, and renders professional karaoke-style
subtitles overlaid on the video.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React 19)                    │
│  Vite + TypeScript + TailwindCSS 4                       │
│                                                          │
│  5-Step Workflow:                                        │
│  1. Input      → URL/upload + lyrics                    │
│  2. Fragments  → Beat-synced video segment selection    │
│  3. Subtitles  → WhisperX transcription + word editor   │
│  4. Preview    → Live CSS preview + template/style       │
│  5. Render     → Final ffmpeg render with ASS subtitles  │
└──────────────────────┬──────────────────────────────────┘
                       │ /api/*
┌──────────────────────┴──────────────────────────────────┐
│                Backend (FastAPI + Python 3.11)            │
│                                                          │
│  Services:                                               │
│  ├── downloader.py       — yt-dlp (YouTube/Rezka/Direct) │
│  ├── stem_separator.py   — Kim_Vocal_2.onnx (CPU)        │
│  ├── speech_recognizer.py— WhisperX 3.8.6 (small, int8)  │
│  ├── forced_alignment.py — DTW + fuzzy matching           │
│  ├── subtitle_generator.py— ASS generation + grouping    │
│  ├── video_renderer.py   — ffmpeg subprocess pipeline    │
│  ├── audio_analyzer.py   — BPM, mood, energy, genre      │
│  ├── bpm_detector.py     — Beat detection (librosa)       │
│  └── fragment_selector.py— Smart fragment selection       │
│                                                          │
│  Docker: python:3.11-slim + ffmpeg + deno + torch CPU    │
│  Deploy: docker-compose + Traefik (TLS, rate limit)      │
└─────────────────────────────────────────────────────────┘
```

## Key Features

### Video Processing
- **Download**: YouTube (android player_client), Rezka.ag (m3u8), Direct URLs
- **Stem Separation**: Kim_Vocal_2.onnx model, CPU-only, ~65s per track
- **Transcription**: WhisperX 3.8.6 (small model, int8 quantization, CPU)
  - Word-level timestamps (<100ms accuracy)
  - wav2vec2 alignment
  - pyannote VAD (built-in)
  - ~48s pipeline for 3-minute track

### Subtitle System
- **Word-level timing**: Each word has start/end/probability
- **Display modes**: line_highlight, word_by_word, single_word, auto
- **Karaoke mode**: Active word highlighted with color transition
- **3 Templates**:
  - **Cinematic**: Montserrat 68px, bottom, gold highlight, subtle blur
  - **Big Words**: Oswald 110px, center, cyan, full-screen zoom
  - **Neon Pop**: Russo One 85px, center, neon glow, dark overlay

### Frontend Workflow (5 Steps)
1. **Input** — Paste URL or upload audio + lyrics
2. **Fragments** — Beat-synced segment selection (BPM-aware)
3. **Subtitles** — Transcription with timeline editor + word editor
4. **Preview** — Live CSS preview with template/style controls
5. **Render** — Final ffmpeg render with ASS subtitles

### Render Output
- **Format**: MP4 (H.264 + AAC)
- **Resolution**: 1080×1920 (9:16 TikTok)
- **FPS**: 30
- **Subtitles**: ASS format with karaoke effects
- **Video modes**: blur background, zoom, clear center

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/analyze` | POST | Download + analyze video (ffprobe) |
| `/api/fragments/select` | POST | Auto-select fragments |
| `/api/fragments/replace` | POST | Replace single fragment |
| `/api/thumbnails` | POST | Generate thumbnails at timestamps |
| `/api/upload/audio` | POST | Upload audio file |
| `/api/bpm` | POST | Detect BPM from audio |
| `/api/beat-sync` | POST | Beat-synced fragment selection |
| `/api/audio-info` | POST | Get audio duration/metadata |
| `/api/track-analysis` | POST | Mood, energy, genre, hook detection |
| `/api/transcribe-full` | POST | Full transcription (WhisperX) |
| `/api/transcribe-full-stream` | POST | SSE streaming transcription with progress |
| `/api/subtitles/word-split` | POST | Split lyrics into word-level subtitles |
| `/api/render` | POST | Render final video |
| `/api/templates` | GET | List render templates |
| `/api/video/{filename}` | GET | Serve source video for preview |
| `/api/download/{filename}` | GET | Download rendered video |
| `/api/thumbnail/{filename}` | GET | Serve thumbnail image |

## Tech Stack

### Backend
- **FastAPI** — async API framework
- **WhisperX 3.8.6** — transcription + alignment
- **audio-separator** — Kim_Vocal_2 vocal isolation
- **torch 2.8.0** — CPU-only inference
- **ffmpeg** — video processing
- **yt-dlp** — video download
- **librosa** — audio analysis (BPM, beats)

### Frontend
- **React 19.2.8** — UI framework
- **Vite 8** — build tool
- **TypeScript** — type safety
- **TailwindCSS 4.3.3** — styling
- **lucide-react** — icons

### Infrastructure
- **Docker Compose** — containerization
- **Traefik** — reverse proxy + TLS
- **Let's Encrypt** — SSL certificates
- **Nginx** — frontend static serving

## Deployment

```bash
# Build frontend
cd frontend && npm run build

# Deploy
cd .. && docker compose up -d --build

# Health check
curl https://jimmy.hotloads.llc/api/health
```

## Environment

- **Server**: Intel Xeon Gold 6230N, 20 cores, 125GB RAM, **NO GPU**
- **All ML inference runs on CPU** (int8 quantization)
- **Pipeline time**: ~113s (stem separation 65s + WhisperX 48s)

## Project Structure

```
raptok/
├── backend/
│   ├── main.py                 # FastAPI app
│   ├── config.py               # Configuration
│   ├── Dockerfile              # Backend container
│   ├── requirements.txt        # Python deps
│   ├── models/
│   │   └── schemas.py          # Pydantic models
│   └── services/
│       ├── downloader.py       # Video download
│       ├── stem_separator.py   # Vocal isolation
│       ├── speech_recognizer.py# WhisperX
│       ├── forced_alignment.py # DTW alignment
│       ├── subtitle_generator.py# ASS generation
│       ├── video_renderer.py   # ffmpeg render
│       ├── audio_analyzer.py   # Track analysis
│       ├── bpm_detector.py     # Beat detection
│       └── fragment_selector.py# Fragment selection
├── frontend/
│   ├── src/
│   │   ├── App.tsx             # Main app (5-step workflow)
│   │   ├── main.tsx            # Entry point
│   │   ├── types.ts            # TypeScript types
│   │   ├── api/
│   │   │   └── client.ts       # API client
│   │   └── components/
│   │       ├── InputPanel.tsx       # Step 1
│   │       ├── FragmentEditor.tsx   # Step 2
│   │       ├── SubtitleEditor.tsx   # Step 3
│   │       ├── VideoPreviewEditor.tsx # Step 4
│   │       ├── RenderPanel.tsx      # Step 5
│   │       ├── TimelinePreview.tsx  # Timeline widget
│   │       ├── PreviewFrame.tsx     # Video+subtitle preview
│   │       └── TrackAnalysisPanel.tsx # Mood/energy panel
│   ├── dist/                   # Built frontend
│   └── package.json
├── docker-compose.yml          # Container orchestration
├── nginx-internal.conf         # Frontend nginx config
├── output/                     # Rendered videos
└── tmp/                        # Temp files (cleaned daily)
```

## Changelog

### v2.1 (2026-08-28)
- Video Preview Editor with CSS Live Preview (Step 4)
- ASS color conversion bug fixed (alpha prefix stripping)
- Fragments visualization on timeline
- Video serving endpoint (`/api/video/{filename}`)

### v2.0 (2026-08-28)
- SSE progress bar for transcription
- Timeline ↔ Edit Words synchronization
- Style merge: user changes override template defaults
- 5-step workflow (added Preview step)

### v1.8 (2026-08-28)
- WhisperX 3.8.6 integration (replaces faster-whisper + MMS FA)
- DTW alignment fix (fuzzy matching + position align)
- Stem separator cross-device fix (shutil.move)
- 3 render templates (Cinematic, Big Words, Neon Pop)
- Deep Track Analysis (mood, energy, genre, hook)

### v1.6 (2026-08-27)
- Word Timeline Editor (80x zoom, scroll minimap)
- 5 Cyrillic fonts
- YouTube 403 fix (android player_client)
- ML stem separation (Kim_Vocal_2.onnx)
- Drag fragment on timeline

### v1.0 (2026-08-25)
- Initial release
- 4-step workflow
- FastAPI + ffmpeg + yt-dlp
- ASS subtitle generation
- TikTok 9:16 format

## License

MIT

## Author

[icek888](https://github.com/icek888)