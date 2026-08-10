import { Palette } from 'lucide-react';
import type { SubtitleStyle } from '../types';

interface Props {
  style: SubtitleStyle;
  onChange: (style: SubtitleStyle) => void;
}

const FONTS = ['Arial', 'Helvetica', 'Impact', 'Comic Sans MS', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana'];

export function StyleEditor({ style, onChange }: Props) {
  const update = (field: keyof SubtitleStyle, value: string | number | boolean) => {
    onChange({ ...style, [field]: value });
  };

  const colorToHex = (assColor: string): string => {
    // ASS format: &H00BBGGRR → hex
    if (!assColor.startsWith('&H')) return '#ffffff';
    const hex = assColor.replace('&H', '').replace(/[^0-9A-Fa-f]/g, '');
    if (hex.length < 8) return '#ffffff';
    const r = hex.substring(6, 8);
    const g = hex.substring(4, 6);
    const b = hex.substring(2, 4);
    return `#${r}${g}${b}`;
  };

  const hexToAss = (hex: string): string => {
    // #RRGGBB → &H00BBGGRR
    const r = hex.substring(1, 3);
    const g = hex.substring(3, 5);
    const b = hex.substring(5, 7);
    return `&H00${b}${g}${r}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Palette size={16} /> Subtitle Style
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Font</label>
          <select
            value={style.font}
            onChange={e => update('font', e.target.value)}
            className="w-full bg-[#0a0a0f] border border-[#2a2a3a] rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:border-purple-500"
          >
            {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Position</label>
          <select
            value={style.position}
            onChange={e => update('position', e.target.value as 'bottom' | 'center' | 'top')}
            className="w-full bg-[#0a0a0f] border border-[#2a2a3a] rounded-lg px-3 py-2 text-sm text-gray-100 outline-none focus:border-purple-500"
          >
            <option value="bottom">Bottom</option>
            <option value="center">Center</option>
            <option value="top">Top</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Font Size: {style.size}px</label>
          <input
            type="range"
            min="24" max="96"
            value={style.size}
            onChange={e => update('size', parseInt(e.target.value))}
            className="w-full"
          />
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Outline Width: {style.outline_width}px</label>
          <input
            type="range"
            min="0" max="8"
            value={style.outline_width}
            onChange={e => update('outline_width', parseInt(e.target.value))}
            className="w-full"
          />
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Text Color</label>
          <input
            type="color"
            value={colorToHex(style.primary_color)}
            onChange={e => update('primary_color', hexToAss(e.target.value))}
            className="w-full h-10 bg-[#0a0a0f] border border-[#2a2a3a] rounded-lg cursor-pointer"
          />
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Outline Color</label>
          <input
            type="color"
            value={colorToHex(style.outline_color)}
            onChange={e => update('outline_color', hexToAss(e.target.value))}
            className="w-full h-10 bg-[#0a0a0f] border border-[#2a2a3a] rounded-lg cursor-pointer"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
        <input
          type="checkbox"
          checked={style.bold}
          onChange={e => update('bold', e.target.checked)}
          className="w-4 h-4 accent-purple-600"
        />
        Bold text
      </label>

      {/* Preview */}
      <div className="bg-black rounded-lg p-6 relative overflow-hidden" style={{ aspectRatio: '9/16', maxHeight: '300px' }}>
        <div
          style={{
            fontFamily: style.font,
            fontSize: `${Math.min(style.size / 2, 24)}px`,
            color: colorToHex(style.primary_color),
            textShadow: `${style.outline_width}px ${style.outline_width}px 0 ${colorToHex(style.outline_color)}`,
            fontWeight: style.bold ? 'bold' : 'normal',
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            ...(style.position === 'top' ? { top: '20px' } : {}),
            ...(style.position === 'center' ? { top: '50%', transform: 'translate(-50%, -50%)' } : {}),
            ...(style.position === 'bottom' ? { bottom: '40px' } : {}),
          }}
        >
          Your lyrics here
        </div>
      </div>
    </div>
  );
}