import { useState } from 'react';
import { Sparkles, Loader2, Download, CheckCircle2, AlertCircle, Layout, Shuffle, Layers } from 'lucide-react';
import { api } from '../api/client';
import type { Fragment, VideoInfo, SubtitleLine, SubtitleStyle, RenderResult, WordTiming } from '../types';
import { useTemplates } from '../utils/templates';

interface Props {
  videoInfo: VideoInfo | null;
  fragments: Fragment[];
  audioPath: string | null;
  audioStart: number;
  subtitles: SubtitleLine[];
  wordTimings?: WordTiming[];
  style: SubtitleStyle;
  karaoke: boolean;
  displayMode: string;
  templateId?: string;
  onTemplateChange?: (id: string) => void;
  beatEffects?: { enabled: boolean; beats: number[]; zoom: number; flash: number; shake: number; energyCurve?: number[]; energyTimes?: number[] };
}

interface RenderSlot {
  templateId: string;
  templateName: string;
  status: 'pending' | 'rendering' | 'done' | 'error';
  result?: RenderResult;
  error?: string;
}

export function RenderPanel({ videoInfo, fragments, audioPath, audioStart, subtitles, wordTimings, style, karaoke, displayMode, templateId, onTemplateChange, beatEffects }: Props) {
  const [rendering, setRendering] = useState(false);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shuffleFragments, setShuffleFragments] = useState(false);
  const [renderAll, setRenderAll] = useState(true); // default: render all 3 templates
  const [slots, setSlots] = useState<RenderSlot[]>([]);
  const { templates } = useTemplates();

  const canRender = videoInfo && fragments.length >= 3 && audioPath && subtitles.length > 0;
  const totalDuration = fragments.reduce((s, f) => s + f.duration, 0);
  const selectedTemplate = templates.find(t => t.id === templateId);

  const buildFragments = () => shuffleFragments
    ? [...fragments].sort(() => Math.random() - 0.5)
    : fragments;

  // Render single template
  const handleRender = async () => {
    if (!canRender) return;
    setRendering(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.render(videoInfo!.local_path, buildFragments(), audioPath!, subtitles, style, karaoke, audioStart, displayMode, templateId || '', wordTimings, beatEffects);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Render failed');
    } finally {
      setRendering(false);
    }
  };

  // Render all 3 templates sequentially
  const handleRenderAll = async () => {
    if (!canRender || templates.length === 0) return;
    setRendering(true);
    setError(null);
    setSlots(templates.map(t => ({ templateId: t.id, templateName: t.name, status: 'pending' })));

    for (let i = 0; i < templates.length; i++) {
      const tpl = templates[i];
      // Update slot to rendering
      setSlots(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'rendering' } : s));
      try {
        const res = await api.render(videoInfo!.local_path, buildFragments(), audioPath!, subtitles, style, karaoke, audioStart, displayMode, tpl.id, wordTimings, beatEffects);
        setSlots(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'done', result: res } : s));
      } catch (e) {
        setSlots(prev => prev.map((s, idx) => idx === i ? { ...s, status: 'error', error: e instanceof Error ? e.message : 'Render failed' } : s));
      }
    }
    setRendering(false);
  };

  const doneCount = slots.filter(s => s.status === 'done').length;
  const allDone = slots.length > 0 && doneCount === slots.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-400">
          Ready to render: {fragments.length} fragments · {totalDuration.toFixed(1)}s · {subtitles.length} subtitles
          {karaoke && <span className="ml-2 text-purple-400">· karaoke mode</span>}
        </div>
      </div>

      {/* Template selector — 3 cards */}
      {templates.length > 0 && (
        <div>
          <div className="text-sm text-gray-400 mb-2">Choose a template:</div>
          <div className="grid grid-cols-3 gap-3">
            {templates.map(tpl => (
              <button
                key={tpl.id}
                onClick={() => onTemplateChange?.(tpl.id)}
                className={`p-3 rounded-xl border-2 transition text-left ${
                  templateId === tpl.id
                    ? 'border-purple-500 bg-purple-500/10'
                    : 'border-[#1a1a2a] bg-[#0f0f17] hover:border-purple-500/30'
                }`}
              >
                <div className="text-sm font-bold mb-1" style={{ color: tpl.active_color }}>
                  {tpl.name}
                </div>
                <div className="text-[10px] text-gray-500">{tpl.description}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Render mode toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setRenderAll(false)}
          className={`flex-1 py-2 px-3 rounded-lg text-sm transition ${!renderAll ? 'bg-purple-600 text-white' : 'bg-[#1a1a2a] text-gray-400 hover:text-gray-200'}`}
        >
          Single template
        </button>
        <button
          onClick={() => setRenderAll(true)}
          className={`flex-1 py-2 px-3 rounded-lg text-sm transition flex items-center justify-center gap-2 ${renderAll ? 'bg-purple-600 text-white' : 'bg-[#1a1a2a] text-gray-400 hover:text-gray-200'}`}
        >
          <Layers size={14} /> All 3 templates
        </button>
      </div>

      {/* Selected template indicator (single mode only) */}
      {!renderAll && selectedTemplate && (
        <div className="bg-purple-950/30 border border-purple-500/30 rounded-lg p-3 flex items-center gap-2">
          <Layout size={16} className="text-purple-400" />
          <div className="flex-1">
            <div className="text-sm font-medium text-purple-300">{selectedTemplate.name}</div>
            <div className="text-xs text-gray-500">{selectedTemplate.description}</div>
          </div>
        </div>
      )}

      {/* Shuffle fragments option */}
      <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
        <input type="checkbox" checked={shuffleFragments}
          onChange={e => setShuffleFragments(e.target.checked)}
          className="accent-purple-500 w-4 h-4" />
        <Shuffle size={14} className="text-purple-400" />
        Shuffle fragments — randomize video clip order
      </label>

      {/* Checklist */}
      <div className="space-y-2">
        <ChecklistItem checked={!!videoInfo} label="Video loaded" />
        <ChecklistItem checked={fragments.length >= 3} label={`${fragments.length} fragments selected (min 3)`} />
        <ChecklistItem checked={!!audioPath} label="Audio track uploaded" />
        <ChecklistItem checked={subtitles.length > 0} label="Subtitles generated" />
        <ChecklistItem checked={karaoke} label={`Karaoke mode · ${displayMode === 'word_by_word' ? 'word-by-word' : 'single word'}`} />
      </div>

      {/* Render button */}
      <button
        onClick={renderAll ? handleRenderAll : handleRender}
        disabled={!canRender || rendering}
        className="w-full py-4 bg-gradient-to-r from-purple-600 via-pink-600 to-purple-600 hover:from-purple-500 hover:via-pink-500 hover:to-purple-500 rounded-xl text-base font-bold text-white disabled:opacity-40 transition flex items-center justify-center gap-3 glow-purple"
      >
        {rendering ? (
          <>
            <Loader2 size={20} className="animate-spin" />
            {renderAll ? `Rendering ${doneCount}/${slots.length}...` : 'Rendering...'}
          </>
        ) : (
          <>
            {renderAll ? <Layers size={20} /> : <Sparkles size={20} />}
            {renderAll ? `Render All ${templates.length} Templates` : 'Generate TikTok Clip'}
          </>
        )}
      </button>

      {error && (
        <div className="flex items-start gap-2 bg-red-950/50 border border-red-800/50 rounded-lg p-3 text-sm text-red-300">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Single render result */}
      {!renderAll && result && (
        <div className="bg-[#0f0f17] border border-green-800/30 rounded-lg p-5 step-enter space-y-4">
          <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
            <CheckCircle2 size={18} /> Render Complete!
          </div>
          <div className="bg-black rounded-lg overflow-hidden relative" style={{ aspectRatio: '9/16', maxHeight: '400px' }}>
            <video src={api.downloadUrl(result.filename)} controls className="w-full h-full object-contain" />
          </div>
          <a href={api.downloadUrl(result.filename)} download={result.filename}
            className="flex items-center justify-center gap-2 py-3 bg-green-700 hover:bg-green-600 rounded-lg text-sm font-semibold text-white transition">
            <Download size={18} /> Download MP4
          </a>
        </div>
      )}

      {/* Multi-render results — 3 slots */}
      {renderAll && slots.length > 0 && (
        <div className="space-y-3">
          {slots.map((slot, i) => (
            <div key={i} className={`rounded-lg p-4 border transition ${
              slot.status === 'done' ? 'bg-[#0f0f17] border-green-800/30'
              : slot.status === 'error' ? 'bg-red-950/30 border-red-800/50'
              : slot.status === 'rendering' ? 'bg-purple-950/20 border-purple-500/40'
              : 'bg-[#0f0f17] border-[#1a1a2a]'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium" style={{ color: templates[i]?.active_color }}>
                  {slot.templateName}
                </div>
                <div className="text-xs">
                  {slot.status === 'pending' && <span className="text-gray-500">⏳ Waiting</span>}
                  {slot.status === 'rendering' && <span className="text-purple-400 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Rendering...</span>}
                  {slot.status === 'done' && <span className="text-green-400 flex items-center gap-1"><CheckCircle2 size={12} /> Done</span>}
                  {slot.status === 'error' && <span className="text-red-400 flex items-center gap-1"><AlertCircle size={12} /> Failed</span>}
                </div>
              </div>

              {slot.status === 'done' && slot.result && (
                <div className="space-y-2">
                  <div className="bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '9/16', maxHeight: '300px' }}>
                    <video src={api.downloadUrl(slot.result.filename)} controls className="w-full h-full object-contain" />
                  </div>
                  <a href={api.downloadUrl(slot.result.filename)} download={slot.result.filename}
                    className="flex items-center justify-center gap-2 py-2 bg-green-700 hover:bg-green-600 rounded-lg text-xs font-semibold text-white transition">
                    <Download size={14} /> Download
                  </a>
                </div>
              )}

              {slot.status === 'error' && (
                <div className="text-xs text-red-400">{slot.error}</div>
              )}
            </div>
          ))}

          {allDone && (
            <div className="text-center text-green-400 text-sm py-2">
              ✅ All {slots.length} clips rendered!
            </div>
          )}
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