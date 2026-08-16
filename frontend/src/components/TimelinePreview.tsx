import { useState, useRef, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import type { Fragment, SubtitleLine, WordTiming, SubtitleStyle } from '../types';

interface AudioInfo {
  duration: number;
  suggested_start: number;
  suggested_end: number;
  rms_times?: number[];
  rms_values?: number[];
  beats?: number[];
  bpm?: number;
}

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
  style?: SubtitleStyle;
}

// ASS color → CSS hex
function assToHex(ass: string): string {
  if (!ass.startsWith('&H')) return '#ffffff';
  const hex = ass.replace('&H', '').replace(/[^0-9A-Fa-f]/g, '');
  if (hex.length < 8) return '#ffffff';
  const r = hex.substring(6, 8);
  const g = hex.substring(4, 6);
  const b = hex.substring(2, 4);
  return `#${r}${g}${b}`;
}

export function TimelinePreview({
  fragments, subtitles, videoUrl,
  wordTimings, audioInfo, audioStart, audioEnd, onRangeChange,
  onSeek, currentTime, isPlaying, onPlayPause,
  displayMode = 'auto',
  style,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const [dragHandle, setDragHandle] = useState<'start' | 'end' | 'none'>('none');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);

  const duration = audioInfo?.duration || 0;

  // Sync video to currentTime
  useEffect(() => {
    if (videoRef.current) {
      const videoTime = currentTime - audioStart;
      if (videoTime >= 0 && videoTime < (videoRef.current.duration || 9999)) {
        // Only seek if difference is large (avoid stutter during normal playback)
        if (Math.abs(videoRef.current.currentTime - videoTime) > 0.3) {
          videoRef.current.currentTime = videoTime;
        }
      }
    }
  }, [currentTime, audioStart]);

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

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      if (!timelineRef.current || duration === 0) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const t = (x / rect.width) * duration;
      if (dragHandle === 'start') {
        onRangeChange(Math.max(0, Math.min(t, audioEnd - 1)), audioEnd);
      } else {
        onRangeChange(audioStart, Math.min(duration, Math.max(t, audioStart + 1)));
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
      {/* ── Video Preview + Karaoke Overlay ── */}
      <div className="flex gap-3">
        {videoUrl && (
          <div className="bg-black rounded-lg overflow-hidden relative shrink-0" style={{ aspectRatio: '9/16', height: '200px' }}>
            <video ref={videoRef} src={videoUrl} className="h-full w-full object-contain" muted playsInline />
            {/* Karaoke overlay — uses real SubtitleStyle */}
            {currentSubs.length > 0 && (() => {
              const textColor = style ? assToHex(style.primary_color) : '#ffffff';
              const outlineW = style ? style.outline_width : 3;
              const fontSize = style ? Math.max(12, Math.min(style.size / 4, 22)) : 14;
              const fontFamily = style ? style.font : 'Arial';
              const fontWeight = style?.bold ? '900' : 'bold';
              const posStyle = style?.position === 'top' ? { top: '12%' }
                : style?.position === 'center' ? { top: '45%' }
                : { bottom: '8%' };

              return (
                <div className="absolute left-3 right-3 text-center pointer-events-none" style={posStyle}>
                  {(() => {
                    // Determine effective mode
                    const currentSub = currentSubs[0];
                    const subWords = currentSub?.words || [];
                    const lineText = subWords.map(w => w.word).join(' ');
                    const tooLong = lineText.length > 30 || subWords.length > 6;
                    const effectiveMode = displayMode === 'auto'
                      ? (tooLong ? 'single_word' : 'line_highlight')
                      : displayMode;

                    if (effectiveMode === 'single_word') {
                      return activeWord ? (
                        <span
                          style={{
                            fontFamily, fontSize: `${fontSize + 6}px`, fontWeight,
                            color: '#facc15',
                            textShadow: `0 ${outlineW}px ${outlineW * 2}px rgba(0,0,0,0.95), 0 0 20px rgba(250,204,21,0.5)`,
                          }}
                        >
                          {activeWord.word}
                        </span>
                      ) : null;
                    }

                    if (effectiveMode === 'word_by_word') {
                      return activeWord ? (
                        <span
                          style={{
                            fontFamily, fontSize: `${fontSize + 4}px`, fontWeight,
                            color: '#facc15',
                            textShadow: `0 ${outlineW}px ${outlineW * 2}px rgba(0,0,0,0.95), 0 0 20px rgba(250,204,21,0.5)`,
                          }}
                        >
                          {activeWord.word}
                        </span>
                      ) : null;
                    }

                    // line_highlight
                    return currentSubs.map(sub => (
                      <div key={sub.id}>
                        {sub.words && sub.words.length > 0 ? (
                          sub.words.map((w, i) => {
                            const isActive = videoTime >= w.start && videoTime <= w.end;
                            const isPast = videoTime > w.end;
                            return (
                              <span
                                key={i}
                                style={{
                                  fontFamily, fontSize: `${fontSize}px`, fontWeight,
                                  color: isActive ? '#facc15' : isPast ? `${textColor}66` : textColor,
                                  textShadow: `0 ${Math.max(2, outlineW)}px ${Math.max(4, outlineW * 2)}px rgba(0,0,0,0.9)`,
                                  transition: 'color 0.15s, transform 0.15s',
                                  display: 'inline-block',
                                  transform: isActive ? 'scale(1.15)' : 'scale(1)',
                                }}
                              >
                                {w.word}{' '}
                              </span>
                            );
                          })
                        ) : (
                          <span style={{ fontFamily, fontSize: `${fontSize}px`, fontWeight, color: textColor, textShadow: `0 ${outlineW}px ${outlineW * 2}px rgba(0,0,0,0.9)` }}>
                            {sub.text}
                          </span>
                        )}
                      </div>
                    ));
                  })()}
                </div>
              );
            })()}
          </div>
        )}

        {/* Side info panel */}
        <div className="flex-1 space-y-1.5">
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

        {/* Audio selection range */}
        <div className="absolute top-0 bottom-0 border-2 border-yellow-500/60 bg-yellow-500/10 pointer-events-none" style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}>
          <span className="absolute top-0 left-1 text-[8px] text-yellow-400 font-mono whitespace-nowrap">{fmtTime(audioStart)}-{fmtTime(audioEnd)}</span>
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
        💡 Click timeline to seek · Drag yellow handles to select range · {displayMode === 'word_by_word' ? 'Word-by-word mode' : 'Line + highlight mode'}
      </div>
    </div>
  );
}