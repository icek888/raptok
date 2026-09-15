import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import type { PanelProps } from './EditorView';
import type { RefObject } from 'react';

interface Props extends PanelProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  audioRef: RefObject<HTMLAudioElement | null>;
}

type DragMode = 'move' | 'resize-left' | 'resize-right' | null;

export default function TimelineTracks({ state, actions, videoRef, audioRef }: Props) {
  const [zoom, setZoom] = useState(1);
  const [editingWordIdx, setEditingWordIdx] = useState<number | null>(null);
  const [slotCountInput, setSlotCountInput] = useState(0); // 0 = use BPM
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const dur = state.trimmedDuration || 1;

  // Time → percentage of inner div width (zoom is already in inner div width)
  const timeToX = useCallback((t: number, width: number) => {
    return (t / dur) * width;
  }, [dur]);

  // Pixel → time (relative to trimmed segment)
  const xToTime = useCallback((x: number, width: number) => {
    return (x / width) * dur;
  }, [dur]);

  // Handle playhead drag — click on timeline to seek
  const handleTimelineClick = (e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left + container.scrollLeft;
    const relTime = xToTime(x, rect.width);
    const absTime = state.trimStart + Math.max(0, Math.min(relTime, dur));
    actions.seek(absTime);
    if (audioRef?.current) {
      audioRef.current.currentTime = absTime;
    }
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, relTime);
    }
  };

  const beatDuration = state.bpm > 0 ? 60 / state.bpm : 0.5;
  const slotCount = Math.floor(dur / beatDuration);

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  const widthPct = `${zoom * 100}%`;

  // --- Issue 2: Word card resize/move drag state ---
  const [dragState, setDragState] = useState<{
    wordIdx: number;
    mode: DragMode;
    startX: number;
    origStart: number;
    origEnd: number;
    containerWidth: number;
  } | null>(null);

  // Start a drag (resize handle or middle move)
  const startWordDrag = (
    e: React.MouseEvent,
    wordIdx: number,
    mode: 'move' | 'resize-left' | 'resize-right',
  ) => {
    e.stopPropagation();
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const w = state.words[wordIdx];
    if (!w) return;
    setDragState({
      wordIdx,
      mode,
      startX: e.clientX,
      origStart: w.start,
      origEnd: w.end,
      containerWidth: container.getBoundingClientRect().width,
    });
  };

  // Global mousemove/mouseup while dragging
  useEffect(() => {
    if (!dragState) return;
    const handleMove = (e: MouseEvent) => {
      const ds = dragState;
      const deltaX = e.clientX - ds.startX;
      const deltaTime = xToTime(deltaX, ds.containerWidth);
      const words = [...state.words];
      const w = { ...words[ds.wordIdx] };
      if (ds.mode === 'resize-left') {
        // Drag left edge → change start (can't exceed end)
        w.start = Math.min(ds.origStart + deltaTime, ds.origEnd - 0.05);
        w.start = Math.max(w.start, state.trimStart);
      } else if (ds.mode === 'resize-right') {
        // Drag right edge → change end (can't go below start)
        w.end = Math.max(ds.origEnd + deltaTime, ds.origStart + 0.05);
        w.end = Math.min(w.end, state.trimStart + dur);
      } else if (ds.mode === 'move') {
        // Move both start and end by same delta, clamp within trim range
        const durW = ds.origEnd - ds.origStart;
        let newStart = ds.origStart + deltaTime;
        newStart = Math.max(state.trimStart, Math.min(newStart, state.trimStart + dur - durW));
        w.start = newStart;
        w.end = newStart + durW;
      }
      words[ds.wordIdx] = w;
      actions.setWords(words);
    };
    const handleUp = () => setDragState(null);
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [dragState, state.words, state.trimStart, dur, xToTime, actions]);

  // --- Waveform: useLayoutEffect synchronously syncs canvas to inner div width ---
  const waveform = state.audioWaveform;

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    const inner = innerRef.current;
    if (!canvas || !inner) return;

    const w = inner.offsetWidth;
    const h = 60;
    if (w === 0) return;

    // Set both drawing buffer and CSS width to the exact inner div pixel width.
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // Draw waveform bars spread across the full canvas width
    if (waveform.length === 0) return;

    const barWidth = w / waveform.length;
    ctx.fillStyle = '#3b82f6'; // blue-500

    for (let i = 0; i < waveform.length; i++) {
      const x = i * barWidth;
      const barH = waveform[i] * h * 0.8;
      const y = (h - barH) / 2;
      ctx.fillRect(x, y, Math.max(1, barWidth - 0.5), barH);
    }
  }, [waveform]);

  // Sync canvas to inner div width before paint — runs on every zoom/data change
  useLayoutEffect(() => {
    drawWaveform();
  }, [zoom, waveform, drawWaveform]);

  // ResizeObserver on inner div — re-draw when its width changes (e.g. container resize)
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const ro = new ResizeObserver(() => drawWaveform());
    ro.observe(inner);
    return () => ro.disconnect();
  }, [drawWaveform]);

  return (
    <div className="flex flex-col h-full bg-neutral-950">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-neutral-800 text-xs">
        <button
          onClick={() => (state.isPlaying ? actions.pause() : actions.play())}
          className="w-6 h-6 flex items-center justify-center bg-neutral-800 hover:bg-neutral-700 rounded"
        >
          {state.isPlaying ? '⏸' : '▶'}
        </button>
        {state.bpm > 0 && <span className="text-neutral-400">{state.bpm} BPM</span>}
        <span className="text-neutral-500">Cuts: {state.timelineSlots.length}/{slotCount}</span>
        <input
          type="number"
          min="0"
          max="50"
          value={slotCountInput || ''}
          placeholder="BPM"
          onChange={e => setSlotCountInput(Math.max(0, +e.target.value))}
          className="w-12 px-1 py-0.5 text-[10px] bg-neutral-800 text-neutral-300 rounded border border-neutral-700 text-center"
          title="0 = use BPM, or enter slot count"
        />
        <button
          onClick={() => actions.generateSlots(slotCountInput || undefined)}
          disabled={state.bpm === 0 && !slotCountInput}
          className="px-2 py-0.5 text-[10px] bg-neutral-800 hover:bg-neutral-700 text-neutral-400 rounded disabled:opacity-50"
        >
          Gen Slots
        </button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-neutral-500">Zoom</span>
          <input
            type="range"
            min="1"
            max="4"
            step="0.1"
            value={zoom}
            onChange={e => setZoom(+e.target.value)}
            className="w-20 accent-cyan-500"
          />
          <span className="text-neutral-400 w-8">{zoom.toFixed(1)}×</span>
          <span className="text-neutral-500 ml-2">{fmtTime(state.currentTime - state.trimStart)}</span>
        </div>
      </div>

      {/* Tracks — all 3 inside the same widthPct div (Issue 3) */}
      <div
        ref={containerRef}
        className="flex-1 overflow-x-auto overflow-y-hidden relative"
        onClick={handleTimelineClick}
      >
        <div ref={innerRef} style={{ width: widthPct, minWidth: '100%' }} className="h-full relative">
          {/* Track 1: Words */}
          <div className="absolute top-0 left-0 h-[36px] border-b border-neutral-800" style={{ width: '100%' }}>
            {state.words.map((w, i) => {
              const relStart = w.start - state.trimStart;
              const relEnd = w.end - state.trimStart;
              const leftPct = timeToX(relStart, 100);
              const durPct = ((relEnd - relStart) / dur) * 100;
              const isActive = state.currentTime >= w.start && state.currentTime < w.end;
              const isEditing = editingWordIdx === i;
              return (
                <div
                  key={i}
                  draggable={!isEditing && !dragState}
                  onDragStart={e => {
                    e.dataTransfer.setData('wordIdx', String(i));
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    const fromIdx = parseInt(e.dataTransfer.getData('wordIdx'));
                    if (isNaN(fromIdx) || fromIdx === i) return;
                    const words = [...state.words];
                    const tmpStart = words[i].start, tmpEnd = words[i].end;
                    words[i] = { ...words[i], start: words[fromIdx].start, end: words[fromIdx].end };
                    words[fromIdx] = { ...words[fromIdx], start: tmpStart, end: tmpEnd };
                    actions.setWords(words);
                  }}
                  onMouseDown={e => {
                    // Middle drag (move) — only if not editing and not on a resize handle
                    if (!isEditing) startWordDrag(e, i, 'move');
                  }}
                  onClick={e => { e.stopPropagation(); actions.selectWord(i); }}
                  onDoubleClick={e => { e.stopPropagation(); setEditingWordIdx(i); }}
                  className={`absolute top-1 flex items-center justify-center rounded whitespace-nowrap select-none ${
                    isEditing ? 'cursor-text' : 'cursor-grab active:cursor-grabbing'
                  } ${
                    isActive
                      ? 'bg-cyan-500 text-black font-semibold'
                      : state.selectedWordIndex === i
                      ? 'bg-cyan-900 text-cyan-300 border border-cyan-700'
                      : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                  }`}
                  style={{
                    left: `${leftPct}%`,
                    height: '22px',
                    padding: '0 4px',
                    fontSize: '10px',
                    minWidth: `${Math.max(durPct, 2)}%`,
                  }}
                  title={`${w.word} · ${(w.start - state.trimStart).toFixed(1)}s (dbl-click to edit, drag edges to resize, drag middle to move)`}
                >
                  {/* Left resize handle (Issue 2) */}
                  <div
                    onMouseDown={e => startWordDrag(e, i, 'resize-left')}
                    className="absolute left-0 top-0 bottom-0 w-[4px] cursor-ew-resize bg-cyan-400/0 hover:bg-cyan-400/50 rounded-l"
                  />
                  {isEditing ? (
                    <input
                      autoFocus
                      type="text"
                      value={w.word}
                      onChange={e => {
                        const words = [...state.words];
                        words[i] = { ...words[i], word: e.target.value };
                        actions.setWords(words);
                      }}
                      onBlur={() => setEditingWordIdx(null)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === 'Escape') setEditingWordIdx(null);
                      }}
                      onClick={e => e.stopPropagation()}
                      onDoubleClick={e => e.stopPropagation()}
                      onMouseDown={e => e.stopPropagation()}
                      className="bg-transparent text-center focus:outline-none"
                      style={{ fontSize: '10px', color: 'inherit', width: '60px' }}
                    />
                  ) : (
                    w.word
                  )}
                  {/* Right resize handle (Issue 2) */}
                  <div
                    onMouseDown={e => startWordDrag(e, i, 'resize-right')}
                    className="absolute right-0 top-0 bottom-0 w-[4px] cursor-ew-resize bg-cyan-400/0 hover:bg-cyan-400/50 rounded-r"
                  />
                </div>
              );
            })}
          </div>

          {/* Track 1.5: Cut markers */}
          <div className="absolute top-[36px] left-0 h-[2px]" style={{ width: '100%' }}>
            {state.bpm > 0 && Array.from({ length: slotCount }).map((_, i) => {
              const t = i * beatDuration;
              const left = timeToX(t, 100);
              return (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 w-[1px] bg-fuchsia-500/40"
                  style={{ left: `${left}%` }}
                />
              );
            })}
          </div>

          {/* Track 2: Clip slots */}
          <div className="absolute top-[40px] left-0 h-[76px] border-b border-neutral-800" style={{ width: '100%' }}>
            {state.timelineSlots.map((slot, i) => {
              const left = timeToX(slot.start, 100);
              const width = Math.max(20, ((slot.end - slot.start) / dur) * 100);
              const clip = state.clips.find(c => c.id === slot.clipId);
              const isSelected = state.selectedSlotId === slot.id;
              return (
                <div
                  key={slot.id}
                  onClick={e => { e.stopPropagation(); actions.selectSlot(slot.id); }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    const clipId = e.dataTransfer.getData('clipId');
                    if (clipId) {
                      actions.assignClip(slot.id, clipId);
                    }
                  }}
                  className={`absolute top-1 h-[68px] rounded border overflow-hidden cursor-pointer ${
                    isSelected ? 'border-cyan-500' : 'border-neutral-700'
                  }`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                >
                  {clip ? (
                    <div className="w-full h-full bg-neutral-700 flex items-center justify-center">
                      {clip.thumbnail ? (
                        <img src={clip.thumbnail} className="w-full h-full object-cover" alt="" />
                      ) : (
                        <span className="text-[10px] text-neutral-400 truncate px-1">{clip.name.slice(0, 8)}</span>
                      )}
                    </div>
                  ) : (
                    <div className="w-full h-full bg-neutral-900 flex items-center justify-center">
                      <span className="text-[10px] text-neutral-600">{i + 1}</span>
                    </div>
                  )}
                </div>
              );
            })}
            {state.timelineSlots.length === 0 && (
              <div className="flex items-center justify-center h-full text-neutral-600 text-xs">
                Click "Gen Slots" to generate timeline slots from BPM
              </div>
            )}
          </div>

          {/* Track 3: Audio waveform — canvas sized in pixels by useLayoutEffect */}
          <div className="absolute top-[120px] left-0 h-[60px]" style={{ width: '100%' }}>
            <canvas
              ref={canvasRef}
              className="block"
            />
          </div>

          {/* Playhead (vertical line across all tracks) */}
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-cyan-400 pointer-events-none z-30"
            style={{ left: `${timeToX(state.currentTime - state.trimStart, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}