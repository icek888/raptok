import { Loader2, Activity, Mic, Palette, Gauge, Zap } from 'lucide-react';
import type { BPMResult, TrackAnalysis } from '../types';

interface Props {
  loading: boolean;
  bpmData: BPMResult | null;
  trackAnalysis: TrackAnalysis | null;
  whisperText: string | null;
  whisperLoading: boolean;
  audioDuration: number | null;
}

export function AnalysisPanel({ loading, bpmData, trackAnalysis, whisperText, whisperLoading, audioDuration }: Props) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 size={48} className="animate-spin text-purple-400" />
        <p className="text-white font-medium text-lg">Analyzing your track...</p>
        <p className="text-gray-500 text-sm">BPM, beats, energy profile, genre, emotion & lyrics detection</p>
      </div>
    );
  }

  const fmtDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const mood = trackAnalysis?.mood || 'unknown';
  const genre = trackAnalysis?.genre_hint || 'unknown';
  const moodScores: any = trackAnalysis?.mood_scores || {};

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Track Analysis Complete</h2>
        <p className="text-gray-400">Everything's ready — review the results and continue to lyrics editing.</p>
      </div>

      {/* Duration */}
      {audioDuration && (
        <div className="flex items-center gap-4 p-4 bg-white/5 rounded-xl">
          <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
            <Gauge size={24} className="text-blue-400" />
          </div>
          <div>
            <div className="text-white font-bold text-xl">{fmtDuration(audioDuration)}</div>
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

      {/* WhisperX lyrics detection */}
      <div className="p-5 bg-white/5 rounded-xl">
        <div className="flex items-center gap-2 mb-3">
          <Mic size={20} className="text-green-400" />
          <span className="text-gray-400 text-sm">Auto-detected Lyrics</span>
          {whisperLoading && <Loader2 size={14} className="animate-spin text-gray-500" />}
        </div>
        {whisperText ? (
          <div className="text-white/70 text-sm whitespace-pre-wrap max-h-40 overflow-y-auto bg-black/20 p-3 rounded-lg">
            {whisperText}
          </div>
        ) : whisperLoading ? (
          <p className="text-gray-500 text-sm">Transcribing with WhisperX...</p>
        ) : (
          <p className="text-gray-500 text-sm">No lyrics detected — you can enter them manually on the next step.</p>
        )}
      </div>
    </div>
  );
}