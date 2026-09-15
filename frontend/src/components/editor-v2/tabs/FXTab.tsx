import type { TabProps } from '../EditorTabs';

const EFFECTS = [
  { key: 'zoom', label: 'Zoom Pulse', desc: 'Scale on beat' },
  { key: 'flash', label: 'Flash', desc: 'White overlay on beat' },
  { key: 'shake', label: 'Shake', desc: 'Rotation jitter' },
  { key: 'vignette', label: 'Vignette', desc: 'Dark edges' },
] as const;

export default function FXTab({ state, actions }: TabProps) {
  return (
    <div className="p-3 space-y-4">
      {/* BPM */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-neutral-400 uppercase">BPM</h4>
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold text-cyan-400">{state.bpm || '—'}</span>
          <span className="text-xs text-neutral-500">BPM</span>
          <button
            onClick={() => {/* TODO: re-detect BPM */}}
            disabled={!state.audioFile}
            className="ml-auto px-2 py-1 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-400 rounded"
          >
            Re-detect
          </button>
        </div>
      </div>

      {/* Effects */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-neutral-400 uppercase">Effects</h4>
        {EFFECTS.map(e => (
          <label
            key={e.key}
            className="flex items-center gap-2 cursor-pointer p-2 rounded hover:bg-neutral-800"
          >
            <input
              type="checkbox"
              checked={state.effects[e.key]}
              onChange={ev => actions.setEffects({ [e.key]: ev.target.checked })}
              className="accent-cyan-500"
            />
            <div>
              <div className="text-xs text-neutral-300">{e.label}</div>
              <div className="text-[10px] text-neutral-600">{e.desc}</div>
            </div>
          </label>
        ))}
      </div>

      {/* Intensity */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <label className="text-xs text-neutral-500 w-16">Intensity</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={state.effects.intensity}
            onChange={e => actions.setEffects({ intensity: +e.target.value })}
            className="flex-1 accent-cyan-500"
          />
          <span className="text-xs text-neutral-400 w-8">{Math.round(state.effects.intensity * 100)}%</span>
        </div>
      </div>
    </div>
  );
}