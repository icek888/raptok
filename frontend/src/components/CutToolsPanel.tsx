/**
 * CutToolsPanel — AI tools for fragment selection (Step 1: Fragments)
 * 
 * - Auto Cut: smart cut at energy peaks, snapped to beats
 * - Snap to Beats: align existing fragments to nearest beats
 */
import { useState, useEffect } from 'react';
import { Scissors, Zap, Loader2, CheckCircle2 } from 'lucide-react';
import { api } from '../api/client';

interface CutToolsPanelProps {
  bpmData: { bpm: number; beats: number[] } | null;
  trackAnalysis: { duration: number; energy_curve?: number[]; energy_times?: number[] } | null;
  onAutoCut: (fragments: any[]) => void;
  onSnapToBeats: (fragments: any[]) => void;
  fragments: any[];
}

type Status = 'idle' | 'loading' | 'done' | 'error';

export function CutToolsPanel({ bpmData, trackAnalysis, onAutoCut, onSnapToBeats, fragments }: CutToolsPanelProps) {
  const [autoCutStatus, setAutoCutStatus] = useState<Status>('idle');
  const [snapStatus, setSnapStatus] = useState<Status>('idle');
  const [count, setCount] = useState(7);
  const [minFrag, setMinFrag] = useState(3);
  const [maxFrag, setMaxFrag] = useState(6);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(!!bpmData?.beats?.length && !!trackAnalysis?.duration);
  }, [bpmData, trackAnalysis]);

  const handleAutoCut = async () => {
    if (!bpmData?.beats?.length || !trackAnalysis?.duration) return;
    setAutoCutStatus('loading');
    try {
      const result = await api.autoCut(
        trackAnalysis.duration,
        bpmData.beats,
        trackAnalysis.energy_curve,
        trackAnalysis.energy_times,
        count,
        minFrag,
        maxFrag
      );
      onAutoCut(result.fragments);
      setAutoCutStatus('done');
      setTimeout(() => setAutoCutStatus('idle'), 3000);
    } catch (e) {
      console.error('Auto cut failed:', e);
      setAutoCutStatus('error');
      setTimeout(() => setAutoCutStatus('idle'), 3000);
    }
  };

  const handleSnap = async () => {
    if (!bpmData?.beats?.length || fragments.length === 0) return;
    setSnapStatus('loading');
    try {
      const result = await api.snapToBeats(fragments, bpmData.beats);
      onSnapToBeats(result.fragments);
      setSnapStatus('done');
      setTimeout(() => setSnapStatus('idle'), 3000);
    } catch (e) {
      console.error('Snap failed:', e);
      setSnapStatus('error');
      setTimeout(() => setSnapStatus('idle'), 3000);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-purple-400">
        <Scissors size={16} />
        AI Cut Tools
      </div>

      {!enabled && (
        <p className="text-xs text-zinc-500 italic">
          {!bpmData ? 'Detect BPM first to enable beat-synced tools' : 'Need track analysis data'}
        </p>
      )}

      {/* Auto Cut */}
      <div className={`rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 ${!enabled ? 'opacity-40' : ''}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-yellow-400" />
            <span className="text-xs font-medium text-zinc-300">Smart Auto Cut</span>
          </div>
          {autoCutStatus === 'done' && <CheckCircle2 size={14} className="text-green-400" />}
          {autoCutStatus === 'loading' && <Loader2 size={14} className="text-purple-400 animate-spin" />}
        </div>
        <p className="text-xs text-zinc-500 mb-2">
          Selects fragments at energy peaks, snapped to beats.
        </p>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <label className="text-xs text-zinc-400">
            Count
            <input
              type="number" min={3} max={15} value={count}
              onChange={e => setCount(+e.target.value)}
              className="w-full mt-1 rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-white"
              disabled={!enabled}
            />
          </label>
          <label className="text-xs text-zinc-400">
            Min (s)
            <input
              type="number" min={1} max={10} step={0.5} value={minFrag}
              onChange={e => setMinFrag(+e.target.value)}
              className="w-full mt-1 rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-white"
              disabled={!enabled}
            />
          </label>
          <label className="text-xs text-zinc-400">
            Max (s)
            <input
              type="number" min={2} max={20} step={0.5} value={maxFrag}
              onChange={e => setMaxFrag(+e.target.value)}
              className="w-full mt-1 rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-white"
              disabled={!enabled}
            />
          </label>
        </div>
        <button
          onClick={handleAutoCut}
          disabled={!enabled || autoCutStatus === 'loading'}
          className="w-full rounded-md bg-purple-600 hover:bg-purple-500 disabled:opacity-30 disabled:cursor-not-allowed px-3 py-1.5 text-xs font-medium text-white transition-colors"
        >
          {autoCutStatus === 'loading' ? 'Cutting...' : autoCutStatus === 'done' ? '✓ Applied' : 'Auto Cut'}
        </button>
      </div>

      {/* Snap to Beats */}
      <div className={`rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 ${!enabled || fragments.length === 0 ? 'opacity-40' : ''}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-cyan-400" />
            <span className="text-xs font-medium text-zinc-300">Snap to Beats</span>
          </div>
          {snapStatus === 'done' && <CheckCircle2 size={14} className="text-green-400" />}
          {snapStatus === 'loading' && <Loader2 size={14} className="text-cyan-400 animate-spin" />}
        </div>
        <p className="text-xs text-zinc-500 mb-2">
          Aligns {fragments.length} fragment{fragments.length !== 1 ? 's' : ''} to nearest beat positions.
        </p>
        <button
          onClick={handleSnap}
          disabled={!enabled || fragments.length === 0 || snapStatus === 'loading'}
          className="w-full rounded-md bg-cyan-600 hover:bg-cyan-500 disabled:opacity-30 disabled:cursor-not-allowed px-3 py-1.5 text-xs font-medium text-white transition-colors"
        >
          {snapStatus === 'loading' ? 'Snapping...' : snapStatus === 'done' ? '✓ Snapped' : 'Snap Fragments'}
        </button>
      </div>
    </div>
  );
}