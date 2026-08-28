import { useState, useEffect } from 'react';
import { Activity, Zap, Music, Target, TrendingUp, Gauge, Sparkles } from 'lucide-react';
import { api } from '../api/client';
import type { TrackAnalysis } from '../types';

interface Props {
  audioPath: string;
  onHookSeek?: (time: number) => void;
}

export function TrackAnalysisPanel({ audioPath, onHookSeek }: Props) {
  const [analysis, setAnalysis] = useState<TrackAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!audioPath) return;
    setLoading(true);
    setError(null);
    api.trackAnalysis(audioPath)
      .then(data => setAnalysis(data))
      .catch(e => setError(e.message || 'Analysis failed'))
      .finally(() => setLoading(false));
  }, [audioPath]);

  if (loading) {
    return (
      <div className="bg-[#0f0f17] border border-[#1a1a2a] rounded-xl p-4">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Activity size={16} className="animate-pulse text-purple-400" />
          <span>Analyzing track...</span>
          <span className="text-gray-600">· extracting spectral features, mood, energy</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3">
        <span className="text-xs text-red-400">⚠️ Analysis error: {error}</span>
      </div>
    );
  }

  if (!analysis) return null;

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const scoreColor = (v: number) =>
    v > 0.7 ? 'text-green-400' : v > 0.4 ? 'text-yellow-400' : 'text-red-400';
  const scoreBg = (v: number) =>
    v > 0.7 ? 'bg-green-500' : v > 0.4 ? 'bg-yellow-500' : 'bg-red-500';

  // Energy graph: find max for scaling
  const maxEnergy = analysis.energy_curve.length > 0
    ? Math.max(...analysis.energy_curve, 0.01)
    : 1;

  return (
    <div className="bg-[#0f0f17] border border-[#1a1a2a] rounded-xl p-3 space-y-3">
      {/* ── Header: Mood + Genre + Key ── */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Mood badge */}
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
          style={{ backgroundColor: `${analysis.mood_color}20`, border: `1px solid ${analysis.mood_color}50` }}
        >
          <span className="text-lg">{analysis.mood_emoji}</span>
          <div>
            <div className="text-sm font-bold" style={{ color: analysis.mood_color }}>
              {analysis.mood}
            </div>
            <div className="text-[9px] text-gray-500">{analysis.mood_description}</div>
          </div>
        </div>

        {/* Genre */}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30">
          <Music size={13} className="text-blue-400" />
          <span className="text-xs font-medium text-blue-300">{analysis.genre_hint}</span>
        </div>

        {/* Key */}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/30">
          <span className="text-xs font-medium text-purple-300">
            🎹 {analysis.key}
          </span>
          <span className="text-[9px] text-gray-600">
            ({(analysis.key_confidence * 100).toFixed(0)}%)
          </span>
        </div>

        {/* BPM */}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/30">
          <span className="text-xs font-medium text-orange-300">♩ {analysis.bpm} BPM</span>
        </div>

        {/* Hook button */}
        {analysis.hook_score > 0.3 && onHookSeek && (
          <button
            onClick={() => onHookSeek(analysis.hook_time)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/20 hover:bg-yellow-500/30 border border-yellow-500/40 transition ml-auto"
            title={`Best moment at ${fmtTime(analysis.hook_time)} (score: ${(analysis.hook_score * 100).toFixed(0)}%)`}
          >
            <Target size={13} className="text-yellow-400" />
            <span className="text-xs font-medium text-yellow-300">
              🎯 Hook @ {fmtTime(analysis.hook_time)}
            </span>
          </button>
        )}
      </div>

      {/* ── Mood Scores ── */}
      <div className="grid grid-cols-5 gap-2">
        {[
          { label: 'Energy', icon: Zap, value: analysis.mood_scores.energy },
          { label: 'Valence', icon: Sparkles, value: analysis.mood_scores.valence },
          { label: 'Aggression', icon: Activity, value: analysis.mood_scores.aggressiveness },
          { label: 'Brightness', icon: TrendingUp, value: analysis.mood_scores.brightness },
          { label: 'Dance', icon: Music, value: analysis.mood_scores.danceability },
        ].map(({ label, icon: Icon, value }) => (
          <div key={label} className="bg-[#0a0a0f] border border-[#1a1a2a] rounded-lg p-2">
            <div className="flex items-center gap-1 mb-1">
              <Icon size={11} className="text-gray-500" />
              <span className="text-[9px] text-gray-500">{label}</span>
            </div>
            <div className={`text-sm font-bold ${scoreColor(value)}`}>
              {(value * 100).toFixed(0)}
              <span className="text-[9px] text-gray-600">%</span>
            </div>
            <div className="h-1 bg-[#1a1a2a] rounded-full mt-1 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${scoreBg(value)}`}
                style={{ width: `${value * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* ── Energy Graph ── */}
      {analysis.energy_curve.length > 0 && (
        <div className="bg-[#0a0a0f] border border-[#1a1a2a] rounded-lg p-2">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Gauge size={12} className="text-purple-400" />
            <span className="text-[10px] text-gray-400 font-medium">Energy Profile</span>
            <span className="text-[9px] text-gray-600 ml-auto">
              {analysis.energy_profile.filter(s => s.label === 'peak').length} peaks ·
              {' '}{analysis.energy_profile.filter(s => s.label === 'low').length} drops
            </span>
          </div>
          {/* SVG energy curve */}
          <div className="relative h-16">
            <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none" viewBox="0 0 200 64">
              <defs>
                <linearGradient id="energyGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#a855f7" stopOpacity="0.6" />
                  <stop offset="100%" stopColor="#a855f7" stopOpacity="0.05" />
                </linearGradient>
              </defs>
              {/* Area fill */}
              <path
                d={
                  `M0,64 ` +
                  analysis.energy_curve.map((v, i) => {
                    const x = (i / (analysis.energy_curve.length - 1)) * 200;
                    const y = 64 - (v / maxEnergy) * 58;
                    return `L${x.toFixed(1)},${y.toFixed(1)}`;
                  }).join(' ') +
                  ` L200,64 Z`
                }
                fill="url(#energyGrad)"
              />
              {/* Line */}
              <path
                d={
                  analysis.energy_curve.map((v, i) => {
                    const x = (i / (analysis.energy_curve.length - 1)) * 200;
                    const y = 64 - (v / maxEnergy) * 58;
                    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
                  }).join(' ')
                }
                fill="none"
                stroke="#a855f7"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
              {/* Hook marker */}
              {analysis.hook_score > 0.3 && (
                <line
                  x1={(analysis.hook_time / analysis.duration) * 200}
                  y1="0"
                  x2={(analysis.hook_time / analysis.duration) * 200}
                  y2="64"
                  stroke="#facc15"
                  strokeWidth="1"
                  strokeDasharray="3,2"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
            {/* Time labels */}
            <div className="absolute bottom-0 left-0 text-[8px] text-gray-600">0:00</div>
            <div className="absolute bottom-0 right-0 text-[8px] text-gray-600">{fmtTime(analysis.duration)}</div>
            {analysis.hook_score > 0.3 && (
              <div
                className="absolute top-0 text-[8px] text-yellow-400 font-mono -translate-x-1/2"
                style={{ left: `${(analysis.hook_time / analysis.duration) * 100}%` }}
              >
                🎯
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Song Structure ── */}
      {analysis.sections.length > 0 && (
        <div className="bg-[#0a0a0f] border border-[#1a1a2a] rounded-lg p-2">
          <div className="text-[10px] text-gray-400 font-medium mb-1.5">🎵 Song Structure</div>
          <div className="flex gap-0.5 h-6 rounded overflow-hidden">
            {analysis.sections.map((sec, i) => {
              const colors: Record<string, string> = {
                intro: '#3b82f6',
                verse: '#6b7280',
                chorus: '#facc15',
                hook: '#f97316',
                break: '#1f2937',
                outro: '#3b82f6',
              };
              const width = ((sec.end - sec.start) / analysis.duration) * 100;
              return (
                <div
                  key={i}
                  className="flex items-center justify-center text-[8px] text-white/80 font-medium transition hover:brightness-125"
                  style={{
                    width: `${width}%`,
                    backgroundColor: colors[sec.label] || '#6b7280',
                    minWidth: sec.label.length > 4 ? '40px' : '30px',
                  }}
                  title={`${sec.label} · ${fmtTime(sec.start)}-${fmtTime(sec.end)} · energy: ${(sec.energy * 100).toFixed(0)}%`}
                >
                  {width > 5 ? sec.label : ''}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}