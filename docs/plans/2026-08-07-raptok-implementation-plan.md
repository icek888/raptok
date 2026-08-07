# RapTok — Implementation Plan

> **Date:** 2026-08-07
> **Based on:** `docs/specs/2026-08-07-raptok-design.md`
> **Total est:** 5-6 weeks (solo + AI)

---

## Phase 1 — Backend MVP (Week 1-2)

**Goal:** FastAPI server that downloads a video, selects fragments, renders a TikTok clip.

### Task 1.1: Project scaffold
- Create `/home/karlen/project/raptok/` structure
- `backend/` — FastAPI, `frontend/` — React (empty for now)
- `requirements.txt`: fastapi, uvicorn, pydantic, python-multipart
- `backend/main.py` — basic app with health check
- **Verify:** `uvicorn main:app` starts, `GET /health` returns 200

### Task 1.2: Video downloader service
- `backend/services/downloader.py`
- `download_video(url) -> {path, duration, width, height, title}`
- Sources:
  - Direct URL (mp4/m3u8) → ffmpeg
  - YouTube → yt-dlp
  - rezka.ag → parse page, extract m3u8, ffmpeg with Referer header
- Use ffprobe for metadata
- **Verify:** Download a YouTube video, get duration + resolution

### Task 1.3: Fragment selector
- `backend/services/fragment_selector.py`
- `select_fragments(duration, fragment_duration, count, seed) -> [{start, end}]`
- Algorithm: divide timeline into N segments, pick random window from each
- Ensure minimum 10s gap between fragments
- `replace_fragment(duration, current_fragments, fragment_id, new_start) -> updated_list`
- **Verify:** Select 9 fragments from a 60min video, verify no overlaps

### Task 1.4: Thumbnail generator
- `backend/services/thumbnail_generator.py`
- `get_thumbnail(video_path, timestamp) -> jpg_path`
- ffmpeg `-ss {timestamp} -frames:v 1` for single frame extraction
- **Verify:** Get thumbnail at 30s mark from test video

### Task 1.5: Subtitle generator (ASS format)
- `backend/services/subtitle_generator.py`
- `split_lyrics(text, fragment_count, fragment_duration) -> [{start, end, text}]`
- `generate_ass(subtitles, style) -> ass_file_path`
- ASS format for advanced styling (font, color, stroke, position)
- **Verify:** Generate ASS file with 9 subtitle blocks, burn into test video

### Task 1.6: Video renderer
- `backend/services/video_renderer.py`
- `render_clip(video_path, fragments, audio_path, subtitles, style) -> output_path`
- Pipeline:
  1. Extract fragments (`ffmpeg -ss -t -c copy`)
  2. Concat fragments (`ffmpeg concat`)
  3. Scale + blur background (`filter_complex`)
  4. Burn subtitles (`-vf subtitles=custom.ass`)
  5. Replace audio (`-map 0:v -map 1:a`)
  6. Encode final (`libx264, aac, -preset fast, -crf 22`)
- Progress tracking via ffmpeg stderr parsing
- **Verify:** Render a 27s clip from test video with subtitles + custom audio

### Task 1.7: API endpoints
- `backend/routers/analyze.py` — POST /api/analyze
- `backend/routers/fragments.py` — POST /api/fragments/select, /api/fragments/replace
- `backend/routers/subtitles.py` — POST /api/subtitles/split
- `backend/routers/render.py` — POST /api/render, GET /api/render/{id}/status, /download
- Background task for rendering (asyncio + job queue)
- **Verify:** Full API flow: analyze → select → split → render → download

### Task 1.8: File management + cleanup
- `backend/utils/file_manager.py`
- UUID-based paths, temp dir management
- Cleanup cron: delete temp > 1h, renders > 24h
- **Verify:** Temp files cleaned up after 1 hour

### Task 1.9: Docker setup
- `backend/Dockerfile` — python:3.12-slim + ffmpeg + yt-dlp
- `docker-compose.yml` — backend service
- **Verify:** `docker compose up` starts backend, health check passes

**Phase 1 Exit Criteria:**
- API can download video from 3 sources
- Select random fragments
- Render TikTok clip with subtitles + custom audio
- All via API (no UI yet)
- Docker container works

---

## Phase 2 — Frontend MVP (Week 2-3)

**Goal:** React UI that calls the backend API end-to-end.

### Task 2.1: React scaffold
- Vite + React + TypeScript + TailwindCSS
- `frontend/src/App.tsx` — main layout
- API client: `frontend/src/api/client.ts`
- **Verify:** `npm run dev` starts, page loads

### Task 2.2: Input panel
- `InputPanel.tsx` — URL input, file upload (mp3), lyrics textarea
- "Analyze" button → POST /api/analyze
- Show video metadata (duration, resolution, title)
- **Verify:** Paste YouTube URL → see duration + title

### Task 2.3: Fragment editor
- `FragmentEditor.tsx` — list of fragments with thumbnails
- `FragmentCard.tsx` — thumbnail image, start-end time, "Replace" button
- "Re-roll" button → new random selection
- Replace flow: show video player, user picks new timeframe
- Add/remove fragments
- **Verify:** See 9 fragments with thumbnails, re-roll works, replace works

### Task 2.4: Subtitle editor
- `SubtitleEditor.tsx` — table of subtitle blocks
- `SubtitleRow.tsx` — time range + text input
- Auto-split on "Analyze" → shows lines mapped to fragments
- Edit text inline
- Adjust timing (number inputs or drag)
- **Verify:** Lyrics auto-split into 9 blocks, edit text works

### Task 2.5: Style editor
- `StyleEditor.tsx` — font dropdown, color pickers, position selector, blur toggle
- Live preview of subtitle style on a sample frame
- **Verify:** Change font → preview updates

### Task 2.6: Video preview + timeline
- `VideoPreview.tsx` — HTML5 video player for source video
- `Timeline.tsx` — visual timeline showing fragments + subtitles
- Click fragment → seek video to that timestamp
- **Verify:** Click fragment → video seeks to correct time

### Task 2.7: Render + download
- "Generate Clip" button → POST /api/render
- `RenderProgress.tsx` — progress bar polling /status
- `ResultPreview.tsx` — show finished video + download link
- **Verify:** Generate clip → progress → preview → download MP4

### Task 2.8: Frontend Docker
- `frontend/Dockerfile` — node:20-slim, build + preview
- Update `docker-compose.yml` with frontend service
- **Verify:** `docker compose up` starts both services

**Phase 2 Exit Criteria:**
- Full flow works in browser: URL → fragments → subtitles → style → generate → download
- All 3 sources work (rezka, YouTube, direct URL)
- Fragment replace/re-roll works
- Subtitle editing works
- Docker compose runs both services

---

## Phase 3 — Polish & SaaS (Week 4-5)

### Task 3.1: Error handling + loading states
- Loading spinners for all API calls
- Error messages for failed downloads, render errors
- Retry buttons
- **Verify:** Test with invalid URL → proper error message

### Task 3.2: Responsive design
- Mobile-friendly layout (tablet + desktop)
- Touch-friendly controls
- **Verify:** Open on mobile width → all controls accessible

### Task 3.3: User accounts (optional MVP)
- Simple registration: email + password
- JWT auth
- Save projects (fragments + subtitles + style per user)
- **Verify:** Register → login → save project → reload → restore

### Task 3.4: Watermark (free tier)
- Add "Made with RapTok" text overlay for free users
- Pro users: no watermark (check user tier)
- **Verify:** Free user render has watermark, pro doesn't

### Task 3.5: Rate limiting
- 10 analyze requests / hour per IP (free)
- 30 renders / day (free), unlimited (pro)
- **Verify:** 11th request in 1 hour → 429 error

### Task 3.6: Deployment
- Deploy to VPS (lanceserv or new)
- Nginx reverse proxy (frontend :3000, backend :8000)
- HTTPS via Let's Encrypt
- Domain: raptok.[tbd]
- **Verify:** Access via HTTPS, both services reachable

**Phase 3 Exit Criteria:**
- Production deployment with HTTPS
- User accounts work
- Free/Pro tiers functional
- Error handling robust

---

## Phase 4 — Launch (Week 5-6)

### Task 4.1: Landing page
- Simple landing: what is RapTok, demo video, pricing
- **Verify:** Landing page loads, links to app

### Task 4.2: Payment integration
- Stripe for Pro subscription ($10-15/mo)
- Webhook for payment confirmation
- **Verify:** Test payment → Pro activated

### Task 4.3: Testing
- End-to-end test: full flow from URL to download
- Load test: 5 concurrent renders
- Edge cases: short video (<30s), long lyrics, special characters
- **Verify:** All edge cases handled without crash

### Task 4.4: Marketing
- Demo video for TikTok (meta: made with RapTok)
- Post in rapper communities
- Contact 10 rappers for free Pro trial
- **Verify:** 10 trial users signed up

---

## Tech Stack Summary

| Component | Technology | Version |
|-----------|-----------|---------|
| Frontend | React + Vite + TypeScript | React 18, Vite 5 |
| UI framework | TailwindCSS | 3.x |
| Backend | FastAPI | 0.110+ |
| Python | 3.12 | |
| Video | ffmpeg + yt-dlp | latest |
| Container | Docker + docker-compose | |
| Web server | Nginx | |
| SSL | Let's Encrypt (certbot) | |
| Payments | Stripe | |

## Project Structure

```
raptok/
├── docs/
│   ├── IDEA.md                    # Идея для друга
│   ├── specs/
│   │   └── 2026-08-07-raptok-design.md
│   └── plans/
│       └── 2026-08-07-raptok-implementation-plan.md
├── backend/
│   ├── main.py
│   ├── routers/
│   │   ├── analyze.py
│   │   ├── fragments.py
│   │   ├── subtitles.py
│   │   └── render.py
│   ├── services/
│   │   ├── downloader.py
│   │   ├── fragment_selector.py
│   │   ├── subtitle_generator.py
│   │   ├── video_renderer.py
│   │   └── thumbnail_generator.py
│   ├── models/
│   │   └── schemas.py
│   ├── utils/
│   │   ├── ffmpeg_helper.py
│   │   └── file_manager.py
│   ├── config.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   ├── api/
│   │   ├── types/
│   │   └── hooks/
│   ├── package.json
│   ├── Dockerfile
│   └── tailwind.config.js
├── docker-compose.yml
└── README.md
```