# Fragments + Preview Merge (v3.2 Lab Mode) — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Merge Fragments (Step 4) and Preview (Step 5) into one screen behind a "Lab" toggle, with 9:16 crop previews, drag-swap, inline editing, and multi-frame scrubbing.

**Architecture:** Client-side toggle (`localStorage`) switches between current 7-step flow and new 6-step flow. Backend gets one new endpoint for 9:16 cropped frame extraction. New `FragmentRail` component replaces the grid in lab mode. Existing `VideoPreviewEditor` is reused in the merged layout.

**Tech Stack:** React + TypeScript (frontend), FastAPI + ffmpeg (backend), Docker (deploy)

---

## Phase 1: Backend — 9:16 Frame Extraction

### Task 1: Add 9:16 preview function to thumbnail_generator.py

**Objective:** Create a function that extracts a single frame from video, cropped to 9:16 aspect ratio matching the render output.

**Files:**
- Modify: `backend/services/thumbnail_generator.py`

**Step 1: Write the function**

Add after existing `get_thumbnail` function (line 27):

```python
def get_916_preview(
    video_path: str,
    timestamp: float,
    crop_mode: str = "crop_fill",
    job_id: str = "preview916",
    width: int = 270,
    height: int = 480,
) -> str:
    """
    Extract a single frame from video, cropped to 9:16 aspect ratio.
    Matches the render output so user sees exactly what the final clip will look like.

    crop_mode:
      - "crop_fill": scale to fill 9:16, crop overflow (zoom)
      - "fit_blur": scale to fit, pad with black (letterbox)

    Returns path to the PNG file.
    """
    output_path = TEMP_DIR / f"{job_id}_{int(timestamp * 1000)}.png"

    if crop_mode == "crop_fill":
        vf = f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"
    else:
        # fit_blur — scale to fit + pad
        vf = f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black"

    cmd = [
        "ffmpeg", "-y",
        "-ss", str(timestamp),
        "-i", str(video_path),
        "-frames:v", "1",
        "-vf", vf,
        str(output_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    if result.returncode != 0:
        raise RuntimeError(f"9:16 preview extraction failed: {result.stderr[:200]}")

    return str(output_path)
```

**Step 2: Verify the function is syntactically valid**

Run: `docker exec raptok-backend python -c "from services.thumbnail_generator import get_916_preview; print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add backend/services/thumbnail_generator.py
git commit -m "feat: add get_916_preview function for 9:16 cropped frame extraction"
```

---

### Task 2: Add /api/fragment-preview-916 endpoint

**Objective:** Create a POST endpoint that accepts video path, timestamp, and crop mode, returns a 9:16 cropped PNG URL.

**Files:**
- Modify: `backend/models/schemas.py` (add request model)
- Modify: `backend/routers/render.py` (add endpoint)

**Step 1: Add request model to schemas.py**

Add after `PreparePreviewRequest` class (around line 226):

```python
class FragmentPreview916Request(BaseModel):
    """Request a 9:16 cropped preview frame for a fragment."""
    video_path: str
    timestamp: float
    crop_mode: str = "crop_fill"  # crop_fill | fit_blur
```

**Step 2: Add endpoint to render.py**

Add import at top of `backend/routers/render.py`:

```python
from models.schemas import (
    RenderRequest, SubtitleLine, Fragment,
    PreparePreviewRequest, FragmentPreview916Request,
)
from services.thumbnail_generator import get_916_preview
```

Add after the `prepare_preview` endpoint (end of file, line ~261):

```python
@router.post("/api/fragment-preview-916")
async def fragment_preview_916(req: FragmentPreview916Request):
    """Extract a single 9:16 cropped frame for fragment preview."""
    try:
        job_id = f"fp916_{os.urandom(4).hex()}"
        img_path = await asyncio.to_thread(
            get_916_preview,
            video_path=req.video_path,
            timestamp=req.timestamp,
            crop_mode=req.crop_mode,
            job_id=job_id,
        )
        filename = os.path.basename(img_path)
        return {
            "preview_url": f"/api/thumbnail/{filename}",
            "timestamp": req.timestamp,
            "crop_mode": req.crop_mode,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

**Step 3: Verify endpoint loads**

Run: `docker exec raptok-backend python -c "from routers.render import router; print('OK')"`
Expected: `OK`

**Step 4: Restart backend container**

```bash
docker compose restart raptok-backend
```

**Step 5: Test endpoint manually**

```bash
# Find a video path in tmp
VIDEO=$(ls /home/karlen/project/raptok/tmp/*.mp4 2>/dev/null | head -1)
curl -s -X POST http://localhost:8000/api/fragment-preview-916 \
  -H "Content-Type: application/json" \
  -d "{\"video_path\":\"$VIDEO\",\"timestamp\":5.0,\"crop_mode\":\"crop_fill\"}"
```
Expected: `{"preview_url":"/api/thumbnail/fp916_xxxx_5000.png","timestamp":5.0,"crop_mode":"crop_fill"}`

**Step 6: Commit**

```bash
git add backend/models/schemas.py backend/routers/render.py
git commit -m "feat: add /api/fragment-preview-916 endpoint"
```

---

### Task 3: Add multi-frame 9:16 preview endpoint

**Objective:** Extend the endpoint to support multiple timestamps in one call (for the Instagram-style scrub effect — 3-5 frames per fragment).

**Files:**
- Modify: `backend/models/schemas.py`
- Modify: `backend/routers/render.py`

**Step 1: Add multi-frame request model**

Add after `FragmentPreview916Request`:

```python
class FragmentPreviewMultiRequest(BaseModel):
    """Request multiple 9:16 cropped frames for a fragment (for scrub effect)."""
    video_path: str
    timestamps: list[float]  # 3-5 timestamps within the fragment
    crop_mode: str = "crop_fill"
```

**Step 2: Add multi-frame endpoint to render.py**

Add after the single-frame endpoint:

```python
@router.post("/api/fragment-preview-multi")
async def fragment_preview_multi(req: FragmentPreviewMultiRequest):
    """Extract multiple 9:16 cropped frames for scrub preview."""
    try:
        job_id = f"fpmulti_{os.urandom(4).hex()}"
        results = []
        for i, ts in enumerate(req.timestamps[:5]):  # max 5 frames
            try:
                img_path = await asyncio.to_thread(
                    get_916_preview,
                    video_path=req.video_path,
                    timestamp=ts,
                    crop_mode=req.crop_mode,
                    job_id=f"{job_id}_{i}",
                )
                filename = os.path.basename(img_path)
                results.append({
                    "preview_url": f"/api/thumbnail/{filename}",
                    "timestamp": ts,
                })
            except Exception as e:
                results.append({"timestamp": ts, "error": str(e)})
        return {"frames": results, "crop_mode": req.crop_mode}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

Update the import line to include `FragmentPreviewMultiRequest`:

```python
from models.schemas import (
    RenderRequest, SubtitleLine, Fragment,
    PreparePreviewRequest, FragmentPreview916Request, FragmentPreviewMultiRequest,
)
```

**Step 3: Verify**

```bash
docker exec raptok-backend python -c "from routers.render import router; print('OK')"
```

**Step 4: Restart + test**

```bash
docker compose restart raptok-backend
VIDEO=$(ls /home/karlen/project/raptok/tmp/*.mp4 2>/dev/null | head -1)
curl -s -X POST http://localhost:8000/api/fragment-preview-multi \
  -H "Content-Type: application/json" \
  -d "{\"video_path\":\"$VIDEO\",\"timestamps\":[2.0,5.0,8.0],\"crop_mode\":\"crop_fill\"}"
```
Expected: JSON with 3 frame URLs.

**Step 5: Commit**

```bash
git add backend/models/schemas.py backend/routers/render.py
git commit -m "feat: add /api/fragment-preview-multi for multi-frame scrub"
```

---

## Phase 2: Frontend — API Client + Types

### Task 4: Add API client methods and types

**Objective:** Add TypeScript types and API client methods for the new endpoints.

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/client.ts`

**Step 1: Add types to types.ts**

Add after the `PreviewResult` interface (end of file, line ~196):

```typescript
// ── 9:16 fragment preview ──
export interface FragmentPreview916Result {
  preview_url: string;
  timestamp: number;
  crop_mode: string;
}

export interface FragmentPreviewMultiResult {
  frames: { preview_url: string; timestamp: number; error?: string }[];
  crop_mode: string;
}
```

**Step 2: Add API client methods**

In `frontend/src/api/client.ts`, add inside the `api` object (before the closing `}`), after `preparePreview`:

```typescript
  // ── 9:16 fragment preview (Lab mode) ──
  fragmentPreview916: (
    videoPath: string,
    timestamp: number,
    cropMode: string = 'crop_fill',
  ): Promise<FragmentPreview916Result> =>
    postJSON(`${API_BASE}/fragment-preview-916`, {
      video_path: videoPath,
      timestamp,
      crop_mode: cropMode,
    }),

  fragmentPreviewMulti: (
    videoPath: string,
    timestamps: number[],
    cropMode: string = 'crop_fill',
  ): Promise<FragmentPreviewMultiResult> =>
    postJSON(`${API_BASE}/fragment-preview-multi`, {
      video_path: videoPath,
      timestamps,
      crop_mode: cropMode,
    }),
```

Add the imports at the top of client.ts:

```typescript
import type { 
  // ... existing imports ...
  FragmentPreview916Result, FragmentPreviewMultiResult
} from '../types';
```

**Step 3: Verify TypeScript compiles**

```bash
cd /home/karlen/project/raptok/frontend && npx tsc --noEmit 2>&1 | head -20
```
Expected: no new errors related to these additions.

**Step 4: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/client.ts
git commit -m "feat: add API client methods for 9:16 fragment preview"
```

---

## Phase 3: Frontend — Lab Toggle

### Task 5: Add Lab mode toggle to App.tsx

**Objective:** Add a "Lab" toggle button in the header that switches between 7-step and 6-step flow. State persisted in localStorage.

**Files:**
- Modify: `frontend/src/App.tsx`

**Step 1: Add labMode state**

Near the top of the `App()` function, after the `step` state (line ~33):

```typescript
const [labMode, setLabMode] = useState<boolean>(
  () => localStorage.getItem('raptok_lab_mode') === 'true'
);

// Persist lab mode
useEffect(() => {
  localStorage.setItem('raptok_lab_mode', String(labMode));
}, [labMode]);
```

**Step 2: Define STEPS_LAB (6 steps — merge 4+5)**

After the existing `STEPS` array (line ~27):

```typescript
const STEPS_LAB = [
  { id: 0 as Step, label: 'Audio', icon: Music },
  { id: 1 as Step, label: 'Analysis', icon: Activity },
  { id: 2 as Step, label: 'Lyrics', icon: Type },
  { id: 3 as Step, label: 'Video', icon: Film },
  { id: 4 as Step, label: 'Fragments & Preview', icon: Eye },
  { id: 5 as Step, label: 'Render', icon: Wand2 },
];
```

Note: In lab mode, Step 4 = merged fragments+preview, Step 5 = render. The existing `Step` type is `0|1|2|3|4|5|6` — lab mode uses 0-5.

**Step 3: Use dynamic STEPS array**

Replace the STEPS reference in the step indicator (line ~429) and navigation:

```typescript
const activeSteps = labMode ? STEPS_LAB : STEPS;
const maxStep = labMode ? 5 : 6;
```

Update the step indicator to use `activeSteps` instead of `STEPS`.

**Step 4: Add Lab toggle button in header**

In the header section (after the BPM badge, around line ~388), add:

```tsx
<button
  onClick={() => setLabMode(!labMode)}
  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
    labMode
      ? 'bg-purple-500/20 border border-purple-500/40 text-purple-300'
      : 'bg-[#1a1a2a] border border-[#2a2a3a] text-gray-500 hover:text-gray-300'
  }`}
  title="Toggle experimental merged fragments+preview mode"
>
  🧪 Lab: {labMode ? 'ON' : 'OFF'}
</button>
```

**Step 5: Update step rendering for lab mode**

In the step content section, replace the step 4 and step 5 conditionals. When `labMode` is true, step 4 renders the merged `FragmentsPreviewMerged` component (created in Phase 4) instead of the separate `FragmentEditor` and `VideoPreviewEditor`.

```tsx
{/* Step 4: Lab mode — merged Fragments + Preview */}
{labMode && step === 4 && videoInfo && (
  <FragmentsPreviewMerged
    videoInfo={videoInfo}
    videoUrl={videoInfo?.local_path || null}
    fragments={fragments}
    onFragmentsChange={handleFragmentsChange}
    audioPath={segmentPath || audioPath}
    audioStart={audioStart}
    subtitles={subtitles}
    wordTimings={wordTimings}
    style={style}
    onStyleChange={setStyle}
    karaoke={karaoke}
    onKaraokeChange={setKaraoke}
    displayMode={displayMode}
    onDisplayModeChange={setDisplayMode}
    templateId={templateId}
    onTemplateChange={setTemplateId}
    segmentDuration={clipRange ? clipRange.end - clipRange.start : (audioDuration || 30)}
    bpmData={bpmData}
    beatEffectsOn={beatEffectsOn}
    onBeatEffectsToggle={setBeatEffectsOn}
    onIntensityChange={handleIntensityChange}
    zoomIntensity={zoomIntensity}
    flashIntensity={flashIntensity}
    shakeIntensity={shakeIntensity}
  />
)}

{/* Step 4: Normal mode — FragmentEditor (unchanged) */}
{!labMode && step === 4 && videoInfo && (
  <FragmentEditor
    videoInfo={videoInfo}
    fragments={fragments}
    onFragmentsChange={handleFragmentsChange}
    audioPath={segmentPath || audioPath}
    segmentDuration={clipRange ? clipRange.end - clipRange.start : (audioDuration || 30)}
  />
)}

{/* Step 5: Normal mode — VideoPreviewEditor (unchanged) */}
{!labMode && step === 5 && (
  // existing VideoPreviewEditor + AIStylePanel + BeatEffectsPanel code
)}
```

Also update `canProceed` for lab mode (step 4 in lab = needs fragments >= 3; step 5 = render):

```typescript
const canProceed = (s: Step): boolean => {
  if (labMode) {
    switch (s) {
      case 0: return !!audioPath;
      case 1: return !!bpmData;
      case 2: return subtitles.length > 0 || wordTimings.length > 0;
      case 3: return !!videoInfo;
      case 4: return fragments.length >= 3; // merged step
      case 5: return true; // render
      default: return true;
    }
  }
  // existing 7-step logic unchanged
  switch (s) {
    case 0: return !!audioPath;
    case 1: return !!bpmData;
    case 2: return subtitles.length > 0 || wordTimings.length > 0;
    case 3: return !!videoInfo;
    case 4: return fragments.length >= 3;
    case 5: return true;
    case 6: return true;
    default: return true;
  }
};
```

Update the "Next" button max step to use `maxStep` instead of hardcoded `6`.

**Step 6: Add import for FragmentsPreviewMerged**

At the top of App.tsx:

```typescript
import { FragmentsPreviewMerged } from './components/FragmentsPreviewMerged';
```

**Step 7: Verify TypeScript compiles (will fail — component not yet created, that's expected)**

This task is complete once the component in Phase 4 is created. Commit together with Phase 4.

---

## Phase 4: Frontend — FragmentRail Component

### Task 6: Create FragmentRail.tsx — vertical 9:16 fragment cards with drag-swap

**Objective:** Create the left-column component: vertical scroll of 9:16 fragment cards with drag-swap, replace, adjust, remove, add, and multi-frame hover scrub.

**Files:**
- Create: `frontend/src/components/FragmentRail.tsx`

**Step 1: Create the component**

```tsx
import { useState, useRef, useEffect, useCallback } from 'react';
import { Shuffle, RefreshCw, Trash2, Clock, Plus, GripVertical, ArrowLeftRight } from 'lucide-react';
import { api } from '../api/client';
import type { Fragment, VideoInfo } from '../types';

interface Props {
  videoInfo: VideoInfo;
  fragments: Fragment[];
  onFragmentsChange: (fragments: Fragment[]) => void;
  segmentDuration: number;
  cropMode: string;
  activeFragmentIdx: number; // syncs with playhead
  onFragmentClick: (idx: number) => void; // seek to fragment
}

export function FragmentRail({
  videoInfo, fragments, onFragmentsChange, segmentDuration,
  cropMode, activeFragmentIdx, onFragmentClick,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [previews, setPreviews] = useState<Record<number, string>>({}); // fragId → 9:16 preview URL
  const [multiFrames, setMultiFrames] = useState<Record<number, string[]>>({}); // fragId → 3-5 frames
  const [hoveredFrag, setHoveredFrag] = useState<number | null>(null);
  const [dragIdx, setDragIdx] = useState(-1);
  const [dropIdx, setDropIdx] = useState(-1);
  const [adjustingFrag, setAdjustingFrag] = useState<number | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);

  // Fetch 9:16 preview for all fragments
  const fetchPreviews = useCallback(async (frags: Fragment[]) => {
    const map: Record<number, string> = {};
    for (const frag of frags) {
      const midTs = (frag.start + frag.end) / 2;
      try {
        const res = await api.fragmentPreview916(videoInfo.local_path, midTs, cropMode);
        map[frag.id] = res.preview_url;
      } catch (e) {
        console.error('Preview fetch failed for frag', frag.id, e);
      }
    }
    setPreviews(map);
  }, [videoInfo.local_path, cropMode]);

  // Fetch multi-frame previews for hover scrub (3 frames: 25%, 50%, 75%)
  const fetchMultiFrames = useCallback(async (frag: Fragment) => {
    const ts25 = frag.start + frag.duration * 0.25;
    const ts50 = frag.start + frag.duration * 0.50;
    const ts75 = frag.start + frag.duration * 0.75;
    try {
      const res = await api.fragmentPreviewMulti(
        videoInfo.local_path, [ts25, ts50, ts75], cropMode,
      );
      const urls = res.frames
        .filter(f => f.preview_url)
        .map(f => f.preview_url);
      if (urls.length > 0) {
        setMultiFrames(prev => ({ ...prev, [frag.id]: urls }));
      }
    } catch (e) {
      console.error('Multi-frame fetch failed', e);
    }
  }, [videoInfo.local_path, cropMode]);

  // Initial preview fetch
  useEffect(() => {
    if (fragments.length > 0) {
      fetchPreviews(fragments);
    }
  }, [fragments.length, cropMode]); // re-fetch when count or crop mode changes

  // Re-fetch previews when fragment start points change (e.g. after shuffle/replace)
  // Use a key based on start+end to detect content changes
  const fragsKey = JSON.stringify(fragments.map(f => `${f.id}:${f.start}:${f.end}`));
  useEffect(() => {
    if (fragments.length > 0) {
      fetchPreviews(fragments);
    }
  }, [fragsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drag-swap ──
  const handleDragStart = (e: React.DragEvent, idx: number) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (idx !== dragIdx) setDropIdx(idx);
  };

  const handleDrop = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx < 0 || dragIdx === idx) {
      setDragIdx(-1);
      setDropIdx(-1);
      return;
    }
    // Swap fragment positions (not timing — just array order)
    const newFrags = [...fragments];
    const tmp = newFrags[dragIdx];
    newFrags[dragIdx] = newFrags[idx];
    newFrags[idx] = tmp;
    // Re-assign IDs to match new positions
    newFrags.forEach((f, i) => { f.id = i; });
    onFragmentsChange(newFrags);
    setDragIdx(-1);
    setDropIdx(-1);
  };

  const handleDragEnd = () => {
    setDragIdx(-1);
    setDropIdx(-1);
  };

  // ── Replace (random new start) ──
  const handleReplace = async (fragId: number) => {
    const frag = fragments.find(f => f.id === fragId);
    if (!frag) return;
    const maxStart = Math.max(0, videoInfo.duration - frag.duration);
    const newStart = Math.round(Math.random() * maxStart * 10) / 10;
    const newFrags = fragments.map(f =>
      f.id === fragId
        ? { ...f, start: newStart, end: Math.round((newStart + frag.duration) * 10) / 10 }
        : f
    );
    onFragmentsChange(newFrags);
    // Fetch new preview
    const replaced = newFrags.find(f => f.id === fragId)!;
    const midTs = (replaced.start + replaced.end) / 2;
    try {
      const res = await api.fragmentPreview916(videoInfo.local_path, midTs, cropMode);
      setPreviews(prev => ({ ...prev, [fragId]: res.preview_url }));
      // Invalidate multi-frames cache
      setMultiFrames(prev => { const c = { ...prev }; delete c[fragId]; return c; });
    } catch (e) { console.error('Replace preview failed', e); }
  };

  // ── Adjust (shift start ±N seconds) ──
  const handleAdjust = (fragId: number, delta: number) => {
    const frag = fragments.find(f => f.id === fragId);
    if (!frag) return;
    const maxStart = Math.max(0, videoInfo.duration - frag.duration);
    let newStart = Math.round((frag.start + delta) * 10) / 10;
    newStart = Math.max(0, Math.min(newStart, maxStart));
    const newFrags = fragments.map(f =>
      f.id === fragId
        ? { ...f, start: newStart, end: Math.round((newStart + frag.duration) * 10) / 10 }
        : f
    );
    onFragmentsChange(newFrags);
  };

  // ── Remove ──
  const handleRemove = (fragId: number) => {
    if (fragments.length <= 3) return;
    const remaining = fragments.filter(f => f.id !== fragId);
    const newCount = remaining.length;
    const fragDur = segmentDuration / newCount;
    const maxStart = Math.max(0, videoInfo.duration - fragDur);
    const newFrags = remaining.map((f, i) => ({
      ...f,
      id: i,
      duration: Math.round(fragDur * 10) / 10,
      start: Math.round(Math.random() * maxStart * 10) / 10,
      end: 0,
    }));
    newFrags.forEach(f => { f.end = Math.round((f.start + fragDur) * 10) / 10; });
    onFragmentsChange(newFrags);
    setPreviews(prev => { const c = { ...prev }; delete c[fragId]; return c; });
    setMultiFrames(prev => { const c = { ...prev }; delete c[fragId]; return c; });
  };

  // ── Add ──
  const handleAdd = () => {
    if (fragments.length >= 12) return;
    const newCount = fragments.length + 1;
    const fragDur = segmentDuration / newCount;
    const maxStart = Math.max(0, videoInfo.duration - fragDur);
    const newFrags = Array.from({ length: newCount }, (_, i) => {
      const start = Math.round(Math.random() * maxStart * 10) / 10;
      return {
        id: i,
        start,
        end: Math.round((start + fragDur) * 10) / 10,
        duration: Math.round(fragDur * 10) / 10,
      };
    });
    onFragmentsChange(newFrags);
  };

  // ── Shuffle (re-roll all starts) ──
  const handleShuffle = async () => {
    setLoading(true);
    const fragDur = segmentDuration / fragments.length;
    const maxStart = Math.max(0, videoInfo.duration - fragDur);
    const newFrags = fragments.map(f => {
      const start = Math.round(Math.random() * maxStart * 10) / 10;
      return {
        ...f,
        start,
        end: Math.round((start + fragDur) * 10) / 10,
      };
    });
    onFragmentsChange(newFrags);
    setMultiFrames({}); // clear cache
    setLoading(false);
  };

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-1 pb-2">
        <span className="text-xs text-gray-500 font-medium">
          {fragments.length} clips · {segmentDuration.toFixed(1)}s
        </span>
        <button
          onClick={handleShuffle}
          disabled={loading}
          className="ml-auto px-2 py-1 bg-purple-600 hover:bg-purple-500 rounded text-[10px] font-medium flex items-center gap-1 transition disabled:opacity-40"
        >
          {loading ? '...' : '🎲 Shuffle'}
        </button>
      </div>

      {/* Fragment rail — vertical scroll */}
      <div ref={railRef} className="flex-1 overflow-y-auto space-y-2 pr-1">
        {fragments.map((frag, i) => (
          <div
            key={frag.id}
            draggable
            onDragStart={(e) => handleDragStart(e, i)}
            onDragOver={(e) => handleDragOver(e, i)}
            onDrop={(e) => handleDrop(e, i)}
            onDragEnd={handleDragEnd}
            onMouseEnter={() => {
              setHoveredFrag(frag.id);
              if (!multiFrames[frag.id]) fetchMultiFrames(frag);
            }}
            onMouseLeave={() => setHoveredFrag(null)}
            onClick={() => onFragmentClick(i)}
            className={`relative bg-[#0f0f17] border rounded-lg overflow-hidden cursor-grab active:cursor-grabbing transition ${
              activeFragmentIdx === i
                ? 'border-purple-500 ring-2 ring-purple-500/30'
                : dropIdx === i
                ? 'border-purple-400 border-dashed'
                : 'border-[#1a1a2a] hover:border-[#2a2a3a]'
            }`}
          >
            {/* Drag handle */}
            <div className="absolute top-1 left-1 z-10 cursor-grab opacity-50 hover:opacity-100">
              <GripVertical size={12} className="text-gray-400" />
            </div>

            {/* 9:16 preview */}
            <div className="relative mx-auto bg-[#0a0a0f]" style={{ width: '100%', aspectRatio: '9/16', maxHeight: '200px' }}>
              {previews[frag.id] ? (
                <img
                  src={hoveredFrag === frag.id && multiFrames[frag.id]?.[0]
                    ? multiFrames[frag.id][Math.floor(Date.now() / 500) % multiFrames[frag.id].length]
                    : previews[frag.id]
                  }
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {/* Fragment number */}
              <div className="absolute top-1 right-1 bg-black/70 px-1.5 py-0.5 rounded text-[10px] text-gray-300 font-mono">
                #{i + 1}
              </div>
              {/* Duration badge */}
              <div className="absolute bottom-1 left-1 bg-black/70 px-1.5 py-0.5 rounded text-[10px] text-gray-400 font-mono">
                {frag.duration.toFixed(1)}s · {formatTime(frag.start)}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-between px-1.5 py-1">
              <button
                onClick={(e) => { e.stopPropagation(); handleReplace(frag.id); }}
                className="p-1 hover:bg-purple-600/20 rounded text-purple-400 transition"
                title="Replace with random"
              >
                <RefreshCw size={11} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setAdjustingFrag(adjustingFrag === frag.id ? null : frag.id); }}
                className={`p-1 rounded transition ${
                  adjustingFrag === frag.id ? 'bg-purple-600/30 text-purple-300' : 'hover:bg-purple-600/20 text-purple-400'
                }`}
                title="Adjust start"
              >
                <ArrowLeftRight size={11} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleRemove(frag.id); }}
                disabled={fragments.length <= 3}
                className="p-1 hover:bg-red-600/20 rounded text-red-400 transition disabled:opacity-30"
                title="Remove"
              >
                <Trash2 size={11} />
              </button>
            </div>

            {/* Adjust slider */}
            {adjustingFrag === frag.id && (
              <div className="px-2 pb-2">
                <input
                  type="range"
                  min={-5}
                  max={5}
                  step={0.5}
                  defaultValue={0}
                  onChange={(e) => handleAdjust(frag.id, parseFloat(e.target.value))}
                  className="w-full accent-purple-500"
                />
                <div className="text-[9px] text-gray-600 text-center mt-0.5">
                  Shift start: ±5s · current {formatTime(frag.start)}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Add card */}
        {fragments.length < 12 && (
          <button
            onClick={handleAdd}
            className="bg-[#0a0a0f] border border-dashed border-[#2a2a3a] rounded-lg flex items-center justify-center gap-1 text-gray-500 hover:text-purple-400 hover:border-purple-500/30 transition py-3"
          >
            <Plus size={14} />
            <span className="text-[10px]">Add fragment</span>
          </button>
        )}
      </div>

      {/* Filmstrip — horizontal overview at bottom */}
      <div className="border-t border-[#1a1a2a] pt-2 mt-2">
        <div className="flex gap-1 overflow-x-auto">
          {fragments.map((frag, i) => (
            <button
              key={frag.id}
              onClick={() => onFragmentClick(i)}
              className={`relative shrink-0 rounded overflow-hidden border transition ${
                activeFragmentIdx === i ? 'border-purple-500' : 'border-[#1a1a2a]'
              }`}
              style={{ width: 32, height: 56 }}
              title={`#${i + 1} ${formatTime(frag.start)}`}
            >
              {previews[frag.id] ? (
                <img src={previews[frag.id]} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-[#0a0a0f]" />
              )}
              <span className="absolute bottom-0 left-0 right-0 text-[7px] text-white bg-black/60 text-center">
                {i + 1}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify it compiles**

```bash
cd /home/karlen/project/raptok/frontend && npx tsc --noEmit 2>&1 | grep -i "FragmentRail" | head -5
```
Expected: no errors specific to FragmentRail.

**Step 3: Commit**

```bash
git add frontend/src/components/FragmentRail.tsx
git commit -m "feat: create FragmentRail component with 9:16 previews, drag-swap, adjust, multi-frame hover"
```

---

## Phase 5: Frontend — Merged Screen

### Task 7: Create FragmentsPreviewMerged.tsx — 3-column merged layout

**Objective:** Create the merged screen that combines FragmentRail (left), VideoPreviewEditor (center), and style/template/beat-effects controls (right) into one view.

**Files:**
- Create: `frontend/src/components/FragmentsPreviewMerged.tsx`

**Step 1: Create the component**

```tsx
import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, SkipBack, SkipForward, Film } from 'lucide-react';
import type { Fragment, SubtitleLine, SubtitleStyle, WordTiming, VideoInfo, BPMResult, RenderTemplate } from '../types';
import { FragmentRail } from './FragmentRail';
import { assToCss, cssToAss } from '../utils/colors';
import { POSITION_MAP } from '../utils/constants';
import { useTemplates, applyTemplateToStyle } from '../utils/templates';

interface Props {
  videoInfo: VideoInfo;
  videoUrl: string;
  fragments: Fragment[];
  onFragmentsChange: (fragments: Fragment[]) => void;
  audioPath: string;
  audioStart: number;
  subtitles: SubtitleLine[];
  wordTimings: WordTiming[];
  style: SubtitleStyle;
  onStyleChange: (s: SubtitleStyle) => void;
  karaoke: boolean;
  onKaraokeChange: (k: boolean) => void;
  displayMode: string;
  onDisplayModeChange: (m: 'auto' | 'line_highlight' | 'word_by_word' | 'single_word') => void;
  templateId: string;
  onTemplateChange: (id: string) => void;
  segmentDuration: number;
  bpmData: BPMResult | null;
  beatEffectsOn: boolean;
  onBeatEffectsToggle: (on: boolean) => void;
  onIntensityChange: (type: 'zoom' | 'flash' | 'shake', value: number) => void;
  zoomIntensity: number;
  flashIntensity: number;
  shakeIntensity: number;
}

export function FragmentsPreviewMerged({
  videoInfo, videoUrl, fragments, onFragmentsChange,
  audioPath, audioStart, subtitles, wordTimings,
  style, onStyleChange, karaoke, onKaraokeChange,
  displayMode, onDisplayModeChange, templateId, onTemplateChange,
  segmentDuration, bpmData, beatEffectsOn, onBeatEffectsToggle,
  onIntensityChange, zoomIntensity, flashIntensity, shakeIntensity,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [activeTab, setActiveTab] = useState<'templates' | 'style' | 'effects'>('templates');
  const { templates } = useTemplates();

  // ── Preview clip state (reuse prepare-preview endpoint) ──
  const [previewData, setPreviewData] = useState<{
    video_url: string;
    audio_url: string | null;
    duration: number;
    word_timings: WordTiming[];
    subtitles: SubtitleLine[];
    fragments: { id: number; start: number; end: number; duration: number }[];
  } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);

  const subsKey = JSON.stringify(subtitles.map(s => ({ id: s.id, start: s.start, end: s.end, text: s.text })));
  const wordsKey = JSON.stringify(wordTimings.map(w => `${w.word}@${w.start}-${w.end}`));
  const fragsKey = JSON.stringify(fragments.map(f => `${f.id}:${f.start}:${f.end}:${f.duration}`));

  // Bump dataVersion on content changes
  useEffect(() => { setDataVersion(v => v + 1); }, [subsKey, wordsKey, fragsKey]);

  // Debounced prepare-preview (800ms after changes)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!videoUrl || fragments.length === 0) return;
    if (wordTimings.length === 0 && subtitles.length === 0) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPreparing(true);
      fetch('/api/prepare-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_path: videoUrl,
          audio_path: audioPath || null,
          audio_start: audioStart,
          fragments: fragments.map(f => ({ id: f.id, start: f.start, end: f.end, duration: f.duration })),
          word_timings: wordTimings,
          subtitles: subtitles,
        }),
      }).then(r => r.json()).then(data => {
        setPreviewData(data);
        setPreparing(false);
      }).catch(err => {
        console.error('Prepare preview failed:', err);
        setPreparing(false);
      });
    }, 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [videoUrl, fragsKey, dataVersion, audioStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Time update ──
  const onTimeUpdate = useCallback(() => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
  }, []);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      if (audioRef.current) audioRef.current.pause();
    } else {
      videoRef.current.play();
      if (audioRef.current) {
        audioRef.current.currentTime = videoRef.current.currentTime;
        audioRef.current.play();
      }
    }
    setIsPlaying(!isPlaying);
  };

  const seekTo = (t: number) => {
    const clamped = Math.max(0, Math.min(t, previewData?.duration || duration));
    if (videoRef.current) videoRef.current.currentTime = clamped;
    if (audioRef.current) audioRef.current.currentTime = clamped;
  };

  // ── Active fragment (sync with playhead) ──
  const previewFragments = previewData?.fragments || [];
  const activeFragmentIdx = previewFragments.findIndex(f => currentTime >= f.start && currentTime <= f.end);

  // ── Seek to fragment by index ──
  const handleFragmentClick = (idx: number) => {
    const frag = previewFragments[idx];
    if (frag) seekTo(frag.start);
  };

  // ── Active subtitle + word ──
  const previewSubs = previewData?.subtitles || subtitles;
  const previewWords = previewData?.word_timings || wordTimings;
  const activeSub = previewSubs.find(s => currentTime >= s.start && currentTime <= s.end);
  const activeWord = previewWords.find(w => currentTime >= w.start && currentTime <= w.end);

  const activeVideoUrl = previewData?.video_url || null;
  const activeAudioUrl = previewData?.audio_url || null;
  const previewDuration = previewData?.duration || duration;

  // Determine crop mode from template
  const cropMode = 'crop_fill'; // default; could be derived from template

  // ── Apply template ──
  const applyTemplate = (tmpl: RenderTemplate) => {
    applyTemplateToStyle(tmpl, onStyleChange, onDisplayModeChange, onTemplateChange);
  };

  // ── CSS subtitle rendering (reused from VideoPreviewEditor) ──
  const renderSubtitles = () => {
    if (!activeWord) return null;
    const activeCss = assToCss(style.active_color);
    return (
      <div style={{
        fontFamily: `'${style.font}', sans-serif`,
        fontSize: `${style.size * 0.25}px`,
        fontWeight: style.bold ? 'bold' : 'normal',
        color: activeCss,
        textAlign: 'center',
        lineHeight: 1.3,
        padding: '0 20px',
        maxWidth: '90%',
      }}>
        {activeWord.word}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Film size={18} className="text-purple-400" />
        <h2 className="text-base font-semibold text-white">Fragments & Preview</h2>
        <span className="text-xs text-gray-500 ml-auto">🧪 Lab mode · 9:16 · 1080×1920</span>
      </div>

      {/* 3-column layout */}
      <div className="flex gap-3" style={{ minHeight: 500 }}>
        {/* ── LEFT: FragmentRail ── */}
        <div className="w-[180px] shrink-0">
          <FragmentRail
            videoInfo={videoInfo}
            fragments={fragments}
            onFragmentsChange={onFragmentsChange}
            segmentDuration={segmentDuration}
            cropMode={cropMode}
            activeFragmentIdx={activeFragmentIdx}
            onFragmentClick={handleFragmentClick}
          />
        </div>

        {/* ── CENTER: 9:16 Live Preview ── */}
        <div className="flex-1 flex flex-col items-center justify-start">
          <div
            className="relative bg-black rounded-xl overflow-hidden border border-[#2a2a3a] shadow-2xl"
            style={{ width: 270, height: 480 }}
          >
            {preparing && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 text-sm gap-2 z-10">
                <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-[10px]">Rebuilding preview...</span>
              </div>
            )}
            {activeVideoUrl && !preparing && (
              <>
                <video
                  ref={videoRef}
                  src={activeVideoUrl}
                  onTimeUpdate={onTimeUpdate}
                  onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => { setIsPlaying(false); if (audioRef.current) audioRef.current.pause(); }}
                  className="w-full h-full object-contain"
                  playsInline
                />
                {/* Subtitle overlay */}
                <div className="absolute left-0 right-0 text-center pointer-events-none"
                  style={style.position === 'top' ? { top: '20px' } : style.position === 'center' ? { top: '45%' } : { bottom: '60px' }}>
                  {renderSubtitles()}
                </div>
              </>
            )}
            {!activeVideoUrl && !preparing && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-sm">
                Loading preview...
              </div>
            )}
          </div>

          {/* Playback controls */}
          <div className="flex items-center gap-2 mt-3">
            <button onClick={() => seekTo(Math.max(0, currentTime - 1))} className="p-1.5 hover:bg-[#2a2a3a] rounded transition">
              <SkipBack size={14} className="text-gray-400" />
            </button>
            <button onClick={togglePlay} className="p-2 bg-purple-600 hover:bg-purple-500 rounded transition">
              {isPlaying ? <Pause size={16} className="text-white" /> : <Play size={16} className="text-white" />}
            </button>
            <button onClick={() => seekTo(Math.min(previewDuration, currentTime + 1))} className="p-1.5 hover:bg-[#2a2a3a] rounded transition">
              <SkipForward size={14} className="text-gray-400" />
            </button>
            <span className="text-xs text-gray-400 font-mono ml-1">
              {currentTime.toFixed(1)} / {previewDuration.toFixed(1)}s
            </span>
            {activeFragmentIdx >= 0 && (
              <span className="text-xs text-purple-400 font-mono ml-2">
                · frag #{activeFragmentIdx + 1}
              </span>
            )}
          </div>

          {/* Hidden audio element for audio playback */}
          {activeAudioUrl && (
            <audio ref={audioRef} src={activeAudioUrl} preload="auto" />
          )}
        </div>

        {/* ── RIGHT: Style / Templates / Effects ── */}
        <div className="w-[280px] shrink-0 space-y-3">
          {/* Tabs */}
          <div className="flex gap-1 bg-[#0a0a0f] border border-[#1a1a2a] rounded-lg p-1">
            {(['templates', 'style', 'effects'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 px-2 py-1.5 rounded text-xs capitalize transition ${
                  activeTab === tab ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {activeTab === 'templates' && (
            <div className="space-y-2">
              {templates.map(tmpl => (
                <button
                  key={tmpl.id}
                  onClick={() => applyTemplate(tmpl)}
                  className={`w-full text-left p-2 rounded-lg border transition ${
                    templateId === tmpl.id
                      ? 'border-purple-500 bg-purple-500/10'
                      : 'border-[#1a1a2a] bg-[#0a0a0f] hover:border-[#2a2a3a]'
                  }`}
                >
                  <div className="text-sm font-medium text-white">{tmpl.name}</div>
                  <div className="text-[10px] text-gray-500">{tmpl.description}</div>
                </button>
              ))}
            </div>
          )}

          {activeTab === 'style' && (
            <div className="space-y-3 bg-[#0a0a0f] border border-[#1a1a2a] rounded-xl p-3">
              {/* Font */}
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Font</label>
                <select
                  value={style.font}
                  onChange={e => onStyleChange({ ...style, font: e.target.value })}
                  className="w-full bg-[#0f0f17] border border-[#2a2a3a] rounded px-2 py-1.5 text-sm text-white outline-none focus:border-purple-500"
                >
                  {['Arial', 'Montserrat', 'Oswald', 'Russo One', 'Pacifico', 'Impact'].map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
              {/* Size */}
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Size: {style.size}px</label>
                <input type="range" min={24} max={140} step={2} value={style.size}
                  onChange={e => onStyleChange({ ...style, size: parseInt(e.target.value) })}
                  className="w-full accent-purple-500" />
              </div>
              {/* Active color */}
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Active color</label>
                <input type="color" value={assToCss(style.active_color)}
                  onChange={e => onStyleChange({ ...style, active_color: cssToAss(e.target.value) })}
                  className="w-10 h-8 rounded border border-[#2a2a3a] bg-transparent cursor-pointer" />
              </div>
              {/* Outline width */}
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Outline: {style.outline_width}px</label>
                <input type="range" min={0} max={10} step={1} value={style.outline_width}
                  onChange={e => onStyleChange({ ...style, outline_width: parseInt(e.target.value) })}
                  className="w-full accent-purple-500" />
              </div>
              {/* Position */}
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Position</label>
                <div className="flex gap-1">
                  {['top', 'center', 'bottom'].map(p => (
                    <button key={p} onClick={() => onStyleChange({ ...style, position: p as any })}
                      className={`flex-1 px-2 py-1 rounded text-xs capitalize ${
                        style.position === p ? 'bg-purple-600 text-white' : 'bg-[#1a1a2a] text-gray-400'
                      }`}>{p}</button>
                  ))}
                </div>
              </div>
              {/* Bold */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={style.bold}
                  onChange={e => onStyleChange({ ...style, bold: e.target.checked })}
                  className="accent-purple-500" />
                <span className="text-xs text-gray-300">Bold</span>
              </label>
            </div>
          )}

          {activeTab === 'effects' && (
            <div className="space-y-3 bg-[#0a0a0f] border border-[#1a1a2a] rounded-xl p-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={beatEffectsOn}
                  onChange={e => onBeatEffectsToggle(e.target.checked)}
                  className="accent-purple-500" />
                <span className="text-xs text-gray-300">Beat effects</span>
              </label>
              {beatEffectsOn && (
                <>
                  <div>
                    <label className="text-[10px] text-gray-500">Zoom: {zoomIntensity.toFixed(2)}</label>
                    <input type="range" min={0} max={0.3} step={0.01} value={zoomIntensity}
                      onChange={e => onIntensityChange('zoom', parseFloat(e.target.value))}
                      className="w-full accent-purple-500" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500">Flash: {flashIntensity.toFixed(2)}</label>
                    <input type="range" min={0} max={1} step={0.05} value={flashIntensity}
                      onChange={e => onIntensityChange('flash', parseFloat(e.target.value))}
                      className="w-full accent-purple-500" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500">Shake: {shakeIntensity.toFixed(2)}</label>
                    <input type="range" min={0} max={1} step={0.05} value={shakeIntensity}
                      onChange={e => onIntensityChange('shake', parseFloat(e.target.value))}
                      className="w-full accent-purple-500" />
                  </div>
                </>
              )}
              {bpmData && (
                <div className="text-[10px] text-gray-500 pt-2 border-t border-[#1a1a2a]">
                  ♩ {bpmData.bpm} BPM
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify it compiles**

```bash
cd /home/karlen/project/raptok/frontend && npx tsc --noEmit 2>&1 | grep -i "FragmentsPreviewMerged" | head -5
```

**Step 3: Commit**

```bash
git add frontend/src/components/FragmentsPreviewMerged.tsx
git commit -m "feat: create FragmentsPreviewMerged 3-column layout (rail + preview + controls)"
```

---

### Task 8: Wire up App.tsx with lab toggle and merged component

**Objective:** Finalize App.tsx changes from Task 5 — import the new components, wire up all props, ensure navigation works in both modes.

**Files:**
- Modify: `frontend/src/App.tsx`

**Step 1: Complete the App.tsx changes from Task 5**

Add imports at the top:
```typescript
import { FragmentsPreviewMerged } from './components/FragmentsPreviewMerged';
```

Implement all the changes described in Task 5: labMode state, STEPS_LAB, dynamic step indicator, lab toggle button, conditional rendering, canProceed update, maxStep in navigation.

**Step 2: Verify TypeScript compiles**

```bash
cd /home/karlen/project/raptok/frontend && npx tsc --noEmit 2>&1 | head -20
```
Expected: no new errors.

**Step 3: Build frontend**

```bash
cd /home/karlen/project/raptok/frontend && npm run build 2>&1 | tail -5
```
Expected: build succeeds.

**Step 4: Deploy + test**

```bash
cd /home/karlen/project/raptok
docker compose restart raptok-frontend
# Visit jimmy.hotloads.llc, toggle Lab mode, verify merged screen
```

**Step 5: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: wire lab toggle + merged fragments/preview screen in App.tsx"
```

---

## Phase 6: Responsive + Polish

### Task 9: Add responsive layout for narrow screens

**Objective:** On screens <1024px, collapse the fragment rail to a horizontal strip above the preview. Hide the right column behind a toggle.

**Files:**
- Modify: `frontend/src/components/FragmentsPreviewMerged.tsx`

**Step 1: Add responsive classes**

Wrap the 3-column flex in a responsive container:

```tsx
{/* Desktop: 3 columns. Mobile: stacked. */}
<div className="flex flex-col lg:flex-row gap-3" style={{ minHeight: 500 }}>
  {/* LEFT: FragmentRail — horizontal on mobile, vertical on desktop */}
  <div className="w-full lg:w-[180px] shrink-0 lg:order-1">
    <div className="lg:hidden">
      {/* Horizontal scroll on mobile */}
      <FragmentRail ... />
    </div>
    <div className="hidden lg:block">
      <FragmentRail ... />
    </div>
  </div>
  ...
```

For the mobile horizontal FragmentRail, add a prop `orientation="horizontal"` that renders the rail as a horizontal scroll of small cards instead of vertical.

**Step 2: Build + verify**

```bash
cd /home/karlen/project/raptok/frontend && npm run build && docker compose restart raptok-frontend
```

**Step 3: Commit**

```bash
git add frontend/src/components/FragmentsPreviewMerged.tsx frontend/src/components/FragmentRail.tsx
git commit -m "feat: responsive layout for merged screen (horizontal rail on mobile)"
```

---

## Phase 7: Testing & Verification

### Task 10: End-to-end manual test

**Objective:** Verify all acceptance criteria from the spec.

**Test checklist:**

```bash
# 1. Lab OFF → current flow unchanged (7 steps)
#    - Navigate through all 7 steps
#    - FragmentEditor shows 16:9 grid (unchanged)
#    - VideoPreviewEditor on step 5 (unchanged)

# 2. Lab ON → 6 steps, merged screen
#    - Toggle button in header: 🧪 Lab: ON
#    - Step indicator shows 6 steps
#    - Step 4 = "Fragments & Preview"

# 3. Fragment rail (left column)
#    - Shows 9:16 cropped previews (not 16:9)
#    - Active fragment syncs with playhead (purple ring)
#    - Click fragment → seek main preview
#    - Drag-swap works (drag #2 onto #5 → positions swap)
#    - Replace (🎲) → new random start + new preview
#    - Adjust (↔) → slider shifts start ±5s
#    - Remove → fragment removed, durations redistributed
#    - Add → new fragment added
#    - Shuffle → all starts re-rolled
#    - Hover → multi-frame scrub (3 frames cycle)

# 4. Live preview (center)
#    - Video plays with audio
#    - Subtitles overlay shows active word
#    - Play/pause/skip controls work
#    - Preview rebuilds after fragment edits (800ms debounce)

# 5. Right panel
#    - Templates tab: apply template works
#    - Style tab: font/size/color/position/bold work
#    - Effects tab: beat effects toggle + sliders

# 6. Filmstrip (bottom of left column)
#    - Shows all fragments in order
#    - Click → seek

# 7. Lab toggle persists in localStorage
#    - Reload page → lab mode preserved

# 8. Lab OFF again → 7 steps restored, no errors
```

**Commit test results:**

```bash
git add -A
git commit -m "test: verify lab mode — all acceptance criteria pass"
```

---

## Summary

| Phase | Tasks | What |
|-------|-------|------|
| 1 | 1-3 | Backend: 9:16 frame extraction (single + multi) |
| 2 | 4 | Frontend: API client + types |
| 3 | 5 | Lab toggle in App.tsx |
| 4 | 6 | FragmentRail component |
| 5 | 7-8 | Merged screen + wiring |
| 6 | 9 | Responsive layout |
| 7 | 10 | E2E testing |

**Total: 10 tasks, ~2-5 min each.**

Current flow is 100% preserved — Lab toggle OFF = zero changes. Lab ON = new merged experience.