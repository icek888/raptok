# Design Spec: Fragments + Preview Merge (v3.2 Experimental)

**Date:** 2026-09-11
**Author:** Karlen + Hermes
**Status:** Approved (toggle approach, current flow preserved)

## Problem

Three UX issues with current RapTok fragment/preview workflow:

1. **No global context (A):** Step 4 (Fragments) shows static 16:9 thumbnails. Step 5 (Preview) shows the full concat clip. User sees fragments without preview context, and preview without fragment context. Disconnected.

2. **16:9 → 9:16 crop blindspot (B):** Fragments are displayed as 16:9 thumbnails, but the renderer crops to 9:16 (`crop_fill` or `fit_blur`). User can't see which part of the frame survives the crop — faces/subjects may get cut off. Only discovers this after render.

3. **No edit-before-render (C):** If preview looks wrong, user must go back to Step 4, edit fragments blindly (no preview), return to Step 5, re-check. No inline editing of fragments from the preview screen.

## Solution

**Experimental toggle in UI** — a "Lab mode" button switches between the current 7-step flow and a new merged "Fragments & Preview" screen. Current flow is 100% preserved; toggle is client-side state (localStorage).

### Merged Screen Layout (Lab mode)

```
┌──────────────────────────────────────────────────────────┐
│  ← Fragments & Preview (Lab)          [Lab ON] Next →     │
├────────────┬──────────────────────┬───────────────────────┤
│ FRAGMENTS  │   9:16 LIVE PREVIEW  │  STYLES / TEMPLATES   │
│ (vertical  │                      │                       │
│  scroll)   │   [video player]     │  [templates]          │
│            │                      │  [style controls]     │
│ ┌──┐ #1    │   сабтитры сверху    │  [beat effects]       │
│ │9:│ ↕↔    │                      │                       │
│ │16│       │                      │                       │
│ └──┘       │                      │                       │
│ ┌──┐ #2    │   ▶ Play  ⏸  ⏮ ⏭    │                       │
│ │9:│ ↕↔    │   0:12 / 0:45        │                       │
│ │16│       │                      │                       │
│ └──┘       │                      │                       │
│ + Add      │                      │                       │
├────────────┴──────────────────────┴───────────────────────┤
│ [Shuffle] [3───●───12] 7 frags · 45.0s · each 6.4s       │
└──────────────────────────────────────────────────────────┘
```

Three columns on desktop. On narrow screens (<1024px), fragment rail collapses to a horizontal strip above the preview.

## Feature Details

### A) Global context — fragment rail + live preview

- **Fragment rail (left column):** vertical scroll of fragment cards, each showing a **9:16 cropped mini-preview** (not 16:9). Active fragment syncs with playhead — highlighted with purple ring.
- **Click fragment → seek** main preview to that fragment's start point.
- **Filmstrip (bottom of left column):** all fragments in a horizontal strip showing order at a glance. Click any → seek.
- **Active word overlay** on the main preview, same as current VideoPreviewEditor.

### B) 9:16 crop preview — see what actually fits

- Each fragment card shows a **9:16 cropped frame** rendered with the same crop mode as the final render (`crop_fill` or `fit_blur` depending on template).
- Backend: new endpoint `POST /api/fragment-preview-916` — takes `video_path`, `timestamp`, `crop_mode`, `template_id` → returns PNG (one frame, cropped to 9:16).
- On the fragment card, a **yellow outline** shows the crop boundary overlay so user sees exactly what survives.
- **Multi-frame mode:** card shows 3 frames (25%, 50%, 75% of fragment duration) on hover/scroll — gives sense of motion. Static mid-frame by default.

### C) Inline editing before render

- **Drag-swap:** drag a fragment card onto another — swaps their positions in the sequence. Rebuilds concat preview (debounce 800ms).
- **Replace (🎲):** new random start point for that fragment. Re-fetches 9:16 preview.
- **Adjust (↔ slider):** shift fragment start by ±N seconds without changing duration. Useful for nudging a face back into frame.
- **Remove / Add:** same as current FragmentEditor (min 3, max 12).
- After any edit → **auto-rebuild** concat preview clip (existing `/api/prepare-preview` endpoint, debounced).

### Instagram-style frame scrubbing

- On a fragment card, **swipe/scroll horizontally** → scrubs through 5 frames across the fragment duration.
- Or: hover → mini animated GIF loop (5 frames, ~2fps) — gives motion preview without video load.
- Implemented as 5 pre-fetched PNGs from `/api/fragment-preview-916` with different timestamps.

## Technical Changes

### Frontend

| Component | Change |
|---|---|
| `App.tsx` | Add `labMode` state (localStorage `raptok_lab_mode`). When ON: Steps 4+5 merge into single Step 4 "Fragments & Preview" (6 steps). When OFF: current 7-step flow unchanged. |
| `FragmentEditor.tsx` | New `FragmentRail` sub-component: 9:16 cards, drag-swap, filmstrip. Existing 16:9 grid stays for non-lab mode. |
| `VideoPreviewEditor.tsx` | Embed in merged layout when lab mode. Receives fragments + handles fragment seek/swap/edit callbacks. |
| `types.ts` | Add `FragmentPreview916` response type. |
| New: `FragmentRail.tsx` | Vertical rail component: 9:16 cards, drag-swap (HTML5 drag API or mouse events like TimelinePreview word-swap), filmstrip, multi-frame hover. |

### Backend

| File | Change |
|---|---|
| `routers/render.py` | New `POST /api/fragment-preview-916` endpoint: input `video_path`, `timestamp`, `crop_mode`, `template_id?` → output PNG path. Uses ffmpeg single-frame extraction + 9:16 crop. |
| `services/thumbnail_generator.py` | Add `generate_916_preview(video_path, timestamp, crop_mode, output_path)` function. Reuses existing ffmpeg pattern. |
| `routers/render.py` | Existing `/api/prepare-preview` stays as-is (already rebuilds concat). |

### ffmpeg for 9:16 preview (per template mode)

```bash
# crop_fill mode
ffmpeg -ss {timestamp} -i {video} -frames:v 1 \
  -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" \
  {output.png}

# fit_blur mode
ffmpeg -ss {timestamp} -i {video} -frames:v 1 \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black" \
  {output.png}

# Multi-frame: repeat with timestamps at 25%, 50%, 75% of fragment duration
```

## Toggle Implementation

- **UI:** "Lab" toggle button in header (next to BPM badge). Purple pill: `🧪 Lab: ON/OFF`.
- **State:** `localStorage['raptok_lab_mode']` — boolean, default `false`.
- **When ON:** Step indicator shows 6 steps (Audio → Analysis → Lyrics → Video → **Fragments & Preview** → Render). Steps 4 and 5 merged.
- **When OFF:** Current 7-step flow. Zero changes.
- **Toggle is instant** — no page reload, state preserves across toggle.

## Acceptance Criteria

- [ ] Toggle button visible in header, persists in localStorage
- [ ] Lab OFF → current flow unchanged (7 steps, FragmentEditor grid)
- [ ] Lab ON → 6 steps, merged screen with 3 columns
- [ ] Fragment rail shows 9:16 cropped previews (not 16:9)
- [ ] Drag-swap works in fragment rail
- [ ] Click fragment → seek main preview
- [ ] Active fragment syncs with playhead
- [ ] Replace/Adjust/Remove/Add all work from merged screen
- [ ] After edit → concat preview auto-rebuilds (debounced)
- [ ] Multi-frame scrub on hover (3-5 frames)
- [ ] Narrow screen (<1024px) → fragment rail collapses to horizontal strip
- [ ] Backend `/api/fragment-preview-916` returns 9:16 PNG

## Out of Scope (YAGNI)

- No AI-based auto-crop or face detection (manual adjust slider is enough)
- No server-side rendering of multi-frame GIFs (client-side loop from PNGs)
- No undo/redo for fragment edits (can re-shuffle)
- No saving lab mode per-project (global toggle is enough)

## Migration & Rollback

- Toggle OFF = zero risk, current production flow untouched.
- If lab mode has bugs → user toggles OFF, continues working.
- No database changes, no API breaking changes.
- Feature is additive only.