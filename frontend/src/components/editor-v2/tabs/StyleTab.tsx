import type { TabProps } from '../EditorTabs';

const TEMPLATES = [
  { id: 'cinematic', label: 'Cinematic', desc: 'Single word, fit blur' },
  { id: 'lyrics', label: 'Lyrics', desc: 'Line highlight, \\kf progress' },
  { id: 'hype', label: 'Hype', desc: 'Bottom-left, crop fill' },
  { id: 'custom', label: 'Custom', desc: 'Manual settings' },
] as const;

const FONTS = ['Arial', 'Helvetica', 'Impact', 'Georgia', 'Roboto', 'Inter', 'Bebas Neue'];

export default function StyleTab({ state, actions }: TabProps) {
  const s = state.style;

  return (
    <div className="p-3 space-y-4">
      {/* Template presets */}
      <div>
        <h4 className="text-xs font-semibold text-neutral-400 uppercase mb-2">Template</h4>
        <div className="grid grid-cols-2 gap-2">
          {TEMPLATES.map(t => (
            <button
              key={t.id}
              onClick={() => actions.setStyle({ template: t.id })}
              className={`p-2 text-left rounded border transition-colors ${
                s.template === t.id
                  ? 'border-cyan-500 bg-cyan-950'
                  : 'border-neutral-700 hover:border-neutral-600 bg-neutral-800'
              }`}
            >
              <div className="text-xs font-medium text-neutral-200">{t.label}</div>
              <div className="text-[10px] text-neutral-500">{t.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Font */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-neutral-400 uppercase">Font</h4>
        <select
          value={s.fontFamily}
          onChange={e => actions.setStyle({ fontFamily: e.target.value })}
          className="w-full text-xs bg-neutral-800 text-neutral-300 rounded px-2 py-1 border border-neutral-700"
        >
          {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <label className="text-xs text-neutral-500 w-16">Size</label>
          <input
            type="range"
            min="12"
            max="96"
            value={s.fontSize}
            onChange={e => actions.setStyle({ fontSize: +e.target.value })}
            className="flex-1 accent-cyan-500"
          />
          <span className="text-xs text-neutral-400 w-8">{s.fontSize}px</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-neutral-500 w-16">Weight</label>
          <select
            value={s.fontWeight}
            onChange={e => actions.setStyle({ fontWeight: +e.target.value })}
            className="text-xs bg-neutral-800 text-neutral-300 rounded px-2 py-1 border border-neutral-700"
          >
            <option value={300}>Light</option>
            <option value={400}>Regular</option>
            <option value={500}>Medium</option>
            <option value={700}>Bold</option>
            <option value={900}>Black</option>
          </select>
        </div>
      </div>

      {/* Colors */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-neutral-400 uppercase">Colors</h4>
        <div className="flex items-center gap-2">
          <label className="text-xs text-neutral-500 w-16">Text</label>
          <input
            type="color"
            value={s.color}
            onChange={e => actions.setStyle({ color: e.target.value })}
            className="w-8 h-8 rounded cursor-pointer bg-neutral-800 border border-neutral-700"
          />
          <span className="text-xs text-neutral-400">{s.color}</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-neutral-500 w-16">Highlight</label>
          <input
            type="color"
            value={s.highlightColor}
            onChange={e => actions.setStyle({ highlightColor: e.target.value })}
            className="w-8 h-8 rounded cursor-pointer bg-neutral-800 border border-neutral-700"
          />
          <span className="text-xs text-neutral-400">{s.highlightColor}</span>
        </div>
      </div>

      {/* Position */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-neutral-400 uppercase">Position</h4>
        <div className="grid grid-cols-4 gap-1">
          {(['top', 'center', 'bottom', 'custom'] as const).map(p => (
            <button
              key={p}
              onClick={() => actions.setStyle({ position: p })}
              className={`py-1 text-[10px] rounded ${s.position === p ? 'bg-cyan-500 text-black' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
        {s.position === 'custom' && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <label className="text-xs text-neutral-500 w-8">X</label>
              <input type="range" min="0" max="100" value={s.customX} onChange={e => actions.setStyle({ customX: +e.target.value })} className="flex-1 accent-cyan-500" />
              <span className="text-xs text-neutral-400 w-10">{s.customX}%</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-neutral-500 w-8">Y</label>
              <input type="range" min="0" max="100" value={s.customY} onChange={e => actions.setStyle({ customY: +e.target.value })} className="flex-1 accent-cyan-500" />
              <span className="text-xs text-neutral-400 w-10">{s.customY}%</span>
            </div>
          </div>
        )}
      </div>

      {/* Karaoke progress */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={s.karaokeProgress}
            onChange={e => actions.setStyle({ karaokeProgress: e.target.checked })}
            className="accent-cyan-500"
            disabled={s.template !== 'lyrics' && s.template !== 'custom'}
          />
          <span className="text-xs text-neutral-400">Karaoke progress bar (\kf)</span>
        </label>
      </div>
    </div>
  );
}