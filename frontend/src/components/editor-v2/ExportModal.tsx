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
      // Get the video server path (not blob URL — backend needs filesystem path)
      const clip = state.clips[0];
      const videoPath = clip?.serverPath || '';
      if (!videoPath) {
        throw new Error('No video clip with server path. Upload a clip first.');
      }

      // Build fragments — backend Fragment needs: id, start, duration
      // Each slot = one fragment from the clip
      const fragments = state.timelineSlots
        .filter(s => s.clipId)
        .map((slot, i) => {
          const fragStart = slot.fragmentStart || 0;
          const fragDur = slot.fragmentDuration || (slot.end - slot.start);
          return {
            id: i,
            start: fragStart,
            duration: fragDur,
          };
        });

      if (fragments.length === 0) {
        throw new Error('No slots with clips assigned. Use Gen Slots + FILL first.');
      }

      // Build word_timings — relative to trimmed segment start (0 = trimStart)
      // Words before trimStart are dropped (they're not in the exported segment)
      const wordTimings = state.words
        .filter(w => w.end > state.trimStart)
        .map(w => ({
          word: w.word,
          start: Math.max(0, w.start - state.trimStart),
          end: Math.max(0, w.end - state.trimStart),
        }));

      // Build subtitles from word_timings (group words into lines)
      const subtitles = wordTimings.map((w, i) => ({
        id: i,
        start: w.start,
        end: w.end,
        text: w.word,
        words: [{ word: w.word, start: w.start, end: w.end }],
      }));

      // Build style — backend SubtitleStyle format
      const style = {
        font: state.style.fontFamily || 'Arial',
        size: state.style.fontSize || 96,
        primary_color: '&H00FFFFFF',
        active_color: '&H00D7FF',
        outline_color: '&H00000000',
        outline_width: 4,
        position: state.style.position === 'top' ? 'top' : state.style.position === 'center' ? 'center' : 'bottom',
        margin_v: 80,
        margin_l: 60,
        bold: state.style.fontWeight >= 700,
      };

      const audioPath = state.audioServerPath || '';
      if (!audioPath) {
        throw new Error('Audio not uploaded to server. Re-load audio file.');
      }

      const resp = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_path: videoPath,
          fragments,
          audio_path: audioPath,
          audio_start: state.trimStart,
          subtitles,
          style,
          karaoke: false,
          display_mode: 'word_highlight',
          template_id: '',
          word_timings: wordTimings,
          beat_effects_enabled: false,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      const filename = data.filename || data.output_path?.split('/').pop();
      setResultUrl(`/api/download/${filename}`);
      setStatus('done');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
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
            <p className="text-neutral-500 text-xs break-words max-w-full">{error}</p>
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