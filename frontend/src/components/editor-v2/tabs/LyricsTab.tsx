import { useState } from 'react';
import type { TabProps } from '../EditorTabs';
import type { WordTiming } from '../types';

export default function LyricsTab({ state, actions }: TabProps) {
  const words = state.words;
  const [manualLyrics, setManualLyrics] = useState('');
  const [manualMode, setManualMode] = useState(false);

  // Apply manual lyrics: split into words and distribute evenly across trimmed duration
  const applyManualLyrics = () => {
    const text = manualLyrics.trim();
    if (!text) return;
    const wordStrs = text.split(/\s+/).filter(Boolean);
    if (wordStrs.length === 0) return;

    const dur = state.trimmedDuration;
    const perWord = dur / wordStrs.length;
    const newWords: WordTiming[] = wordStrs.map((word, i) => ({
      word,
      start: state.trimStart + i * perWord,
      end: state.trimStart + (i + 1) * perWord,
    }));
    actions.setWords(newWords);
    setManualLyrics('');
    setManualMode(false);
  };

  // Edit a single word text
  const editWord = (idx: number, newText: string) => {
    const newWords = [...words];
    newWords[idx] = { ...newWords[idx], word: newText };
    actions.setWords(newWords);
  };

  // Delete a word
  const deleteWord = (idx: number) => {
    const newWords = words.filter((_, i) => i !== idx);
    actions.setWords(newWords);
  };

  return (
    <div className="p-3 space-y-3">
      {/* Transcribe / Manual input section */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <select
            value={state.language}
            onChange={() => actions.setTab('lyrics')}
            className="text-xs bg-neutral-800 text-neutral-300 rounded px-2 py-1 border border-neutral-700"
          >
            <option value="ru">Russian</option>
            <option value="en">English</option>
            <option value="auto">Auto</option>
          </select>
          <button
            onClick={() => actions.transcribe()}
            disabled={state.isTranscribing || !state.audioFile}
            className="px-3 py-1 text-xs bg-cyan-500 hover:bg-cyan-400 disabled:bg-neutral-800 disabled:text-neutral-600 text-black font-medium rounded"
          >
            {state.isTranscribing ? '⏳ Transcribing...' : '🎙 Transcribe'}
          </button>
          <button
            onClick={() => setManualMode(!manualMode)}
            className={`px-3 py-1 text-xs rounded ${manualMode ? 'bg-fuchsia-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`}
          >
            ✏ Manual
          </button>
        </div>
        <p className="text-[10px] text-neutral-600">Model: {state.transcriptModel}</p>
      </div>

      {/* Manual lyrics input */}
      {manualMode && (
        <div className="space-y-2 p-2 bg-neutral-900 rounded border border-neutral-800">
          <textarea
            value={manualLyrics}
            onChange={e => setManualLyrics(e.target.value)}
            placeholder="Type or paste lyrics here...
Words will be distributed evenly across the trimmed segment."
            rows={5}
            className="w-full text-xs bg-neutral-950 text-neutral-200 rounded px-2 py-1 border border-neutral-700 focus:border-fuchsia-500 focus:outline-none resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={applyManualLyrics}
              disabled={!manualLyrics.trim()}
              className="px-3 py-1 text-xs bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white font-medium rounded"
            >
              Apply
            </button>
            <button
              onClick={() => setManualMode(false)}
              className="px-3 py-1 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-400 rounded"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Word list */}
      <div className="space-y-1">
        <h4 className="text-xs font-semibold text-neutral-400 uppercase">
          Words ({words.length})
        </h4>
        {words.length === 0 ? (
          <div className="text-xs text-neutral-600 py-4 text-center space-y-2">
            <p>No lyrics yet.</p>
            <p className="text-[10px]">Transcribe audio or use Manual input.</p>
          </div>
        ) : (
          <div className="space-y-0.5 max-h-[400px] overflow-y-auto">
            {words.map((w, i) => (
              <div
                key={i}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded cursor-pointer group ${
                  state.selectedWordIndex === i
                    ? 'bg-cyan-950 text-cyan-300'
                    : 'hover:bg-neutral-800 text-neutral-400'
                }`}
                onClick={() => actions.selectWord(i)}
              >
                <span className="text-neutral-600 w-12 text-[10px] shrink-0">
                  {w.start.toFixed(1)}s
                </span>
                <input
                  type="text"
                  value={w.word}
                  onChange={e => { e.stopPropagation(); editWord(i, e.target.value); }}
                  onClick={e => e.stopPropagation()}
                  className="flex-1 bg-transparent border-b border-transparent hover:border-neutral-700 focus:border-cyan-500 focus:outline-none text-neutral-200"
                />
                <span className="text-neutral-600 text-[10px] w-12 shrink-0 text-right">
                  {(w.end - w.start).toFixed(2)}s
                </span>
                <button
                  onClick={e => { e.stopPropagation(); deleteWord(i); }}
                  className="text-neutral-700 hover:text-red-400 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}