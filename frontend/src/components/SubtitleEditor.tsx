import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, Type, Mic, Sparkles, Play, Pause, Plus, X, Layout, Check } from 'lucide-react';
import { api } from '../api/client';
import type { Fragment, SubtitleLine, WordTiming, AudioInfo, SubtitleStyle, RenderTemplate } from '../types';
import { TimelinePreview } from './TimelinePreview';
import { PreviewFrame } from './PreviewFrame';
import { assToCss, cssToAss } from '../utils/colors';
import { useTemplates, applyTemplateToStyle } from '../utils/templates';
import { WORD_COLORS } from '../utils/constants';



interface Props {
  lyrics: string;
  fragments: Fragment[];
  subtitles: SubtitleLine[];
  onSubtitlesChange: (subs: SubtitleLine[]) => void;
  audioPath: string | null;
  wordTimings: WordTiming[];
  onWordTimingsChange: (timings: WordTiming[]) => void;
  karaoke: boolean;
  onKaraokeChange: (v: boolean) => void;
  displayMode: 'auto' | 'line_highlight' | 'word_by_word' | 'single_word';
  onDisplayModeChange: (v: 'auto' | 'line_highlight' | 'word_by_word' | 'single_word') => void;
  videoUrl?: string | null;
  onAudioStartChange?: (start: number) => void;
  style: SubtitleStyle;
  onStyleChange: (style: SubtitleStyle) => void;
  templateId?: string;
  onTemplateChange?: (id: string) => void;
  onApplyStyle?: (style: Partial<SubtitleStyle>) => void;
  onApplyTemplate?: (templateId: string) => void;
  onLyricsChange?: (text: string) => void;
  autoDetectedText?: string;
  onRangeChange?: (start: number, end: number) => void;
  active?: boolean;
  showStylePanel?: boolean;
  clipRange?: { start: number; end: number } | null;
}

export function SubtitleEditor({
  lyrics, fragments, subtitles, onSubtitlesChange,
  audioPath, wordTimings, onWordTimingsChange,
  karaoke, onKaraokeChange,
  displayMode, onDisplayModeChange,
  videoUrl, onAudioStartChange,
  style, onStyleChange,
  templateId, onTemplateChange,
  onApplyStyle: _onApplyStyle, onApplyTemplate: _onApplyTemplate,
  onLyricsChange, autoDetectedText: _autoDetectedText,
  onRangeChange, active = true, clipRange,
}: Props) {
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeLang, setTranscribeLang] = useState('ru');
  const [whisperModel, setWhisperModel] = useState('small');
  const [wordSplitLoading, setWordSplitLoading] = useState(false);
  const [audioInfo, setAudioInfo] = useState<AudioInfo | null>(null);
  const [, setAudioLoading] = useState(false);
  // ── Template popup state (templates loaded via useTemplates hook) ──
  const { templates } = useTemplates();
  const [showTemplatePopup, setShowTemplatePopup] = useState(false);
  const [previewThumb, setPreviewThumb] = useState<string | null>(null);

  // ── Load first frame thumbnail for template previews ──
  useEffect(() => {
    if (fragments.length > 0 && videoUrl && !previewThumb) {
      const firstFrag = fragments[0];
      api.getThumbnails(videoUrl, [firstFrag.start])
        .then(data => {
          if (data.thumbnails?.[0]?.path) {
            const filename = data.thumbnails[0].path.split('/').pop();
            if (filename) setPreviewThumb(api.thumbnailUrl(filename));
          }
        })
        .catch(() => {});
    }
  }, [fragments, videoUrl]);

  // ── Apply template (shared utility) ──
  const applyTemplate = (tmpl: RenderTemplate) => {
    applyTemplateToStyle(tmpl, onStyleChange, onDisplayModeChange, (id) => onTemplateChange?.(id));
    setShowTemplatePopup(false);
  };
  const [audioStart, setAudioStart] = useState(0);
  const [audioEnd, setAudioEnd] = useState(0);
  const [showWordEditor, setShowWordEditor] = useState(false);
  const [selectedWordIdx, setSelectedWordIdx] = useState(-1);

  // ── Full-track word timings (absolute timestamps from whisper) ──
  // Once transcribed, we filter these by audioStart/audioEnd locally
  const [fullTrackWords, setFullTrackWords] = useState<WordTiming[]>([]);
  const [hasFullTranscription, setHasFullTranscription] = useState(false);

  // ── Audio URL for preview ──
  const audioUrl = audioPath ? `/api/audio-preview/${audioPath.split('/').pop()}` : null;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playTime, setPlayTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // ── Load audio info ──
  // v3: If clipRange is already set (from Analysis step), use it — don't override with suggested
  useEffect(() => {
    if (audioPath && !audioInfo) {
      setAudioLoading(true);
      api.audioInfo(audioPath)
        .then(info => {
          setAudioInfo(info);
          if (clipRange) {
            // Use range from Analysis step
            setAudioStart(clipRange.start);
            setAudioEnd(clipRange.end);
            onAudioStartChange?.(clipRange.start);
          } else {
            // Fallback: use suggested range
            setAudioStart(info.suggested_start);
            setAudioEnd(info.suggested_end);
            onAudioStartChange?.(info.suggested_start);
          }
        })
        .catch(e => console.error('Audio info failed:', e))
        .finally(() => setAudioLoading(false));
    }
  }, [audioPath, audioInfo, onAudioStartChange, clipRange]);

  useEffect(() => {
    onAudioStartChange?.(audioStart);
  }, [audioStart, onAudioStartChange]);

  // ── Audio playback tracking + LOOP within selected range [audioStart, audioEnd] ──
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      setPlayTime(audio.currentTime);
      // Loop: when playback reaches the end of the selected range → jump back to range start
      // Guard: skip the jump while a programmatic seek is in progress (prevents
      // the "flaky playback" — seek fighting the loop-jump)
      if (audioEnd > audioStart && !audio.seeking && audio.currentTime >= audioEnd) {
        audio.currentTime = audioStart;
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
  }, [audioUrl, audioStart, audioEnd]);

  // ── Stop playback when leaving the Lyrics step (component stays mounted) ──
  useEffect(() => {
    if (!active) {
      audioRef.current?.pause();
    }
  }, [active]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      // Always start playback INSIDE the selected range (yellow runner)
      if (audioStart > 0 && (audio.currentTime < audioStart || audio.currentTime >= audioEnd)) {
        audio.currentTime = audioStart;
      }
      audio.play();
    }
  }, [isPlaying, audioStart, audioEnd]);

  const seekTo = useCallback((t: number) => {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = t;
      setPlayTime(t);
    }
  }, []);

  // ── Transcribe ENTIRE track once + filter by range locally ──
  const [transcribeStatus, setTranscribeStatus] = useState<{ label: string; progress: number; elapsed?: number } | null>(null);

  const handleTranscribe = async () => {
    if (!audioPath) return;
    setTranscribing(true);
    setTranscribeStatus({ label: 'Starting...', progress: 0 });

    try {
      // ── v3: Transcribe ONLY the selected segment (e.g. 37s, not full 5-min track) ──
      const clipLen = audioEnd - audioStart;
      const result = await api.transcribeFullStream(
        audioPath, transcribeLang, lyrics, whisperModel,
        (data) => setTranscribeStatus({ label: data.label, progress: data.progress, elapsed: data.elapsed }),
        audioStart,  // clip_start = range start
        clipLen,     // clip_length = range duration
      );

      // Word timestamps are already shifted to absolute (clip_start offset) in backend
      setFullTrackWords(result.words);
      setHasFullTranscription(true);
      const filtered = filterWordsByRange(result.words, audioStart, audioEnd);
      onWordTimingsChange(filtered);
      regenSubtitles(filtered);

      setShowWordEditor(true);
    } catch (e) {
      console.error('Transcribe failed:', e);
    } finally {
      setTranscribing(false);
      setTranscribeStatus(null);
    }
  };

  // ── Filter absolute word timings to selected range → video-relative ──
  const filterWordsByRange = (allWords: WordTiming[], start: number, end: number): WordTiming[] => {
    return allWords
      .filter(w => w.end > start && w.start < end)  // word overlaps with [start, end]
      .map(w => ({
        ...w,
        start: Math.max(0, w.start - start),  // convert to video-relative (0-based)
        end: Math.max(0, w.end - start),
      }));
  };

  // ── When range changes, re-filter locally (NO API call!) ──
  const handleRangeChange = (start: number, end: number) => {
    setAudioStart(start);
    setAudioEnd(end);
    onRangeChange?.(start, end);
    
    if (hasFullTranscription && fullTrackWords.length > 0) {
      // Filter locally — instant, no server round-trip
      const filtered = filterWordsByRange(fullTrackWords, start, end);
      onWordTimingsChange(filtered);
      
      // Regenerate subtitles from filtered words
      if (lyrics && fragments.length > 0) {
        api.wordSplitSubtitles(lyrics, fragments, filtered, 0)
          .then(r => onSubtitlesChange(r.subtitles))
          .catch(e => console.error('Word split failed:', e));
      }
    }
    
    onAudioStartChange?.(start);
  };

  // ── Word Split (even distribution) ──
  const handleWordSplit = async () => {
    if (fragments.length === 0) return;
    setWordSplitLoading(true);
    try {
      const result = await api.wordSplitSubtitles(
        lyrics, fragments,
        wordTimings.length > 0 ? wordTimings : undefined,
        0,  // audio_start=0, word timings already on video timeline
      );
      onSubtitlesChange(result.subtitles);
    } catch (e) {
      console.error('Word split failed:', e);
    } finally {
      setWordSplitLoading(false);
    }
  };

  // ── Per-word edit (with live subtitle regen) ──
  const updateWordTiming = (idx: number, field: 'start' | 'end' | 'word', value: string | number) => {
    const updated = wordTimings.map((w, i) =>
      i === idx ? { ...w, [field]: value } : w
    );
    onWordTimingsChange(updated);
    // Live regen subtitles from updated word timings (word-split does not need fragments)
    regenSubtitles(updated);
  };

  const deleteWord = (idx: number) => {
    const updated = wordTimings.filter((_, i) => i !== idx);
    onWordTimingsChange(updated);
    regenSubtitles(updated);
  };

  // ── Rebuild subtitles from word timings (no fragments needed — timestamps are authoritative) ──
  const regenSubtitles = (words: WordTiming[]) => {
    if (words.length === 0) {
      onSubtitlesChange([]);
      return;
    }
    // Group by natural pauses (gap > 0.4s) or max 8 words per line — mirrors backend logic
    const lines: SubtitleLine[] = [];
    let cur: WordTiming[] = [];
    for (const w of words) {
      if (cur.length > 0) {
        const gap = w.start - cur[cur.length - 1].end;
        if (gap > 0.4 || cur.length >= 8) {
          lines.push({ id: lines.length, start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map(x => x.word).join(' '), words: [...cur] });
          cur = [];
        }
      }
      cur.push(w);
    }
    if (cur.length > 0) lines.push({ id: lines.length, start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map(x => x.word).join(' '), words: [...cur] });
    onSubtitlesChange(lines);
  };

  const insertWord = (idx: number) => {
    const prevEnd = idx > 0 ? wordTimings[idx - 1].end : 0;
    const nextStart = idx < wordTimings.length ? wordTimings[idx].start : prevEnd + 0.5;
    const midTime = (prevEnd + nextStart) / 2;
    const dur = Math.max(0.2, (nextStart - prevEnd) / 4);
    const newWord: WordTiming = {
      word: '...',
      start: Math.round(midTime * 1000) / 1000,
      end: Math.round((midTime + dur) * 1000) / 1000,
    };
    const updated = [...wordTimings];
    updated.splice(idx, 0, newWord);
    onWordTimingsChange(updated);
    regenSubtitles(updated);
  };

  // ── Active word for karaoke highlight ──
  const activeWordIndex = wordTimings.findIndex(w =>
    playTime - audioStart >= w.start && playTime - audioStart <= w.end
  );

  // ── LEFT COLUMN: Style Controls Panel ──

  // ── LEFT COLUMN: Style Controls Panel ──
  const stylePanel = (
    <div className="space-y-3">
      {/* Templates button + popup */}
      {templates.length > 0 && (
        <>
          <button
            onClick={() => setShowTemplatePopup(true)}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition ${
              templateId
                ? 'bg-purple-600/20 border border-purple-500/40 text-purple-300'
                : 'bg-gradient-to-r from-purple-600/10 to-pink-600/10 border border-purple-500/20 text-gray-300 hover:border-purple-500/40'
            }`}
          >
            <Layout size={14} />
            {templateId ? `Template: ${templates.find(t => t.id === templateId)?.name || 'Selected'}` : 'Choose Template'}
          </button>

          {/* Template Popup Modal */}
          {showTemplatePopup && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
              onClick={() => setShowTemplatePopup(false)}
            >
              <div
                className="bg-[#0f0f17] border border-[#2a2a3a] rounded-2xl p-5 max-w-2xl w-full mx-4 max-h-[85vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-bold text-white">Render Templates</h3>
                  <button
                    onClick={() => setShowTemplatePopup(false)}
                    className="text-gray-500 hover:text-gray-300"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {templates.map(tmpl => {
                    const isSelected = templateId === tmpl.id;
                    // Convert ASS BGR color to CSS RGB for preview
                    const activeCss = assToCss(tmpl.active_color);
                    const primaryCss = assToCss(tmpl.primary_color);
                    // CSS filter per video_mode
                    let bgFilter = 'none';
                    let imgClass = 'absolute inset-0 w-full h-full object-cover';
                    if (tmpl.video_mode === 'crop_fill') {
                      bgFilter = 'none';
                      imgClass = 'absolute inset-0 w-full h-full object-cover';
                    } else if (tmpl.video_mode === 'fit_blur_dark') {
                      bgFilter = `blur(${Math.round(tmpl.blur_sigma / 3)}px) brightness(${1 - tmpl.dark_overlay * 0.5}) contrast(0.8)`;
                    } else {
                      bgFilter = `blur(${Math.round(tmpl.blur_sigma / 3)}px)`;
                    }
                    // Scale transform for "floating" look
                    const scaleStyle = tmpl.scale_factor < 1.0
                      ? { transform: `scale(${tmpl.scale_factor})` }
                      : {};

                    return (
                      <button
                        key={tmpl.id}
                        onClick={() => applyTemplate(tmpl)}
                        className={`relative rounded-xl overflow-hidden border-2 transition group ${
                          isSelected ? 'border-purple-500' : 'border-[#2a2a3a] hover:border-purple-500/50'
                        }`}
                      >
                        {/* Preview thumbnail (9:16 mini) with real video frame */}
                        <div
                          className="relative aspect-[9/16] flex items-center justify-center overflow-hidden"
                          style={{ background: '#0a0a0f' }}
                        >
                          {previewThumb ? (
                            <>
                              {tmpl.video_mode === 'crop_fill' ? (
                                /* crop_fill: full screen zoomed video, no blur */
                                <img
                                  src={previewThumb}
                                  alt=""
                                  className={imgClass}
                                  style={{ filter: bgFilter, ...scaleStyle }}
                                />
                              ) : (
                                /* fit_blur / fit_blur_dark: blurred bg + clear centered video */
                                <>
                                  <img
                                    src={previewThumb}
                                    alt=""
                                    className="absolute inset-0 w-full h-full object-cover"
                                    style={{ filter: bgFilter }}
                                  />
                                  <img
                                    src={previewThumb}
                                    alt=""
                                    className="absolute inset-0 w-full h-full object-contain"
                                    style={{ ...scaleStyle, zIndex: 2 }}
                                  />
                                </>
                              )}
                            </>
                          ) : (
                            <div
                              className="absolute inset-0"
                              style={{
                                background: `radial-gradient(circle at 50% 40%, rgba(100,60,200,0.3), transparent 70%)`,
                                filter: `blur(${Math.round(tmpl.blur_sigma / 3)}px)`,
                              }}
                            />
                          )}
                          {/* Dark overlay */}
                          {tmpl.dark_overlay > 0 && (
                            <div
                              className="absolute inset-0 bg-black"
                              style={{ opacity: tmpl.dark_overlay }}
                            />
                          )}
                          {/* Sample text — positioned like the real render */}
                          <div
                            className={`relative z-10 text-center px-2 ${tmpl.position === 'bottom' ? 'absolute bottom-4 left-0 right-0' : ''} ${tmpl.position === 'top' ? 'absolute top-4 left-0 right-0' : ''}`}
                          >
                            <span
                              style={{
                                fontFamily: `'${tmpl.font}', sans-serif`,
                                fontSize: `${Math.max(10, tmpl.size / 5)}px`,
                                color: primaryCss,
                                textShadow: `0 0 ${tmpl.blur_sigma > 30 ? '8px' : '4px'} ${activeCss}, 0 2px 4px rgba(0,0,0,0.8)`,
                                fontWeight: 'bold',
                                display: 'block',
                                lineHeight: '1.2',
                              }}
                            >
                              Где то там
                            </span>
                            <span
                              style={{
                                fontFamily: `'${tmpl.font}', sans-serif`,
                                fontSize: `${Math.max(12, tmpl.size / 4)}px`,
                                color: activeCss,
                                textShadow: `0 0 6px ${activeCss}, 0 2px 4px rgba(0,0,0,0.8)`,
                                fontWeight: 'bold',
                                display: 'block',
                                lineHeight: '1.2',
                                marginTop: '2px',
                              }}
                            >
                              ангелы
                            </span>
                          </div>
                        </div>

                        {/* Template info */}
                        <div className="p-2 bg-[#0a0a0f]">
                          <div className="text-xs font-bold text-white flex items-center gap-1">
                            {isSelected && <Check size={12} className="text-purple-400" />}
                            {tmpl.name}
                          </div>
                          <div className="text-[9px] text-gray-500 leading-tight mt-0.5">{tmpl.description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Clear template button */}
                {templateId && (
                  <button
                    onClick={() => {
                      onTemplateChange?.('');
                      setShowTemplatePopup(false);
                    }}
                    className="mt-4 w-full py-2 text-xs text-gray-500 hover:text-gray-300 border border-[#2a2a3a] rounded-lg"
                  >
                    ✕ Clear template — use custom style
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Style Controls — always visible (not collapsible) */}
      <div className="bg-pink-500/5 border border-pink-500/20 rounded-xl p-3 space-y-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-pink-300">🎨 Style Controls</span>
          <span className="text-[10px] text-gray-500 ml-auto">
            {style.font} · {style.position} · {style.size}px
          </span>
        </div>

        {/* Font selector */}
        <div className="space-y-1">
          <label className="text-[10px] text-gray-500 uppercase tracking-wide">Font</label>
          <select
            value={style.font}
            onChange={e => onStyleChange({ ...style, font: e.target.value })}
            className="w-full bg-[#0a0a0f] border border-[#2a2a3a] rounded px-2 py-1.5 text-xs text-gray-200"
          >
            {['Arial', 'Montserrat', 'Oswald', 'Russo One', 'Pacifico', 'Press Start 2P'].map(f =>
              <option key={f} value={f}>{f}</option>
            )}
          </select>
        </div>

        {/* Position */}
        <div className="space-y-1">
          <label className="text-[10px] text-gray-500 uppercase tracking-wide">Position</label>
          <select
            value={style.position}
            onChange={e => onStyleChange({ ...style, position: e.target.value as 'bottom' | 'center' | 'top' })}
            className="w-full bg-[#0a0a0f] border border-[#2a2a3a] rounded px-2 py-1.5 text-xs text-gray-200"
          >
            <option value="bottom">↓ Bottom</option>
            <option value="center">↕ Center</option>
            <option value="top">↑ Top</option>
          </select>
        </div>

        {/* Size */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-[10px] text-gray-500 uppercase tracking-wide">Size</label>
            <span className="text-pink-300 font-mono text-xs">{style.size}px</span>
          </div>
          <input
            type="range" min="36" max="120"
            value={style.size}
            onChange={e => onStyleChange({ ...style, size: parseInt(e.target.value) })}
            className="w-full accent-pink-500"
          />
        </div>

        {/* Margin */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-[10px] text-gray-500 uppercase tracking-wide">Margin V</label>
            <span className="text-pink-300 font-mono text-xs">{style.margin_v}px</span>
          </div>
          <input
            type="range" min="0" max="400"
            value={style.margin_v}
            onChange={e => onStyleChange({ ...style, margin_v: parseInt(e.target.value) })}
            className="w-full accent-pink-500"
          />
        </div>

        {/* Outline Width */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-[10px] text-gray-500 uppercase tracking-wide">Outline</label>
            <span className="text-pink-300 font-mono text-xs">{style.outline_width}</span>
          </div>
          <input
            type="range" min="0" max="10"
            value={style.outline_width}
            onChange={e => onStyleChange({ ...style, outline_width: parseInt(e.target.value) })}
            className="w-full accent-pink-500"
          />
        </div>

        {/* Colors */}
        <div className="space-y-1">
          <label className="text-[10px] text-gray-500 uppercase tracking-wide">Colors</label>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <input
                type="color"
                value={assToCss(style.active_color)}
                onChange={e => onStyleChange({ ...style, active_color: cssToAss(e.target.value) })}
                className="w-8 h-8 bg-transparent border border-[#2a2a3a] rounded cursor-pointer"
                title="Active word color"
              />
              <span className="text-[10px] text-gray-500">Active</span>
            </div>
            <div className="flex items-center gap-1">
              <input
                type="color"
                value={assToCss(style.primary_color)}
                onChange={e => onStyleChange({ ...style, primary_color: cssToAss(e.target.value) })}
                className="w-8 h-8 bg-transparent border border-[#2a2a3a] rounded cursor-pointer"
                title="Text color"
              />
              <span className="text-[10px] text-gray-500">Text</span>
            </div>
            <div className="flex items-center gap-1">
              <input
                type="color"
                value={assToCss(style.outline_color)}
                onChange={e => onStyleChange({ ...style, outline_color: cssToAss(e.target.value) })}
                className="w-8 h-8 bg-transparent border border-[#2a2a3a] rounded cursor-pointer"
                title="Outline color"
              />
              <span className="text-[10px] text-gray-500">Outline</span>
            </div>
          </div>
        </div>

        {/* Bold toggle */}
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={style.bold}
            onChange={e => onStyleChange({ ...style, bold: e.target.checked })}
            className="w-3.5 h-3.5 accent-pink-500"
          />
          Bold
        </label>
      </div>

      {/* Display Mode + Karaoke toggle */}
      <div className="bg-[#0f0f17] border border-[#1a1a2a] rounded-xl p-3 space-y-2.5">
        {/* Karaoke toggle */}
        <button
          onClick={() => onKaraokeChange(!karaoke)}
          className={`flex items-center gap-1.5 w-full px-3 py-2 rounded-lg text-sm transition ${
            karaoke ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400'
          }`}
        >
          <Sparkles size={14} />
          Karaoke {karaoke ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  );


  // ── CENTER COLUMN: Main editing content ──
  const centerContent = (
    <div className="space-y-4 min-w-0">
      {/* ── Top: Unified Timeline + Audio Player ── */}
      {audioPath && audioInfo && (
        <div className="bg-[#0f0f17] border border-[#1a1a2a] rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={togglePlay}
              className="p-1.5 rounded-full bg-purple-600 hover:bg-purple-500 transition"
            >
              {isPlaying ? <Pause size={14} className="text-white" /> : <Play size={14} className="text-white" />}
            </button>
            <span className="text-sm text-gray-300 font-mono">
              {playTime.toFixed(1)}s / {audioInfo.duration.toFixed(1)}s
            </span>
            {audioInfo && (
              <span className="ml-auto text-xs text-gray-500">
                ♩ {audioInfo.bpm} BPM
                {audioInfo.bpm_raw != null && audioInfo.bpm_raw !== audioInfo.bpm && (
                  <span className="text-gray-600"> (raw: {audioInfo.bpm_raw})</span>
                )}
              </span>
            )}
          </div>
          <TimelinePreview
            fragments={fragments}
            subtitles={subtitles}
            audioUrl={audioUrl}
            videoUrl={videoUrl}
            wordTimings={wordTimings}
            audioInfo={audioInfo}
            audioStart={audioStart}
            audioEnd={audioEnd}
            onRangeChange={handleRangeChange}
            onWordTimingsChange={(timings) => {
              onWordTimingsChange(timings);
              // Live regen subtitles from timeline edits too (local, no API needed)
              if (timings.length === 0) {
                onSubtitlesChange([]);
                return;
              }
              const lines: SubtitleLine[] = [];
              let cur: WordTiming[] = [];
              for (const w of timings) {
                if (cur.length > 0) {
                  const gap = w.start - cur[cur.length - 1].end;
                  if (gap > 0.4 || cur.length >= 8) {
                    lines.push({ id: lines.length, start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map(x => x.word).join(' '), words: [...cur] });
                    cur = [];
                  }
                }
                cur.push(w);
              }
              if (cur.length > 0) lines.push({ id: lines.length, start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map(x => x.word).join(' '), words: [...cur] });
              onSubtitlesChange(lines);
            }}
            onSeek={seekTo}
            currentTime={playTime}
            isPlaying={isPlaying}
            onPlayPause={togglePlay}
          />
        </div>
      )}

      {/* ── Lyrics textarea (optional — used as alignment hint for WhisperX) ── */}
      {audioPath && (
        <div className="bg-white/5 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">📝 Lyrics (optional — improves alignment accuracy)</span>
            {lyrics.trim() && (
              <span className="text-[10px] text-green-400">✓ {lyrics.trim().split(/\s+/).length} words</span>
            )}
          </div>
          <textarea
            value={lyrics}
            onChange={(e) => onLyricsChange?.(e.target.value)}
            placeholder="Paste lyrics here for better transcription accuracy..."
            className="w-full h-20 bg-[#0a0a0f] border border-[#2a2a3a] rounded-lg px-3 py-2 text-sm text-gray-200 resize-none focus:border-purple-500 focus:outline-none"
          />
        </div>
      )}

      {/* ── Transcribe controls (compact, no audio range — use yellow slider) ── */}
      {audioPath && (
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={transcribeLang}
              onChange={e => setTranscribeLang(e.target.value)}
              className="bg-[#0a0a0f] border border-[#2a2a3a] rounded-lg px-2 py-1.5 text-xs text-gray-200"
            >
              <option value="ru">🇷🇺 RU</option>
              <option value="en">🇬🇧 EN</option>
              <option value="auto">🌍 Auto</option>
            </select>
            <select
              value={whisperModel}
              onChange={e => setWhisperModel(e.target.value)}
              className="bg-[#0a0a0f] border border-[#2a2a3a] rounded-lg px-2 py-1.5 text-xs text-gray-200"
              title="WhisperX model size — bigger = more accurate but slower"
            >
              <option value="small">⚡ small (~48s)</option>
              <option value="medium">🔷 medium (~103s)</option>
              <option value="large-v3">🧠 large-v3 (~160s)</option>
            </select>
            <button
              onClick={handleTranscribe}
              disabled={transcribing}
              className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition disabled:opacity-40"
            >
              {transcribing ? <Loader2 size={12} className="animate-spin" /> : <Mic size={12} />}
              {hasFullTranscription ? '✓ Re-transcribe' : (lyrics.trim() ? 'Transcribe & Align' : 'Transcribe')}
            </button>
            {wordTimings.length > 0 && (
              <span className="text-xs text-green-400">
                ✓ {wordTimings.length} words{hasFullTranscription ? ' (filtered)' : ''}
              </span>
            )}
            {hasFullTranscription && (
              <span className="text-xs text-blue-400">📜 Full track — drag yellow slider to filter</span>
            )}
          </div>
        </div>
      )}

      {/* ── Transcription progress bar ── */}
      {transcribing && transcribeStatus && (
        <div className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Loader2 size={14} className="animate-spin text-purple-400" />
            <span className="text-xs text-purple-300 font-medium">{transcribeStatus.label}</span>
            {transcribeStatus.elapsed != null && (
              <span className="text-[10px] text-gray-500 ml-auto font-mono">
                {transcribeStatus.elapsed}s elapsed
              </span>
            )}
          </div>
          <div className="relative h-2 bg-[#0a0a0f] rounded-full overflow-hidden">
            <div
              className="absolute top-0 left-0 h-full bg-gradient-to-r from-purple-600 to-pink-500 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${transcribeStatus.progress}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-gray-500">
            <span>{transcribeStatus.progress}%</span>
            <span>
              {transcribeStatus.progress > 0 && transcribeStatus.elapsed != null
                ? `~ETA ${Math.round((transcribeStatus.elapsed / transcribeStatus.progress) * (100 - transcribeStatus.progress))}s`
                : 'Calculating...'}
            </span>
          </div>
        </div>
      )}

      {/* ── Word Split + Edit Words toolbar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={handleWordSplit}
          disabled={wordSplitLoading || fragments.length === 0}
          className="flex items-center gap-1.5 px-3 py-2 bg-purple-600/50 hover:bg-purple-500/50 rounded-lg text-sm text-purple-200 transition disabled:opacity-40"
        >
          {wordSplitLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Word Split {wordTimings.length > 0 ? '(synced)' : '(even)'}
        </button>
        {wordTimings.length > 0 && (
          <button
            onClick={() => setShowWordEditor(!showWordEditor)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition ${
              showWordEditor ? 'bg-orange-600/50 text-orange-200' : 'bg-gray-800 text-gray-400'
            }`}
          >
            <Type size={14} />
            Edit Words
          </button>
        )}
        <span className="text-xs text-gray-500 ml-auto">
          {subtitles.length} lines
        </span>
      </div>

      {/* ── Word Editor: Left (word chips by line) + Right (edit panel) ── */}
      {showWordEditor && wordTimings.length > 0 && (
        <div className="bg-[#0f0f17] border border-[#1a1a2a] rounded-xl p-3">
          <div className="flex gap-3" style={{ minHeight: 220, maxHeight: 320 }}>
            {/* LEFT: Word chips grouped by subtitle lines */}
            <div className="flex-1 min-w-0 overflow-y-auto pr-2 space-y-1.5">
              <div className="text-[10px] text-gray-500 mb-1 flex items-center gap-2">
                <span>📝 Words by line</span>
                <span className="text-gray-700">· click to edit</span>
              </div>
              {subtitles.length > 0 ? (
                subtitles.map((sub, lineIdx) => {
                  const lineColor = WORD_COLORS[lineIdx % WORD_COLORS.length];
                  const lineWords = sub.words && sub.words.length > 0
                    ? wordTimings.filter(w => sub.words!.some(sw => sw.word === w.word && Math.abs(sw.start - w.start) < 0.01))
                    : wordTimings.filter(w => w.start >= sub.start - 0.01 && w.end <= sub.end + 0.01);
                  if (lineWords.length === 0) return null;
                  return (
                    <div key={sub.id} className="flex flex-wrap gap-1 items-center">
                      <span className="text-[9px] text-gray-600 font-mono mr-1">#{sub.id + 1}</span>
                      {lineWords.map(w => {
                        const wordIdx = wordTimings.indexOf(w);
                        const isActive = wordIdx === activeWordIndex;
                        const isSelected = wordIdx === selectedWordIdx;
                        return (
                          <button
                            key={wordIdx}
                            onClick={() => { setSelectedWordIdx(wordIdx); seekTo(w.start + audioStart); }}
                            className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${
                              isSelected
                                ? 'ring-2 ring-yellow-400 text-white scale-105'
                                : isActive
                                ? 'bg-yellow-500/30 text-yellow-200 ring-1 ring-yellow-500/50'
                                : 'hover:scale-105'
                            }`}
                            style={
                              isSelected || isActive
                                ? undefined
                                : {
                                    backgroundColor: `${lineColor}25`,
                                    color: lineColor,
                                    border: `1px solid ${lineColor}40`,
                                  }
                            }
                            title={`${w.start.toFixed(2)}s → ${w.end.toFixed(2)}s${w.probability ? ` · p=${w.probability.toFixed(2)}` : ''}`}
                          >
                            {w.word}
                          </button>
                        );
                      })}
                    </div>
                  );
                })
              ) : (
                // No subtitles yet — show all words in one row
                <div className="flex flex-wrap gap-1">
                  {wordTimings.map((w, i) => {
                    const isActive = i === activeWordIndex;
                    const isSelected = i === selectedWordIdx;
                    const color = WORD_COLORS[i % WORD_COLORS.length];
                    return (
                      <button
                        key={i}
                        onClick={() => { setSelectedWordIdx(i); seekTo(w.start + audioStart); }}
                        className={`px-2 py-1 rounded-md text-xs font-medium transition-all ${
                          isSelected
                            ? 'ring-2 ring-yellow-400 text-white scale-105'
                            : isActive
                            ? 'bg-yellow-500/30 text-yellow-200 ring-1 ring-yellow-500/50'
                            : 'hover:scale-105'
                        }`}
                        style={
                          isSelected || isActive
                            ? undefined
                            : { backgroundColor: `${color}25`, color, border: `1px solid ${color}40` }
                        }
                        title={`${w.start.toFixed(2)}s → ${w.end.toFixed(2)}s`}
                      >
                        {w.word}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="w-px bg-[#1a1a2a]" />

            {/* RIGHT: Word edit panel */}
            <div className="w-[240px] shrink-0 space-y-2.5">
              {selectedWordIdx >= 0 && wordTimings[selectedWordIdx] ? (
                (() => {
                  const w = wordTimings[selectedWordIdx];
                  return (
                    <>
                      <div className="text-[10px] text-gray-500 flex items-center justify-between">
                        <span>✏️ Edit word #{selectedWordIdx + 1}</span>
                        <span className="text-gray-700">{wordTimings.length} total</span>
                      </div>

                      {/* Large word display */}
                      <div className="bg-[#0a0a0f] border border-[#2a2a3a] rounded-lg p-2.5 text-center">
                        <input
                          type="text"
                          value={w.word}
                          onChange={e => updateWordTiming(selectedWordIdx, 'word', e.target.value)}
                          className="w-full bg-transparent text-center text-lg font-bold text-white outline-none border-b border-transparent focus:border-purple-500 transition"
                          placeholder="word..."
                        />
                      </div>

                      {/* Timing */}
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <label className="text-[10px] text-gray-500 w-10">Start</label>
                          <input
                            type="number" step={0.01}
                            value={w.start}
                            onChange={e => updateWordTiming(selectedWordIdx, 'start', parseFloat(e.target.value) || 0)}
                            className="flex-1 bg-[#0a0a0f] border border-[#2a2a3a] rounded px-2 py-1 text-xs text-blue-400 font-mono outline-none focus:border-blue-500"
                          />
                          <span className="text-[10px] text-gray-600">s</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="text-[10px] text-gray-500 w-10">End</label>
                          <input
                            type="number" step={0.01}
                            value={w.end}
                            onChange={e => updateWordTiming(selectedWordIdx, 'end', parseFloat(e.target.value) || 0)}
                            className="flex-1 bg-[#0a0a0f] border border-[#2a2a3a] rounded px-2 py-1 text-xs text-blue-400 font-mono outline-none focus:border-blue-500"
                          />
                          <span className="text-[10px] text-gray-600">s</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="text-[10px] text-gray-500 w-10">Dur</label>
                          <span className="flex-1 text-xs text-gray-400 font-mono px-2 py-1">
                            {(w.end - w.start).toFixed(3)}s
                          </span>
                        </div>
                        {w.probability !== undefined && (
                          <div className="flex items-center gap-2">
                            <label className="text-[10px] text-gray-500 w-10">Conf</label>
                            <div className="flex-1 flex items-center gap-1.5">
                              <div className="flex-1 h-1.5 bg-[#1a1a2a] rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    w.probability > 0.8 ? 'bg-green-500' : w.probability > 0.5 ? 'bg-yellow-500' : 'bg-red-500'
                                  }`}
                                  style={{ width: `${Math.round(w.probability * 100)}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-gray-400 font-mono w-8">{(w.probability * 100).toFixed(0)}%</span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="grid grid-cols-2 gap-1.5 pt-1">
                        <button
                          onClick={() => seekTo(w.start + audioStart)}
                          className="flex items-center justify-center gap-1 px-2 py-1.5 bg-purple-600/30 hover:bg-purple-500/40 rounded-lg text-xs text-purple-200 transition"
                        >
                          <Play size={11} /> Play
                        </button>
                        <button
                          onClick={() => insertWord(selectedWordIdx)}
                          className="flex items-center justify-center gap-1 px-2 py-1.5 bg-green-600/20 hover:bg-green-500/30 rounded-lg text-xs text-green-300 transition"
                        >
                          <Plus size={11} /> Insert
                        </button>
                        <button
                          onClick={() => {
                            if (selectedWordIdx > 0) {
                              setSelectedWordIdx(selectedWordIdx - 1);
                              seekTo(wordTimings[selectedWordIdx - 1].start + audioStart);
                            }
                          }}
                          disabled={selectedWordIdx === 0}
                          className="flex items-center justify-center gap-1 px-2 py-1.5 bg-gray-700/40 hover:bg-gray-600/50 rounded-lg text-xs text-gray-300 transition disabled:opacity-30"
                        >
                          ← Prev
                        </button>
                        <button
                          onClick={() => {
                            if (selectedWordIdx < wordTimings.length - 1) {
                              setSelectedWordIdx(selectedWordIdx + 1);
                              seekTo(wordTimings[selectedWordIdx + 1].start + audioStart);
                            }
                          }}
                          disabled={selectedWordIdx === wordTimings.length - 1}
                          className="flex items-center justify-center gap-1 px-2 py-1.5 bg-gray-700/40 hover:bg-gray-600/50 rounded-lg text-xs text-gray-300 transition disabled:opacity-30"
                        >
                          Next →
                        </button>
                      </div>
                      <button
                        onClick={() => { deleteWord(selectedWordIdx); setSelectedWordIdx(-1); }}
                        className="w-full flex items-center justify-center gap-1 px-2 py-1.5 bg-red-600/20 hover:bg-red-500/30 rounded-lg text-xs text-red-300 transition"
                      >
                        <X size={11} /> Delete word
                      </button>
                    </>
                  );
                })()
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center gap-2">
                  <Type size={24} className="text-gray-700" />
                  <p className="text-xs text-gray-500">Click a word on the left to edit</p>
                  <p className="text-[10px] text-gray-700">text · timing · confidence</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Words is the only way to view/edit subtitles now ── */}
      {subtitles.length === 0 && wordTimings.length === 0 && (
        <div className="text-center py-8 text-gray-500 text-sm">
          {audioPath
            ? (hasFullTranscription
                ? '✅ Full track transcribed — drag yellow slider to filter words'
                : 'Click "Transcribe & Align" — recognizes FULL track, then filters by range')
            : 'Upload audio → paste lyrics → Transcribe & Align (full track)'}
        </div>
      )}
    </div>
  );

  // ── RIGHT COLUMN: Large video preview ──
  const rightColumn = (
    <PreviewFrame
      subtitles={subtitles}
      wordTimings={wordTimings}
      displayMode={displayMode}
      style={style}
      audioStart={audioStart}
      currentTime={playTime}
      isPlaying={isPlaying}
      onPlayPause={togglePlay}
    />
  );

  return (
    <div className="space-y-4">
      {/* Hidden audio element for playback */}
      {audioUrl && (
        <audio ref={audioRef} src={audioUrl} preload="metadata" />
      )}

      {/* ── 3-column desktop layout (≥1024px) / single column mobile (<1024px) ── */}
      <div className="flex flex-col lg:flex-row gap-5">
        {/* LEFT: Style controls + display mode + karaoke (~260px) */}
        <div className="lg:w-[260px] lg:shrink-0">
          {stylePanel}
        </div>

        {/* CENTER: Audio + timeline + transcribe + sync + subtitles (flex-1) */}
        <div className="flex-1 min-w-0">
          {centerContent}
        </div>

        {/* RIGHT: Large 9:16 video preview (~380px) */}
        <div className="lg:w-[380px] lg:shrink-0">
          {rightColumn}
        </div>
      </div>
    </div>
  );
}