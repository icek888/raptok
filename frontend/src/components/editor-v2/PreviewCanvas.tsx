import type { PanelProps } from './EditorView';
import type { RefObject } from 'react';

interface Props extends PanelProps {
  videoRef: RefObject<HTMLVideoElement | null>;
}

export default function PreviewCanvas({ state, actions, videoRef }: Props) {
  // Find current word based on currentTime
  const currentWordIdx = state.words.findIndex(
    w => state.currentTime >= w.start && state.currentTime < w.end
  );
  const currentWord = currentWordIdx >= 0 ? state.words[currentWordIdx] : null;

  // Calculate lyrics position
  const posTop = state.style.position === 'top' ? '10%'
    : state.style.position === 'center' ? '45%'
    : state.style.position === 'bottom' ? '80%'
    : `${state.style.customY}%`;
  const posLeft = state.style.position === 'custom'
    ? `${state.style.customX}%`
    : '50%';

  // FX transforms
  const fxScale = state.effects.zoom ? 1 + state.effects.intensity * 0.05 : 1;
  const fxRotate = state.effects.shake ? state.effects.intensity * 2 : 0;

  return (
    <div className="relative flex flex-col items-center justify-center h-full w-full">
      {/* 9:16 Canvas */}
      <div
        className="relative bg-black overflow-hidden rounded-lg"
        style={{
          aspectRatio: '9/16',
          maxHeight: '100%',
          maxWidth: '100%',
          height: 'calc(100% - 48px)',
        }}
      >
        {/* Background blur layer */}
        {state.background !== 'black' && state.audioUrl && (
          <video
            src={state.audioUrl}
            className="absolute inset-0 w-full h-full"
            style={{
              objectFit: 'cover',
              filter: `blur(${state.background === 'subtle' ? 10 : state.background === 'medium' ? 20 : 40}px) brightness(0.3)`,
            }}
            muted
            playsInline
          />
        )}

        {/* Video layer */}
        {state.audioUrl && (
          <video
            ref={videoRef}
            src={state.audioUrl}
            className="absolute inset-0 w-full h-full"
            style={{
              objectFit: state.framing === 'fit' ? 'contain' : 'cover',
              transform: `scale(${state.canvasPosition.scale * fxScale}) rotate(${state.canvasPosition.rotation + fxRotate}deg)`,
            }}
            onTimeUpdate={e => actions.seek(e.currentTarget.currentTime)}
            onClick={() => (state.isPlaying ? actions.pause() : actions.play())}
            playsInline
          />
        )}

        {/* Lyrics overlay */}
        {currentWord && (
          <div
            className="absolute z-10 text-center pointer-events-none px-4"
            style={{
              top: posTop,
              left: posLeft,
              transform: 'translate(-50%, -50%)',
              fontFamily: state.style.fontFamily,
              fontSize: `${state.style.fontSize}px`,
              fontWeight: state.style.fontWeight,
              color: state.style.color,
              textShadow: '0 2px 8px rgba(0,0,0,0.8), 0 0 2px rgba(0,0,0,0.9)',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ color: state.style.highlightColor }}>
              {currentWord.word}
            </span>
          </div>
        )}

        {/* Vignette overlay */}
        {state.effects.vignette && (
          <div
            className="absolute inset-0 pointer-events-none z-20"
            style={{ boxShadow: `inset 0 0 ${100 * state.effects.intensity}px rgba(0,0,0,0.6)` }}
          />
        )}

        {/* Flash overlay */}
        {state.effects.flash && currentWordIdx >= 0 && (
          <div
            className="absolute inset-0 pointer-events-none z-20 bg-white"
            style={{ opacity: state.effects.intensity * 0.15 }}
          />
        )}

        {/* Empty state inside canvas */}
        {!state.audioUrl && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-neutral-600 text-sm">No audio loaded</p>
          </div>
        )}
      </div>

      {/* Playback controls */}
      <div className="flex items-center gap-3 mt-2 text-xs text-neutral-400">
        <button
          onClick={() => (state.isPlaying ? actions.pause() : actions.play())}
          className="w-8 h-8 flex items-center justify-center bg-neutral-800 hover:bg-neutral-700 rounded-full"
        >
          {state.isPlaying ? '⏸' : '▶'}
        </button>
        <span>
          {Math.floor(state.currentTime / 60)}:{String(Math.floor(state.currentTime % 60)).padStart(2, '0')}
          {' / '}
          {Math.floor(state.trimmedDuration / 60)}:{String(Math.floor(state.trimmedDuration % 60)).padStart(2, '0')}
        </span>
        <span className="ml-2 px-2 py-0.5 bg-neutral-800 rounded text-neutral-500">9:16</span>
      </div>
    </div>
  );
}