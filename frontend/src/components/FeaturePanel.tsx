/**
 * FeaturePanel — modular AI enhancement controls.
 * 
 * Shows all 5 features with toggle switches and status indicators.
 * Each feature can be enabled/disabled independently.
 * 
 * Placed in the sidebar of Fragment Editor and Render steps.
 */
import { useState, useEffect, useCallback } from 'react';
import { 
  Zap, Heart, Scissors, Music4, Mic, 
  Loader2, CheckCircle2, AlertCircle, Sparkles 
} from 'lucide-react';
import { api } from '../api/client';

interface FeatureStatus {
  beat_effects: {
    enabled: boolean;
    zoom_intensity: number;
    flash_intensity: number;
    shake_intensity: number;
  };
  emotion_style: {
    enabled: boolean;
    available: boolean;
  };
  auto_cut: {
    enabled: boolean;
    snap_to_beat: boolean;
    end_on_beat: boolean;
  };
  genre_template: {
    enabled: boolean;
    available: boolean;
  };
  vocal_enhance: {
    enabled: boolean;
    method: string;
  };
}

interface EmotionResult {
  valence: number;
  arousal: number;
  moods: string[];
  primary_mood: string;
  source: string;
  recommended_style: {
    active_color: string;
    font: string;
    size: number;
    bold: boolean;
    template_id: string;
    description: string;
  };
}

interface GenreResult {
  genre: string;
  confidence: number;
  source: string;
  recommended_template: {
    template_id: string;
    active_color: string;
    font: string;
    size: number;
    bold: boolean;
    description: string;
  };
}

interface Props {
  audioPath: string | null;
  bpmData: { bpm: number; beats: number[] } | null;
  trackAnalysis: { 
    energy_curve?: number[]; 
    energy_times?: number[];
    duration?: number;
    mood?: string;
    genre_hint?: string;
  } | null;
  onApplyStyle?: (style: Partial<{ font: string; size: number; active_color: string; bold: boolean }>) => void;
  onApplyTemplate?: (templateId: string) => void;
  onAutoCut?: (fragments: any[]) => void;
  onSnapToBeats?: (fragments: any[]) => void;
  className?: string;
}

type AnalysisState = 'idle' | 'loading' | 'done' | 'error';

export function FeaturePanel({
  audioPath, bpmData, trackAnalysis,
  onApplyStyle, onApplyTemplate, onAutoCut, onSnapToBeats,
  className = '',
}: Props) {
  const [features, setFeatures] = useState<FeatureStatus | null>(null);
  const [emotion, setEmotion] = useState<EmotionResult | null>(null);
  const [genre, setGenre] = useState<GenreResult | null>(null);
  const [emotionState, setEmotionState] = useState<AnalysisState>('idle');
  const [genreState, setGenreState] = useState<AnalysisState>('idle');
  const [autoCutState, setAutoCutState] = useState<AnalysisState>('idle');

  // Load feature flags on mount
  useEffect(() => {
    api.getFeatures()
      .then(setFeatures)
      .catch(() => setFeatures(null));
  }, []);

  // ── Emotion analysis ──
  const handleAnalyzeEmotion = useCallback(async () => {
    if (!audioPath) return;
    setEmotionState('loading');
    try {
      const result = await api.analyzeEmotion(audioPath);
      if (result.error) throw new Error(result.error);
      setEmotion(result);
      setEmotionState('done');
    } catch (e) {
      console.error('Emotion analysis failed:', e);
      setEmotionState('error');
    }
  }, [audioPath]);

  // ── Genre classification ──
  const handleClassifyGenre = useCallback(async () => {
    if (!audioPath) return;
    setGenreState('loading');
    try {
      const result = await api.classifyGenre(audioPath);
      if (result.error) throw new Error(result.error);
      setGenre(result);
      setGenreState('done');
    } catch (e) {
      console.error('Genre classification failed:', e);
      setGenreState('error');
    }
  }, [audioPath]);

  // ── Auto cut (smart) ──
  const handleAutoCut = useCallback(async () => {
    if (!bpmData?.beats?.length || !trackAnalysis?.duration) return;
    setAutoCutState('loading');
    try {
      const result = await api.autoCut(
        trackAnalysis.duration,
        bpmData.beats,
        trackAnalysis.energy_curve,
        trackAnalysis.energy_times,
        7
      );
      if (result.fragments?.length && onAutoCut) {
        onAutoCut(result.fragments);
      }
      setAutoCutState('done');
      setTimeout(() => setAutoCutState('idle'), 2000);
    } catch (e) {
      console.error('Auto cut failed:', e);
      setAutoCutState('error');
    }
  }, [bpmData, trackAnalysis, onAutoCut]);

  // ── Snap to beats ──
  const handleSnapToBeats = useCallback(async () => {
    if (!bpmData?.beats?.length) return;
    // This needs current fragments — handled by parent
    if (onSnapToBeats) onSnapToBeats([]);
  }, [bpmData, onSnapToBeats]);

  // ── Apply recommended style ──
  const applyEmotionStyle = () => {
    if (!emotion?.recommended_style || !onApplyStyle) return;
    const s = emotion.recommended_style;
    onApplyStyle({
      font: s.font,
      size: s.size,
      active_color: s.active_color,
      bold: s.bold,
    });
  };

  // ── Apply recommended template ──
  const applyGenreTemplate = () => {
    if (!genre?.recommended_template || !onApplyTemplate) return;
    onApplyTemplate(genre.recommended_template.template_id);
  };

  const hasAudio = !!audioPath;
  const hasBeats = !!bpmData?.beats?.length;

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={16} className="text-purple-400" />
        <h3 className="text-sm font-semibold text-purple-300">AI Enhancements</h3>
        {features && (
          <span className="text-xs text-gray-500 ml-auto">
            {Object.entries(features).filter(([, v]) => v.enabled).length}/5 active
          </span>
        )}
      </div>

      {/* ── 1. Beat Effects ── */}
      <FeatureCard
        icon={<Zap size={16} className="text-yellow-400" />}
        title="Beat Effects"
        subtitle="Zoom pulse · Flash · Shake on beats"
        enabled={features?.beat_effects.enabled ?? false}
      >
        {features?.beat_effects.enabled && (
          <div className="space-y-2 mt-2">
            <IntensityBar label="Zoom" value={features.beat_effects.zoom_intensity} max={0.2} color="yellow" />
            <IntensityBar label="Flash" value={features.beat_effects.flash_intensity} max={1} color="white" />
            <IntensityBar label="Shake" value={features.beat_effects.shake_intensity} max={1} color="orange" />
            <p className="text-xs text-gray-500 mt-1">
              Applied automatically at render time. No action needed.
            </p>
          </div>
        )}
      </FeatureCard>

      {/* ── 2. Emotion Style ── */}
      <FeatureCard
        icon={<Heart size={16} className="text-pink-400" />}
        title="Emotion Style"
        subtitle="AI mood → auto subtitle style"
        enabled={features?.emotion_style.enabled ?? false}
        disabled={!hasAudio}
      >
        {features?.emotion_style.enabled && hasAudio && (
          <div className="space-y-2 mt-2">
            <button
              onClick={handleAnalyzeEmotion}
              disabled={emotionState === 'loading'}
              className="w-full px-3 py-1.5 bg-pink-600/20 hover:bg-pink-600/30 border border-pink-500/30 rounded-lg text-xs font-medium text-pink-300 transition flex items-center justify-center gap-2"
            >
              {emotionState === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {emotionState === 'loading' ? 'Analyzing...' : 'Analyze Emotion'}
            </button>
            
            {emotionState === 'done' && emotion && (
              <div className="bg-pink-950/20 border border-pink-500/20 rounded-lg p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-pink-300 capitalize">{emotion.primary_mood}</span>
                  <span className="text-xs text-gray-500">{emotion.source}</span>
                </div>
                <div className="flex gap-3 text-xs text-gray-400">
                  <span>Valence: {(emotion.valence * 100).toFixed(0)}%</span>
                  <span>Arousal: {(emotion.arousal * 100).toFixed(0)}%</span>
                </div>
                <p className="text-xs text-gray-500">{emotion.recommended_style.description}</p>
                {onApplyStyle && (
                  <button
                    onClick={applyEmotionStyle}
                    className="w-full mt-1 px-2 py-1 bg-pink-600/30 hover:bg-pink-600/40 rounded text-xs text-pink-200 transition flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle2 size={12} /> Apply Style
                  </button>
                )}
              </div>
            )}
            
            {emotionState === 'error' && (
              <p className="text-xs text-red-400 flex items-center gap-1">
                <AlertCircle size={12} /> Analysis failed
              </p>
            )}
          </div>
        )}
      </FeatureCard>

      {/* ── 3. Auto Cut ── */}
      <FeatureCard
        icon={<Scissors size={16} className="text-cyan-400" />}
        title="Auto Cut"
        subtitle="Smart cut on beats + energy peaks"
        enabled={features?.auto_cut.enabled ?? false}
        disabled={!hasBeats}
      >
        {features?.auto_cut.enabled && hasBeats && (
          <div className="space-y-2 mt-2">
            <div className="flex gap-2">
              <button
                onClick={handleAutoCut}
                disabled={autoCutState === 'loading'}
                className="flex-1 px-3 py-1.5 bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/30 rounded-lg text-xs font-medium text-cyan-300 transition flex items-center justify-center gap-2"
              >
                {autoCutState === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {autoCutState === 'loading' ? 'Cutting...' : autoCutState === 'done' ? 'Done!' : 'Smart Cut'}
              </button>
              {onSnapToBeats && (
                <button
                  onClick={handleSnapToBeats}
                  className="px-3 py-1.5 bg-cyan-600/10 hover:bg-cyan-600/20 border border-cyan-500/20 rounded-lg text-xs text-cyan-400 transition"
                  title="Snap current fragments to beats"
                >
                  Snap
                </button>
              )}
            </div>
            <div className="flex gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <CheckCircle2 size={10} className="text-green-400" /> 
                {features.auto_cut.snap_to_beat ? 'Snap start' : 'Free start'}
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle2 size={10} className="text-green-400" />
                {features.auto_cut.end_on_beat ? 'Snap end' : 'Free end'}
              </span>
            </div>
            {autoCutState === 'error' && (
              <p className="text-xs text-red-400 flex items-center gap-1">
                <AlertCircle size={12} /> Cut failed
              </p>
            )}
          </div>
        )}
      </FeatureCard>

      {/* ── 4. Genre Template ── */}
      <FeatureCard
        icon={<Music4 size={16} className="text-green-400" />}
        title="Genre Template"
        subtitle="AI genre → auto template"
        enabled={features?.genre_template.enabled ?? false}
        disabled={!hasAudio}
      >
        {features?.genre_template.enabled && hasAudio && (
          <div className="space-y-2 mt-2">
            <button
              onClick={handleClassifyGenre}
              disabled={genreState === 'loading'}
              className="w-full px-3 py-1.5 bg-green-600/20 hover:bg-green-600/30 border border-green-500/30 rounded-lg text-xs font-medium text-green-300 transition flex items-center justify-center gap-2"
            >
              {genreState === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {genreState === 'loading' ? 'Classifying...' : 'Detect Genre'}
            </button>
            
            {genreState === 'done' && genre && (
              <div className="bg-green-950/20 border border-green-500/20 rounded-lg p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-green-300 capitalize">{genre.genre}</span>
                  <span className="text-xs text-gray-500">{(genre.confidence * 100).toFixed(0)}%</span>
                </div>
                <p className="text-xs text-gray-500">{genre.recommended_template.description}</p>
                {onApplyTemplate && genre.recommended_template.template_id && (
                  <button
                    onClick={applyGenreTemplate}
                    className="w-full mt-1 px-2 py-1 bg-green-600/30 hover:bg-green-600/40 rounded text-xs text-green-200 transition flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle2 size={12} /> Apply Template
                  </button>
                )}
              </div>
            )}
            
            {genreState === 'error' && (
              <p className="text-xs text-red-400 flex items-center gap-1">
                <AlertCircle size={12} /> Classification failed
              </p>
            )}
          </div>
        )}
      </FeatureCard>

      {/* ── 5. Vocal Enhance ── */}
      <FeatureCard
        icon={<Mic size={16} className="text-orange-400" />}
        title="Vocal Enhance"
        subtitle="Denoise + enhance before transcription"
        enabled={features?.vocal_enhance.enabled ?? false}
      >
        {features && (
          <div className="space-y-1.5 mt-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">Method</span>
              <span className="text-orange-400 capitalize">{features.vocal_enhance.method}</span>
            </div>
            {features.vocal_enhance.enabled ? (
              <p className="text-xs text-orange-300">
                Auto-applied before WhisperX transcription.
              </p>
            ) : (
              <p className="text-xs text-gray-500">
                Disabled (CPU-heavy). Enable via RAPTOK_VOCAL_ENHANCE=1
              </p>
            )}
          </div>
        )}
      </FeatureCard>

      {/* Footer hint */}
      {!hasAudio && (
        <p className="text-xs text-gray-600 text-center pt-1">
          Upload audio to unlock emotion & genre analysis
        </p>
      )}
      {hasAudio && !hasBeats && (
        <p className="text-xs text-gray-600 text-center pt-1">
          Use Beat Sync to unlock auto-cut
        </p>
      )}
    </div>
  );
}


// ── Feature card wrapper ──
function FeatureCard({
  icon, title, subtitle, enabled, disabled, children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  enabled: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border p-3 transition ${
        disabled
          ? 'bg-[#0a0a0f] border-[#1a1a2a] opacity-50'
          : enabled
            ? 'bg-[#0f0f17] border-[#1a1a2a]'
            : 'bg-[#0a0a0f] border-[#1a1a2a] opacity-60'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className={`mt-0.5 ${disabled ? 'text-gray-600' : ''}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-200">{title}</span>
            <StatusDot enabled={enabled} disabled={disabled} />
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
        </div>
      </div>
      {enabled && !disabled && children}
    </div>
  );
}


function StatusDot({ enabled, disabled }: { enabled: boolean; disabled?: boolean }) {
  if (disabled) {
    return <span className="w-2 h-2 rounded-full bg-gray-700" title="Requires audio/beats" />;
  }
  if (enabled) {
    return <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" title="Active" />;
  }
  return <span className="w-2 h-2 rounded-full bg-gray-600" title="Disabled" />;
}


function IntensityBar({ label, value, max, color }: { 
  label: string; value: number; max: number; color: string;
}) {
  const pct = Math.min(100, (value / max) * 100);
  const colorMap: Record<string, string> = {
    yellow: 'bg-yellow-500',
    white: 'bg-white',
    orange: 'bg-orange-500',
  };
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 w-12">{label}</span>
      <div className="flex-1 h-1.5 bg-[#1a1a2a] rounded-full overflow-hidden">
        <div className={`h-full ${colorMap[color] || 'bg-purple-500'} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-600 font-mono w-8 text-right">{(value * 100).toFixed(0)}%</span>
    </div>
  );
}