import { useState } from 'react';
import type { EditorState } from './types';
import type { EditorActions } from './useEditorState';

interface Props {
  state: EditorState;
  actions: EditorActions;
  onClose: () => void;
}

export default function ExportModal({ state, actions: _actions, onClose }: Props) {
  const [status, setStatus] = useState<'idle' | 'rendering' | 'done' | 'error'>('idle');
  const [resultUrl, setResultUrl] = useState('');
  const [error, setError] = useState('');

  const handleExport = async () => {
    setStatus('rendering');
    setError('');

    try {
      // Build fragments from timeline slots
      const fragments = state.timelineSlots
        .filter(slot => slot.clipId)
        .map(slot => {
          const clip = state.clips.find(c => c.id === slot.clipId);
          return {
            source: clip?.serverPath || clip?.videoUrl || '',
            start: slot.fragmentStart || 0,
            end: (slot.fragmentStart || 0) + (slot.fragmentDuration || (slot.end - slot.start)),
            slot_start: slot.start,
            slot_end: slot.end,
          };
        });

      // Build subtitles from words
      const subtitles = state.words.map(w => ({
        start: w.start - state.trimStart,
        end: w.end - state.trimStart,
        text: w.word,
        words: [w.word],
      }));

      // Style from editor state
      const style = {
        font: state.style.fontFamily,
        size: state.style.fontSize,
        color: state.style.color,
        highlight: state.style.highlightColor,
        weight: state.style.fontWeight,
      };

      const resp = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_path: state.clips[0]?.serverPath || state.clips[0]?.videoUrl || '',
          fragments,
          audio_path: state.audioUrl || '',
          audio_start: state.trimStart,
          subtitles,
          style,
          karaoke: false,
          display_mode: 'word_highlight',
          template_id: '',
          word_timings: state.words.map(w => ({
            word: w.word,
            start: w.start - state.trimStart,
            end: w.end - state.trimStart,
          })),
          beat_effects_enabled: false,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      setResultUrl(data.download_url || `/api/download/${data.filename}`);
      setStatus('done');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Export failed');
      setStatus('error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
      <div className="bg-neutral-900 rounded-xl p-6 w-[480px] max-w-[90vw]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">Export Video</h2>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-white text-xl w-8 h-8 flex items-center justify-center"
          >
            ×
          </button>
        </div>

        {/* Summary */}
        <div className="space-y-2 mb-4 text-sm text-neutral-400">
          <div className="flex justify-between">
            <span>Duration:</span>
            <span className="text-neutral-200">{state.trimmedDuration.toFixed(1)}s</span>
          </div>
          <div className="flex justify-between">
            <span>Words:</span>
            <span className="text-neutral-200">{state.words.length}</span>
          </div>
          <div className="flex justify-between">
            <span>Slots:</span>
            <span className="text-neutral-200">{state.timelineSlots.length}</span>
          </div>
          <div className="flex justify-between">
            <span>Clips:</span>
            <span className="text-neutral-200">{state.clips.length}</span>
          </div>
          <div className="flex justify-between">
            <span>Resolution:</span>
            <span className="text-neutral-200">1080×1920</span>
          </div>
        </div>

        {/* Status */}
        {status === 'rendering' && (
          <div className="text-center py-8">
            <div className="animate-spin w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-cyan-400 text-sm">Rendering video...</p>
            <p className="text-neutral-600 text-xs mt-1">This may take 30-60 seconds</p>
          </div>
        )}

        {status === 'done' && resultUrl && (
          <div className="space-y-4">
            <div className="text-center py-4">
              <p className="text-green-400 text-lg mb-3">✅ Export complete!</p>
              <video src={resultUrl} controls className="w-full rounded-lg max-h-[300px]" />
            </div>
            <a
              href={resultUrl}
              download="raptok_export.mp4"
              className="block w-full py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-lg text-center transition-colors"
            >
              ⬇ Download MP4
            </a>
          </div>
        )}

        {status === 'error' && (
          <div className="text-center py-8">
            <p className="text-red-400 text-sm mb-2">❌ Export failed</p>
            <p className="text-neutral-500 text-xs">{error}</p>
          </div>
        )}

        {status === 'idle' && (
          <button
            onClick={handleExport}
            disabled={!state.audioUrl || state.words.length === 0}
            className="w-full py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {state.audioUrl ? '🎬 Export Video' : 'Load audio first'}
          </button>
        )}
      </div>
    </div>
  );
}