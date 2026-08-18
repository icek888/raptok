import { useRef, useEffect } from 'react';
import { Play, Pause } from 'lucide-react';
import type { SubtitleLine, WordTiming, SubtitleStyle } from '../types';

interface PreviewFrameProps {
  videoUrl?: string | null;
  subtitles: SubtitleLine[];
  wordTimings: WordTiming[];
  displayMode: 'auto' | 'line_highlight' | 'word_by_word' | 'single_word';
  style: SubtitleStyle;
  audioStart: number;
  currentTime: number;
  isPlaying: boolean;
  onPlayPause: () => void;
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

/**
 * Large 9:16 video preview with karaoke overlay.
 * Shows the video at ~340px wide × ~604px tall — proportionally representing
 * the actual 1080×1920 render frame.
 */
export function PreviewFrame({
  videoUrl,
  subtitles,
  wordTimings,
  displayMode,
  style,
  audioStart,
  currentTime,
  isPlaying,
  onPlayPause,
}: PreviewFrameProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Sync video to currentTime (same logic as TimelinePreview)
  useEffect(() => {
    if (videoRef.current) {
      const videoTime = currentTime - audioStart;
      if (videoTime >= 0 && videoTime < (videoRef.current.duration || 9999)) {
        if (Math.abs(videoRef.current.currentTime - videoTime) > 0.3) {
          videoRef.current.currentTime = videoTime;
        }
      }
    }
  }, [currentTime, audioStart]);

  const videoTime = currentTime - audioStart;

  // Get current subtitle on video timeline
  const currentSubs = videoTime >= 0
    ? subtitles.filter(s => videoTime >= s.start && videoTime <= s.end)
    : [];

  // Get active word
  const activeWord = videoTime >= 0
    ? wordTimings.find(w => videoTime >= w.start && videoTime <= w.end)
    : null;

  // Scale factor: 1080px render → 340px preview = ~3.18x downscale
  const scale = 1080 / 360;

  return (
    <div className="bg-[#0f0f17] border border-[#1a1a2a] rounded-xl p-2.5 space-y-2 lg:sticky lg:top-4">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-gray-500 font-medium">Live Preview</span>
        <span className="text-[10px] text-gray-600 font-mono">1080×1920</span>
      </div>

      {/* Video frame — 340px wide, 9:16 aspect = ~604px tall */}
      <div
        className="bg-black rounded-lg overflow-hidden relative mx-auto"
        style={{ width: '100%', maxWidth: '360px', aspectRatio: '9/16' }}
      >
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            className="h-full w-full object-contain"
            muted
            playsInline
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-gray-600 text-xs">
            No video uploaded
          </div>
        )}

        {/* Karaoke overlay — uses real SubtitleStyle, scaled to preview size */}
        {videoUrl && currentSubs.length > 0 && (() => {
          const textColor = assToHex(style.primary_color);
          const activeColor = assToHex(style.active_color);
          const outlineW = style.outline_width;
          const fontSize = Math.max(16, Math.min(style.size / scale, 52));
          const fontFamily = style.font;
          const fontWeight = style.bold ? '900' : 'bold';
          const marginPx = Math.round((style.margin_v || 0) / scale);
          const posStyle: React.CSSProperties =
            style.position === 'top' ? { top: `${marginPx}px` }
            : style.position === 'center' ? { top: '45%' }
            : { bottom: `${marginPx}px` };
          const activeGlow = activeColor + '80';

          return (
            <div
              className="absolute left-[4%] right-[4%] text-center pointer-events-none"
              style={posStyle}
            >
              {(() => {
                // ── Auto mode: choose ONE mode for entire track ──
                let longLines = 0;
                let shortLines = 0;
                for (const sub of subtitles) {
                  if (!sub.words) continue;
                  const lineText = sub.words.map(w => w.word).join(' ');
                  if (lineText.length > 30 || sub.words.length > 6) longLines++;
                  else shortLines++;
                }
                const effectiveMode = displayMode === 'auto'
                  ? (longLines > shortLines ? 'single_word' : 'line_highlight')
                  : displayMode;

                if (effectiveMode === 'single_word') {
                  return activeWord ? (
                    <span
                      style={{
                        fontFamily,
                        fontSize: `${fontSize + 8}px`,
                        fontWeight,
                        color: activeColor,
                        textShadow: `0 ${outlineW}px ${outlineW * 2}px rgba(0,0,0,0.95), 0 0 20px ${activeGlow}`,
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
                        fontFamily,
                        fontSize: `${fontSize + 4}px`,
                        fontWeight,
                        color: activeColor,
                        textShadow: `0 ${outlineW}px ${outlineW * 2}px rgba(0,0,0,0.95), 0 0 20px ${activeGlow}`,
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
                              fontFamily,
                              fontSize: `${fontSize}px`,
                              fontWeight,
                              color: isActive ? activeColor : isPast ? `${textColor}66` : textColor,
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
                      <span
                        style={{
                          fontFamily,
                          fontSize: `${fontSize}px`,
                          fontWeight,
                          color: textColor,
                          textShadow: `0 ${outlineW}px ${outlineW * 2}px rgba(0,0,0,0.9)`,
                        }}
                      >
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

      {/* Play/pause button synced with main audio */}
      {videoUrl && (
        <button
          onClick={onPlayPause}
          className="w-full py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition"
        >
          {isPlaying ? <Pause size={12} className="text-white" /> : <Play size={12} className="text-white" />}
          <span className="text-white">{isPlaying ? 'Pause' : 'Play'}</span>
        </button>
      )}

      {/* Current subtitle info */}
      {videoUrl && (
        <div className="bg-[#0a0a0f] border border-[#1a1a2a] rounded-lg px-2 py-1.5 text-center min-h-[28px]">
          {activeWord ? (
            <span className="text-xs text-yellow-400 font-bold">✨ {activeWord.word}</span>
          ) : currentSubs.length > 0 ? (
            <span className="text-xs text-gray-400">📝 Line #{currentSubs[0].id + 1}</span>
          ) : (
            <span className="text-xs text-gray-600">⏸ No active subtitle</span>
          )}
        </div>
      )}
    </div>
  );
}