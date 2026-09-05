import { useState, useEffect, useRef } from 'react';
import { Loader2, Activity, Palette, Gauge, Zap, Play, Pause, Scissors } from 'lucide-react';
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
  const [dragging, setDragging] = useState<null | 'start' | 'end' | 'move'>(null);
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

  // Audio playback tracking
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      setPlayTime(audio.currentTime);
      // Loop within range
      if (rangeEnd > rangeStart && !audio.seeking && audio.currentTime >= rangeEnd) {
        audio.currentTime = rangeStart;
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, [audioUrl, rangeStart, rangeEnd]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      if (audio.currentTime < rangeStart || audio.currentTime >= rangeEnd) {
        audio.currentTime = rangeStart;
      }
      audio.play();
    }
  };

  const seekTo = (t: number) => {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = t;
      setPlayTime(t);
    }
  };

  // Waveform interaction
  const duration = audioInfo?.duration || audioDuration || 0;
  const rmsValues = audioInfo?.rms_values || [];

  const timeToPct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0);
  const pctToTime = (pct: number) => (pct / 100) * duration;

  const handleWaveformMouseDown = (e: React.MouseEvent, mode: 'start' | 'end' | 'move' | 'seek') => {
    e.preventDefault();
    e.stopPropagation();
    if (mode === 'seek') {
      const rect = waveformRef.current?.getBoundingClientRect();
      if (rect) {
        const pct = ((e.clientX - rect.left) / rect.width) * 100;
        seekTo(Math.max(0, Math.min(duration, pctToTime(pct))));
      }
      return;
    }
    setDragging(mode);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const rect = waveformRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      const t = pctToTime(pct);

      if (dragging === 'start') {
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

          {/* Play button */}
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlay}
              className="w-10 h-10 rounded-full bg-purple-600 hover:bg-purple-500 flex items-center justify-center transition-colors"
            >
              {isPlaying ? <Pause size={18} className="text-white" /> : <Play size={18} className="text-white ml-0.5" />}
            </button>
            <span className="text-gray-400 text-sm font-mono">{fmtTime(playTime)}</span>
          </div>

          {/* Waveform + range markers */}
          <div
            ref={waveformRef}
            className="relative h-24 bg-black/40 rounded-lg cursor-pointer overflow-hidden select-none"
            onMouseDown={(e) => handleWaveformMouseDown(e, 'seek')}
          >
            {/* RMS waveform bars */}
            <div className="absolute inset-0 flex items-end gap-px px-1">
              {rmsValues.length > 0 ? (
                rmsValues.map((v, i) => {
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
                // Fallback: energy curve
                trackAnalysis?.energy_curve?.slice(0, 100).map((v, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-gradient-to-t from-blue-900 to-purple-700"
                    style={{ height: `${Math.max(5, v * 100)}%`, opacity: 0.5 }}
                  />
                ))
              )}
            </div>

            {/* Selected range overlay */}
            <div
              className="absolute top-0 bottom-0 bg-purple-500/20 border-x-2 border-purple-400"
              style={{
                left: `${timeToPct(rangeStart)}%`,
                width: `${timeToPct(rangeEnd - rangeStart)}%`,
              }}
            />

            {/* Start handle */}
            <div
              className="absolute top-0 bottom-0 w-2 bg-purple-400 cursor-ew-resize z-10 hover:bg-purple-300"
              style={{ left: `calc(${timeToPct(rangeStart)}% - 4px)` }}
              onMouseDown={(e) => handleWaveformMouseDown(e, 'start')}
            >
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-purple-400 rounded-full" />
            </div>

            {/* End handle */}
            <div
              className="absolute top-0 bottom-0 w-2 bg-purple-400 cursor-ew-resize z-10 hover:bg-purple-300"
              style={{ left: `calc(${timeToPct(rangeEnd)}% - 4px)` }}
              onMouseDown={(e) => handleWaveformMouseDown(e, 'end')}
            >
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-purple-400 rounded-full" />
            </div>

            {/* Move handle (center) */}
            <div
              className="absolute top-0 bottom-0 cursor-grab z-5"
              style={{
                left: `${timeToPct(rangeStart)}%`,
                width: `${timeToPct(rangeEnd - rangeStart)}%`,
              }}
              onMouseDown={(e) => handleWaveformMouseDown(e, 'move')}
            />

            {/* Playhead */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-yellow-400 z-20 pointer-events-none"
              style={{ left: `${timeToPct(playTime)}%` }}
            />
          </div>

          {/* Range info */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400">
              Drag the <span className="text-purple-400">purple handles</span> to select your segment
            </span>
            <span className="text-white font-bold">
              Clip length: <span className="text-purple-400">{clipLength.toFixed(1)}s</span>
            </span>
          </div>
        </div>
      )}

      {/* Audio element */}
      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="metadata" />}
    </div>
  );
}