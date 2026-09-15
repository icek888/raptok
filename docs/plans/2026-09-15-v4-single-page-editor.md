# RapTok v4.0 Single-Page Editor — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a LYRC-style single-page editor at `/v2` alongside the existing wizard at `/`, with OpenRouter STT transcription.

**Architecture:** React Router splits `/` (wizard, untouched) and `/v2` (new EditorView). EditorView uses a centralized `useEditorState` hook, 4-panel layout (Clips/Preview/Tabs/Timeline), and a TrimModal for audio upload. Backend gets a new OpenRouter STT endpoint with CrisperWhisper fallback.

**Tech Stack:** React 19, Vite 8, TypeScript 6, Tailwind 4, react-router-dom, FastAPI, httpx, OpenRouter STT API

**Spec:** `docs/specs/v4-single-page-editor.md`

---

## Phase 1: Routing & Project Structure

### Task 1: Install react-router-dom

**Objective:** Add routing dependency to frontend.

**Files:**
- Modify: `frontend/package.json`

**Step 1:** Install dependency

```bash
cd /home/karlen/project/raptok/frontend
npm install react-router-dom
```

**Step 2:** Verify installation

```bash
node -e "require('react-router-dom'); console.log('OK')"
```
Expected: `OK`

**Step 3: Commit**

```bash
cd /home/karlen/project/raptok
git add frontend/package.json frontend/package-lock.json
git commit -m "feat: add react-router-dom for /v2 routing"
```

---

### Task 2: Create directory structure for editor-v2

**Objective:** Create all folders and stub files for the new editor.

**Files:**
- Create: `frontend/src/pages/WizardPage.tsx`
- Create: `frontend/src/pages/EditorPage.tsx`
- Create: `frontend/src/components/editor-v2/EditorView.tsx`
- Create: `frontend/src/components/editor-v2/ClipsPanel.tsx`
- Create: `frontend/src/components/editor-v2/PreviewCanvas.tsx`
- Create: `frontend/src/components/editor-v2/EditorTabs.tsx`
- Create: `frontend/src/components/editor-v2/TimelineTracks.tsx`
- Create: `frontend/src/components/editor-v2/TrimModal.tsx`
- Create: `frontend/src/components/editor-v2/useEditorState.ts`
- Create: `frontend/src/components/editor-v2/types.ts`
- Create: `frontend/src/components/editor-v2/tabs/LyricsTab.tsx`
- Create: `frontend/src/components/editor-v2/tabs/StyleTab.tsx`
- Create: `frontend/src/components/editor-v2/tabs/VisualsTab.tsx`
- Create: `frontend/src/components/editor-v2/tabs/FXTab.tsx`

**Step 1:** Create directories

```bash
mkdir -p frontend/src/pages
mkdir -p frontend/src/components/editor-v2/tabs
```

**Step 2:** Create stub files — each exports a placeholder component:

`frontend/src/components/editor-v2/types.ts`:
```typescript
// Editor v2 types — see spec section 3.1
export interface EditorState {
  audioFile: File | null;
  audioUrl: string | null;
  audioDuration: number;
  audioWaveform: number[];
  trimStart: number;
  trimEnd: number;
  trimmedDuration: number;
  words: WordTiming[];
  language: 'ru' | 'en' | 'auto';
  transcriptModel: string;
  isTranscribing: boolean;
  clips: Clip[];
  timelineSlots: TimelineSlot[];
  framing: 'fit' | 'fill';
  background: 'black' | 'subtle' | 'medium' | 'heavy';
  canvasPosition: { x: number; y: number; scale: number; rotation: number };
  style: EditorStyle;
  effects: EditorEffects;
  currentTime: number;
  isPlaying: boolean;
  bpm: number;
  activeTab: 'lyrics' | 'style' | 'visuals' | 'fx';
  selectedSlotId: string | null;
  selectedWordIndex: number | null;
  isTrimModalOpen: boolean;
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface Clip {
  id: string;
  name: string;
  source: 'stock' | 'user';
  thumbnail: string;
  duration: number;
  locked: boolean;
}

export interface TimelineSlot {
  id: string;
  clipId: string | null;
  start: number;
  end: number;
  wordIndices: number[];
}

export interface EditorStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  highlightColor: string;
  position: 'top' | 'center' | 'bottom' | 'custom';
  customX: number;
  customY: number;
  template: 'cinematic' | 'lyrics' | 'hype' | 'custom';
  karaokeProgress: boolean;
}

export interface EditorEffects {
  zoom: boolean;
  flash: boolean;
  shake: boolean;
  vignette: boolean;
  intensity: number;
}
```

`frontend/src/components/editor-v2/EditorView.tsx` (stub):
```tsx
export default function EditorView() {
  return <div className="h-screen bg-black text-white">EditorView stub</div>;
}
```

Each tab stub: `export default function XxxTab() { return <div>XxxTab stub</div>; }`

**Step 3: Commit**

```bash
git add frontend/src/pages/ frontend/src/components/editor-v2/
git commit -m "feat: scaffold editor-v2 directory structure"
```

---

### Task 3: Rename App.tsx to WizardPage and create new App.tsx router

**Objective:** Convert App.tsx to a router that serves wizard at `/` and editor at `/v2`.

**Files:**
- Rename: `frontend/src/App.tsx` → `frontend/src/pages/WizardPage.tsx`
- Create: `frontend/src/App.tsx` (new router, ~15 lines)

**Step 1:** Rename current App.tsx

```bash
cd frontend/src
cp App.tsx pages/WizardPage.tsx
```

**Step 2:** In `pages/WizardPage.tsx`, change the export:

```tsx
// Change "export default function App()" to:
export default function WizardPage() {
  // ... rest unchanged
}
```

**Step 3:** Create new `App.tsx`:

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import WizardPage from './pages/WizardPage';
import EditorPage from './pages/EditorPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WizardPage />} />
        <Route path="/v2" element={<EditorPage />} />
      </Routes>
    </BrowserRouter>
  );
}
```

**Step 4:** Create `pages/EditorPage.tsx`:

```tsx
import EditorView from '../components/editor-v2/EditorView';

export default function EditorPage() {
  return <EditorView />;
}
```

**Step 5:** Verify build

```bash
cd frontend
npm run build 2>&1 | tail -5
```
Expected: Build succeeds (may have warnings, no errors)

**Step 6:** Verify dev server

```bash
npm run dev &
sleep 3
curl -s http://localhost:5173/ | head -5
curl -s http://localhost:5173/v2 | head -5
kill %1
```
Expected: Both return HTML

**Step 7: Commit**

```bash
git add frontend/src/App.tsx frontend/src/pages/
git commit -m "feat: add React Router — wizard at / , editor at /v2"
```

---

## Phase 2: State Management

### Task 4: Implement useEditorState hook

**Objective:** Create the centralized state hook with all state fields and actions.

**Files:**
- Create: `frontend/src/components/editor-v2/useEditorState.ts`

**Step 1:** Write the hook with useState for all EditorState fields:

```typescript
import { useState, useCallback, useEffect, useRef } from 'react';
import type { EditorState, WordTiming, Clip, TimelineSlot, EditorStyle, EditorEffects } from './types';
import { api } from '../../api/client';

const initialState: EditorState = {
  audioFile: null,
  audioUrl: null,
  audioDuration: 0,
  audioWaveform: [],
  trimStart: 0,
  trimEnd: 30,
  trimmedDuration: 30,
  words: [],
  language: 'ru',
  transcriptModel: 'qwen/qwen3-asr-0.6b',
  isTranscribing: false,
  clips: [],
  timelineSlots: [],
  framing: 'fit',
  background: 'black',
  canvasPosition: { x: 50, y: 50, scale: 1, rotation: 0 },
  style: {
    fontFamily: 'Arial',
    fontSize: 48,
    fontWeight: 700,
    color: '#ffffff',
    highlightColor: '#22d3ee',
    position: 'center',
    customX: 50,
    customY: 50,
    template: 'custom',
    karaokeProgress: false,
  },
  effects: { zoom: false, flash: false, shake: false, vignette: false, intensity: 0.5 },
  currentTime: 0,
  isPlaying: false,
  bpm: 0,
  activeTab: 'lyrics',
  selectedSlotId: null,
  selectedWordIndex: null,
  isTrimModalOpen: false,
};

export function useEditorState() {
  const [state, setState] = useState<EditorState>(initialState);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Helper to update partial state
  const update = useCallback(<K extends keyof EditorState>(key: K, value: EditorState[K]) => {
    setState(prev => ({ ...prev, [key]: value }));
  }, []);

  // Actions
  const loadAudio = useCallback(async (file: File) => {
    update('audioFile', file);
    update('audioUrl', URL.createObjectURL(file));
    const result = await api.uploadAudio(file);
    // Fetch waveform + duration via audio-info
    const info = await api.audioInfo(result.path);
    update('audioDuration', info.duration);
    update('audioWaveform', info.rms_values || []);
    update('bpm', info.bpm);
    update('trimStart', info.suggested_start);
    update('trimEnd', info.suggested_end);
    update('trimmedDuration', info.suggested_end - info.suggested_start);
  }, [update]);

  const trimAudio = useCallback((start: number, end: number) => {
    update('trimStart', start);
    update('trimEnd', end);
    update('trimmedDuration', end - start);
  }, [update]);

  const transcribe = useCallback(async () => {
    if (!state.audioFile) return;
    update('isTranscribing', true);
    try {
      // Try OpenRouter STT first
      const result = await api.transcribeOpenRouter(
        state.audioFile,
        state.language,
        state.transcriptModel
      );
      update('words', result.words);
    } catch (e) {
      // Fallback to local CrisperWhisper
      console.warn('OpenRouter STT failed, falling back to CrisperWhisper');
      // TODO: implement fallback
    } finally {
      update('isTranscribing', false);
    }
  }, [state.audioFile, state.language, state.transcriptModel, update]);

  const setWords = useCallback((words: WordTiming[]) => update('words', words), [update]);
  const addClip = useCallback((clip: Clip) => setState(prev => ({ ...prev, clips: [...prev.clips, clip] })), []);
  const removeClip = useCallback((id: string) => setState(prev => ({ ...prev, clips: prev.clips.filter(c => c.id !== id) })), []);
  const lockClip = useCallback((id: string) => setState(prev => ({ ...prev, clips: prev.clips.map(c => c.id === id ? { ...c, locked: !c.locked } : c) })), []);
  const fillSlots = useCallback(() => {
    setState(prev => {
      const unlocked = prev.clips.filter(c => !c.locked);
      if (unlocked.length === 0) return prev;
      const slots = [...prev.timelineSlots];
      let clipIdx = 0;
      for (let i = 0; i < slots.length; i++) {
        if (!slots[i].clipId) {
          slots[i] = { ...slots[i], clipId: unlocked[clipIdx % unlocked.length].id };
          clipIdx++;
        }
      }
      return { ...prev, timelineSlots: slots };
    });
  }, []);
  const shuffleSlots = useCallback(() => {
    setState(prev => {
      const unlocked = prev.clips.filter(c => !c.locked);
      const shuffled = [...unlocked].sort(() => Math.random() - 0.5);
      let clipIdx = 0;
      const slots = prev.timelineSlots.map(slot => {
        const existingClip = prev.clips.find(c => c.id === slot.clipId);
        if (existingClip?.locked) return slot;
        return { ...slot, clipId: shuffled[clipIdx % shuffled.length]?.id || null, ...(clipIdx++ , {}) };
      });
      return { ...prev, timelineSlots: slots };
    });
  }, []);
  const selectSlot = useCallback((id: string | null) => update('selectedSlotId', id), [update]);
  const selectWord = useCallback((idx: number | null) => update('selectedWordIndex', idx), [update]);
  const setStyle = useCallback((partial: Partial<EditorStyle>) => setState(prev => ({ ...prev, style: { ...prev.style, ...partial } })), []);
  const setEffects = useCallback((partial: Partial<EditorEffects>) => setState(prev => ({ ...prev, effects: { ...prev.effects, ...partial } })), []);
  const setVisuals = useCallback((partial: Partial<Pick<EditorState, 'framing' | 'background' | 'canvasPosition'>>) => setState(prev => ({ ...prev, ...partial })), []);
  const play = useCallback(() => update('isPlaying', true), [update]);
  const pause = useCallback(() => update('isPlaying', false), [update]);
  const seek = useCallback((time: number) => update('currentTime', time), [update]);
  const setTab = useCallback((tab: EditorState['activeTab']) => update('activeTab', tab), [update]);

  return {
    state,
    videoRef,
    actions: { loadAudio, trimAudio, transcribe, setWords, addClip, removeClip, lockClip, fillSlots, shuffleSlots, selectSlot, selectWord, setStyle, setEffects, setVisuals, play, pause, seek, setTab },
  };
}

export type EditorActions = ReturnType<typeof useEditorState>['actions'];
```

**Step 2:** Verify TypeScript compiles

```bash
cd frontend
npx tsc --noEmit 2>&1 | head -20
```
Expected: No errors (or only pre-existing errors)

**Step 3: Commit**

```bash
git add frontend/src/components/editor-v2/useEditorState.ts frontend/src/components/editor-v2/types.ts
git commit -m "feat: implement useEditorState hook with all actions"
```

---

## Phase 3: Editor Layout Shell

### Task 5: Build EditorView layout shell

**Objective:** Create the 4-panel layout (TopBar + 3 columns + Timeline zone).

**Files:**
- Modify: `frontend/src/components/editor-v2/EditorView.tsx`

**Step 1:** Implement layout:

```tsx
import { useEditorState } from './useEditorState';
import ClipsPanel from './ClipsPanel';
import PreviewCanvas from './PreviewCanvas';
import EditorTabs from './EditorTabs';
import TimelineTracks from './TimelineTracks';
import TrimModal from './TrimModal';

export default function EditorView() {
  const editor = useEditorState();
  const { state, actions } = editor;

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-100 overflow-hidden">
      {/* TopBar */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 h-12 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-neutral-400">
            {state.audioFile ? state.audioFile.name : 'Untitled Project'}
          </span>
          {state.bpm > 0 && <span className="text-xs text-cyan-400">{state.bpm} BPM</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => actions.setTab('lyrics')}
            className="px-3 py-1 text-xs bg-neutral-800 hover:bg-neutral-700 rounded"
          >
            Export
          </button>
        </div>
      </header>

      {/* Main 3-column area */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Clips */}
        <div className="w-[280px] shrink-0 border-r border-neutral-800">
          <ClipsPanel state={state} actions={actions} />
        </div>

        {/* Center: Preview */}
        <div className="flex-1 min-w-0 flex items-center justify-center bg-neutral-900">
          {state.audioUrl ? (
            <PreviewCanvas state={state} actions={actions} videoRef={editor.videoRef} />
          ) : (
            <button
              onClick={() => actions.setTab('lyrics')} // will open trim modal
              className="px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-medium rounded-lg"
            >
              New Project
            </button>
          )}
        </div>

        {/* Right: Editor Tabs */}
        <div className="w-[320px] shrink-0 border-l border-neutral-800">
          <EditorTabs state={state} actions={actions} />
        </div>
      </div>

      {/* Bottom: Timeline */}
      <div className="h-[220px] shrink-0 border-t border-neutral-800">
        <TimelineTracks state={state} actions={actions} videoRef={editor.videoRef} />
      </div>

      {/* Trim Modal */}
      {state.isTrimModalOpen && <TrimModal state={state} actions={actions} />}
    </div>
  );
}
```

**Step 2:** Create minimal stub implementations for all child components (each accepts `{ state, actions }` props and renders a placeholder div). These will be filled in later tasks.

Each stub component pattern:
```tsx
import type { EditorState } from '../types';
import type { EditorActions } from '../useEditorState';

interface Props { state: EditorState; actions: EditorActions; }

export default function ClipsPanel({ state, actions }: Props) {
  return <div className="p-3 text-sm text-neutral-500">ClipsPanel</div>;
}
```

**Step 3:** Verify build

```bash
cd frontend && npm run build 2>&1 | tail -3
```

**Step 4: Commit**

```bash
git add frontend/src/components/editor-v2/
git commit -m "feat: EditorView 4-panel layout shell with stubs"
```

---

## Phase 4: TrimModal

### Task 6: Implement TrimModal — waveform canvas + draggable handles

**Objective:** Build the audio upload modal with waveform visualization and trim selection.

**Files:**
- Modify: `frontend/src/components/editor-v2/TrimModal.tsx`

**Step 1:** Implement TrimModal:

```tsx
import { useState, useRef, useEffect, useCallback } from 'react';
import type { EditorState } from './types';
import type { EditorActions } from './useEditorState';

interface Props { state: EditorState; actions: EditorActions; }

const DURATION_PRESETS = [15, 20, 25, 30];

export default function TrimModal({ state, actions }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(state.trimStart);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);

  // Draw waveform on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !state.audioWaveform.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, W, H);
    // Draw waveform bars
    const bars = state.audioWaveform;
    const barWidth = W / bars.length;
    ctx.fillStyle = '#333';
    for (let i = 0; i < bars.length; i++) {
      const x = i * barWidth;
      const h = bars[i] * H * 0.8;
      ctx.fillRect(x, (H - h) / 2, Math.max(1, barWidth - 1), h);
    }
    // Draw selection region
    const startX = (state.trimStart / state.audioDuration) * W;
    const endX = (state.trimEnd / state.audioDuration) * W;
    ctx.fillStyle = 'rgba(34, 211, 238, 0.2)';
    ctx.fillRect(startX, 0, endX - startX, H);
    // Draw handles
    ctx.fillStyle = '#fff';
    ctx.fillRect(startX - 2, 0, 4, H);
    ctx.fillRect(endX - 2, 0, 4, H);
    // Draw playhead
    if (playing) {
      const phX = (playhead / state.audioDuration) * W;
      ctx.fillStyle = '#22d3ee';
      ctx.fillRect(phX - 1, 0, 2, H);
    }
  }, [state.audioWaveform, state.trimStart, state.trimEnd, state.audioDuration, playhead, playing]);

  // Handle mouse events on canvas
  const handleMouseDown = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = (x / rect.width) * state.audioDuration;
    const distStart = Math.abs(time - state.trimStart);
    const distEnd = Math.abs(time - state.trimEnd);
    if (distStart < 1) setDragging('start');
    else if (distEnd < 1) setDragging('end');
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const time = (x / rect.width) * state.audioDuration;
    if (dragging === 'start') {
      actions.trimAudio(Math.min(time, state.trimEnd - 5), state.trimEnd);
    } else {
      actions.trimAudio(state.trimStart, Math.max(time, state.trimStart + 5));
    }
  };

  const handleMouseUp = () => setDragging(null);

  const setDuration = (dur: number) => {
    actions.trimAudio(state.trimStart, Math.min(state.trimStart + dur, state.audioDuration));
  };

  const togglePlay = () => {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
    } else {
      if (audioRef.current) {
        audioRef.current.currentTime = playhead;
        audioRef.current.play();
        setPlaying(true);
      }
    }
  };

  const handleAudioTimeUpdate = () => {
    if (audioRef.current) {
      const t = audioRef.current.currentTime;
      setPlayhead(t);
      if (t >= state.trimEnd) {
        audioRef.current.pause();
        setPlaying(false);
      }
    }
  };

  const handleConfirm = () => {
    // Close modal + trigger transcription
    // The parent handles this via state change
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
      <div className="bg-neutral-900 rounded-xl p-6 w-[800px] max-w-[90vw]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-white">TRIM YOUR AUDIO</h2>
            <p className="text-xs text-neutral-500 mt-1">{state.audioFile?.name}</p>
          </div>
          <button className="text-neutral-500 hover:text-white text-xl">×</button>
        </div>

        {/* Waveform canvas */}
        <div className="relative mb-4">
          <canvas
            ref={canvasRef}
            width={760}
            height={120}
            className="w-full rounded-lg cursor-pointer"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />
          <p className="text-xs text-neutral-600 mt-1">Drag the white handles to pick your 15-30s clip</p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4 mb-4">
          <button onClick={togglePlay} className="w-10 h-10 flex items-center justify-center bg-cyan-500 text-black rounded-full">
            {playing ? '⏸' : '▶'}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-500">Zoom</span>
            <input type="range" min="1" max="10" step="0.5" value={zoom} onChange={e => setZoom(+e.target.value)} className="w-24" />
            <span className="text-xs text-neutral-400">{zoom.toFixed(1)}×</span>
          </div>
          <div className="text-xs text-neutral-400 ml-auto">
            Position: {Math.floor(playhead / 60)}:{(playhead % 60).toFixed(1).padStart(4, '0')}
          </div>
        </div>

        {/* Duration presets */}
        <div className="flex items-center gap-2 mb-6">
          <span className="text-xs text-neutral-500 mr-2">Duration:</span>
          {DURATION_PRESETS.map(d => (
            <button
              key={d}
              onClick={() => setDuration(d)}
              className={`px-3 py-1 text-xs rounded ${state.trimmedDuration === d ? 'bg-cyan-500 text-black' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`}
            >
              {d}s
            </button>
          ))}
        </div>

        {/* Confirm button */}
        <button
          onClick={handleConfirm}
          className="w-full py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-lg"
        >
          CONFIRM SELECTION
        </button>

        {/* Hidden audio element */}
        {state.audioUrl && (
          <audio
            ref={audioRef}
            src={state.audioUrl}
            onTimeUpdate={handleAudioTimeUpdate}
            onEnded={() => setPlaying(false)}
          />
        )}
      </div>
    </div>
  );
}
```

**Step 2:** Wire the "New Project" button in EditorView to open TrimModal:

In `EditorView.tsx`, change the empty state button:
```tsx
// Change from:
onClick={() => actions.setTab('lyrics')}
// To:
onClick={() => update('isTrimModalOpen', true)}
```
(Add `update` to the returned actions in useEditorState, or add a dedicated `openTrimModal` action.)

Add to `useEditorState.ts`:
```typescript
const openTrimModal = useCallback(() => update('isTrimModalOpen', true), [update]);
const closeTrimModal = useCallback(() => update('isTrimModalOpen', false), [update]);
```

In TrimModal `handleConfirm`:
```typescript
const handleConfirm = () => {
  actions.closeTrimModal();
  // Auto-transcribe after trim
  actions.transcribe();
};
```

**Step 3:** Verify build

**Step 4: Commit**

```bash
git add frontend/src/components/editor-v2/TrimModal.tsx frontend/src/components/editor-v2/EditorView.tsx frontend/src/components/editor-v2/useEditorState.ts
git commit -m "feat: TrimModal with waveform canvas + draggable handles + duration presets"
```

---

## Phase 5: PreviewCanvas

### Task 7: Implement PreviewCanvas — 9:16 video + lyrics overlay

**Objective:** Build the center 9:16 preview with video playback and real-time lyrics overlay.

**Files:**
- Modify: `frontend/src/components/editor-v2/PreviewCanvas.tsx`

**Step 1:** Implement PreviewCanvas:

```tsx
import { useEffect, useRef } from 'react';
import type { EditorState } from './types';
import type { EditorActions } from './useEditorState';

interface Props {
  state: EditorState;
  actions: EditorActions;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export default function PreviewCanvas({ state, actions, videoRef }: Props) {
  // Find current word based on currentTime
  const currentWordIdx = state.words.findIndex(
    w => state.currentTime >= w.start && state.currentTime < w.end
  );
  const currentWord = currentWordIdx >= 0 ? state.words[currentWordIdx] : null;

  // Calculate lyrics position
  const lyricsPos = {
    top: state.style.position === 'top' ? '10%' : state.style.position === 'center' ? '45%' : state.style.position === 'bottom' ? '80%' : `${state.style.customY}%`,
    left: state.style.position === 'custom' ? `${state.style.customX}%` : '50%',
    transform: state.style.position === 'custom' ? 'translate(-50%, -50%)' : 'translate(-50%, -50%)',
  };

  return (
    <div className="relative flex flex-col items-center justify-center h-full">
      {/* 9:16 Canvas */}
      <div
        className="relative bg-black overflow-hidden"
        style={{
          aspectRatio: '9/16',
          maxHeight: '100%',
          maxWidth: '100%',
          height: 'calc(100% - 40px)',
        }}
      >
        {/* Video layer */}
        {state.audioUrl && (
          <video
            ref={videoRef}
            src={state.audioUrl}
            className="absolute inset-0 w-full h-full"
            style={{
              objectFit: state.framing === 'fit' ? 'contain' : 'cover',
              transform: `scale(${state.canvasPosition.scale}) rotate(${state.canvasPosition.rotation}deg)`,
            }}
            onTimeUpdate={e => actions.seek(e.currentTarget.currentTime)}
            onClick={() => {
              if (state.isPlaying) actions.pause();
              else actions.play();
            }}
          />
        )}

        {/* Background blur layer (if not black) */}
        {state.background !== 'black' && (
          <div
            className="absolute inset-0 -z-10"
            style={{
              backgroundImage: `url(${state.audioUrl})`,
              filter: `blur(${state.background === 'subtle' ? 10 : state.background === 'medium' ? 20 : 40}px)`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
        )}

        {/* Lyrics overlay */}
        {currentWord && (
          <div
            className="absolute z-10 text-center pointer-events-none"
            style={{
              top: lyricsPos.top,
              left: lyricsPos.left,
              transform: lyricsPos.transform,
              fontFamily: state.style.fontFamily,
              fontSize: `${state.style.fontSize}px`,
              fontWeight: state.style.fontWeight,
              color: state.style.color,
              textShadow: '0 2px 8px rgba(0,0,0,0.8)',
            }}
          >
            <span style={{ color: state.style.highlightColor }}>
              {currentWord.word}
            </span>
          </div>
        )}

        {/* FX overlays */}
        {state.effects.vignette && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ boxShadow: 'inset 0 0 100px rgba(0,0,0,0.6)' }}
          />
        )}
        {state.effects.zoom && videoRef.current && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ transform: `scale(${1 + state.effects.intensity * 0.05})` }}
          />
        )}
      </div>

      {/* Playback controls */}
      <div className="flex items-center gap-3 mt-2 text-xs text-neutral-400">
        <button
          onClick={() => state.isPlaying ? actions.pause() : actions.play()}
          className="w-8 h-8 flex items-center justify-center bg-neutral-800 rounded-full"
        >
          {state.isPlaying ? '⏸' : '▶'}
        </button>
        <span>
          {Math.floor(state.currentTime / 60)}:{String(Math.floor(state.currentTime % 60)).padStart(2, '0')}
          {' / '}
          {Math.floor(state.trimmedDuration / 60)}:{String(Math.floor(state.trimmedDuration % 60)).padStart(2, '0')}
        </span>
        <span className="ml-2 px-2 py-0.5 bg-neutral-800 rounded">9:16</span>
      </div>
    </div>
  );
}
```

**Step 2:** Verify build

**Step 3: Commit**

```bash
git add frontend/src/components/editor-v2/PreviewCanvas.tsx
git commit -m "feat: PreviewCanvas 9:16 with lyrics overlay + FX + playback"
```

---

## Phase 6: ClipsPanel

### Task 8: Implement ClipsPanel — tabs, grid, fill/shuffle

**Objective:** Build the left panel with clip management.

**Files:**
- Modify: `frontend/src/components/editor-v2/ClipsPanel.tsx`

**Step 1:** Implement ClipsPanel (full component with Stock/User tabs, clip grid, Fill/Shuffle buttons, upload via file input).

**Step 2:** Add `uploadClip` action to `useEditorState`:

```typescript
const uploadClip = useCallback(async (file: File) => {
  const result = await api.uploadVideo(file);
  const newClip: Clip = {
    id: crypto.randomUUID(),
    name: file.name,
    source: 'user',
    thumbnail: '', // TODO: generate via fragmentPreview916
    duration: result.duration,
    locked: false,
  };
  addClip(newClip);
}, [addClip]);
```

**Step 3:** Wire drag-and-drop from clip card to timeline slots (HTML5 drag events).

**Step 4:** Verify build + commit

```bash
git add frontend/src/components/editor-v2/ClipsPanel.tsx frontend/src/components/editor-v2/useEditorState.ts
git commit -m "feat: ClipsPanel with tabs, grid, fill/shuffle, upload"
```

---

## Phase 7: EditorTabs

### Task 9: Implement EditorTabs container + LyricsTab

**Objective:** Build the tab container and Lyrics tab with text editing + re-transcribe.

**Files:**
- Modify: `frontend/src/components/editor-v2/EditorTabs.tsx`
- Modify: `frontend/src/components/editor-v2/tabs/LyricsTab.tsx`

**Step 1:** Implement EditorTabs (tab bar + conditional content rendering).

**Step 2:** Implement LyricsTab:
- Editable text blocks (textarea per line)
- Word list with timestamps (click to select)
- Re-transcribe button (calls `actions.transcribe()`)
- Language selector

**Step 3:** Verify build + commit

---

### Task 10: Implement StyleTab

**Objective:** Style tab with template presets, font, color, position controls.

**Files:**
- Modify: `frontend/src/components/editor-v2/tabs/StyleTab.tsx`

**Step 1:** Implement StyleTab with:
- Template preset cards (Cinematic / Lyrics / Hype / Custom)
- Font family dropdown, size slider, weight dropdown
- Color pickers (text + highlight)
- Position radio (top/center/bottom/custom) + X/Y sliders
- Karaoke progress toggle (visible only for Lyrics template)

**Step 2:** Verify build + commit

---

### Task 11: Implement VisualsTab

**Objective:** Visuals tab with framing, background, position/scale/rotation.

**Files:**
- Modify: `frontend/src/components/editor-v2/tabs/VisualsTab.tsx`

**Step 1:** Implement VisualsTab with:
- Framing toggle (Fit/Fill)
- Background radio (Black/Subtle/Medium/Heavy)
- X/Y/Scale/Rotation sliders
- "Apply to all slots" checkbox

**Step 2:** Verify build + commit

---

### Task 12: Implement FXTab

**Objective:** FX tab with beat effects + intensity + BPM.

**Files:**
- Modify: `frontend/src/components/editor-v2/tabs/FXTab.tsx`

**Step 1:** Implement FXTab with:
- Effect toggles (Zoom/Flash/Shake/Vignette)
- Intensity slider (0-100%)
- BPM display + "Re-detect BPM" button (calls `api.detectBPM`)
- Beat sync preview strip

**Step 2:** Verify build + commit

---

## Phase 8: TimelineTracks

### Task 13: Implement TimelineTracks — 3 tracks + playhead + zoom

**Objective:** Build the bottom timeline with 3 tracks (words, clips, waveform).

**Files:**
- Modify: `frontend/src/components/editor-v2/TimelineTracks.tsx`

**Step 1:** Implement TimelineTracks with:
- Track 1: Word pills (clickable, draggable timing)
- Track 1.5: Cut markers (magenta vertical lines)
- Track 2: Clip slot filmstrip (numbered, drag from ClipsPanel)
- Track 3: Audio waveform render
- Playhead (draggable vertical line across all tracks)
- Toolbar: play/pause, BPM, cut count, zoom slider, add cut

**Step 2:** Add zoom state and slot-generation logic to `useEditorState`:

```typescript
const [timelineZoom, setTimelineZoom] = useState(1);

// Generate slots from BPM + duration
const generateSlots = useCallback(() => {
  if (state.bpm === 0 || state.trimmedDuration === 0) return;
  const beatDuration = 60 / state.bpm;
  const slotCount = Math.floor(state.trimmedDuration / beatDuration);
  const slots: TimelineSlot[] = Array.from({ length: slotCount }, (_, i) => ({
    id: `slot-${i}`,
    clipId: null,
    start: i * beatDuration,
    end: (i + 1) * beatDuration,
    wordIndices: [],
  }));
  update('timelineSlots', slots);
}, [state.bpm, state.trimmedDuration, update]);
```

**Step 3:** Wire click handlers (word → select, slot → select, playhead → seek).

**Step 4:** Verify build + commit

---

## Phase 9: Backend — OpenRouter STT

### Task 14: Add httpx to backend requirements

**Objective:** Add httpx for async HTTP calls to OpenRouter.

**Files:**
- Modify: `backend/requirements.txt`

**Step 1:** Add `httpx>=0.27.0` to requirements.txt

**Step 2:** Install in container or venv:
```bash
pip install httpx
```

**Step 3: Commit**

---

### Task 15: Create OpenRouter STT service

**Objective:** Backend service that calls OpenRouter audio transcription API.

**Files:**
- Create: `backend/services/openrouter_stt.py`

**Step 1:** Implement the service:

```python
"""OpenRouter STT service — transcribe audio via OpenRouter API."""
import os
import base64
import httpx
from typing import Optional

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_STT_URL = "https://openrouter.ai/api/v1/audio/transcriptions"

async def transcribe_via_openrouter(
    audio_path: str,
    model: str = "qwen/qwen3-asr-0.6b",
    language: str = "ru",
) -> dict:
    """
    Transcribe audio file via OpenRouter STT API.
    Returns { words: [{word, start, end}], text, language, duration, model }
    """
    if not OPENROUTER_API_KEY:
        raise ValueError("OPENROUTER_API_KEY not set")

    with open(audio_path, "rb") as f:
        audio_b64 = base64.b64encode(f.read()).decode()

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
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
        )
        response.raise_for_status()
        data = response.json()

    # Parse word-level timestamps from verbose_json response
    words = []
    for seg in data.get("segments", []):
        for w in seg.get("words", []):
            words.append({
                "word": w.get("word", "").strip(),
                "start": float(w.get("start", 0)),
                "end": float(w.get("end", 0)),
            })

    # Fallback: if no segments with words, try top-level words
    if not words and "words" in data:
        for w in data["words"]:
            words.append({
                "word": w.get("word", "").strip(),
                "start": float(w.get("start", 0)),
                "end": float(w.get("end", 0)),
            })

    return {
        "words": words,
        "text": data.get("text", ""),
        "language": data.get("language", language),
        "duration": float(data.get("duration", 0)),
        "model": model,
    }
```

**Step 2: Commit**

---

### Task 16: Add OpenRouter STT endpoint to transcription router

**Objective:** Expose the OpenRouter STT as a backend API endpoint.

**Files:**
- Modify: `backend/routers/transcription.py`

**Step 1:** Add endpoint:

```python
from services.openrouter_stt import transcribe_via_openrouter
from services.crisper_transcriber import transcribe_audio_crisper

@router.post("/api/transcribe/openrouter")
async def api_transcribe_openrouter(req: OpenRouterSTTRequest):
    """Transcribe audio via OpenRouter STT with CrisperWhisper fallback."""
    try:
        result = await transcribe_via_openrouter(
            req.audio_path,
            model=req.model,
            language=req.language,
        )
        return result
    except Exception as e:
        # Fallback to local CrisperWhisper
        try:
            fallback = transcribe_audio_crisper(req.audio_path, language=req.language)
            return {**fallback, "fallback": True, "error": str(e)}
        except Exception as fallback_err:
            raise HTTPException(
                status_code=500,
                detail=f"OpenRouter failed: {e}. Fallback also failed: {fallback_err}"
            )
```

Add request model to `models/schemas.py`:
```python
class OpenRouterSTTRequest(BaseModel):
    audio_path: str
    model: str = "qwen/qwen3-asr-0.6b"
    language: str = "ru"
```

**Step 2: Commit**

---

### Task 17: Add transcribeOpenRouter to frontend API client

**Objective:** Add the API method to call the new backend endpoint.

**Files:**
- Modify: `frontend/src/api/client.ts`

**Step 1:** Add to the `api` object:

```typescript
transcribeOpenRouter: (
  audioFile: File,
  language: string = 'ru',
  model: string = 'qwen/qwen3-asr-0.6b',
): Promise<{
  words: { word: string; start: number; end: number }[];
  text: string;
  language: string;
  duration: number;
  model: string;
  fallback?: boolean;
}> => {
  const form = new FormData();
  form.append('file', audioFile);
  form.append('language', language);
  form.append('model', model);
  return postForm(`${API_BASE}/transcribe/openrouter`, form);
},
```

Note: The backend endpoint needs to accept file upload. Modify the endpoint to accept `UploadFile` instead of JSON path:

```python
@router.post("/api/transcribe/openrouter")
async def api_transcribe_openrouter(
    file: UploadFile = File(...),
    language: str = Form("ru"),
    model: str = Form("qwen/qwen3-asr-0.6b"),
):
    # Save uploaded file temporarily
    tmp_path = f"/tmp/raptok_stt_{file.filename}"
    with open(tmp_path, "wb") as f:
        f.write(await file.read())
    try:
        result = await transcribe_via_openrouter(tmp_path, model=model, language=language)
        return result
    except Exception as e:
        # Fallback...
    finally:
        os.unlink(tmp_path)
```

**Step 2: Commit**

---

## Phase 10: Integration & Polish

### Task 18: Wire all panels to useEditorState

**Objective:** Connect all components — actions flow correctly between panels.

**Step 1:** Update EditorView to pass correct props to all panels.
**Step 2:** Verify: upload audio → trim → transcribe → words appear → add clips → fill → preview plays.
**Step 3: Commit**

---

### Task 19: Add OPENROUTER_API_KEY to environment

**Objective:** Ensure the API key is available to the backend.

**Files:**
- Modify: `backend/config.py` (read from env)
- Modify: `docker-compose.yml` (pass env var)

**Step 1:** Add to config.py:
```python
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
```

**Step 2:** Add to docker-compose.yml backend environment:
```yaml
environment:
  - OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
```

**Step 3:** Add to `.env` file (not committed):
```
OPENROUTER_API_KEY=sk-or-v1-...
```

**Step 4: Commit** (docker-compose.yml only, not .env)

---

### Task 20: Nginx SPA fallback for /v2 route

**Objective:** Ensure nginx serves index.html for /v2 so React Router handles it.

**Files:**
- Modify: `nginx.conf`

**Step 1:** Add SPA fallback:
```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

**Step 2: Commit**

---

### Task 21: Keyboard shortcuts + loading states + empty states

**Objective:** Polish — add keyboard shortcuts, loading spinners, empty state messages.

**Step 1:** Add keyboard shortcuts to EditorView:
- Space: play/pause
- Ctrl+Scroll: zoom timeline
- Esc: close modal

**Step 2:** Add loading states:
- Transcribing spinner in Lyrics tab
- "Uploading..." in TrimModal
- Empty clips state: "No clips yet. Upload to get started."

**Step 3: Commit**

---

## Summary

- **21 tasks** across 10 phases
- **Phase 1-3:** Routing + state + layout shell (Tasks 1-5)
- **Phase 4:** TrimModal (Task 6)
- **Phase 5:** PreviewCanvas (Task 7)
- **Phase 6:** ClipsPanel (Task 8)
- **Phase 7:** EditorTabs + 4 tabs (Tasks 9-12)
- **Phase 8:** TimelineTracks (Task 13)
- **Phase 9:** Backend OpenRouter STT (Tasks 14-17)
- **Phase 10:** Integration + polish (Tasks 18-21)

**Each task = 2-5 minutes of focused work.**
**Each task ends with a commit.**
**Build verified after each task.**