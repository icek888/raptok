import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, SkipBack, SkipForward, Film } from 'lucide-react';
import type {
  Fragment, SubtitleLine, SubtitleStyle, WordTiming, VideoInfo,
  BPMResult, RenderTemplate,
} from '../types';
import { FragmentRail } from './FragmentRail';
import { assToCss, cssToAss } from '../utils/colors';
import { useTemplates, applyTemplateToStyle } from '../utils/templates';

interface Props {
  videoInfo: VideoInfo;
  videoUrl: string | null;
  fragments: Fragment[];
  onFragmentsChange: (fragments: Fragment[]) => void;
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
  segmentDuration: number;
  bpmData: BPMResult | null;
  beatEffectsOn: boolean;
  onBeatEffectsToggle: (on: boolean) => void;
  onIntensityChange: (type: 'zoom' | 'flash' | 'shake', value: number) => void;
  zoomIntensity: number;
  flashIntensity: number;
  shakeIntensity: number;
}

export function FragmentsPreviewMerged({
  videoInfo, videoUrl, fragments, onFragmentsChange,
  audioPath, audioStart, subtitles, wordTimings,
  style, onStyleChange,
  displayMode: _displayMode, onDisplayModeChange,
  templateId, onTemplateChange,
  segmentDuration, bpmData, beatEffectsOn, onBeatEffectsToggle,
  onIntensityChange, zoomIntensity, flashIntensity, shakeIntensity,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [activeTab, setActiveTab] = useState<'templates' | 'style' | 'effects'>('templates');
  const { templates } = useTemplates();

  // ── Preview clip state (reuse prepare-preview endpoint) ──
  const [previewData, setPreviewData] = useState<{
    video_url: string;
    audio_url: string | null;
    duration: number;
    word_timings: WordTiming[];
    subtitles: SubtitleLine[];
    fragments: { id: number; start: number; end: number; duration: number }[];
  } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const subsKey = JSON.stringify(subtitles.map(s => ({ id: s.id, start: s.start, end: s.end, text: s.text })));
  const wordsKey = JSON.stringify(wordTimings.map(w => `${w.word}@${w.start}-${w.end}`));
  const fragsKey = JSON.stringify(fragments.map(f => `${f.id}:${f.start}:${f.end}:${f.duration}`));

  useEffect(() => { setDataVersion(v => v + 1); }, [subsKey, wordsKey, fragsKey]);

  // Debounced prepare-preview (800ms after changes)
  useEffect(() => {
    if (!videoUrl || fragments.length === 0) return;
    if (wordTimings.length === 0 && subtitles.length === 0) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPreparing(true);
      fetch('/api/prepare-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_path: videoUrl,
          audio_path: audioPath || null,
          audio_start: audioStart,
          fragments: fragments.map(f => ({ id: f.id, start: f.start, end: f.end, duration: f.duration })),
          word_timings: wordTimings,
          subtitles: subtitles,
        }),
      }).then(r => r.json()).then(data => {
        setPreviewData(data);
        setPreparing(false);
      }).catch(err => {
        console.error('Prepare preview failed:', err);
        setPreparing(false);
      });
    }, 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [videoUrl, fragsKey, dataVersion, audioStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const onTimeUpdate = useCallback(() => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
  }, []);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      if (audioRef.current) audioRef.current.pause();
    } else {
      videoRef.current.play();
      if (audioRef.current) {
        audioRef.current.currentTime = videoRef.current.currentTime;
        audioRef.current.play();
      }
    }
    setIsPlaying(!isPlaying);
  };

  const seekTo = (t: number) => {
    const clamped = Math.max(0, Math.min(t, previewData?.duration || duration));
    if (videoRef.current) videoRef.current.currentTime = clamped;
    if (audioRef.current) audioRef.current.currentTime = clamped;
  };

  // ── Active fragment (sync with playhead) ──
  const previewFragments = previewData?.fragments || [];
  const activeFragmentIdx = previewFragments.findIndex(f => currentTime >= f.start && currentTime <= f.end);

  const handleFragmentClick = (idx: number) => {
    const frag = previewFragments[idx];
    if (frag) seekTo(frag.start);
  };

  // ── Active subtitle + word ──
  const previewWords = previewData?.word_timings || wordTimings;
  const activeWord = previewWords.find(w => currentTime >= w.start && currentTime <= w.end);

  const activeVideoUrl = previewData?.video_url || null;
  const activeAudioUrl = previewData?.audio_url || null;
  const previewDuration = previewData?.duration || duration;

  const cropMode = 'crop_fill';

  const applyTemplate = (tmpl: RenderTemplate) => {
    applyTemplateToStyle(tmpl, onStyleChange, onDisplayModeChange, onTemplateChange);
  };

  // ── CSS subtitle rendering ──
  const renderSubtitles = () => {
    if (!activeWord) return null;
    const activeCss = assToCss(style.active_color);
    const outlineCss = assToCss(style.outline_color);
    return (
      <div style={{
        fontFamily: `'${style.font}', sans-serif`,
        fontSize: `${style.size * 0.25}px`,
        fontWeight: style.bold ? 'bold' : 'normal',
        color: activeCss,
        textShadow: `-${style.outline_width * 0.25}px -${style.outline_width * 0.25}px 0 ${outlineCss}, ${style.outline_width * 0.25}px -${style.outline_width * 0.25}px 0 ${outlineCss}, -${style.outline_width * 0.25}px ${style.outline_width * 0.25}px 0 ${outlineCss}, ${style.outline_width * 0.25}px ${style.outline_width * 0.25}px 0 ${outlineCss}`,
        textAlign: 'center',
        lineHeight: 1.3,
        padding: '0 20px',
        maxWidth: '90%',
      }}>
        {activeWord.word}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Film size={18} className="text-purple-400" />
        <h2 className="text-base font-semibold text-white">Fragments & Preview</h2>
        <span className="text-xs text-gray-500 ml-auto">🧪 Lab mode · 9:16 · 1080×1920</span>
      </div>

      {/* 3-column layout */}
      <div className="flex gap-3" style={{ minHeight: 500 }}>
        {/* ── LEFT: FragmentRail ── */}
        <div className="w-[180px] shrink-0">
          <FragmentRail
            videoInfo={videoInfo}
            fragments={fragments}
            onFragmentsChange={onFragmentsChange}
            segmentDuration={segmentDuration}
            cropMode={cropMode}
            activeFragmentIdx={activeFragmentIdx}
            onFragmentClick={handleFragmentClick}
          />
        </div>

        {/* ── CENTER: 9:16 Live Preview ── */}
        <div className="flex-1 flex flex-col items-center justify-start">
          <div
            className="relative bg-black rounded-xl overflow-hidden border border-[#2a2a3a] shadow-2xl"
            style={{ width: 270, height: 480 }}
          >
            {preparing && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 text-sm gap-2 z-10">
                <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-[10px]">Rebuilding preview...</span>
              </div>
            )}
            {activeVideoUrl && !preparing && (
              <>
                <video
                  ref={videoRef}
                  src={activeVideoUrl}
                  onTimeUpdate={onTimeUpdate}
                  onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => { setIsPlaying(false); if (audioRef.current) audioRef.current.pause(); }}
                  className="w-full h-full object-contain"
                  playsInline
                />
                {/* Subtitle overlay */}
                <div className="absolute left-0 right-0 text-center pointer-events-none"
                  style={style.position === 'top' ? { top: '20px' } : style.position === 'center' ? { top: '45%' } : { bottom: '60px' }}>
                  {renderSubtitles()}
                </div>
              </>
            )}
            {!activeVideoUrl && !preparing && (
              <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-sm">
                Loading preview...
              </div>
            )}
          </div>

          {/* Playback controls */}
          <div className="flex items-center gap-2 mt-3">
            <button onClick={() => seekTo(Math.max(0, currentTime - 1))} className="p-1.5 hover:bg-[#2a2a3a] rounded transition">
              <SkipBack size={14} className="text-gray-400" />
            </button>
            <button onClick={togglePlay} className="p-2 bg-purple-600 hover:bg-purple-500 rounded transition">
              {isPlaying ? <Pause size={16} className="text-white" /> : <Play size={16} className="text-white" />}
            </button>
            <button onClick={() => seekTo(Math.min(previewDuration, currentTime + 1))} className="p-1.5 hover:bg-[#2a2a3a] rounded transition">
              <SkipForward size={14} className="text-gray-400" />
            </button>
            <span className="text-xs text-gray-400 font-mono ml-1">
              {currentTime.toFixed(1)} / {previewDuration.toFixed(1)}s
            </span>
            {activeFragmentIdx >= 0 && (
              <span className="text-xs text-purple-400 font-mono ml-2">
                · frag #{activeFragmentIdx + 1}
              </span>
            )}
          </div>

          {activeAudioUrl && (
            <audio ref={audioRef} src={activeAudioUrl} preload="auto" />
          )}
        </div>

        {/* ── RIGHT: Style / Templates / Effects ── */}
        <div className="w-[280px] shrink-0 space-y-3">
          {/* Tabs */}
          <div className="flex gap-1 bg-[#0a0a0f] border border-[#1a1a2a] rounded-lg p-1">
            {(['templates', 'style', 'effects'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 px-2 py-1.5 rounded text-xs capitalize transition ${
                  activeTab === tab ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {activeTab === 'templates' && (
            <div className="space-y-2">
              {templates.map(tmpl => (
                <button
                  key={tmpl.id}
                  onClick={() => applyTemplate(tmpl)}
                  className={`w-full text-left p-2 rounded-lg border transition ${
                    templateId === tmpl.id
                      ? 'border-purple-500 bg-purple-500/10'
                      : 'border-[#1a1a2a] bg-[#0a0a0f] hover:border-[#2a2a3a]'
                  }`}
                >
                  <div className="text-sm font-medium text-white">{tmpl.name}</div>
                  <div className="text-[10px] text-gray-500">{tmpl.description}</div>
                </button>
              ))}
            </div>
          )}

          {activeTab === 'style' && (
            <div className="space-y-3 bg-[#0a0a0f] border border-[#1a1a2a] rounded-xl p-3">
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Font</label>
                <select
                  value={style.font}
                  onChange={e => onStyleChange({ ...style, font: e.target.value })}
                  className="w-full bg-[#0f0f17] border border-[#2a2a3a] rounded px-2 py-1.5 text-sm text-white outline-none focus:border-purple-500"
                >
                  {['Arial', 'Montserrat', 'Oswald', 'Russo One', 'Pacifico', 'Impact'].map(f => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Size: {style.size}px</label>
                <input type="range" min={24} max={140} step={2} value={style.size}
                  onChange={e => onStyleChange({ ...style, size: parseInt(e.target.value) })}
                  className="w-full accent-purple-500" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Active color</label>
                <input type="color" value={assToCss(style.active_color)}
                  onChange={e => onStyleChange({ ...style, active_color: cssToAss(e.target.value) })}
                  className="w-10 h-8 rounded border border-[#2a2a3a] bg-transparent cursor-pointer" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Outline: {style.outline_width}px</label>
                <input type="range" min={0} max={10} step={1} value={style.outline_width}
                  onChange={e => onStyleChange({ ...style, outline_width: parseInt(e.target.value) })}
                  className="w-full accent-purple-500" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 mb-1 block">Position</label>
                <div className="flex gap-1">
                  {['top', 'center', 'bottom'].map(p => (
                    <button key={p} onClick={() => onStyleChange({ ...style, position: p as 'bottom' | 'center' | 'top' })}
                      className={`flex-1 px-2 py-1 rounded text-xs capitalize ${
                        style.position === p ? 'bg-purple-600 text-white' : 'bg-[#1a1a2a] text-gray-400'
                      }`}>{p}</button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={style.bold}
                  onChange={e => onStyleChange({ ...style, bold: e.target.checked })}
                  className="accent-purple-500" />
                <span className="text-xs text-gray-300">Bold</span>
              </label>
            </div>
          )}

          {activeTab === 'effects' && (
            <div className="space-y-3 bg-[#0a0a0f] border border-[#1a1a2a] rounded-xl p-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={beatEffectsOn}
                  onChange={e => onBeatEffectsToggle(e.target.checked)}
                  className="accent-purple-500" />
                <span className="text-xs text-gray-300">Beat effects</span>
              </label>
              {beatEffectsOn && (
                <>
                  <div>
                    <label className="text-[10px] text-gray-500">Zoom: {zoomIntensity.toFixed(2)}</label>
                    <input type="range" min={0} max={0.3} step={0.01} value={zoomIntensity}
                      onChange={e => onIntensityChange('zoom', parseFloat(e.target.value))}
                      className="w-full accent-purple-500" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500">Flash: {flashIntensity.toFixed(2)}</label>
                    <input type="range" min={0} max={1} step={0.05} value={flashIntensity}
                      onChange={e => onIntensityChange('flash', parseFloat(e.target.value))}
                      className="w-full accent-purple-500" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500">Shake: {shakeIntensity.toFixed(2)}</label>
                    <input type="range" min={0} max={1} step={0.05} value={shakeIntensity}
                      onChange={e => onIntensityChange('shake', parseFloat(e.target.value))}
                      className="w-full accent-purple-500" />
                  </div>
                </>
              )}
              {bpmData && (
                <div className="text-[10px] text-gray-500 pt-2 border-t border-[#1a1a2a]">
                  ♩ {bpmData.bpm} BPM
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}