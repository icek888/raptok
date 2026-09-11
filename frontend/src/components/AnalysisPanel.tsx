import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, Activity, Palette, Gauge, Zap, Play, Pause, Scissors, ZoomIn, ZoomOut } from 'lucide-react';
import type { BPMResult, TrackAnalysis, AudioInfo } from '../types';
import { api } from '../api/client';

interface Props {
  loading: boolean;
  bpmData: BPMResult | null;
  trackAnalysis: TrackAnalysis | null;
  audioDuration: number | null;
  audioPath: string | null;
  clipRange: { start: number; end: number } | null;
  onClipRangeChange: (start: number, end: number) => void;
}

export function AnalysisPanel({
  loading, bpmData, trackAnalysis, audioDuration,
  audioPath, clipRange, onClipRangeChange,
}: Props) {
  const [audioInfo, setAudioInfo] = useState<AudioInfo | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playTime, setPlayTime] = useState(0);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const [dragging, setDragging] = useState<null | 'start' | 'end' | 'move' | 'seek'>(null);
  const [seekCursor, setSeekCursor] = useState(0); // silver draggable cursor — sets playback position
  const [zoomLevel, setZoomLevel] = useState(1);  // 1 = full track, 20 = detailed
  const [zoomCenter, setZoomCenter] = useState(0); // center of viewport in seconds
  const [buffered, setBuffered] = useState(false);
  const [loopSegment, setLoopSegment] = useState(true); // loop playback within selected segment
  const loopRef = useRef({ loopSegment, rangeStart, rangeEnd });
  // Keep ref in sync so rAF tick (created once) always sees fresh values
  useEffect(() => {
    loopRef.current = { loopSegment, rangeStart, rangeEnd };
  }, [loopSegment, rangeStart, rangeEnd]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const waveformRef = useRef<HTMLDivElement>(null);

  const audioUrl = audioPath ? `/api/audio-preview/${audioPath.split('/').pop()}` : null;

  // Load audio info
  useEffect(() => {
    if (audioPath && !audioInfo) {
      setAudioLoading(true);
      api.audioInfo(audioPath)
        .then(info => {
          setAudioInfo(info);
          // Initialize range from suggested or full track
          if (!clipRange) {
            const s = info.suggested_start || 0;
            const e = info.suggested_end || Math.min(info.duration, 30);
            setRangeStart(s);
            setRangeEnd(e);
            onClipRangeChange(s, e);
          } else {
            setRangeStart(clipRange.start);
            setRangeEnd(clipRange.end);
          }
        })
        .catch(e => console.error('Audio info failed:', e))
        .finally(() => setAudioLoading(false));
    }
  }, [audioPath]);

  // Restore range from clipRange if already set
  useEffect(() => {
    if (clipRange) {
      setRangeStart(clipRange.start);
      setRangeEnd(clipRange.end);
    }
  }, [clipRange]);

  // Audio element ref + rAF — smooth 60fps playhead
  const rafIdRef = useRef<number | null>(null);

  // Start rAF loop for smooth playhead tracking
  const startRaf = useCallback(() => {
    if (rafIdRef.current !== null) return; // already running
    const audio = audioRef.current;
    if (!audio) return;
    let lastT = -1;
    const tick = () => {
      const audio = audioRef.current;
      if (!audio) { rafIdRef.current = requestAnimationFrame(tick); return; }
      const t = audio.currentTime;
      const { loopSegment: lp, rangeStart: rs, rangeEnd: re } = loopRef.current;
      // Loop segment: if playing past rangeEnd, jump back to rangeStart
      if (lp && t >= re) {
        audio.currentTime = rs;
        setPlayTime(rs);
        lastT = rs;
      } else if (lp && t < rs - 0.05) {
        audio.currentTime = rs;
        setPlayTime(rs);
        lastT = rs;
      } else {
        if (t !== lastT) {
          setPlayTime(t);
          lastT = t;
        }
      }
      rafIdRef.current = requestAnimationFrame(tick);
    };
    rafIdRef.current = requestAnimationFrame(tick);
  }, []);

  const stopRaf = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopRaf();
  }, [stopRaf]);

  // Sync isPlaying state from audio element events (safety net)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => { setIsPlaying(false); stopRaf(); setPlayTime(audio.currentTime); };
    const onEnded = () => { setIsPlaying(false); stopRaf(); };
    const onSeeked = () => setPlayTime(audio.currentTime);
    const onCanPlayThrough = () => setBuffered(true);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('seeked', onSeeked);
    audio.addEventListener('canplaythrough', onCanPlayThrough);
    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('seeked', onSeeked);
      audio.removeEventListener('canplaythrough', onCanPlayThrough);
    };
  }, [audioUrl, stopRaf]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      stopRaf();
      setPlayTime(audio.currentTime);
    } else {
      // If loop mode and cursor is outside segment, start from rangeStart
      let startFrom = seekCursor;
      if (loopSegment && (seekCursor < rangeStart - 0.05 || seekCursor >= rangeEnd)) {
        startFrom = rangeStart;
        setSeekCursor(rangeStart);
      }
      if (Math.abs(audio.currentTime - startFrom) > 0.1) {
        audio.currentTime = startFrom;
      }
      const p = audio.play();
      if (p) {
        p.then(() => {
          setIsPlaying(true);
          startRaf(); // Start 60fps rAF loop directly here
        }).catch((err) => {
          console.error('Audio play failed:', err);
          setIsPlaying(false);
        });
      } else {
        setIsPlaying(true);
        startRaf();
      }
    }
  };

  // Play only the selected segment (seeks to rangeStart, plays, stops at rangeEnd)
  const playSegment = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      stopRaf();
    }
    audio.currentTime = rangeStart;
    setSeekCursor(rangeStart);
    setPlayTime(rangeStart);
    audio.play().then(() => {
      setIsPlaying(true);
      startRaf();
    }).catch((err) => console.error('Audio play failed:', err));
  };

  const seekTo = (t: number) => {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = t;
      setPlayTime(t);
    }
    setSeekCursor(t);
  };

  // Waveform interaction — viewport-relative for zoom
  const duration = audioInfo?.duration || audioDuration || 0;
  const rmsValues = audioInfo?.rms_values || [];

  const viewportSize = duration / zoomLevel;
  const viewportStart = Math.max(0, Math.min(duration - viewportSize, zoomCenter - viewportSize / 2));
  const viewportEnd = Math.min(duration, viewportStart + viewportSize);

  // Auto-follow: when playing + zoomed, keep playhead in view by shifting viewport
  useEffect(() => {
    if (!isPlaying || zoomLevel <= 1.1) return;
    if (playTime < viewportStart + viewportSize * 0.1) return;
    if (playTime <= viewportEnd - viewportSize * 0.1) return;
    const newCenter = Math.min(duration - viewportSize / 2, playTime + viewportSize * 0.3);
    setZoomCenter(Math.max(viewportSize / 2, newCenter));
  }, [playTime, isPlaying, zoomLevel, viewportStart, viewportEnd, viewportSize, duration]);

  const timeToX = (t: number) => viewportSize === 0 ? 0 : ((t - viewportStart) / viewportSize) * 100;
  const xToTime = (clientX: number) => {
    const rect = waveformRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return viewportStart + pct * viewportSize;
  };

  const handleWaveformMouseDown = (e: React.MouseEvent, mode: 'start' | 'end' | 'move' | 'seek' | 'seek-click') => {
    e.preventDefault();
    e.stopPropagation();
    if (mode === 'seek' || mode === 'seek-click') {
      const t = Math.max(0, Math.min(duration, xToTime(e.clientX)));
      seekTo(t);
      if (mode === 'seek-click') {
        setZoomCenter(t); // only center on click, not on drag
        // Start playback from clicked position
        const audio = audioRef.current;
        if (audio && audio.paused) {
          audio.play().then(() => {
            setIsPlaying(true);
            startRaf();
          }).catch((err) => console.error('Audio play failed:', err));
        }
      }
      return;
    }
    setDragging(mode);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const t = Math.max(0, Math.min(duration, xToTime(e.clientX)));

      if (dragging === 'seek') {
        seekTo(t);
      } else if (dragging === 'start') {
        const newStart = Math.min(t, rangeEnd - 1);
        setRangeStart(newStart);
        onClipRangeChange(newStart, rangeEnd);
      } else if (dragging === 'end') {
        const newEnd = Math.max(t, rangeStart + 1);
        setRangeEnd(newEnd);
        onClipRangeChange(rangeStart, newEnd);
      } else if (dragging === 'move') {
        const rangeSize = rangeEnd - rangeStart;
        const newCenter = t;
        const newStart = Math.max(0, Math.min(duration - rangeSize, newCenter - rangeSize / 2));
        const newEnd = newStart + rangeSize;
        setRangeStart(newStart);
        setRangeEnd(newEnd);
        onClipRangeChange(newStart, newEnd);
      }
    };
    const onUp = () => setDragging(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, rangeStart, rangeEnd, duration]);

  const fmtTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const clipLength = rangeEnd - rangeStart;

  if (loading || audioLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 size={48} className="animate-spin text-purple-400" />
        <p className="text-white font-medium text-lg">Analyzing your track...</p>
        <p className="text-gray-500 text-sm">BPM, beats, energy profile, genre & emotion</p>
      </div>
    );
  }

  const mood = trackAnalysis?.mood || 'unknown';
  const genre = trackAnalysis?.genre_hint || 'unknown';
  const moodScores: any = trackAnalysis?.mood_scores || {};

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Track Analysis Complete</h2>
        <p className="text-gray-400">Select the segment you want to work with — this defines your clip length.</p>
      </div>

      {/* Duration */}
      {duration > 0 && (
        <div className="flex items-center gap-4 p-4 bg-white/5 rounded-xl">
          <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
            <Gauge size={24} className="text-blue-400" />
          </div>
          <div>
            <div className="text-white font-bold text-xl">{fmtTime(duration)}</div>
            <div className="text-gray-400 text-sm">Track Duration</div>
          </div>
        </div>
      )}

      {/* Results grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {/* BPM */}
        {bpmData && (
          <div className="p-5 bg-white/5 rounded-xl border border-white/5">
            <div className="flex items-center gap-2 mb-2">
              <Activity size={20} className="text-purple-400" />
              <span className="text-gray-400 text-sm">BPM</span>
            </div>
            <div className="text-white font-bold text-3xl">{bpmData.bpm}</div>
            <div className="text-gray-500 text-xs mt-1">{bpmData.beats.length} beats detected</div>
          </div>
        )}

        {/* Mood */}
        <div className="p-5 bg-white/5 rounded-xl border border-white/5">
          <div className="flex items-center gap-2 mb-2">
            <Zap size={20} className="text-yellow-400" />
            <span className="text-gray-400 text-sm">Mood</span>
          </div>
          <div className="text-white font-bold text-2xl capitalize">{mood}</div>
          {moodScores.energy !== undefined && (
            <div className="text-gray-500 text-xs mt-1">
              Energy: {Math.round(moodScores.energy * 100)}% · Valence: {Math.round((moodScores.valence || 0) * 100)}%
            </div>
          )}
        </div>

        {/* Genre */}
        <div className="p-5 bg-white/5 rounded-xl border border-white/5">
          <div className="flex items-center gap-2 mb-2">
            <Palette size={20} className="text-pink-400" />
            <span className="text-gray-400 text-sm">Genre</span>
          </div>
          <div className="text-white font-bold text-2xl capitalize">{genre}</div>
        </div>
      </div>

      {/* Energy curve */}
      {trackAnalysis?.energy_curve && trackAnalysis.energy_curve.length > 0 && (
        <div className="p-5 bg-white/5 rounded-xl">
          <div className="text-gray-400 text-sm mb-3">Energy Profile</div>
          <div className="flex items-end gap-0.5 h-20">
            {trackAnalysis.energy_curve.slice(0, 80).map((v, i) => (
              <div
                key={i}
                className="flex-1 bg-gradient-to-t from-purple-600 to-pink-500 rounded-sm"
                style={{ height: `${Math.max(5, v * 100)}%`, opacity: 0.7 }}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── RANGE SELECTOR ── */}
      {audioUrl && duration > 0 && (
        <div className="p-5 bg-white/5 rounded-xl space-y-4">
          <div className="flex items-center gap-2">
            <Scissors size={20} className="text-purple-400" />
            <span className="text-white font-bold">Select Segment</span>
            <span className="ml-auto text-purple-400 font-mono text-sm">
              {fmtTime(rangeStart)} → {fmtTime(rangeEnd)} · {clipLength.toFixed(1)}s
            </span>
          </div>

          {/* Play button + buffer indicator */}
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlay}
              className="w-10 h-10 rounded-full bg-purple-600 hover:bg-purple-500 flex items-center justify-center transition-colors"
            >
              {isPlaying ? <Pause size={18} className="text-white" /> : <Play size={18} className="text-white ml-0.5" />}
            </button>
            <button
              onClick={playSegment}
              className="px-3 h-9 rounded-lg bg-purple-600/20 border border-purple-500/30 hover:bg-purple-600/30 text-purple-300 text-xs font-medium transition flex items-center gap-1.5"
              title="Play selected segment only"
            >
              <Play size={14} /> Segment
            </button>
            <button
              onClick={() => setLoopSegment(!loopSegment)}
              className={`px-3 h-9 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
                loopSegment
                  ? 'bg-green-600/20 border border-green-500/40 text-green-300'
                  : 'bg-[#1a1a2a] border border-[#2a2a3a] text-gray-500 hover:text-gray-300'
              }`}
              title="Loop playback within selected segment"
            >
              {loopSegment ? '🔁' : '➡️'} Loop
            </button>
            <span className="text-gray-400 text-sm font-mono">{fmtTime(isPlaying ? playTime : seekCursor)}</span>
            {!buffered && <span className="text-xs text-yellow-500 animate-pulse">buffering...</span>}
            {buffered && <span className="text-xs text-green-500">● ready</span>}
          </div>

          {/* Zoom controls */}
          <div className="flex items-center gap-2">
            <ZoomOut size={14} className="text-gray-500" />
            <input
              type="range" min={1} max={20} step={0.5}
              value={zoomLevel}
              onChange={e => { setZoomLevel(parseFloat(e.target.value)); setZoomCenter(playTime); }}
              className="flex-1 accent-purple-500"
              title={`Zoom: ${zoomLevel.toFixed(1)}x`}
            />
            <ZoomIn size={14} className="text-gray-500" />
            <span className="text-xs text-gray-500 font-mono w-10">{zoomLevel.toFixed(1)}x</span>
            <button
              onClick={() => { setZoomLevel(1); setZoomCenter(0); }}
              className="text-[10px] text-gray-400 px-2 py-0.5 hover:bg-[#2a2a3a] rounded transition"
            >
              1:1
            </button>
          </div>

          {/* Waveform + range markers */}
          <div
            ref={waveformRef}
            className="relative h-24 bg-black/40 rounded-lg cursor-pointer overflow-hidden select-none"
            onMouseDown={(e) => handleWaveformMouseDown(e, 'seek-click')}
          >
            {/* RMS waveform bars — filtered by viewport */}
            <div className="absolute inset-0 flex items-end gap-px px-1">
              {rmsValues.length > 0 ? (
                rmsValues.map((v, i) => {
                  const barTime = (i / rmsValues.length) * duration;
                  if (barTime < viewportStart || barTime > viewportEnd) return null;
                  return (
                    <div
                      key={i}
                      className="flex-1 bg-gradient-to-t from-blue-900 to-purple-700"
                      style={{
                        height: `${Math.max(3, Math.min(100, v * 200))}%`,
                        opacity: 0.6,
                        minWidth: '1px',
                      }}
                    />
                  );
                })
              ) : (
                trackAnalysis?.energy_curve?.slice(0, 100).map((v, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-gradient-to-t from-blue-900 to-purple-700"
                    style={{ height: `${Math.max(5, v * 100)}%`, opacity: 0.5 }}
                  />
                ))
              )}
            </div>

            {/* Selected range overlay — visual only, clicks fall through to waveform */}
            <div
              className="absolute top-0 bottom-0 bg-purple-500/20 border-x-2 border-purple-400 pointer-events-none"
              style={{
                left: `${timeToX(rangeStart)}%`,
                width: `${Math.max(0.5, timeToX(rangeEnd) - timeToX(rangeStart))}%`,
              }}
            />

            {/* Start handle — visual line only (pointer-events: none so clicks fall through to waveform) */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-purple-400 z-10 pointer-events-none"
              style={{ left: `calc(${timeToX(rangeStart)}% - 1px)` }}
            />
            {/* Start handle knob — the ONLY draggable part (top circle) */}
            <div
              className="absolute top-0 z-20 cursor-ew-resize group"
              style={{ left: `calc(${timeToX(rangeStart)}% - 6px)` }}
              onMouseDown={(e) => handleWaveformMouseDown(e, 'start')}
              title="Drag to move start"
            >
              <div className="w-3 h-3 bg-purple-400 rounded-full group-hover:bg-purple-300 group-hover:scale-125 transition-all shadow-md" />
              <div className="absolute top-3 left-1/2 -translate-x-1/2 w-0.5 h-[84px] bg-purple-400 group-hover:bg-purple-300 transition-colors" />
            </div>

            {/* End handle — visual line only */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-purple-400 z-10 pointer-events-none"
              style={{ left: `calc(${timeToX(rangeEnd)}% - 1px)` }}
            />
            {/* End handle knob — the ONLY draggable part */}
            <div
              className="absolute top-0 z-20 cursor-ew-resize group"
              style={{ left: `calc(${timeToX(rangeEnd)}% - 6px)` }}
              onMouseDown={(e) => handleWaveformMouseDown(e, 'end')}
              title="Drag to move end"
            >
              <div className="w-3 h-3 bg-purple-400 rounded-full group-hover:bg-purple-300 group-hover:scale-125 transition-all shadow-md" />
              <div className="absolute top-3 left-1/2 -translate-x-1/2 w-0.5 h-[84px] bg-purple-400 group-hover:bg-purple-300 transition-colors" />
            </div>

            {/* Move handle — thin strip at top of range, pointer-events:none except small grab knob in center */}
            <div
              className="absolute top-0 h-1.5 z-5 pointer-events-none"
              style={{
                left: `${timeToX(rangeStart)}%`,
                width: `${Math.max(0.5, timeToX(rangeEnd) - timeToX(rangeStart))}%`,
              }}
            >
              <div className="h-full bg-purple-400/30 rounded-t" />
            </div>
            {/* Move grab knob — centered on the segment, draggable */}
            <div
              className="absolute top-0 z-20 cursor-grab active:cursor-grabbing"
              style={{
                left: `calc(${timeToX((rangeStart + rangeEnd) / 2)}% - 12px)`,
              }}
              onMouseDown={(e) => handleWaveformMouseDown(e, 'move')}
              title="Drag to move segment"
            >
              <div className="flex items-center gap-0.5 px-1.5 py-0.5 bg-purple-500/40 hover:bg-purple-500/60 rounded text-purple-300 text-[10px] font-medium transition">
                ⠿
              </div>
            </div>

            {/* Silver seek cursor — draggable, sets playback position */}
            {/* Silver seek cursor — line is visual only (pointer-events:none), knob is draggable */}
            <div
              className="absolute top-0 bottom-0 z-25 pointer-events-none"
              style={{ left: `${timeToX(seekCursor)}%` }}
            >
              <div className="absolute top-0 bottom-0 w-0.5 bg-gray-300" />
            </div>
            <div
              className="absolute top-1/2 -translate-y-1/2 z-25 cursor-ew-resize group"
              style={{ left: `calc(${timeToX(seekCursor)}% - 6px)` }}
              onMouseDown={(e) => handleWaveformMouseDown(e, 'seek')}
              title="Drag to seek"
            >
              <div className="w-3 h-3 rounded-full bg-gray-300 group-hover:bg-white border border-gray-400 shadow-md transition-colors" />
            </div>

            {/* Red playhead — 60fps smooth via rAF, always visible */}
            <div
              className="absolute top-0 bottom-0 w-[2px] bg-red-500 z-30 pointer-events-none"
              style={{ left: `${Math.max(0, Math.min(100, timeToX(playTime)))}%` }}
            >
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-red-500 rounded-full shadow-[0_0_8px_rgba(239,68,68,0.9)]" />
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-red-500 rounded-full" />
            </div>
          </div>

          {/* Scroll bar — when zoomed, shows viewport position in full track */}
          {zoomLevel > 1.1 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const newCenter = Math.max(viewportSize / 2, zoomCenter - viewportSize * 0.5);
                  setZoomCenter(Math.min(duration - viewportSize / 2, newCenter));
                }}
                className="p-1 hover:bg-[#2a2a3a] rounded transition"
                title="Scroll left"
              >
                <span className="text-gray-400 text-xs">◀</span>
              </button>
              <div
                className="relative flex-1 h-5 bg-[#0a0a0f] border border-[#1a1a2a] rounded-lg cursor-pointer"
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

                  // Click-to-jump
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
                  style={{
                    left: `${(viewportStart / duration) * 100}%`,
                    width: `${Math.max(2, (viewportSize / duration) * 100)}%`,
                  }}
                />
                {/* Seek cursor on minimap */}
                <div
                  className="absolute top-0 bottom-0 w-px bg-gray-400/60 pointer-events-none"
                  style={{ left: `${(seekCursor / duration) * 100}%` }}
                />
              </div>
              <button
                onClick={() => {
                  const newCenter = Math.min(duration - viewportSize / 2, zoomCenter + viewportSize * 0.5);
                  setZoomCenter(Math.max(viewportSize / 2, newCenter));
                }}
                className="p-1 hover:bg-[#2a2a3a] rounded transition"
                title="Scroll right"
              >
                <span className="text-gray-400 text-xs">▶</span>
              </button>
              <span className="text-[10px] text-gray-500 font-mono whitespace-nowrap">
                {fmtTime(viewportStart)} → {fmtTime(viewportEnd)}
              </span>
            </div>
          )}

          {/* Range info */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">
              <span className="text-gray-300">Click waveform to seek & play</span> · <span className="text-purple-400">⬤ handles</span> = drag segment edges · <span className="text-purple-300">⠿</span> = move segment · <span className="text-gray-400">◯</span> = seek · <span className="text-red-400">Red line</span> = playing
            </span>
            <span className="text-white font-bold">
              Clip length: <span className="text-purple-400">{clipLength.toFixed(1)}s</span>
            </span>
          </div>
        </div>
      )}

      {/* Audio element */}
      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="auto" />}
    </div>
  );
}