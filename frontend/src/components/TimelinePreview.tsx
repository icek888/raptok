import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, SkipBack, SkipForward, ZoomIn, ZoomOut, Scissors, Combine, Trash2, Edit3, Maximize2 } from 'lucide-react';
import type { Fragment, SubtitleLine, WordTiming, AudioInfo } from '../types';
import { WORD_COLORS } from '../utils/constants';
import { formatTime } from '../utils/format';

interface Props {
  fragments: Fragment[];
  subtitles: SubtitleLine[];
  audioUrl?: string | null;
  videoUrl?: string | null;
  wordTimings: WordTiming[];
  audioInfo: AudioInfo | null;
  audioStart: number;
  audioEnd: number;
  onRangeChange: (start: number, end: number) => void;
  onWordTimingsChange?: (timings: WordTiming[]) => void;
  onSeek?: (time: number) => void;
  currentTime: number;
  isPlaying: boolean;
  onPlayPause: () => void;
}

const MAX_ZOOM = 80; // 80x zoom — very detailed word editing

export function TimelinePreview({
  fragments, subtitles,
  wordTimings, audioInfo, audioStart, audioEnd, onRangeChange,
  onWordTimingsChange,
  onSeek, currentTime, isPlaying, onPlayPause,
}: Props) {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [zoomCenter, setZoomCenter] = useState(0);
  const [autoZoom, setAutoZoom] = useState(true);

  const [dragging, setDragging] = useState(false);
  const [dragMode, setDragMode] = useState<'range-start' | 'range-end' | 'range-move' | 'word-move' | 'word-resize-left' | 'word-resize-right' | 'pan' | 'none'>('none');
  const [dragWordIdx, setDragWordIdx] = useState(-1);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartData, setDragStartData] = useState({ start: 0, end: 0, wordStart: 0, wordEnd: 0, zoomCenter: 0 });

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; wordIdx: number } | null>(null);
  const [editingWordIdx, setEditingWordIdx] = useState(-1);
  const [editText, setEditText] = useState('');

  const timelineRef = useRef<HTMLDivElement | null>(null);
  const duration = audioInfo?.duration || 0;

  // Auto-zoom when range changes
  useEffect(() => {
    if (autoZoom && audioEnd > audioStart) {
      setZoomCenter((audioStart + audioEnd) / 2);
      const rangeSize = audioEnd - audioStart;
      const viewportSize = duration / zoomLevel;
      if (rangeSize < viewportSize * 0.5) {
        const newZoom = Math.min(MAX_ZOOM, Math.max(1, duration / (rangeSize * 2)));
        setZoomLevel(newZoom);
      }
    }
  }, [audioStart, audioEnd, autoZoom, duration, zoomLevel]);

  const viewportSize = duration / zoomLevel;
  const viewportStart = Math.max(0, Math.min(duration - viewportSize, zoomCenter - viewportSize / 2));
  const viewportEnd = Math.min(duration, viewportStart + viewportSize);

  const timeToX = useCallback((t: number) => {
    if (viewportSize === 0) return 0;
    return ((t - viewportStart) / viewportSize) * 100;
  }, [viewportStart, viewportSize]);

  const xToTime = useCallback((x: number) => {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const pct = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
    return viewportStart + pct * viewportSize;
  }, [viewportStart, viewportSize]);

  // fmtTime now uses shared formatTime from utils/format.ts

  const handleSeek = (time: number) => {
    const clamped = Math.max(0, Math.min(duration, time));
    onSeek?.(clamped);
  };

  // Scroll viewport by delta seconds
  const scrollViewport = (deltaSec: number) => {
    const newCenter = Math.max(viewportSize / 2, Math.min(duration - viewportSize / 2, zoomCenter + deltaSec));
    setZoomCenter(newCenter);
  };

  const handleTimelineClick = (e: React.MouseEvent) => {
    if (dragging || contextMenu) return;
    const t = xToTime(e.clientX);
    handleSeek(t);
  };

  const handleRangeMouseDown = (e: React.MouseEvent, mode: 'start' | 'end' | 'move') => {
    e.stopPropagation();
    e.preventDefault();
    setDragging(true);
    setDragMode(mode === 'start' ? 'range-start' : mode === 'end' ? 'range-end' : 'range-move');
    setDragStartX(e.clientX);
    setDragStartData({ start: audioStart, end: audioEnd, wordStart: 0, wordEnd: 0, zoomCenter });
  };

  const handleWordMouseDown = (e: React.MouseEvent, idx: number, mode: 'move' | 'resize-left' | 'resize-right') => {
    if (!onWordTimingsChange) return;
    e.stopPropagation();
    e.preventDefault();
    const w = wordTimings[idx];
    setDragging(true);
    setDragMode(`word-${mode}` as any);
    setDragWordIdx(idx);
    setDragStartX(e.clientX);
    setDragStartData({ start: audioStart, end: audioEnd, wordStart: w.start, wordEnd: w.end, zoomCenter });
  };

  // Pan (middle-click or space+drag to scroll timeline)
  const handlePanStart = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      e.preventDefault();
      e.stopPropagation();
      setDragging(true);
      setDragMode('pan');
      setDragStartX(e.clientX);
      setDragStartData({ start: 0, end: 0, wordStart: 0, wordEnd: 0, zoomCenter });
    }
  };

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      const deltaT = xToTime(e.clientX) - xToTime(dragStartX);

      if (dragMode === 'range-start') {
        onRangeChange(Math.max(0, Math.min(dragStartData.start + deltaT, dragStartData.end - 0.5)), dragStartData.end);
      } else if (dragMode === 'range-end') {
        onRangeChange(dragStartData.start, Math.min(duration, Math.max(dragStartData.end + deltaT, dragStartData.start + 0.5)));
      } else if (dragMode === 'range-move') {
        const rangeW = dragStartData.end - dragStartData.start;
        let ns = Math.max(0, Math.min(dragStartData.start + deltaT, duration - rangeW));
        onRangeChange(ns, ns + rangeW);
      } else if (dragMode === 'pan') {
        const newCenter = Math.max(viewportSize / 2, Math.min(duration - viewportSize / 2, dragStartData.zoomCenter - deltaT));
        setZoomCenter(newCenter);
      } else if (dragMode === 'word-move' && dragWordIdx >= 0 && onWordTimingsChange) {
        const wordW = dragStartData.wordEnd - dragStartData.wordStart;
        let ns = Math.max(0, dragStartData.wordStart + deltaT);
        ns = Math.min(ns, duration - wordW);
        const updated = [...wordTimings];
        updated[dragWordIdx] = { ...updated[dragWordIdx], start: ns, end: ns + wordW };
        onWordTimingsChange(updated);
      } else if (dragMode === 'word-resize-left' && dragWordIdx >= 0 && onWordTimingsChange) {
        let ns = Math.max(0, Math.min(dragStartData.wordStart + deltaT, dragStartData.wordEnd - 0.05));
        const updated = [...wordTimings];
        updated[dragWordIdx] = { ...updated[dragWordIdx], start: ns };
        onWordTimingsChange(updated);
      } else if (dragMode === 'word-resize-right' && dragWordIdx >= 0 && onWordTimingsChange) {
        let ne = Math.max(dragStartData.wordEnd + deltaT, dragStartData.wordStart + 0.05);
        ne = Math.min(ne, duration);
        const updated = [...wordTimings];
        updated[dragWordIdx] = { ...updated[dragWordIdx], end: ne };
        onWordTimingsChange(updated);
      }
    };
    const handleUp = () => {
      setDragging(false);
      setDragMode('none');
      setDragWordIdx(-1);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragging, dragMode, dragStartX, dragStartData, dragWordIdx, duration, audioStart, audioEnd, onRangeChange, onWordTimingsChange, wordTimings, xToTime, viewportSize]);

  // Context menu actions
  const splitWord = (idx: number) => {
    if (!onWordTimingsChange) return;
    const w = wordTimings[idx];
    const mid = (w.start + w.end) / 2;
    const first = w.word.substring(0, Math.ceil(w.word.length / 2));
    const second = w.word.substring(Math.ceil(w.word.length / 2));
    const updated = [...wordTimings];
    updated[idx] = { word: first, start: w.start, end: mid, probability: w.probability };
    updated.splice(idx + 1, 0, { word: second, start: mid, end: w.end, probability: w.probability });
    onWordTimingsChange(updated);
    setContextMenu(null);
  };

  const combineWithNext = (idx: number) => {
    if (!onWordTimingsChange || idx >= wordTimings.length - 1) return;
    const w = wordTimings[idx];
    const next = wordTimings[idx + 1];
    const updated = [...wordTimings];
    updated[idx] = { word: w.word + next.word, start: w.start, end: next.end, probability: w.probability };
    updated.splice(idx + 1, 1);
    onWordTimingsChange(updated);
    setContextMenu(null);
  };

  const deleteWord = (idx: number) => {
    if (!onWordTimingsChange) return;
    const updated = wordTimings.filter((_, i) => i !== idx);
    onWordTimingsChange(updated);
    setContextMenu(null);
  };

  const editWord = (idx: number) => {
    setEditingWordIdx(idx);
    setEditText(wordTimings[idx].word);
    setContextMenu(null);
  };

  const saveEdit = () => {
    if (editingWordIdx >= 0 && onWordTimingsChange) {
      const updated = [...wordTimings];
      updated[editingWordIdx] = { ...updated[editingWordIdx], word: editText };
      onWordTimingsChange(updated);
    }
    setEditingWordIdx(-1);
    setEditText('');
  };

  useEffect(() => {
    const close = () => setContextMenu(null);
    if (contextMenu) {
      window.addEventListener('click', close);
      return () => window.removeEventListener('click', close);
    }
  }, [contextMenu]);

  const videoTime = currentTime - audioStart;
  const activeWord = videoTime >= 0
    ? wordTimings.find(w => videoTime >= w.start && videoTime <= w.end)
    : null;
  const activeWordIdx = activeWord
    ? wordTimings.findIndex(w => w.start === activeWord.start)
    : -1;

  const startPct = timeToX(audioStart);
  const endPct = timeToX(audioEnd);
  const playheadPct = timeToX(currentTime);

  const visibleWords = wordTimings.map((w, i) => ({ w, i })).filter(({ w }) => (w.end + audioStart) >= viewportStart && (w.start + audioStart) <= viewportEnd);

  // Zoom controls
  const zoomIn = () => {
    setAutoZoom(false);
    setZoomLevel(z => Math.min(MAX_ZOOM, z * 1.8));
  };
  const zoomOut = () => {
    setAutoZoom(false);
    setZoomLevel(z => Math.max(1, z / 1.8));
  };
  const zoomFit = () => {
    setAutoZoom(false);
    setZoomLevel(1);
    setZoomCenter(duration / 2);
  };
  const zoomToRange = () => {
    setAutoZoom(false);
    const rangeSize = audioEnd - audioStart;
    setZoomCenter((audioStart + audioEnd) / 2);
    setZoomLevel(Math.min(MAX_ZOOM, Math.max(1, duration / Math.max(rangeSize * 1.2, 1))));
  };

  // Timeline height adapts to zoom — taller when zoomed in
  const timelineHeight = zoomLevel > 10 ? 120 : zoomLevel > 5 ? 100 : zoomLevel > 2 ? 80 : 64;

  // Scroll slider: represents viewport position within full track
  const scrollPct = duration > 0 ? (viewportStart / duration) * 100 : 0;
  const scrollWidthPct = duration > 0 ? (viewportSize / duration) * 100 : 100;

  // Word block height — more space when zoomed in
  const wordTop = zoomLevel > 5 ? 6 : 4;
  const wordBottom = 2;

  return (
    <div className="space-y-2">
      {/* ── Playback + Zoom controls ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => handleSeek(Math.max(0, currentTime - 1))} className="p-1.5 hover:bg-[#2a2a3a] rounded transition">
          <SkipBack size={14} className="text-gray-400" />
        </button>
        <button onClick={onPlayPause} className="p-2 bg-purple-600 hover:bg-purple-500 rounded transition">
          {isPlaying ? <Pause size={16} className="text-white" /> : <Play size={16} className="text-white" />}
        </button>
        <button onClick={() => handleSeek(Math.min(duration, currentTime + 1))} className="p-1.5 hover:bg-[#2a2a3a] rounded transition">
          <SkipForward size={14} className="text-gray-400" />
        </button>
        <span className="text-xs text-gray-400 font-mono ml-1">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <div className="flex items-center gap-1 ml-auto">
          <button onClick={zoomOut} className="p-1.5 hover:bg-[#2a2a3a] rounded transition" title="Zoom out">
            <ZoomOut size={14} className="text-gray-400" />
          </button>
          {/* Zoom slider */}
          <input
            type="range" min={1} max={MAX_ZOOM} step={0.5}
            value={zoomLevel}
            onChange={e => { setAutoZoom(false); setZoomLevel(parseFloat(e.target.value)); }}
            className="w-20 accent-purple-500"
            title={`Zoom: ${zoomLevel.toFixed(1)}x`}
          />
          <button onClick={zoomIn} className="p-1.5 hover:bg-[#2a2a3a] rounded transition" title="Zoom in">
            <ZoomIn size={14} className="text-gray-400" />
          </button>
          <button onClick={zoomToRange} className="flex items-center gap-1 px-2 py-1 text-[10px] text-purple-300 hover:bg-purple-500/10 rounded transition" title="Zoom to selection">
            <Maximize2 size={10} /> Fit
          </button>
          <button onClick={zoomFit} className="px-2 py-1 text-[10px] text-gray-400 hover:bg-[#2a2a3a] rounded transition" title="Reset zoom (1:1)">
            1:1
          </button>
          <button
            onClick={() => setAutoZoom(!autoZoom)}
            className={`px-2 py-1 text-[10px] rounded transition ${autoZoom ? 'text-purple-400 bg-purple-500/10' : 'text-gray-500 hover:bg-[#2a2a3a]'}`}
            title="Auto-zoom to selection"
          >
            Auto
          </button>
        </div>
      </div>

      {/* ── Now playing info ── */}
      <div className="bg-[#0a0a0f] border border-[#1a1a2a] rounded-lg px-2 py-1.5 flex items-center gap-3">
        {activeWord ? (
          <div className="text-xs flex items-center gap-2">
            <span className="text-yellow-400 font-bold">✨ {activeWord.word}</span>
            <span className="text-gray-600">{activeWord.start.toFixed(2)}s → {activeWord.end.toFixed(2)}s</span>
            {activeWord.probability && (
              <span className="text-gray-700">p={activeWord.probability.toFixed(2)}</span>
            )}
          </div>
        ) : (
          <div className="text-xs text-gray-600">⏸ No active word</div>
        )}
        <div className="flex gap-3 text-[10px] text-gray-500 ml-auto">
          <span>🎬 {fragments.length} frags</span>
          <span>📝 {subtitles.length} subs</span>
          <span>🔤 {wordTimings.length} words</span>
          {audioInfo?.bpm && <span>♩ {audioInfo.bpm} BPM</span>}
        </div>
      </div>

      {/* ── Word Timeline (taller, more space for words) ── */}
      <div
        ref={timelineRef}
        className={`relative bg-[#0a0a0f] border border-[#1a1a2a] rounded-lg cursor-pointer overflow-hidden select-none`}
        style={{ height: `${timelineHeight}px` }}
        onClick={handleTimelineClick}
        onMouseDown={handlePanStart}
        onContextMenu={(e) => {
          if (!onWordTimingsChange) return;
          e.preventDefault();
          const t = xToTime(e.clientX);
          const idx = wordTimings.findIndex(w => t >= w.start && t <= w.end);
          if (idx >= 0) {
            setContextMenu({ x: e.clientX, y: e.clientY, wordIdx: idx });
          }
        }}
      >
        {/* Waveform */}
        {audioInfo?.rms_values && audioInfo.rms_values.length > 0 && (
          <div className="absolute inset-0 flex items-end gap-px px-1 pb-1">
            {audioInfo.rms_values.map((v: number, i: number) => {
              const rmsT = (i / audioInfo.rms_values.length) * duration;
              if (rmsT < viewportStart || rmsT > viewportEnd) return null;
              return (
                <div key={i} className="flex-1 bg-purple-500/15 rounded-sm" style={{ height: `${Math.min(100, v * 200)}%` }} />
              );
            })}
          </div>
        )}

        {/* Beat markers */}
        {audioInfo?.beats?.map((beat: number, i: number) => {
          if (beat < viewportStart || beat > viewportEnd) return null;
          return (
            <div key={i} className="absolute top-0 bottom-0 w-px bg-blue-500/15 pointer-events-none" style={{ left: `${timeToX(beat)}%` }} />
          );
        })}

        {/* Subtitle markers (green, bottom) */}
        {subtitles.map(s => {
          if (s.end + audioStart < viewportStart || s.start + audioStart > viewportEnd) return null;
          return (
            <div key={s.id} className="absolute bottom-0 h-1.5 bg-green-500/30 rounded-sm pointer-events-none"
              style={{ left: `${timeToX(s.start + audioStart)}%`, width: `${Math.max(0.5, (s.end - s.start) / viewportSize * 100)}%` }} />
          );
        })}

        {/* Audio selection range */}
        <div
          className="absolute top-0 bottom-0 border-2 border-yellow-500/50 bg-yellow-500/5 cursor-grab active:cursor-grabbing z-10"
          style={{ left: `${startPct}%`, width: `${Math.max(0.5, endPct - startPct)}%` }}
          onMouseDown={(e) => handleRangeMouseDown(e, 'move')}
        >
          <span className="absolute top-0 left-1 text-[8px] text-yellow-400/80 font-mono whitespace-nowrap pointer-events-none">
            {formatTime(audioStart)}-{formatTime(audioEnd)}
          </span>
        </div>
        {/* Range handles */}
        <div className="absolute top-0 bottom-0 w-3 cursor-ew-resize z-20 flex items-center justify-center"
          style={{ left: `calc(${startPct}% - 6px)` }}
          onMouseDown={(e) => handleRangeMouseDown(e, 'start')}>
          <div className="w-1 h-full bg-yellow-500 rounded-full" />
        </div>
        <div className="absolute top-0 bottom-0 w-3 cursor-ew-resize z-20 flex items-center justify-center"
          style={{ left: `calc(${endPct}% - 6px)` }}
          onMouseDown={(e) => handleRangeMouseDown(e, 'end')}>
          <div className="w-1 h-full bg-yellow-500 rounded-full" />
        </div>

        {/* Word blocks — colorful, taller, bigger text when zoomed */}
        {visibleWords.map(({ w, i }) => {
          const absStart = w.start + audioStart;
          const absEnd = w.end + audioStart;
          const left = timeToX(absStart);
          const width = Math.max(1.5, ((absEnd - absStart) / viewportSize) * 100);
          const color = WORD_COLORS[i % WORD_COLORS.length];
          const isActive = i === activeWordIdx;
          const isEditing = i === editingWordIdx;
          const isDragging = i === dragWordIdx && dragging;

          // Font size adapts to zoom and word width
          const fontSize = width > 15 ? '16px' : width > 8 ? '14px' : width > 4 ? '12px' : '10px';
          const showText = width > 2;

          return (
            <div
              key={i}
              className={`absolute rounded-md flex items-center justify-center cursor-move transition-opacity ${isActive ? 'ring-2 ring-yellow-400 z-30' : 'z-20'} ${isDragging ? 'opacity-80' : ''}`}
              style={{
                top: `${wordTop}px`,
                bottom: `${wordBottom}px`,
                left: `${left}%`,
                width: `${width}%`,
                backgroundColor: `${color}40`,
                border: `1px solid ${color}`,
                borderBottom: `3px solid ${color}`,
                minHeight: '28px',
              }}
              onMouseDown={(e) => handleWordMouseDown(e, i, 'move')}
              onDoubleClick={(e) => { e.stopPropagation(); editWord(i); }}
              title={`${w.word} | ${w.start.toFixed(2)}s - ${w.end.toFixed(2)}s`}
            >
              {/* Left resize handle */}
              {onWordTimingsChange && (
                <div
                  className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/40 rounded-l-md"
                  onMouseDown={(e) => handleWordMouseDown(e, i, 'resize-left')}
                />
              )}
              {/* Right resize handle */}
              {onWordTimingsChange && (
                <div
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/40 rounded-r-md"
                  onMouseDown={(e) => handleWordMouseDown(e, i, 'resize-right')}
                />
              )}
              {/* Word text */}
              {isEditing ? (
                <input
                  type="text"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={saveEdit}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-[#0a0a0f] text-white text-center px-1 w-full outline-none border border-purple-500 rounded"
                  style={{ fontSize }}
                  autoFocus
                />
              ) : (
                <span
                  className="text-white truncate px-1 select-none font-medium"
                  style={{ fontSize }}
                >
                  {showText ? w.word : ''}
                </span>
              )}
            </div>
          );
        })}

        {/* Playhead */}
        <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-40 pointer-events-none" style={{ left: `${playheadPct}%` }} />
      </div>

      {/* ── Scroll slider for navigation when zoomed ── */}
      {zoomLevel > 1.1 && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => scrollViewport(-viewportSize * 0.5)}
            className="p-1 hover:bg-[#2a2a3a] rounded transition"
            title="Scroll left"
          >
            <SkipBack size={12} className="text-gray-400" />
          </button>
          {/* Scroll track — draggable, shows where viewport is within the full track */}
          <div
            className="relative flex-1 h-6 bg-[#0a0a0f] border border-[#1a1a2a] rounded-lg cursor-pointer"
            onMouseDown={(e) => {
              const trackEl = e.currentTarget;
              const startDragX = e.clientX;
              const startVpStart = viewportStart;
              const trackRect = trackEl.getBoundingClientRect();
              
              const handleScrollMove = (ev: MouseEvent) => {
                const dx = ev.clientX - startDragX;
                const deltaT = (dx / trackRect.width) * duration;
                const newStart = Math.max(0, Math.min(duration - viewportSize, startVpStart + deltaT));
                setZoomCenter(newStart + viewportSize / 2);
              };
              const handleScrollUp = () => {
                window.removeEventListener('mousemove', handleScrollMove);
                window.removeEventListener('mouseup', handleScrollUp);
              };
              
              // Also handle click-to-jump on first click
              const pct = (e.clientX - trackRect.left) / trackRect.width;
              const newStart = Math.max(0, Math.min(duration - viewportSize, pct * duration - viewportSize / 2));
              setZoomCenter(newStart + viewportSize / 2);
              
              window.addEventListener('mousemove', handleScrollMove);
              window.addEventListener('mouseup', handleScrollUp);
            }}
          >
            {/* Mini waveform preview */}
            {audioInfo?.rms_values && (
              <div className="absolute inset-0 flex items-end gap-px px-1 pb-0.5 pointer-events-none">
                {audioInfo.rms_values.map((v: number, i: number) => (
                  <div key={i} className="flex-1 bg-purple-500/10 rounded-sm" style={{ height: `${Math.min(100, v * 150)}%` }} />
                ))}
              </div>
            )}
            {/* Viewport indicator */}
            <div
              className="absolute top-0 bottom-0 bg-purple-500/20 border border-purple-500/50 rounded pointer-events-none"
              style={{ left: `${scrollPct}%`, width: `${Math.max(2, scrollWidthPct)}%` }}
            />
            {/* Playhead on minimap */}
            <div
              className="absolute top-0 bottom-0 w-px bg-red-500/60 pointer-events-none"
              style={{ left: `${(currentTime / duration) * 100}%` }}
            />
          </div>
          <button
            onClick={() => scrollViewport(viewportSize * 0.5)}
            className="p-1 hover:bg-[#2a2a3a] rounded transition"
            title="Scroll right"
          >
            <SkipForward size={12} className="text-gray-400" />
          </button>
          <span className="text-[10px] text-gray-500 font-mono whitespace-nowrap">
            {formatTime(viewportStart)} → {formatTime(viewportEnd)}
          </span>
        </div>
      )}

      {/* ── Tip line ── */}
      <div className="text-[10px] text-gray-600 flex items-center gap-3">
        <span>💡 Click to seek · Drag words to move · Drag edges to resize</span>
        {onWordTimingsChange && <span className="text-gray-700">· Right-click for menu · Double-click to edit</span>}
        {zoomLevel > 1.1 && <span className="text-gray-700">· Shift+drag to pan</span>}
      </div>

      {/* ── Context menu ── */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[#1a1a2a] border border-[#2a2a3a] rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[10px] text-gray-500 border-b border-[#2a2a3a]">
            "{wordTimings[contextMenu.wordIdx]?.word}"
          </div>
          <button onClick={() => splitWord(contextMenu.wordIdx)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-[#2a2a3a] transition">
            <Scissors size={12} /> Split word
          </button>
          <button onClick={() => combineWithNext(contextMenu.wordIdx)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-[#2a2a3a] transition">
            <Combine size={12} /> Combine with next
          </button>
          <button onClick={() => editWord(contextMenu.wordIdx)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-[#2a2a3a] transition">
            <Edit3 size={12} /> Edit text
          </button>
          <div className="border-t border-[#2a2a3a] my-1" />
          <button onClick={() => deleteWord(contextMenu.wordIdx)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition">
            <Trash2 size={12} /> Delete word
          </button>
        </div>
      )}
    </div>
  );
}