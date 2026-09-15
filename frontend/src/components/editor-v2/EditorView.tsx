import { useEditorState } from './useEditorState';
import ClipsPanel from './ClipsPanel';
import PreviewCanvas from './PreviewCanvas';
import EditorTabs from './EditorTabs';
import TimelineTracks from './TimelineTracks';
import TrimModal from './TrimModal';
import type { EditorState } from './types';
import type { EditorActions } from './useEditorState';

export interface PanelProps {
  state: EditorState;
  actions: EditorActions;
}

export default function EditorView() {
  const editor = useEditorState();
  const { state, actions, videoRef, audioRef } = editor;
  const props: PanelProps = { state, actions };

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-100 overflow-hidden select-none">
      {/* TopBar */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 h-12 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-neutral-300">
            {state.audioFile ? state.audioFile.name : 'Untitled Project'}
          </span>
          {state.bpm > 0 && (
            <span className="text-xs text-cyan-400 bg-cyan-950 px-2 py-0.5 rounded">
              {state.bpm} BPM
            </span>
          )}
          {state.isTranscribing && (
            <span className="text-xs text-amber-400 animate-pulse">Transcribing...</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <a href="/" className="px-3 py-1 text-xs text-neutral-500 hover:text-neutral-300">
            ← Wizard
          </a>
          <button className="px-3 py-1 text-xs bg-cyan-500 hover:bg-cyan-400 text-black font-medium rounded">
            Export
          </button>
        </div>
      </header>

      {/* Main 3-column area */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Clips */}
        <div className="w-[280px] shrink-0 border-r border-neutral-800 overflow-y-auto">
          <ClipsPanel {...props} />
        </div>

        {/* Center: Preview */}
        <div className="flex-1 min-w-0 flex items-center justify-center bg-neutral-900">
          {state.audioUrl ? (
            <PreviewCanvas {...props} videoRef={videoRef} audioRef={audioRef} />
          ) : (
            <div className="text-center space-y-4">
              <div className="text-6xl">🎬</div>
              <h2 className="text-xl text-neutral-300 font-medium">RapTok Editor</h2>
              <p className="text-sm text-neutral-500 max-w-xs">
                Load audio to start. Trim a 15-30s segment, transcribe lyrics, add video clips.
              </p>
              <button
                onClick={() => actions.openTrimModal()}
                className="px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-medium rounded-lg transition-colors"
              >
                📁 Load Audio
              </button>
            </div>
          )}
        </div>

        {/* Right: Editor Tabs */}
        <div className="w-[320px] shrink-0 border-l border-neutral-800 overflow-y-auto">
          <EditorTabs {...props} />
        </div>
      </div>

      {/* Bottom: Timeline */}
      <div className="h-[220px] shrink-0 border-t border-neutral-800">
        <TimelineTracks {...props} videoRef={videoRef} audioRef={audioRef} />
      </div>

      {/* Trim Modal */}
      {state.isTrimModalOpen && <TrimModal {...props} />}
    </div>
  );
}