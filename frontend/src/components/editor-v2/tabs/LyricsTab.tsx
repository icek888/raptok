import type { TabProps } from '../EditorTabs';

export default function LyricsTab({ state, actions }: TabProps) {
  const words = state.words;

  return (
    <div className="p-3 space-y-3">
      {/* Re-transcribe section */}
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
            {state.isTranscribing ? 'Transcribing...' : 'Re-transcribe'}
          </button>
        </div>
        <p className="text-[10px] text-neutral-600">Model: {state.transcriptModel}</p>
      </div>

      {/* Word list */}
      <div className="space-y-1">
        <h4 className="text-xs font-semibold text-neutral-400 uppercase">Words ({words.length})</h4>
        {words.length === 0 ? (
          <p className="text-xs text-neutral-600 py-4 text-center">
            No transcription yet. Upload audio and transcribe.
          </p>
        ) : (
          <div className="space-y-0.5 max-h-[400px] overflow-y-auto">
            {words.map((w, i) => (
              <div
                key={i}
                onClick={() => actions.selectWord(i)}
                className={`flex items-center gap-2 px-2 py-1 text-xs rounded cursor-pointer ${
                  state.selectedWordIndex === i
                    ? 'bg-cyan-950 text-cyan-300'
                    : 'hover:bg-neutral-800 text-neutral-400'
                }`}
              >
                <span className="text-neutral-600 w-12 text-[10px]">
                  {w.start.toFixed(1)}s
                </span>
                <span className="flex-1">{w.word}</span>
                <span className="text-neutral-600 text-[10px]">
                  {(w.end - w.start).toFixed(2)}s
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}