# RapTok v4.0 — Single-Page Editor (LYRC-style) + OpenRouter STT

## Status: APPROVED DESIGN
## Date: 2026-09-15
## Author: Hermes Agent + Karlen

## 1. Overview

Transition RapTok frontend from a 7-step wizard to a single-page editor inspired by LYRC.studio. The new editor lives at `/v2` while the existing wizard remains at `/` — zero risk to current functionality.

**Goals:**
- Single-page layout: Clips (left) + Preview (center) + Editor Tabs (right) + Timeline (bottom)
- Audio upload via TrimModal (waveform + draggable handles + duration presets)
- API transcription via OpenRouter STT (Qwen3 ASR 0.6B) for 30s segments
- 3-track timeline: word pills + clip filmstrip + audio waveform
- 4 right-panel tabs: Lyrics / Style / Visuals / FX
- Template presets preserved: Cinematic / Lyrics / Hype

**Non-goals (this phase):**
- Batch rollout ("30 videos one click")
- AI B-roll generation (Seedance)
- "Be the Star" selfie-to-video
- Instagram auto-posting
- Pexels stock library integration
- Mac desktop app

## 2. Architecture

### 2.1 Routing

```
/    → WizardPage (current App.tsx, renamed)
/v2  → EditorPage (new EditorView)
```

**App.tsx** becomes a 15-line router:
```tsx
<BrowserRouter>
  <Routes>
    <Route path="/" element={<WizardPage />} />
    <Route path="/v2" element={<EditorPage />} />
  </Routes>
</BrowserRouter>
```

- Add `react-router-dom` dependency
- Vite SPA fallback in nginx: `try_files $uri /index.html`
- Wizard code untouched — only renamed

### 2.2 File Structure

```
frontend/src/
  App.tsx                    ← Router (15 lines)
  pages/
    WizardPage.tsx           ← current App.tsx (renamed, no changes)
    EditorPage.tsx           ← <EditorView /> wrapper
  components/
    (existing components — untouched)
    editor-v2/
      EditorView.tsx         ← root layout, uses useEditorState
      ClipsPanel.tsx         ← left panel
      PreviewCanvas.tsx      ← center 9:16 preview
      EditorTabs.tsx         ← right panel (tab container)
      tabs/
        LyricsTab.tsx
        StyleTab.tsx
        VisualsTab.tsx
        FXTab.tsx
      TimelineTracks.tsx     ← bottom 3-track timeline
      TrimModal.tsx          ← audio upload + waveform + trim
      useEditorState.ts      ← centralized state hook
      types.ts               ← shared TypeScript interfaces
```

### 2.3 Layout

```
┌─────────────────────────────────────────────────────┐
│  TopBar: Project name · BPM · Export button         │  48px
├──────────┬──────────────────────┬─────────────────────┤
│          │                      │                    │
│  Clips   │   Preview Canvas     │   Editor Tabs      │
│  Panel   │   (9:16, always)     │   (4 tabs)         │
│  280px   │   flex-1             │   320px            │
│          │                      │                    │
├──────────┴──────────────────────┴─────────────────────┤
│  Timeline: 3 tracks (words + clips + waveform)       │  220px
└─────────────────────────────────────────────────────┘
```

- Dark theme (current), cyan accents (#22d3ee)
- Panel proportions: 280px / flex / 320px / 220px timeline
- Empty state: center shows "New Project" button → opens TrimModal
- Loaded state: everything visible, preview + timeline synced

## 3. Components

### 3.1 useEditorState

Centralized state hook — single source of truth for the editor.

```typescript
interface EditorState {
  // Audio
  audioFile: File | null
  audioUrl: string | null
  audioDuration: number          // seconds, full track
  audioWaveform: number[]        // normalized peaks for rendering
  trimStart: number
  trimEnd: number
  trimmedDuration: number        // trimEnd - trimStart

  // Transcription
  words: WordTiming[]            // {word, start, end, confidence}
  language: 'ru' | 'en' | 'auto'
  transcriptModel: string        // 'qwen/qwen3-asr-0.6b'
  isTranscribing: boolean

  // Clips
  clips: Clip[]                  // {id, source, thumbnail, duration, locked, name}
  timelineSlots: TimelineSlot[]  // {id, clipId|null, start, end, wordIndices: number[]}

  // Visuals (per-project, overridable per-slot)
  framing: 'fit' | 'fill'
  background: 'black' | 'subtle' | 'medium' | 'heavy'
  canvasPosition: { x: number; y: number; scale: number; rotation: number }

  // Style
  style: {
    fontFamily: string
    fontSize: number
    fontWeight: number
    color: string
    highlightColor: string
    position: 'top' | 'center' | 'bottom' | 'custom'
    customX: number              // % if position='custom'
    customY: number              // %
    template: 'cinematic' | 'lyrics' | 'hype' | 'custom'
    karaokeProgress: boolean     // \kf tags (lyrics template)
  }

  // FX
  effects: {
    zoom: boolean
    flash: boolean
    shake: boolean
    vignette: boolean
    intensity: number            // 0-1
  }

  // Playback
  currentTime: number           // seconds within trimmed region
  isPlaying: boolean
  bpm: number

  // UI
  activeTab: 'lyrics' | 'style' | 'visuals' | 'fx'
  selectedSlotId: string | null
  selectedWordIndex: number | null
  isTrimModalOpen: boolean
}
```

**Actions** (returned by hook):
- `loadAudio(file)` — upload + waveform extraction
- `trimAudio(start, end)` — set trim region
- `transcribe()` — call OpenRouter STT
- `setWords(words)` — manual edit
- `addClip(clip)` / `removeClip(id)` / `lockClip(id)`
- `fillSlots()` — auto-assign clips to empty slots
- `shuffleSlots()` — reshuffle unlocked clips
- `selectSlot(id)` / `selectWord(index)`
- `setStyle(partial)` / `setEffects(partial)` / `setVisuals(partial)`
- `play()` / `pause()` / `seek(time)`
- `setTab(tab)`

### 3.2 TrimModal

Full-screen modal overlay.

**Elements:**
- Title: "TRIM YOUR AUDIO" + filename + close [×]
- Waveform canvas: full track waveform, selected region highlighted cyan
- Two draggable white handles (start/end of selection)
- Selection region shows duration in real-time
- Duration presets: 15s / 20s / 25s / 30s (clicking sets end = start + preset)
- Zoom slider (1× — 10×), affects waveform detail
- Play button (plays selection only)
- Position readout: "0:07.2" (current playhead position)
- −/+ buttons for fine position adjustment
- "CONFIRM SELECTION" button (cyan, prominent)

**Flow:**
1. User clicks "New Project" or uploads audio
2. Modal opens, waveform renders
3. User drags handles to select 15-30s region
4. User clicks CONFIRM
5. Modal closes, audio uploaded to backend, auto-trim applied
6. Auto-transcribe fires (OpenRouter STT)
7. Words appear in timeline + lyrics tab
8. Editor is now in "loaded state"

**Backend calls:**
- `POST /api/audio/upload` (existing) — upload file
- `GET /api/audio/waveform?file=...` (new) — return normalized peaks
- `POST /api/transcribe/openrouter` (new) — transcribe trimmed segment

### 3.3 ClipsPanel (left, 280px)

**Tabs:** Stock / User / [+]

- **Stock** — placeholder for future Pexels/library integration. Empty state: "Stock library coming soon"
- **User** — uploaded clips shown as thumbnail grid (3 columns)
- **[+]** — upload new clip (drag & drop or file picker) or import URL (YouTube/TikTok — future)

**Clip card:**
- Thumbnail (16:9 cropped)
- Duration label (bottom-right)
- Lock icon (toggle — locked clips survive shuffle)
- Click to select, drag to timeline slot

**Bottom bar:**
- "N shufflable" count
- [FILL] button — auto-assign clips to all empty slots
- [SHUFFLE] button — random reshuffle (preserves locked clips)

**Backend calls:**
- `POST /api/clips/upload` (new) — upload clip file
- `GET /api/clips/list` (new) — list user clips
- `POST /api/video/extract-fragments` (existing) — extract fragments from source video

### 3.4 PreviewCanvas (center, flex-1)

9:16 vertical video preview, always centered.

**Layers (bottom to top):**
1. Background (black / blurred copy of video — based on Visuals setting)
2. Video layer (current slot's clip, fit or fill)
3. Lyrics overlay (current word highlighted, style from Style tab)
4. Effects overlay (zoom pulse, flash, shake, vignette — from FX tab)

**Controls (bottom bar):**
- Play/Pause button
- Time display: "0:07 / 0:25"
- Aspect ratio badge: "9:16"

**Interactions:**
- Click on canvas → selects corresponding timeline slot
- Spacebar → play/pause
- Real-time render from style settings (no backend needed for preview)

**Reuses:** A/V sync logic from FragmentsPreviewMerged, video element management, time tracking.

### 3.5 EditorTabs (right, 320px)

4 tabs at top, content below.

#### Lyrics Tab
- Editable text blocks (textarea per line/phrase)
- Display words with timestamps (click to edit timing)
- Re-transcribe button (calls OpenRouter STT again)
- Language selector: Auto / Russian / English
- Word-level list: each word with start/end times, click to select in timeline
- "Add word" / "Delete word" for manual corrections

#### Style Tab
- Template presets: Cinematic / Lyrics / Hype / Custom (radio cards)
- Font family dropdown
- Font size slider (12-72px)
- Font weight dropdown (300/400/500/700/900)
- Text color picker
- Highlight color picker (active word)
- Position: Top / Center / Bottom / Custom (with X/Y sliders if Custom)
- Karaoke progress bar toggle (visible only for Lyrics template)
- Live preview in PreviewCanvas as settings change

#### Visuals Tab
- Framing toggle: Fit / Fill
- Background: Black / Subtle / Medium / Heavy (blur intensity)
- Position & Scale section:
  - X slider (0-100%)
  - Y slider (0-100%)
  - Scale slider (0.5-3.0×)
  - Rotation slider (-180° to 180°)
- "Apply to all slots" checkbox (default: on)
- Per-slot override: when a specific slot is selected, changes apply to that slot only

#### FX Tab
- Effect toggles: Zoom Pulse / Flash / Shake / Vignette
- Intensity slider (0-100%)
- BPM display (from auto-detection, editable)
- "Re-detect BPM" button
- Effect preview: plays 2-second loop with effects applied
- Beat sync indicator: shows detected beats as dots on a timeline strip

### 3.6 TimelineTracks (bottom, 220px)

3 horizontal tracks + toolbar.

**Track 1 — Words (40px height):**
- Word pills: "НЕБЕСАХ", "ЧУДЕСА", "УЛИЦАМ"...
- Color: inactive = gray, active (under playhead) = cyan
- Click word → selects in PreviewCanvas + Lyrics tab
- Drag word horizontally → adjust start time
- Word width proportional to duration

**Track 1.5 — Cut Markers (overlay on words track):**
- Magenta vertical lines at beat positions
- "Add Cut" button inserts manual marker
- Drag marker to adjust position
- Right-click marker → delete

**Track 2 — Clips (80px height):**
- Numbered slot filmstrip: [1][2][3]...[30]
- Each slot shows clip thumbnail (if assigned) or empty placeholder
- Slot width = slot duration (proportional)
- Drag clip from ClipsPanel → drop on slot
- Click slot → selects in PreviewCanvas + Visuals tab
- Lock icon on slot (locked clips survive shuffle)
- Drag slot boundary → adjust cut position

**Track 3 — Audio Waveform (60px height):**
- Full waveform render (from TrimModal data)
- Playhead: vertical cyan line across all 3 tracks
- Draggable playhead → scrub

**Toolbar (20px):**
- Play/Pause
- BPM display
- "Cuts: N/total" count
- Zoom slider (100% — 400%)
- "Add Cut" button
- Time display

**Zoom:** affects horizontal scale of all tracks. Scroll = zoom. Drag = pan.

**Slot count calculation:**
- Based on BPM + trimmed duration
- Each slot ≈ 1 beat (60/BPM seconds)
- 152 BPM × 25.9s ≈ 65 slots
- Display "Cuts: N / total" in toolbar

## 4. Backend — OpenRouter STT

### 4.1 New Endpoint

```
POST /api/transcribe/openrouter
Content-Type: application/json

Request:
{
  "audio_base64": "<base64-encoded audio bytes>",
  "model": "qwen/qwen3-asr-0.6b",
  "language": "ru",
  "response_format": "verbose_json",
  "timestamp_granularities": ["word"]
}

Response (success):
{
  "words": [
    {"word": "НЕБЕСАХ", "start": 0.0, "end": 0.8, "confidence": 0.95},
    {"word": "ЧУДЕСА", "start": 0.8, "end": 1.5, "confidence": 0.92}
  ],
  "text": "НЕБЕСАХ ЧУДЕСА УЛИЦАМ ПОЛУЧИЛ",
  "language": "ru",
  "duration": 25.9,
  "model": "qwen/qwen3-asr-0.6b"
}

Response (error):
{
  "error": "OpenRouter API error: 429 Too Many Requests",
  "fallback_available": true
}
```

### 4.2 OpenRouter API Call

```python
# backend/services/openrouter_stt.py
import base64, httpx, json

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_STT_URL = "https://openrouter.ai/api/v1/audio/transcriptions"

async def transcribe_via_openrouter(
    audio_path: str,
    model: str = "qwen/qwen3-asr-0.6b",
    language: str = "ru"
) -> dict:
    with open(audio_path, "rb") as f:
        audio_b64 = base64.b64encode(f.read()).decode()

    response = await httpx.AsyncClient().post(
        OPENROUTER_STT_URL,
        headers={
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "audio": audio_b64,
            "response_format": "verbose_json",
            "timestamp_granularities": ["word"],
            "language": language,
        },
        timeout=60.0,
    )
    data = response.json()
    return {
        "words": [
            {"word": w["word"], "start": w["start"], "end": w["end"]}
            for w in data.get("segments", [])
        ],
        "text": data.get("text", ""),
        "language": data.get("language", language),
        "duration": data.get("duration", 0),
        "model": model,
    }
```

### 4.3 Fallback Chain

1. **Primary:** OpenRouter STT (Qwen3 ASR 0.6B)
2. **Fallback:** Local CrisperWhisper (if OpenRouter fails)
3. **Manual:** User types lyrics manually, no timestamps

### 4.4 New Backend Files

```
backend/
  services/
    openrouter_stt.py          ← new
  routers/
    transcription.py           ← add /openrouter endpoint
```

### 4.5 Environment

```env
# .env (backend)
OPENROUTER_API_KEY=sk-or-v1-...
```

## 5. Dependencies

### Frontend (new)
- `react-router-dom` — routing

### Backend (new)
- `httpx` (already in requirements.txt? verify) — async HTTP for OpenRouter

## 6. Implementation Order

1. **Routing setup** — App.tsx → Router, WizardPage rename, EditorPage stub
2. **useEditorState** — types.ts + hook with all state + actions
3. **EditorView shell** — layout grid (TopBar + 3 columns + timeline zone)
4. **TrimModal** — waveform canvas + handles + presets + confirm
5. **PreviewCanvas** — 9:16 video + lyrics overlay + playback
6. **ClipsPanel** — tabs + grid + fill/shuffle
7. **EditorTabs** — 4 tab container + LyricsTab (text + re-transcribe)
8. **StyleTab** — template presets + font/color/position controls
9. **VisualsTab** — framing/background/position controls
10. **FXTab** — effect toggles + intensity + BPM
11. **TimelineTracks** — 3 tracks + playhead + zoom + cut markers
12. **Backend: OpenRouter STT** — service + endpoint + fallback
13. **Integration** — wire all panels to useEditorState
14. **Polish** — keyboard shortcuts, empty states, loading states

## 7. Testing Strategy

- **Unit:** useEditorState actions (fill, shuffle, trim, transcribe)
- **Component:** each panel renders with mock state
- **Integration:** TrimModal → transcribe → words appear in timeline
- **E2E:** upload audio → trim → transcribe → add clips → fill → export
- **Backend:** OpenRouter STT endpoint with mock audio
- **Fallback:** OpenRouter down → CrisperWhisper kicks in

## 8. Migration Plan

1. v2 ships at `/v2`
2. User tests v2 alongside v1
3. When v2 is stable and feature-complete → swap: `/` → v2, `/v1` → old wizard
4. Eventually remove v1 code

## 9. Cost Estimate

- OpenRouter Qwen3 ASR 0.6B: ~$0.001 per 30s transcription
- 100 transcriptions/day = ~$0.10/day = ~$3/month
- Negligible

## 10. Future Phases (not in scope)

- **Phase 2:** Rollout / batch generation ("30 videos one click")
- **Phase 3:** AI B-roll (Seedance 2.0 integration)
- **Phase 4:** Pexels stock library
- **Phase 5:** Instagram auto-posting
- **Phase 6:** Artist page (Linktree replacement)
- **Phase 7:** Mac desktop app (Tauri)