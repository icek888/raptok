import { useState, useRef, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import type { Fragment, SubtitleLine, WordTiming, AudioInfo } from '../types';

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
  onSeek?: (time: number) => void;
  currentTime: number;
  isPlaying: boolean;
  onPlayPause: () => void;
  displayMode?: 'auto' | 'line_highlight' | 'word_by_word' | 'single_word';
}

export function TimelinePreview({
  fragments, subtitles,
  wordTimings, audioInfo, audioStart, audioEnd, onRangeChange,
  onSeek, currentTime, isPlaying, onPlayPause,
  displayMode = 'auto',
}: Props) {
  const [dragging, setDragging] = useState(false);
  const [dragHandle, setDragHandle] = useState<'start' | 'end' | 'move' | 'none'>('none');
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartRange, setDragStartRange] = useState({ start: 0, end: 0 });
  const timelineRef = useRef<HTMLDivElement | null>(null);

  const duration = audioInfo?.duration || 0;

  const handleSeek = (time: number) => {
    const clamped = Math.max(0, Math.min(duration, time));
    onSeek?.(clamped);
  };

  // Timeline click → seek
  const handleTimelineClick = (e: React.MouseEvent) => {
    if (!timelineRef.current || duration === 0 || dragging) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = (x / rect.width) * duration;
    handleSeek(t);
  };

  // Range drag
  const handleHandleMouseDown = (e: React.MouseEvent, handle: 'start' | 'end') => {
    e.stopPropagation();
    e.preventDefault();
    setDragging(true);
    setDragHandle(handle);
  };

  // Move entire range
  const handleRangeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDragging(true);
    setDragHandle('move');
    setDragStartX(e.clientX);
    setDragStartRange({ start: audioStart, end: audioEnd });
  };

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      if (!timelineRef.current || duration === 0) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const t = (x / rect.width) * duration;
      if (dragHandle === 'start') {
        onRangeChange(Math.max(0, Math.min(t, audioEnd - 1)), audioEnd);
      } else if (dragHandle === 'end') {
        onRangeChange(audioStart, Math.min(duration, Math.max(t, audioStart + 1)));
      } else if (dragHandle === 'move') {
        // Move entire range — preserve width, shift by delta
        const deltaX = e.clientX - dragStartX;
        const deltaT = (deltaX / rect.width) * duration;
        const rangeWidth = dragStartRange.end - dragStartRange.start;
        let newStart = Math.max(0, Math.min(dragStartRange.start + deltaT, duration - rangeWidth));
        let newEnd = newStart + rangeWidth;
        if (newEnd > duration) {
          newEnd = duration;
          newStart = newEnd - rangeWidth;
        }
        onRangeChange(newStart, newEnd);
      }
    };
    const handleUp = () => { setDragging(false); setDragHandle('none'); };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragging, dragHandle, duration, audioStart, audioEnd, onRangeChange]);

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const startPct = duration > 0 ? (audioStart / duration) * 100 : 0;
  const endPct = duration > 0 ? (audioEnd / duration) * 100 : 100;
  const playheadPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Video timeline is 0-based (relative to fragment start = audioStart)
  const videoTime = currentTime - audioStart;

  // Get current subtitle on video timeline
  const currentSubs = videoTime >= 0
    ? subtitles.filter(s => videoTime >= s.start && videoTime <= s.end)
    : [];

  // Get active word
  const activeWord = videoTime >= 0
    ? wordTimings.find(w => videoTime >= w.start && videoTime <= w.end)
    : null;
  const activeWordIdx = activeWord
    ? wordTimings.findIndex(w => w.start === activeWord.start)
    : -1;

  return (
    <div className="space-y-2">
      {/* Side info panel (no small video preview — use PreviewFrame in right column) */}
      <div className="space-y-1.5">
          {/* Playback controls */}
          <div className="flex items-center gap-1.5">
            <button onClick={() => handleSeek(Math.max(0, currentTime - 5))} className="p-1.5 hover:bg-[#2a2a3a] rounded transition">
              <SkipBack size={14} className="text-gray-400" />
            </button>
            <button onClick={onPlayPause} className="p-2 bg-purple-600 hover:bg-purple-500 rounded transition">
              {isPlaying ? <Pause size={16} className="text-white" /> : <Play size={16} className="text-white" />}
            </button>
            <button onClick={() => handleSeek(Math.min(duration, currentTime + 5))} className="p-1.5 hover:bg-[#2a2a3a] rounded transition">
              <SkipForward size={14} className="text-gray-400" />
            </button>
            <span className="text-xs text-gray-400 font-mono ml-1">
              {fmtTime(currentTime)} / {fmtTime(duration)}
            </span>
          </div>

          {/* Now playing info */}
          <div className="bg-[#0a0a0f] border border-[#1a1a2a] rounded-lg px-2 py-1.5 space-y-0.5">
            {activeWord ? (
              <div className="text-xs">
                <span className="text-yellow-400 font-bold">✨ {activeWord.word}</span>
                <span className="text-gray-600 ml-2">{activeWord.start.toFixed(2)}s → {activeWord.end.toFixed(2)}s</span>
              </div>
            ) : currentSubs.length > 0 ? (
              <div className="text-xs text-gray-400">
                📝 Line #{currentSubs[0].id + 1}
              </div>
            ) : (
              <div className="text-xs text-gray-600">⏸ No active subtitle</div>
            )}
            <div className="flex gap-3 text-[10px] text-gray-500">
              <span>🎬 {fragments.length} frags</span>
              <span>📝 {subtitles.length} subs</span>
              <span>🔤 {wordTimings.length} words</span>
              {audioInfo?.bpm && <span>♩ {audioInfo.bpm} BPM</span>}
            </div>
          </div>
        </div>

      {/* ── Timeline ── */}
      <div
        ref={timelineRef}
        className="relative h-16 bg-[#0a0a0f] border border-[#1a1a2a] rounded-lg cursor-pointer overflow-hidden select-none"
        onClick={handleTimelineClick}
      >
        {/* Waveform */}
        {audioInfo?.rms_values && audioInfo.rms_values.length > 0 && (
          <div className="absolute inset-0 flex items-end gap-px px-1 pb-1">
            {audioInfo.rms_values.map((v: number, i: number) => (
              <div key={i} className="flex-1 bg-purple-500/20 rounded-sm" style={{ height: `${Math.min(100, v * 200)}%` }} />
            ))}
          </div>
        )}

        {/* Beat markers */}
        {audioInfo?.beats?.map((beat: number, i: number) => (
          <div key={i} className="absolute top-0 bottom-0 w-px bg-blue-500/15" style={{ left: `${duration > 0 ? (beat / duration) * 100 : 0}%` }} />
        ))}

        {/* Audio selection range — draggable to move entire range */}
        <div
          className="absolute top-0 bottom-0 border-2 border-yellow-500/60 bg-yellow-500/10 cursor-grab active:cursor-grabbing z-10"
          style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
          onMouseDown={handleRangeMouseDown}
        >
          <span className="absolute top-0 left-1 text-[8px] text-yellow-400 font-mono whitespace-nowrap pointer-events-none">{fmtTime(audioStart)}-{fmtTime(audioEnd)}</span>
        </div>

        {/* Start handle */}
        <div className="absolute top-0 bottom-0 w-3 cursor-ew-resize z-20 flex items-center justify-center" style={{ left: `calc(${startPct}% - 6px)` }} onMouseDown={(e) => handleHandleMouseDown(e, 'start')}>
          <div className="w-1 h-full bg-yellow-500 rounded-full" />
        </div>
        {/* End handle */}
        <div className="absolute top-0 bottom-0 w-3 cursor-ew-resize z-20 flex items-center justify-center" style={{ left: `calc(${endPct}% - 6px)` }} onMouseDown={(e) => handleHandleMouseDown(e, 'end')}>
          <div className="w-1 h-full bg-yellow-500 rounded-full" />
        </div>

        {/* Word markers (cyan) — show each word as tiny tick */}
        {wordTimings.map((w, i) => (
          <div
            key={i}
            className={`absolute bottom-0 w-px ${i === activeWordIdx ? 'bg-yellow-400 h-3' : 'bg-cyan-500/30 h-1.5'}`}
            style={{ left: `${duration > 0 ? ((w.start + audioStart) / duration) * 100 : 0}%` }}
          />
        ))}

        {/* Subtitle markers (green) */}
        {subtitles.map(s => (
          <div key={s.id} className="absolute bottom-0 h-2 bg-green-500/40 rounded-sm" style={{ left: `${duration > 0 ? ((s.start + audioStart) / duration) * 100 : 0}%`, width: `${duration > 0 ? ((s.end - s.start) / duration) * 100 : 0}%` }} />
        ))}

        {/* Playhead */}
        <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none" style={{ left: `${playheadPct}%` }} />
      </div>

      <div className="text-[10px] text-gray-600">
        💡 Click timeline to seek · Drag yellow handles to resize · Drag yellow area to move range · {displayMode === 'word_by_word' ? 'Word-by-word mode' : 'Line + highlight mode'}
      </div>
    </div>
  );
}