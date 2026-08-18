import { useState, useEffect } from 'react';
import { Sparkles, Loader2, Download, CheckCircle2, AlertCircle, Layout } from 'lucide-react';
import { api } from '../api/client';
import type { Fragment, VideoInfo, SubtitleLine, SubtitleStyle, RenderResult, RenderTemplate } from '../types';

interface Props {
  videoInfo: VideoInfo | null;
  fragments: Fragment[];
  audioPath: string | null;
  audioStart: number;
  subtitles: SubtitleLine[];
  style: SubtitleStyle;
  karaoke: boolean;
  displayMode: string;
  templateId?: string;
}

export function RenderPanel({ videoInfo, fragments, audioPath, audioStart, subtitles, style, karaoke, displayMode, templateId }: Props) {
  const [rendering, setRendering] = useState(false);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<RenderTemplate[]>([]);

  useEffect(() => {
    api.getTemplates().then(data => setTemplates(data.templates)).catch(() => {});
  }, []);

  const canRender = videoInfo && fragments.length >= 3 && audioPath && subtitles.length > 0;
  const totalDuration = fragments.reduce((s, f) => s + f.duration, 0);
  const selectedTemplate = templates.find(t => t.id === templateId);

  const handleRender = async () => {
    if (!canRender) return;
    setRendering(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.render(videoInfo!.local_path, fragments, audioPath!, subtitles, style, karaoke, audioStart, displayMode, templateId || '');
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Render failed');
    } finally {
      setRendering(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-400">
          Ready to render: {fragments.length} fragments · {totalDuration.toFixed(1)}s · {subtitles.length} subtitles
          {karaoke && <span className="ml-2 text-purple-400">· karaoke mode</span>}
          {selectedTemplate && <span className="ml-2 text-purple-400">· {selectedTemplate.name}</span>}
        </div>
      </div>

      {/* Selected template indicator */}
      {selectedTemplate && (
        <div className="bg-purple-950/30 border border-purple-500/30 rounded-lg p-3 flex items-center gap-2">
          <Layout size={16} className="text-purple-400" />
          <div className="flex-1">
            <div className="text-sm font-medium text-purple-300">{selectedTemplate.name}</div>
            <div className="text-xs text-gray-500">{selectedTemplate.description}</div>
          </div>
        </div>
      )}

      {/* Checklist */}
      <div className="space-y-2">
        <ChecklistItem checked={!!videoInfo} label="Video loaded" />
        <ChecklistItem checked={fragments.length >= 3} label={`${fragments.length} fragments selected (min 3)`} />
        <ChecklistItem checked={!!audioPath} label="Audio track uploaded" />
        <ChecklistItem checked={subtitles.length > 0} label="Subtitles generated" />
        <ChecklistItem checked={karaoke} label={`Karaoke mode · ${displayMode === 'word_by_word' ? 'word-by-word' : 'line + highlight'}`} />
      </div>

      <button
        onClick={handleRender}
        disabled={!canRender || rendering}
        className="w-full py-4 bg-gradient-to-r from-purple-600 via-pink-600 to-purple-600 hover:from-purple-500 hover:via-pink-500 hover:to-purple-500 rounded-xl text-base font-bold text-white disabled:opacity-40 transition flex items-center justify-center gap-3 glow-purple"
      >
        {rendering ? (
          <>
            <Loader2 size={20} className="animate-spin" /> Rendering...
          </>
        ) : (
          <>
            <Sparkles size={20} /> Generate TikTok Clip
          </>
        )}
      </button>

      {error && (
        <div className="flex items-start gap-2 bg-red-950/50 border border-red-800/50 rounded-lg p-3 text-sm text-red-300">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {result && (
        <div className="bg-[#0f0f17] border border-green-800/30 rounded-lg p-5 step-enter space-y-4">
          <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
            <CheckCircle2 size={18} /> Render Complete!
          </div>

          <div className="bg-black rounded-lg overflow-hidden relative" style={{ aspectRatio: '9/16', maxHeight: '400px' }}>
            <video
              src={api.downloadUrl(result.filename)}
              controls
              className="w-full h-full object-contain"
            />
          </div>

          <a
            href={api.downloadUrl(result.filename)}
            download={result.filename}
            className="flex items-center justify-center gap-2 py-3 bg-green-700 hover:bg-green-600 rounded-lg text-sm font-semibold text-white transition"
          >
            <Download size={18} /> Download MP4
          </a>
        </div>
      )}
    </div>
  );
}

function ChecklistItem({ checked, label }: { checked: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {checked ? (
        <CheckCircle2 size={16} className="text-green-400" />
      ) : (
        <div className="w-4 h-4 rounded-full border-2 border-gray-600" />
      )}
      <span className={checked ? 'text-gray-300' : 'text-gray-500'}>{label}</span>
    </div>
  );
}