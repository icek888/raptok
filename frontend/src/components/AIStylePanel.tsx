/**
 * AIStylePanel — unified genre + emotion analysis (Step 2: Subtitles)
 * 
 * Shows genre (HuggingFace), mood (Music2Emo), valence/arousal,
 * recommended template + style. One "Apply Recommended" button.
 */
import { useState, useEffect, useRef } from 'react';
import { Music4, Heart, Loader2, CheckCircle2, Sparkles, Mic } from 'lucide-react';
import { api } from '../api/client';

interface AIStyleResult {
  genre: string;
  genre_confidence: number;
  genre_source: string;
  primary_mood: string;
  valence: number;
  arousal: number;
  moods: string[];
  emotion_source: string;
  recommended_template: any | null;
  recommended_style: any | null;
  bpm: number | null;
  energy_score: number;
  genre_all_predictions?: { label: string; score: number }[];
  error?: string;
}

interface AIStylePanelProps {
  audioPath?: string;
  onApplyStyle: (style: any) => void;
  onApplyTemplate: (templateId: string) => void;
  vocalEnhanceEnabled?: boolean;
}

type Status = 'idle' | 'loading' | 'done' | 'error';

export function AIStylePanel({ audioPath, onApplyStyle, onApplyTemplate, vocalEnhanceEnabled }: AIStylePanelProps) {
  const [result, setResult] = useState<AIStyleResult | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [applied, setApplied] = useState(false);
  const fetchedRef = useRef<string | null>(null);

  // Auto-analyze when audio path changes
  useEffect(() => {
    if (!audioPath || fetchedRef.current === audioPath) return;
    fetchedRef.current = audioPath;
    setStatus('loading');
    api.aiStyle(audioPath)
      .then((data: AIStyleResult) => {
        if (data.error) {
          setStatus('error');
        } else {
          setResult(data);
          setStatus('done');
        }
      })
      .catch(() => setStatus('error'));
  }, [audioPath]);

  const handleApply = () => {
    if (!result) return;
    if (result.recommended_style) onApplyStyle(result.recommended_style);
    if (result.recommended_template) onApplyTemplate(result.recommended_template.template_id);
    setApplied(true);
    setTimeout(() => setApplied(false), 3000);
  };

  if (status === 'loading') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-purple-400">
          <Sparkles size={16} />
          AI Style Analysis
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 size={14} className="animate-spin text-purple-400" />
          Analyzing genre & emotion...
        </div>
        <p className="text-xs text-zinc-500 italic">
          Running HuggingFace genre model + Music2Emo. Takes ~30-60s on CPU.
        </p>
      </div>
    );
  }

  if (status === 'error' || (result?.error && !result.genre)) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-purple-400">
          <Sparkles size={16} />
          AI Style Analysis
        </div>
        <p className="text-xs text-red-400">Analysis failed. Using defaults.</p>
      </div>
    );
  }

  if (!result) return null;

  const genrePct = Math.round(result.genre_confidence * 100);
  const valencePct = Math.round((result.valence / 9) * 100);  // M2E scale 1-9
  const arousalPct = Math.round((result.arousal / 9) * 100);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-purple-400">
        <Sparkles size={16} />
        AI Style Analysis
      </div>

      {/* Genre */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Music4 size={14} className="text-cyan-400" />
            <span className="text-xs font-medium text-zinc-300">Genre</span>
          </div>
          <span className="text-xs text-zinc-500 capitalize">{result.genre_source}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold capitalize text-white">{result.genre}</span>
          <span className="text-xs font-medium text-cyan-400">{genrePct}%</span>
        </div>
        {result.genre_all_predictions && result.genre_all_predictions.length > 1 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {result.genre_all_predictions.slice(1, 4).map(p => (
              <span key={p.label} className="text-[10px] text-zinc-500 capitalize rounded bg-zinc-800 px-1.5 py-0.5">
                {p.label} {Math.round(p.score * 100)}%
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Mood / Emotion */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Heart size={14} className="text-pink-400" />
            <span className="text-xs font-medium text-zinc-300">Mood</span>
          </div>
          <span className="text-xs text-zinc-500 capitalize">{result.emotion_source}</span>
        </div>
        <div className="text-lg font-bold capitalize text-white">{result.primary_mood}</div>
        {result.moods.length > 1 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {result.moods.slice(0, 6).map(m => (
              <span key={m} className="text-[10px] text-zinc-400 capitalize rounded bg-zinc-800 px-1.5 py-0.5">
                {m}
              </span>
            ))}
          </div>
        )}
        {/* VA bars */}
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500 w-12">Valence</span>
            <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-blue-500 to-yellow-400" style={{ width: `${valencePct}%` }} />
            </div>
            <span className="text-[10px] text-zinc-400 w-8 text-right">{valencePct}%</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500 w-12">Arousal</span>
            <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-green-500 to-red-500" style={{ width: `${arousalPct}%` }} />
            </div>
            <span className="text-[10px] text-zinc-400 w-8 text-right">{arousalPct}%</span>
          </div>
        </div>
      </div>

      {/* Recommended */}
      <div className="rounded-lg border border-purple-800/50 bg-purple-900/20 p-3">
        <div className="text-xs font-medium text-purple-300 mb-2">Recommended</div>
        {result.recommended_template && (
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-zinc-400">Template:</span>
            <span className="text-xs font-medium text-white capitalize">{result.recommended_template.template_id}</span>
          </div>
        )}
        {result.recommended_style && (
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-zinc-400">Style:</span>
            <span className="text-xs font-medium text-white">{result.recommended_style.description}</span>
          </div>
        )}
        <button
          onClick={handleApply}
          className={`w-full rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            applied
              ? 'bg-green-600 text-white'
              : 'bg-purple-600 hover:bg-purple-500 text-white'
          }`}
        >
          {applied ? (
            <span className="flex items-center justify-center gap-1">
              <CheckCircle2 size={14} /> Applied
            </span>
          ) : (
            <span className="flex items-center justify-center gap-1">
              <Sparkles size={14} /> Apply Recommended
            </span>
          )}
        </button>
      </div>

      {/* Vocal Enhance indicator */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mic size={12} className={vocalEnhanceEnabled ? 'text-green-400' : 'text-zinc-600'} />
            <span className="text-xs text-zinc-400">Vocal Enhance</span>
          </div>
          <span className={`text-[10px] ${vocalEnhanceEnabled ? 'text-green-400' : 'text-zinc-600'}`}>
            {vocalEnhanceEnabled ? 'Active' : 'Off'}
          </span>
        </div>
      </div>
    </div>
  );
}