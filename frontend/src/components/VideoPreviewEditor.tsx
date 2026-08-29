import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, SkipBack, SkipForward, Type, Palette, Layout, Eye, Film, Loader2 } from 'lucide-react';
import type { SubtitleLine, SubtitleStyle, WordTiming, Fragment, RenderTemplate, VideoInfo } from '../types';
import { assToCss, cssToAss } from '../utils/colors';
import { POSITION_MAP } from '../utils/constants';
import { useTemplates, applyTemplateToStyle } from '../utils/templates';

interface Props {
  videoInfo: VideoInfo | null;
  videoUrl: string | null;
  fragments: Fragment[];
  audioPath: string | null;
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
}

// ASS color → CSS color conversion is now in utils/colors.ts

// POSITION_MAP is now in utils/constants.ts

export function VideoPreviewEditor({
  videoInfo, videoUrl, fragments, audioPath, audioStart,
  subtitles, wordTimings, style, onStyleChange,
  karaoke, onKaraokeChange, displayMode, onDisplayModeChange,
  templateId, onTemplateChange,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const { templates } = useTemplates();
  const [activeTab, setActiveTab] = useState<'templates' | 'style' | 'layout'>('templates');

  // ── Preview clip state ──
  const [previewData, setPreviewData] = useState<{
    video_url: string;
    audio_url: string | null;
    duration: number;
    word_timings: WordTiming[];
    subtitles: SubtitleLine[];
    fragments: { id: number; start: number; end: number; duration: number }[];
  } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // ── Prepare preview clip when entering Step 3 ──
  // Backend concats selected video fragments + audio fragments into one clip.
  // Word timings and subtitles are shifted to 0-based relative to the concat clip.
  useEffect(() => {
    if (!videoUrl || fragments.length === 0 || previewData) return;
    if (wordTimings.length === 0 && subtitles.length === 0) return;

    setPreparing(true);
    setPreviewError(null);

    // Call backend to concat fragments + shift timings
    fetch('/api/prepare-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_path: videoUrl,
        audio_path: audioPath || null,
        audio_start: audioStart,
        fragments: fragments.map(f => ({
          id: f.id,
          start: f.start,
          end: f.end,
          duration: f.duration,
        })),
        word_timings: wordTimings,
        subtitles: subtitles,
      }),
    }).then(r => r.json()).then(data => {
      setPreviewData(data);
      setPreparing(false);
      console.log('[Preview] Concat data:', {
        subs: data.subtitles?.length || 0,
        words: data.word_timings?.length || 0,
        duration: data.duration,
        video: data.video_url,
        audio: data.audio_url,
      });
    }).catch(err => {
      setPreviewError(err instanceof Error ? err.message : 'Failed to prepare preview');
      setPreparing(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl, fragments.length, wordTimings.length, subtitles.length]);

  // Templates loaded via useTemplates() hook (cached)

  // ── Time update ──
  const onTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      // Concat clip is 0-based, word_timings/subtitles are 0-based — direct match
      setCurrentTime(videoRef.current.currentTime);
    }
  }, []);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      if (audioRef.current) audioRef.current.pause();
    } else {
      videoRef.current.play();
      if (audioRef.current) {
        // Both video and audio are 0-based concat clips — same timeline
        audioRef.current.currentTime = videoRef.current.currentTime;
        audioRef.current.play();
      }
    }
    setIsPlaying(!isPlaying);
  };

  const seekTo = (t: number) => {
    const clamped = Math.max(0, Math.min(t, duration || previewDuration));
    if (videoRef.current) videoRef.current.currentTime = clamped;
    if (audioRef.current) audioRef.current.currentTime = clamped;
  };

  // ── Use preview clip data if available, fall back to raw ──
  const activeVideoUrl = previewData?.video_url || null;
  const activeAudioUrl = previewData?.audio_url || null;
  // Duration: video duration minus audioStart (since we seek to audioStart)
  const previewDuration = previewData?.duration || duration;
  const previewSubs = previewData?.subtitles || subtitles;
  const previewWords = previewData?.word_timings || wordTimings;
  const previewFragments = previewData?.fragments || fragments;

  // ── Find active fragment at current time ──
  const activeFragment = previewFragments.find((f: any) => currentTime >= f.start && currentTime <= f.end);

  // ── Find active subtitle at current time ──
  const activeSub = previewSubs.find(s => currentTime >= s.start && currentTime <= s.end);
  const activeWord = previewWords.find(w => currentTime >= w.start && currentTime <= w.end);

  // DEBUG: log preview data state
  console.log('[Preview Debug]', {
    currentTime: currentTime.toFixed(2),
    isPlaying,
    duration,
    previewDuration,
    previewSubsCount: previewSubs.length,
    previewWordsCount: previewWords.length,
    activeSub: activeSub ? `${activeSub.start}-${activeSub.end} "${activeSub.text}"` : 'NONE',
    activeWord: activeWord ? `${activeWord.start}-${activeWord.end} "${activeWord.word}"` : 'NONE',
    displayMode,
    hasPreviewData: !!previewData,
    previewDataSubs: previewData?.subtitles?.length || 0,
    previewDataWords: previewData?.word_timings?.length || 0,
  });

  // ── Apply template (shared utility) ──
  const applyTemplate = (tmpl: RenderTemplate) => {
    applyTemplateToStyle(tmpl, onStyleChange, onDisplayModeChange, onTemplateChange);
  };

  // ── CSS subtitle rendering ──
  const renderSubtitles = () => {
    if (!activeSub) return null;
    const primaryCss = assToCss(style.primary_color);
    const activeCss = assToCss(style.active_color);
    const outlineCss = assToCss(style.outline_color);

    const baseStyle: React.CSSProperties = {
      fontFamily: `'${style.font}', sans-serif`,
      fontSize: `${style.size * 0.25}px`, // scale: preview is 270px wide, render is 1080px (270/1080 = 0.25)
      fontWeight: style.bold ? 'bold' : 'normal',
      color: primaryCss,
      textShadow: `-${style.outline_width * 0.25}px -${style.outline_width * 0.25}px 0 ${outlineCss}, ${style.outline_width * 0.25}px -${style.outline_width * 0.25}px 0 ${outlineCss}, -${style.outline_width * 0.25}px ${style.outline_width * 0.25}px 0 ${outlineCss}, ${style.outline_width * 0.25}px ${style.outline_width * 0.25}px 0 ${outlineCss}`,
      textAlign: 'center',
      lineHeight: 1.3,
      padding: '0 20px',
      maxWidth: '90%',
    };

    if (displayMode === 'word_by_word' && activeWord) {
      // Show only active word, highlighted
      return (
        <div style={{ ...baseStyle, color: activeCss, transform: 'scale(1.15)', transition: 'all 0.1s' }}>
          {activeWord.word}
        </div>
      );
    }

    if (displayMode === 'single_word' && activeWord) {
      return (
        <div style={{ ...baseStyle, color: activeCss }}>
          {activeWord.word}
        </div>
      );
    }

    // line_highlight / auto — show full line, highlight active word
    const words = activeSub.words || [];
    return (
      <div style={baseStyle}>
        {words.length > 0 ? words.map((w, i) => {
          const isActive = currentTime >= w.start && currentTime <= w.end;
          return (
            <span key={i} style={{
              color: isActive ? activeCss : primaryCss,
              transition: 'color 0.1s',
            }}>
              {w.word}{i < words.length - 1 ? ' ' : ''}
            </span>
          );
        }) : activeSub.text}
      </div>
    );
  };

  // Scale: preview is ~270px wide (half of 540), video is 1080px wide

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Film size={20} className="text-purple-400" />
        <h2 className="text-lg font-semibold text-white">Video Preview Editor</h2>
        <span className="text-xs text-gray-500 ml-auto">Live CSS preview · 9:16 · 1080×1920</span>
      </div>

      <div className="flex gap-4" style={{ minHeight: 600 }}>
        {/* ── LEFT: Controls ── */}
        <div className="w-[320px] shrink-0 space-y-3">
          {/* Tabs */}
          <div className="flex gap-1 bg-[#0a0a0f] border border-[#1a1a2a] rounded-lg p-1">
            <button
              onClick={() => setActiveTab('templates')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded text-xs transition ${
                activeTab === 'templates' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <Layout size={13} /> Templates
            </button>
            <button
              onClick={() => setActiveTab('style')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded text-xs transition ${
                activeTab === 'style' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <Palette size={13} /> Style
            </button>
            <button
              onClick={() => setActiveTab('layout')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded text-xs transition ${
                activeTab === 'layout' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <Type size={13} /> Layout
            </button>
          </div>

          {/* ── Templates tab ── */}
          {activeTab === 'templates' && (
            <div className="space-y-2">
              {templates.map(tmpl => {
                const isSelected = templateId === tmpl.id;
                const fontCss = `'${tmpl.font}', sans-serif`;
                const colorCss = assToCss(tmpl.active_color);
                return (
                  <button
                    key={tmpl.id}
                    onClick={() => applyTemplate(tmpl)}
                    className={`w-full text-left p-3 rounded-xl border transition-all ${
                      isSelected
                        ? 'border-purple-500 bg-purple-500/10 ring-2 ring-purple-500/30'
                        : 'border-[#1a1a2a] bg-[#0a0a0f] hover:border-[#2a2a3a]'
                    }`}
                  >
                    {/* Mini preview */}
                    <div className="bg-black rounded-lg mb-2 flex items-center justify-center"
                         style={{ height: 60, position: 'relative', overflow: 'hidden' }}>
                      <div style={{
                        fontFamily: fontCss,
                        fontSize: 18,
                        color: colorCss,
                        fontWeight: tmpl.bold ? 'bold' : 'normal',
                        textShadow: tmpl.outline_width > 0 ? `0 0 ${tmpl.outline_width}px rgba(0,0,0,0.8)` : 'none',
                      }}>
                        {tmpl.name}
                      </div>
                      {tmpl.video_mode === 'blur' && (
                        <div className="absolute inset-0" style={{ backdropFilter: 'blur(2px)' }} />
                      )}
                    </div>
                    <div className="text-sm font-medium text-white">{tmpl.name}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{tmpl.description}</div>
                    <div className="flex items-center gap-2 mt-1.5 text-[10px] text-gray-600">
                      <span>{tmpl.font}</span>
                      <span>·</span>
                      <span>{tmpl.size}px</span>
                      <span>·</span>
                      <span style={{ color: colorCss }}>●</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Style tab ── */}
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
                  <option value="Arial">Arial</option>
                  <option value="Montserrat">Montserrat</option>
                  <option value="Oswald">Oswald</option>
                  <option value="Russo One">Russo One</option>
                  <option value="Pacifico">Pacifico</option>
                  <option value="Press Start 2P">Press Start 2P</option>
                  <option value="Impact">Impact</option>
                </select>
              </div>

              {/* Size */}
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Size: {style.size}px</label>
                <input
                  type="range" min={24} max={140} step={2}
                  value={style.size}
                  onChange={e => onStyleChange({ ...style, size: parseInt(e.target.value) })}
                  className="w-full accent-purple-500"
                />
              </div>

              {/* Primary color */}
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Inactive color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={assToCss(style.primary_color)}
                    onChange={e => onStyleChange({ ...style, primary_color: cssToAss(e.target.value) })}
                    className="w-10 h-8 rounded border border-[#2a2a3a] bg-transparent cursor-pointer"
                  />
                  <span className="text-xs text-gray-400 font-mono">{assToCss(style.primary_color)}</span>
                </div>
              </div>

              {/* Active color */}
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Active color (highlight)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={assToCss(style.active_color)}
                    onChange={e => onStyleChange({ ...style, active_color: cssToAss(e.target.value) })}
                    className="w-10 h-8 rounded border border-[#2a2a3a] bg-transparent cursor-pointer"
                  />
                  <span className="text-xs text-gray-400 font-mono">{assToCss(style.active_color)}</span>
                </div>
              </div>

              {/* Outline color */}
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Outline color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={assToCss(style.outline_color)}
                    onChange={e => onStyleChange({ ...style, outline_color: cssToAss(e.target.value) })}
                    className="w-10 h-8 rounded border border-[#2a2a3a] bg-transparent cursor-pointer"
                  />
                  <span className="text-xs text-gray-400 font-mono">{assToCss(style.outline_color)}</span>
                </div>
              </div>

              {/* Outline width */}
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Outline: {style.outline_width}px</label>
                <input
                  type="range" min={0} max={10} step={1}
                  value={style.outline_width}
                  onChange={e => onStyleChange({ ...style, outline_width: parseInt(e.target.value) })}
                  className="w-full accent-purple-500"
                />
              </div>

              {/* Bold */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={style.bold}
                  onChange={e => onStyleChange({ ...style, bold: e.target.checked })}
                  className="accent-purple-500"
                />
                <span className="text-xs text-gray-300">Bold</span>
              </label>
            </div>
          )}

          {/* ── Layout tab ── */}
          {activeTab === 'layout' && (
            <div className="space-y-3 bg-[#0a0a0f] border border-[#1a1a2a] rounded-xl p-3">
              {/* Position */}
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Position</label>
                <div className="flex gap-1">
                  {['top', 'center', 'bottom'].map(p => (
                    <button
                      key={p}
                      onClick={() => onStyleChange({ ...style, position: p as 'bottom' | 'center' | 'top' })}
                      className={`flex-1 px-2 py-1.5 rounded text-xs capitalize transition ${
                        style.position === p ? 'bg-purple-600 text-white' : 'bg-[#1a1a2a] text-gray-400'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Margin V */}
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Vertical margin: {style.margin_v}px</label>
                <input
                  type="range" min={0} max={400} step={10}
                  value={style.margin_v}
                  onChange={e => onStyleChange({ ...style, margin_v: parseInt(e.target.value) })}
                  className="w-full accent-purple-500"
                />
              </div>

              {/* Display mode */}
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Display mode</label>
                <select
                  value={displayMode}
                  onChange={e => onDisplayModeChange(e.target.value as 'auto' | 'line_highlight' | 'word_by_word' | 'single_word')}
                  className="w-full bg-[#0f0f17] border border-[#2a2a3a] rounded px-2 py-1.5 text-sm text-white outline-none focus:border-purple-500"
                >
                  <option value="line_highlight">Line highlight (full line, active word colored)</option>
                  <option value="word_by_word">Word by word (one word at a time, scaled)</option>
                  <option value="single_word">Single word (one word, no scale)</option>
                  <option value="auto">Auto (detect from template)</option>
                </select>
              </div>

              {/* Karaoke */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={karaoke}
                  onChange={e => onKaraokeChange(e.target.checked)}
                  className="accent-purple-500"
                />
                <span className="text-xs text-gray-300">Karaoke mode</span>
              </label>

              {/* Video info */}
              {videoInfo && (
                <div className="pt-2 border-t border-[#1a1a2a] space-y-1">
                  <div className="text-[10px] text-gray-500">Video: {videoInfo.width}×{videoInfo.height}</div>
                  <div className="text-[10px] text-gray-500">Fragments: {previewFragments.length}</div>
                  <div className="text-[10px] text-gray-500">Subtitles: {previewSubs.length} lines · {previewWords.length} words</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── CENTER: Video preview ── */}
        <div className="flex-1 flex flex-col items-center justify-start">
          {/* 9:16 preview frame */}
          <div
            className="relative bg-black rounded-xl overflow-hidden border border-[#2a2a3a] shadow-2xl"
            style={{
              width: 270,
              height: 480,
            }}
          >
            {preparing && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 text-sm gap-2 z-10">
                <Loader2 size={28} className="animate-spin text-purple-400" />
                <span>Preparing preview clip...</span>
                <span className="text-[10px] text-gray-600">Extracting {fragments.length} fragments</span>
              </div>
            )}
            {previewError && !preparing && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400 text-sm gap-2">
                <span>Preview failed: {previewError}</span>
              </div>
            )}
            {activeVideoUrl && !preparing ? (
              <>
                <video
                  ref={videoRef}
                  src={activeVideoUrl}
                  onTimeUpdate={onTimeUpdate}
                  onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => { setIsPlaying(false); if (audioRef.current) audioRef.current.pause(); }}
                  className="absolute inset-0 w-full h-full object-cover"
                  muted
                  playsInline
                />
                {activeAudioUrl && (
                  <audio ref={audioRef} src={activeAudioUrl} preload="auto" />
                )}
              </>
            ) : !preparing && !previewError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600 text-sm gap-2">
                <Film size={32} className="text-gray-700" />
                <span>No video loaded</span>
                <span className="text-[10px] text-gray-700">Go back to Step 1 to add a video</span>
              </div>
            )}

            {/* Subtitle overlay */}
            <div
              className="absolute inset-0 flex"
              style={{
                justifyContent: 'center',
                alignItems: POSITION_MAP[style.position] || 'flex-end',
                paddingBottom: style.position === 'bottom' ? `${style.margin_v * 0.25}px` : '0',
                paddingTop: style.position === 'top' ? `${style.margin_v * 0.25}px` : '0',
              }}
            >
              {renderSubtitles()}
            </div>

            {/* Blur overlay indicator */}
            {templateId && templates.find(t => t.id === templateId)?.video_mode === 'blur' && (
              <div className="absolute inset-0 pointer-events-none" style={{
                backdropFilter: 'blur(1px)',
                background: 'rgba(0,0,0,0.1)',
              }} />
            )}
          </div>

          {/* Transport controls */}
          <div className="flex items-center gap-3 mt-3">
            <button onClick={() => seekTo(currentTime - 5)} className="text-gray-400 hover:text-white transition">
              <SkipBack size={18} />
            </button>
            <button
              onClick={togglePlay}
              className="w-10 h-10 flex items-center justify-center bg-purple-600 hover:bg-purple-500 rounded-full transition"
            >
              {isPlaying ? <Pause size={18} className="text-white" /> : <Play size={18} className="text-white ml-0.5" />}
            </button>
            <button onClick={() => seekTo(currentTime + 5)} className="text-gray-400 hover:text-white transition">
              <SkipForward size={18} />
            </button>
            <span className="text-xs text-gray-400 font-mono ml-2">
              {/* Time: 0-based relative to audio_start */}
              {currentTime.toFixed(1)}s / {previewDuration.toFixed(1)}s
            </span>
          </div>

          {/* Timeline scrubber with fragments */}
          <div className="w-full max-w-md mt-3">
            {/* Fragment bar */}
            {previewFragments.length > 0 && (duration > 0 || previewDuration > 0) && (
              <div className="flex items-center gap-1 mb-1.5 text-[10px] text-gray-500">
                <span>Fragments:</span>
                {previewFragments.map((f: any, i: number) => (
                  <span key={i} className="px-1.5 py-0.5 rounded text-[9px] font-mono"
                        style={{
                          backgroundColor: activeFragment?.id === f.id ? 'rgba(168,85,247,0.3)' : 'rgba(30,30,50,0.5)',
                          color: activeFragment?.id === f.id ? '#c084fc' : '#666',
                        }}>
                    #{i+1} {f.start.toFixed(1)}-{f.end.toFixed(1)}s
                  </span>
                ))}
              </div>
            )}
            <div
              className="relative h-2 bg-[#0a0a0f] border border-[#1a1a2a] rounded-full cursor-pointer"
              onClick={e => {
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = (e.clientX - rect.left) / rect.width;
                seekTo(pct * duration);
              }}
            >
              <div
                className="absolute top-0 left-0 h-full bg-gradient-to-r from-purple-600 to-pink-500 rounded-full"
                style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
              />
              {/* Fragment markers */}
              {previewFragments.map((f: any) => (
                <div
                  key={f.id}
                  className="absolute top-0 h-full border-l border-r"
                  style={{
                    left: `${(duration || previewDuration) > 0 ? (f.start / (duration || previewDuration)) * 100 : 0}%`,
                    width: `${(duration || previewDuration) > 0 ? ((f.end - f.start) / (duration || previewDuration)) * 100 : 0}%`,
                    backgroundColor: activeFragment?.id === f.id ? 'rgba(168,85,247,0.25)' : 'rgba(30,80,160,0.15)',
                    borderColor: activeFragment?.id === f.id ? 'rgba(168,85,247,0.6)' : 'rgba(30,80,160,0.3)',
                  }}
                />
              ))}
              {/* Subtitle markers */}
              {previewSubs.map(s => (
                <div
                  key={s.id}
                  className="absolute top-0 h-full bg-yellow-500/20"
                  style={{
                    left: `${(duration || previewDuration) > 0 ? (s.start / (duration || previewDuration)) * 100 : 0}%`,
                    width: `${(duration || previewDuration) > 0 ? ((s.end - s.start) / (duration || previewDuration)) * 100 : 0}%`,
                  }}
                />
              ))}
            </div>
            {/* Legend */}
            <div className="flex items-center gap-3 mt-1 text-[9px] text-gray-600">
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-purple-500/30 rounded-sm" /> Fragment</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-yellow-500/20 rounded-sm" /> Subtitle</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 bg-purple-600 rounded-sm" /> Playhead</span>
            </div>
          </div>

          {/* Active subtitle info */}
          {activeSub && (
            <div className="mt-3 bg-[#0a0a0f] border border-[#1a1a2a] rounded-lg px-3 py-2 max-w-md w-full">
              <div className="text-[10px] text-gray-500 mb-0.5">
                Line #{activeSub.id + 1} · {activeSub.start.toFixed(2)}s → {activeSub.end.toFixed(2)}s
              </div>
              <div className="text-sm text-white" style={{ fontFamily: `'${style.font}', sans-serif` }}>
                {activeSub.text}
              </div>
              {activeWord && (
                <div className="text-xs mt-1" style={{ color: assToCss(style.active_color) }}>
                  → {activeWord.word} ({activeWord.start.toFixed(2)}s - {activeWord.end.toFixed(2)}s)
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT: Info & tips ── */}
        <div className="w-[200px] shrink-0 space-y-3">
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Eye size={13} className="text-blue-400" />
              <span className="text-xs text-blue-300 font-medium">Live Preview</span>
            </div>
            <p className="text-[10px] text-gray-400 leading-relaxed">
              CSS subtitle overlay in real-time. Play video to see subtitles animate with active word highlighting.
            </p>
          </div>

          <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-3">
            <div className="text-xs text-purple-300 font-medium mb-1.5">Current Style</div>
            <div className="space-y-1 text-[10px] text-gray-400">
              <div>Font: <span className="text-white">{style.font}</span></div>
              <div>Size: <span className="text-white">{style.size}px</span></div>
              <div>Position: <span className="text-white">{style.position}</span></div>
              <div>Mode: <span className="text-white">{displayMode}</span></div>
              <div>Active: <span style={{ color: assToCss(style.active_color) }}>●</span> <span className="text-gray-500 font-mono">{style.active_color}</span></div>
              <div>Karaoke: <span className="text-white">{karaoke ? 'ON' : 'OFF'}</span></div>
            </div>
          </div>

          {templateId && (
            <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-3">
              <div className="text-xs text-green-300 font-medium mb-1">Template Active</div>
              <div className="text-[10px] text-gray-400">
                {templates.find(t => t.id === templateId)?.name || templateId}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}