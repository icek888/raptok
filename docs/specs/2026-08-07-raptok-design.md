# RapTok — Design Specification

> **Date:** 2026-08-07
> **Project:** RapTok — TikTok Content Maker for Rappers
> **Status:** Draft v1
> **Team:** Карлен (dev) + друг-рэпер (content/testing)

---

## 1. Overview

RapTok — веб-приложение, которое создаёт TikTok-клипы для рэперов из фрагментов фильмов/видео под их музыку. Пользователь вставляет ссылку на видео, загружает трек и текст песни — система нарезает случайные фрагменты, склеивает в 21-30сек ролик, накладывает субтитры и трек.

### Problem
Рэперам нужен постоянный TikTok контент. Ручная нарезка клипов занимает 30-60 минут на один ролик. RapTok делает это за 2 минуты.

### Solution
Автоматическая нарезка + редактор для контроля + рендер в TikTok формат (1080×1920).

---

## 2. User Flow

```
1. Paste video URL (rezka.ag / YouTube / direct mp4/m3u8)
2. Upload track (mp3, up to 10MB)
3. Paste lyrics text
4. [Analyze] → system downloads video, selects random fragments
5. Fragment Editor:
   - Preview each fragment (thumbnail + timing)
   - Replace any fragment (pick new timeframe from video)
   - Add / remove fragments
   - Adjust duration (3-5s each)
   - Total: 21-30s
6. Subtitle Editor:
   - Auto-split lyrics into lines
   - Each line mapped to a fragment's timeframe
   - Edit text, adjust timing
   - Style: font, color, stroke, position
7. Style Editor:
   - Font (5-10 options)
   - Text color + stroke color
   - Position (top / center / bottom)
   - Background blur toggle
8. [Generate Clip] → ffmpeg renders → progress bar
9. Preview result → Download MP4
```

---

## 3. Sources

### 3.1 rezka.ag
- Parse movie page → extract m3u8 URL
- Download via ffmpeg with Referer header
- Reuse logic from RezkaVideo project (patterns only, fresh code)
- Handle: movies, TV series (season/episode selection)

### 3.2 YouTube
- yt-dlp for download
- Quality: up to 1080p
- Format: mp4 preferred
- Handle: age-restricted (optional), playlists (single video only for MVP)

### 3.3 Direct URL
- ffmpeg direct download
- Supported: mp4, m3u8, webm, mkv
- Stream copy when possible (no re-encode)

---

## 4. Fragment Selection Algorithm

### Default Behavior
1. Get total video duration (ffprobe)
2. Divide timeline into N segments (N = total_duration / fragment_count)
3. From each segment, pick a random 3-5s window
4. Ensure no two fragments are within 10s of each other
5. Total clip duration: 21-30s (target 27s = 9 fragments × 3s)

### Parameters
| Parameter | Default | Range | User adjustable |
|-----------|---------|-------|-----------------|
| Fragment duration | 3s | 3-5s | Yes |
| Total clip duration | 21-30s | 15-60s | Yes |
| Number of fragments | 7-10 | 3-20 | Yes (auto-calculated) |
| Random seed | time-based | — | No (but "re-roll" button) |

### Re-roll
"Re-roll" button → new random selection with same parameters. User can re-roll until satisfied, then fine-tune individual fragments.

---

## 5. Subtitle System

### Auto-split Lyrics
1. Split text by lines (newline)
2. Group lines into subtitle blocks (1-2 lines per block)
3. Each block = one fragment duration
4. If more blocks than fragments → merge short lines
5. If fewer blocks than fragments → repeat/extend

### Manual Override
- Edit any subtitle block text
- Adjust start/end time per block
- Drag-and-drop reordering
- Add / remove blocks

### Style Options
| Option | Values | Default |
|--------|--------|---------|
| Font | Montserrat, Roboto, Impact, Bebas Neue, Oswald, Anton, Pacifico, permanent marker | Montserrat Bold |
| Font size | 40-100px | 70px |
| Text color | Color picker | White |
| Stroke color | Color picker | Black |
| Stroke width | 0-8px | 4px |
| Position | Top, Center, Bottom | Bottom (y=300 from top in 1920 height) |
| Background blur | On/Off | On |
| Text alignment | Left, Center, Right | Center |

---

## 6. Video Output

### Format
| Spec | Value |
|------|-------|
| Resolution | 1080×1920 (9:16 vertical) |
| FPS | 30 |
| Codec | H.264 (libx264) |
| Audio codec | AAC |
| Audio source | User's uploaded track (replaces original video audio) |
| Container | MP4 |
| File size target | < 50MB |

### Layout
```
┌──────────────┐
│              │  ← Blur background (from video, scaled + blurred)
│  ┌────────┐  │
│  │        │  │  ← Video fragment (centered, scaled to fit width)
│  │ VIDEO  │  │
│  │        │  │
│  └────────┘  │
│              │
│  "Lyrics"    │  ← Subtitle text (positioned per style)
│  "line 2"    │
│              │
└──────────────┘
1080 × 1920
```

### ffmpeg Pipeline
```
Step 1: Download source video
Step 2: Extract fragments (ffmpeg -ss START -t DURATION -i input -c copy fragment_N.mp4)
Step 3: Concatenate fragments (ffmpeg concat filter)
Step 4: Scale to 1080 width + blur background (filter_complex)
Step 5: Burn subtitles (ffmpeg -vf subtitles=custom.ass)
Step 6: Replace audio with user track (ffmpeg -map 0:v -map 1:a)
Step 7: Encode final (libx264, aac, -preset fast, -crf 22)
```

---

## 7. API Design (FastAPI)

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/analyze` | Download video, get duration, return metadata |
| POST | `/api/fragments/select` | Select random fragments, return list with thumbnails |
| POST | `/api/fragments/replace` | Replace specific fragment with new timeframe |
| POST | `/api/subtitles/split` | Auto-split lyrics, return subtitle blocks |
| POST | `/api/render` | Render final video with all settings |
| GET | `/api/render/{job_id}/status` | Poll render progress |
| GET | `/api/render/{job_id}/download` | Download finished MP4 |
| GET | `/api/video/{video_id}/thumbnail` | Get video frame at timestamp |

### Request/Response Examples

**POST /api/analyze**
```json
// Request
{ "url": "https://www.youtube.com/watch?v=xxx" }

// Response
{
  "video_id": "abc123",
  "duration": 3600.0,
  "width": 1920,
  "height": 1080,
  "source": "youtube",
  "title": "Movie Name",
  "status": "ready"
}
```

**POST /api/fragments/select**
```json
// Request
{
  "video_id": "abc123",
  "fragment_duration": 3,
  "total_duration": 27,
  "count": 9,
  "seed": null
}

// Response
{
  "fragments": [
    { "id": 0, "start": 145.3, "end": 148.3, "thumbnail": "/api/video/abc123/thumbnail?t=145.3" },
    { "id": 1, "start": 890.1, "end": 893.1, "thumbnail": "/api/video/abc123/thumbnail?t=890.1" },
    ...
  ],
  "total_duration": 27.0
}
```

**POST /api/render**
```json
// Request
{
  "video_id": "abc123",
  "fragments": [
    { "start": 145.3, "end": 148.3 },
    { "start": 890.1, "end": 893.1 },
    ...
  ],
  "audio_path": "uploads/track_123.mp3",
  "subtitles": [
    { "start": 0.0, "end": 3.0, "text": "В этих улицах я нашёл свой дом" },
    { "start": 3.0, "end": 6.0, "text": "Где каждый шаг как бит" },
    ...
  ],
  "style": {
    "font": "Montserrat-Bold",
    "font_size": 70,
    "text_color": "#FFFFFF",
    "stroke_color": "#000000",
    "stroke_width": 4,
    "position": "bottom",
    "blur_background": true
  }
}

// Response
{ "job_id": "render_xyz789", "status": "queued" }
```

---

## 8. Frontend Architecture (React)

### Components

```
src/
├── App.tsx                      # Main layout
├── components/
│   ├── InputPanel.tsx           # URL input, track upload, lyrics textarea
│   ├── VideoPreview.tsx         # HTML5 video player for source video
│   ├── FragmentEditor.tsx       # Fragment list with thumbnails, replace/shift/add
│   ├── FragmentCard.tsx         # Single fragment: thumbnail, timing, controls
│   ├── SubtitleEditor.tsx       # Subtitle blocks table, text + timing
│   ├── SubtitleRow.tsx          # Single subtitle row: time, text, drag handle
│   ├── StyleEditor.tsx          # Font, color, position, blur controls
│   ├── RenderProgress.tsx       # Progress bar during render
│   ├── ResultPreview.tsx        # Final video preview + download
│   └── Timeline.tsx             # Visual timeline of fragments + subtitles
├── api/
│   └── client.ts                # Fetch wrapper for backend API
├── types/
│   └── index.ts                 # TypeScript interfaces
└── hooks/
    ├── useVideoAnalyze.ts       # Analyze video hook
    ├── useFragments.ts          # Fragment selection + management
    └── useRender.ts             # Render polling hook
```

### Key UX Features
- **Drag-and-drop** subtitle reordering
- **Timeline visualizer** — see fragments and subtitles on a timeline
- **Live preview** — subtitle text updates as you type
- **Thumbnail gallery** — each fragment shows a preview frame
- **Re-roll button** — new random fragments with one click
- **Progress feedback** — real-time render percentage

---

## 9. Backend Architecture (FastAPI)

```
backend/
├── main.py                      # FastAPI app, CORS, routes
├── routers/
│   ├── analyze.py               # Video analysis endpoints
│   ├── fragments.py             # Fragment selection endpoints
│   ├── subtitles.py             # Subtitle processing
│   └── render.py                # Render queue + progress
├── services/
│   ├── downloader.py            # Video download (yt-dlp, ffmpeg, rezka parser)
│   ├── fragment_selector.py     # Random fragment selection algorithm
│   ├── subtitle_generator.py    # ASS subtitle file generation
│   ├── video_renderer.py        # ffmpeg render pipeline
│   └── thumbnail_generator.py   # Frame extraction for previews
├── models/
│   ├── schemas.py               # Pydantic models for API
│   └── job.py                   # Render job tracking
├── utils/
│   ├── ffmpeg_helper.py         # ffmpeg command builder
│   └── file_manager.py          # Temp file management
└── config.py                    # Settings, paths, limits
```

---

## 10. Docker Setup

```yaml
# docker-compose.yml
version: '3.8'
services:
  raptok-backend:
    build: ./backend
    ports:
      - "8000:8000"
    volumes:
      - ./uploads:/app/uploads
      - ./renders:/app/renders
      - ./temp:/app/temp
    environment:
      - MAX_FILE_SIZE_MB=500
      - RENDER_TIMEOUT=300
      - CLEANUP_INTERVAL=3600

  raptok-frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    depends_on:
      - raptok-backend
    environment:
      - VITE_API_URL=http://localhost:8000
```

### Backend Dockerfile
```dockerfile
FROM python:3.12-slim
RUN apt-get update && apt-get install -y ffmpeg yt-dlp
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Frontend Dockerfile
```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY . .
RUN npm run build
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "3000"]
```

---

## 11. File Management

### Temp Files Lifecycle
```
1. Download: /app/temp/{video_id}/source.mp4 (up to 500MB)
2. Fragments: /app/temp/{video_id}/frag_{N}.mp4 (3-5s each)
3. Thumbnails: /app/temp/{video_id}/thumb_{N}.jpg
4. Subtitles: /app/temp/{job_id}/subtitles.ass
5. Render: /app/renders/{job_id}/output.mp4
6. Cleanup: cron job deletes temp/ older than 1 hour, renders/ older than 24h
```

### Limits
| Resource | Limit |
|----------|-------|
| Source video max size | 500MB |
| Track max size | 10MB |
| Concurrent renders | 3 |
| Render timeout | 300s |
| Temp file retention | 1 hour |
| Render file retention | 24 hours |

---

## 12. Security

| Concern | Mitigation |
|---------|-----------|
| Malicious URLs | Validate URL format, block localhost/LAN IPs |
| Large files | Size limits on upload + download |
| ffmpeg injection | Sanitize all user input, use subprocess list (not shell) |
| Path traversal | Use UUIDs for file paths, no user-controlled paths |
| CORS | Restrict to frontend domain |
| Rate limiting | 10 analyze requests / hour per IP (free tier) |

---

## 13. Future Features (Post-MVP)

| Feature | Priority | Description |
|---------|----------|-------------|
| User accounts | P1 | Registration, login, save projects |
| Watermark (free tier) | P1 | Small "Made with RapTok" on free clips |
| Multiple clips batch | P2 | Generate 5 variations from same source |
| Beat-sync | P2 | Auto-sync fragment cuts to beat drops |
| AI text generation | P2 | GPT for catchy captions |
| Voice-to-text | P3 | Auto-transcribe lyrics from audio |
| TikTok direct posting | P3 | API integration for auto-posting |
| Template library | P3 | Pre-made style presets |
| Team accounts | P3 | Shared projects, roles |

---

## 14. Success Metrics

| Metric | Target (3 months) |
|--------|-------------------|
| Active users | 100 |
| Clips generated | 1,000 |
| Free → Pro conversion | 5% |
| Paying users | 5-10 |
| Monthly revenue | $50-150 |

---

## 15. References

- RezkaVideo project: `/home/karlen/project/RezkaVideo/vtdtsl/` — patterns for m3u8 parsing, TikTok format rendering
- `make_tiktok_format()` from render_one_video.py — blur bg + text overlay pattern
- ffmpeg filter_complex for compositing
- yt-dlp for YouTube downloads