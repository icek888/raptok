import { Play, Pause, Type } from 'lucide-react';
import type { SubtitleLine, WordTiming, SubtitleStyle } from '../types';

interface PreviewFrameProps {
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
  if (!ass || !ass.startsWith('&H')) return '#ffffff';
  const hex = ass.replace('&H', '').replace(/[^0-9A-Fa-f]/g, '');
  if (hex.length < 8) return '#ffffff';
  const r = hex.substring(6, 8);
  const g = hex.substring(4, 6);
  const b = hex.substring(2, 4);
  return `#${r}${g}${b}`;
}

/**
 * Compact text preview — shows how subtitles will look on render.
 * Neutral gradient background (no video). Words highlight during playback.
 * This is NOT the full video preview (that's on the next step).
 */
export function PreviewFrame({
  subtitles,
  wordTimings,
  displayMode,
  style,
  audioStart,
  currentTime,
  isPlaying,
  onPlayPause,
}: PreviewFrameProps) {
  const videoTime = currentTime - audioStart;

  // Get current subtitle
  const currentSubs = videoTime >= 0
    ? subtitles.filter(s => videoTime >= s.start && videoTime <= s.end)
    : [];

  // Get active word
  const activeWord = videoTime >= 0
    ? wordTimings.find(w => videoTime >= w.start && videoTime <= w.end)
    : null;

  // Scale: 1080px render → ~280px preview
  const scale = 1080 / 280;
  const textColor = assToHex(style.primary_color);
  const activeColor = assToHex(style.active_color);
  const outlineW = style.outline_width;
  const fontSize = Math.max(14, Math.min(style.size / scale, 36));
  const fontFamily = style.font;
  const fontWeight = style.bold ? '900' : 'bold';
  const marginPx = Math.round((style.margin_v || 0) / scale);
  const activeGlow = activeColor + '80';

  // Determine display mode
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

  const posStyle: React.CSSProperties =
    style.position === 'top' ? { top: `${marginPx}px` }
    : style.position === 'center' ? { top: '45%' }
    : { bottom: `${marginPx}px` };

  // Find next words for context (show a few words ahead)
  const upcomingWords = wordTimings
    .filter(w => w.start >= videoTime && w.start < videoTime + 3)
    .slice(0, 5);

  return (
    <div className="bg-[#0f0f17] border border-[#1a1a2a] rounded-xl p-3 space-y-2 lg:sticky lg:top-4">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-gray-500 font-medium flex items-center gap-1">
          <Type size={12} /> Text Preview
        </span>
        <span className="text-[10px] text-gray-600">{style.font} · {style.position} · {Math.round(fontSize)}px</span>
      </div>

      {/* Text preview area — neutral gradient background */}
      <div
        className="rounded-lg overflow-hidden relative mx-auto"
        style={{
          width: '100%',
          maxWidth: '280px',
          aspectRatio: '9/16',
          background: 'linear-gradient(160deg, #1a1a2e 0%, #16162a 40%, #1e1e3a 100%)',
        }}
      >
        {/* Subtle grid pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'repeating-linear-gradient(0deg, #fff, #fff 1px, transparent 1px, transparent 40px), repeating-linear-gradient(90deg, #fff, #fff 1px, transparent 1px, transparent 40px)',
          }}
        />

        {/* Text overlay */}
        <div
          className="absolute left-[5%] right-[5%] text-center pointer-events-none"
          style={posStyle}
        >
          {currentSubs.length > 0 || activeWord ? (
            (() => {
              if (effectiveMode === 'single_word' || effectiveMode === 'word_by_word') {
                return activeWord ? (
                  <div key={activeWord.word + activeWord.start}>
                    <span
                      style={{
                        fontFamily,
                        fontSize: `${fontSize + 6}px`,
                        fontWeight,
                        color: activeColor,
                        textShadow: `0 ${outlineW}px ${outlineW * 2}px rgba(0,0,0,0.95), 0 0 24px ${activeGlow}`,
                        transition: 'all 0.15s ease',
                        display: 'inline-block',
                        transform: 'scale(1.1)',
                      }}
                    >
                      {activeWord.word}
                    </span>
                    {/* Show next words as preview (dimmed) */}
                    {upcomingWords.length > 1 && (
                      <div className="mt-3 text-[10px] opacity-30" style={{ fontFamily, color: textColor }}>
                        {upcomingWords.slice(1, 4).map(w => w.word).join(' ')}
                      </div>
                    )}
                  </div>
                ) : null;
              }

              // line_highlight mode
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
                            color: isActive ? activeColor : isPast ? `${textColor}55` : textColor,
                            textShadow: `0 ${Math.max(2, outlineW)}px ${Math.max(4, outlineW * 2)}px rgba(0,0,0,0.9)`,
                            transition: 'color 0.12s, transform 0.12s',
                            display: 'inline-block',
                            transform: isActive ? 'scale(1.18)' : 'scale(1)',
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
            })()
          ) : (
            /* Idle state — show first subtitle or placeholder */
            subtitles.length > 0 ? (
              <div style={{ fontFamily, fontSize: `${fontSize}px`, fontWeight, color: `${textColor}40` }}>
                {subtitles[0].words?.map(w => w.word).join(' ') || subtitles[0].text}
              </div>
            ) : (
              <div className="text-gray-600 text-xs mt-[40%]">
                Transcribe to see preview
              </div>
            )
          )}
        </div>
      </div>

      {/* Play/pause + current word info */}
      <div className="space-y-1.5">
        <button
          onClick={onPlayPause}
          className="w-full py-1.5 bg-purple-600 hover:bg-purple-500 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition"
        >
          {isPlaying ? <Pause size={12} className="text-white" /> : <Play size={12} className="text-white" />}
          <span className="text-white">{isPlaying ? 'Pause' : 'Play'}</span>
          <span className="text-white/50 ml-1">{currentTime.toFixed(1)}s</span>
        </button>

        <div className="bg-[#0a0a0f] border border-[#1a1a2a] rounded-lg px-2 py-1 text-center min-h-[24px]">
          {activeWord ? (
            <span className="text-xs font-bold" style={{ color: activeColor }}>
              ✨ {activeWord.word}
            </span>
          ) : currentSubs.length > 0 ? (
            <span className="text-xs text-gray-400">Line #{currentSubs[0].id + 1}</span>
          ) : (
            <span className="text-xs text-gray-600">—</span>
          )}
        </div>
      </div>
    </div>
  );
}