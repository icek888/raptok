/**
 * BeatEffectsPanel — beat-synced visual effects toggle (Step 3: Preview)
 *
 * - Toggle Beat Effects ON/OFF
 * - Intensity sliders: Zoom, Flash, Shake
 * - Beat markers indicator
 */
import { useState, useEffect } from 'react';
import { Zap } from 'lucide-react';
import { api } from '../api/client';

interface BeatEffectsPanelProps {
  bpmData: { bpm: number; beats: number[] } | null;
  beatEffectsEnabled: boolean;
  onToggle: (enabled: boolean) => void;
  onIntensityChange: (type: 'zoom' | 'flash' | 'shake', value: number) => void;
  zoomIntensity: number;
  flashIntensity: number;
  shakeIntensity: number;
}

export function BeatEffectsPanel({
  bpmData,
  beatEffectsEnabled,
  onToggle,
  onIntensityChange,
  zoomIntensity,
  flashIntensity,
  shakeIntensity,
}: BeatEffectsPanelProps) {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    api.getFeatures().then((data: any) => {
      setAvailable(data?.beat_effects?.enabled ?? false);
    }).catch(() => {});
  }, []);

  const hasBeats = !!bpmData?.beats?.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-purple-400">
        <Zap size={16} />
        Beat Effects
      </div>

      {!hasBeats && (
        <p className="text-xs text-zinc-500 italic">
          Detect BPM first to enable beat-synced effects
        </p>
      )}

      {/* Master toggle */}
      <div className={`rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 ${!hasBeats ? 'opacity-40' : ''}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-medium text-zinc-300">Beat-synced effects</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">
              {hasBeats ? `${bpmData!.beats.length} beats detected at ${bpmData!.bpm} BPM` : 'No beats'}
            </div>
          </div>
          <button
            onClick={() => onToggle(!beatEffectsEnabled)}
            disabled={!hasBeats}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              beatEffectsEnabled ? 'bg-purple-600' : 'bg-zinc-700'
            } disabled:cursor-not-allowed`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                beatEffectsEnabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Intensity sliders */}
      {beatEffectsEnabled && hasBeats && (
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
          <div className="text-xs font-medium text-zinc-400">Intensity</div>

          {/* Zoom */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-zinc-300">Zoom Pulse</span>
              <span className="text-[10px] text-zinc-500">{Math.round(zoomIntensity * 100)}%</span>
            </div>
            <input
              type="range" min={0} max={0.2} step={0.01}
              value={zoomIntensity}
              onChange={e => onIntensityChange('zoom', +e.target.value)}
              className="w-full accent-purple-500"
            />
          </div>

          {/* Flash */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-zinc-300">Flash</span>
              <span className="text-[10px] text-zinc-500">{Math.round(flashIntensity * 100)}%</span>
            </div>
            <input
              type="range" min={0} max={0.5} step={0.05}
              value={flashIntensity}
              onChange={e => onIntensityChange('flash', +e.target.value)}
              className="w-full accent-yellow-500"
            />
          </div>

          {/* Shake */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-zinc-300">Shake</span>
              <span className="text-[10px] text-zinc-500">{Math.round(shakeIntensity * 100)}%</span>
            </div>
            <input
              type="range" min={0} max={0.3} step={0.01}
              value={shakeIntensity}
              onChange={e => onIntensityChange('shake', +e.target.value)}
              className="w-full accent-red-500"
            />
          </div>

          <div className="pt-1 border-t border-zinc-800">
            <p className="text-[10px] text-zinc-500">
              Effects will be applied during final render.
              {available ? ' ✅ Backend ready' : ' ⚠️ Backend feature off'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}