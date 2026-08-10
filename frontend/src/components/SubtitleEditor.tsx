import { useState } from 'react';
import { Loader2, Type } from 'lucide-react';
import { api } from '../api/client';
import type { Fragment, SubtitleLine } from '../types';

interface Props {
  lyrics: string;
  fragments: Fragment[];
  subtitles: SubtitleLine[];
  onSubtitlesChange: (subs: SubtitleLine[]) => void;
}

export function SubtitleEditor({ lyrics, fragments, subtitles, onSubtitlesChange }: Props) {
  const [loading, setLoading] = useState(false);

  const autoSplit = async () => {
    if (!lyrics.trim() || fragments.length === 0) return;
    setLoading(true);
    try {
      const result = await api.splitSubtitles(lyrics, fragments);
      onSubtitlesChange(result.subtitles);
    } catch (e) {
      console.error('Split failed:', e);
    } finally {
      setLoading(false);
    }
  };

  const updateText = (id: number, text: string) => {
    onSubtitlesChange(subtitles.map(s => s.id === id ? { ...s, text } : s));
  };

  const updateTiming = (id: number, field: 'start' | 'end', value: number) => {
    onSubtitlesChange(subtitles.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Type size={16} /> {subtitles.length} subtitle lines
        </div>
        <button
          onClick={autoSplit}
          disabled={loading || !lyrics.trim() || fragments.length === 0}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium flex items-center gap-2 transition disabled:opacity-40"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Type size={14} />}
          Auto-split from lyrics
        </button>
      </div>

      {subtitles.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">
          Click "Auto-split from lyrics" to generate subtitles
        </div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
          {subtitles.map(sub => (
            <div key={sub.id} className="flex items-start gap-3 bg-[#0f0f17] border border-[#1a1a2a] rounded-lg p-3 hover:border-purple-500/20 transition">
              <div className="text-xs text-gray-500 font-mono pt-1 w-6">#{sub.id + 1}</div>
              <div className="flex flex-col gap-1 w-28">
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.1"
                    value={sub.start}
                    onChange={e => updateTiming(sub.id, 'start', parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#0a0a0f] border border-[#2a2a3a] rounded px-2 py-1 text-xs text-gray-300 font-mono"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.1"
                    value={sub.end}
                    onChange={e => updateTiming(sub.id, 'end', parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#0a0a0f] border border-[#2a2a3a] rounded px-2 py-1 text-xs text-gray-300 font-mono"
                  />
                </div>
              </div>
              <input
                type="text"
                value={sub.text}
                onChange={e => updateText(sub.id, e.target.value)}
                className="flex-1 bg-[#0a0a0f] border border-[#2a2a3a] rounded px-3 py-2 text-sm text-gray-100 focus:border-purple-500 outline-none transition"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}