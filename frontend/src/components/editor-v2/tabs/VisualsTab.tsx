import type { TabProps } from '../EditorTabs';

const BG_OPTIONS = ['black', 'subtle', 'medium', 'heavy'] as const;

export default function VisualsTab({ state, actions }: TabProps) {
  const p = state.canvasPosition;

  return (
    <div className="p-3 space-y-4">
      {/* Framing */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-neutral-400 uppercase">Framing</h4>
        <div className="grid grid-cols-2 gap-2">
          {(['fit', 'fill'] as const).map(f => (
            <button
              key={f}
              onClick={() => actions.setVisuals({ framing: f })}
              className={`py-2 text-xs rounded ${state.framing === f ? 'bg-cyan-500 text-black font-medium' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`}
            >
              {f === 'fit' ? 'Fit' : 'Fill'}
            </button>
          ))}
        </div>
      </div>

      {/* Background */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-neutral-400 uppercase">Background</h4>
        <div className="grid grid-cols-4 gap-1">
          {BG_OPTIONS.map(bg => (
            <button
              key={bg}
              onClick={() => actions.setVisuals({ background: bg })}
              className={`py-1 text-[10px] rounded capitalize ${state.background === bg ? 'bg-cyan-500 text-black' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`}
            >
              {bg}
            </button>
          ))}
        </div>
      </div>

      {/* Position & Scale */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-neutral-400 uppercase">Position & Scale</h4>
        <div className="flex items-center gap-2">
          <label className="text-xs text-neutral-500 w-12">X</label>
          <input type="range" min="0" max="100" value={p.x} onChange={e => actions.setVisuals({ canvasPosition: { ...p, x: +e.target.value } })} className="flex-1 accent-cyan-500" />
          <span className="text-xs text-neutral-400 w-10">{p.x}%</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-neutral-500 w-12">Y</label>
          <input type="range" min="0" max="100" value={p.y} onChange={e => actions.setVisuals({ canvasPosition: { ...p, y: +e.target.value } })} className="flex-1 accent-cyan-500" />
          <span className="text-xs text-neutral-400 w-10">{p.y}%</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-neutral-500 w-12">Scale</label>
          <input type="range" min="0.5" max="3" step="0.01" value={p.scale} onChange={e => actions.setVisuals({ canvasPosition: { ...p, scale: +e.target.value } })} className="flex-1 accent-cyan-500" />
          <span className="text-xs text-neutral-400 w-10">{p.scale.toFixed(2)}×</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-neutral-500 w-12">Rotate</label>
          <input type="range" min="-180" max="180" value={p.rotation} onChange={e => actions.setVisuals({ canvasPosition: { ...p, rotation: +e.target.value } })} className="flex-1 accent-cyan-500" />
          <span className="text-xs text-neutral-400 w-10">{p.rotation}°</span>
        </div>
      </div>
    </div>
  );
}