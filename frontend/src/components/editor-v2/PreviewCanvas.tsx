import type { PanelProps } from './EditorView';
import type { RefObject } from 'react';
import { useEffect, useCallback } from 'react';

interface Props extends PanelProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  audioRef: RefObject<HTMLAudioElement | null>;
}

export default function PreviewCanvas({ state, actions, videoRef, audioRef }: Props) {
  // Words are in absolute time, currentTime is absolute too
  const currentWordIdx = state.words.findIndex(
    w => state.currentTime >= w.start && state.currentTime < w.end
  );
  const currentWord = currentWordIdx >= 0 ? state.words[currentWordIdx] : null;

  // Relative time for display and timeline slots
  const relTime = Math.max(0, state.currentTime - state.trimStart);

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

  // Find currently active clip from timeline (slots are 0-based from trimStart)
  const activeSlot = state.timelineSlots.find(
    s => relTime >= s.start && relTime < s.end
  );
  const activeClip = activeSlot?.clipId
    ? state.clips.find(c => c.id === activeSlot.clipId)
    : null;

  // Sync play/pause to video + audio elements
  useEffect(() => {
    const audio = audioRef.current;
    const video = videoRef.current;
    if (!audio && !video) return;

    if (state.isPlaying) {
      // Ensure audio starts at trimStart if outside range
      if (audio) {
        if (audio.currentTime < state.trimStart || audio.currentTime >= state.trimEnd) {
          audio.currentTime = state.trimStart;
        }
        audio.play().catch(() => {});
      }
      video?.play().catch(() => {});
    } else {
      audio?.pause();
      video?.pause();
    }
  }, [state.isPlaying]);

  // Stop at trimEnd
  useEffect(() => {
    if (!state.isPlaying) return;
    if (state.currentTime >= state.trimEnd) {
      actions.pause();
    }
  }, [state.currentTime, state.trimEnd, state.isPlaying, actions]);

  // When clip changes, set video source
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeClip?.videoUrl) return;
    if (video.src !== activeClip.videoUrl) {
      video.src = activeClip.videoUrl;
      video.currentTime = 0;
    }
  }, [activeClip?.id, activeClip?.videoUrl]);

  const handleAudioTimeUpdate = useCallback((e: React.SyntheticEvent<HTMLAudioElement>) => {
    const t = e.currentTarget.currentTime;
    actions.seek(t);
    // Stop at trimEnd
    if (t >= state.trimEnd) {
      e.currentTarget.pause();
      actions.pause();
    }
  }, [actions, state.trimEnd]);

  const handleVideoTimeUpdate = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    // Video is relative (starts at 0), add trimStart for absolute
    actions.seek(state.trimStart + e.currentTarget.currentTime);
  }, [actions, state.trimStart]);

  // Format time as M:SS
  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

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
        {/* Background blur layer from clip */}
        {activeClip?.videoUrl && state.background !== 'black' && (
          <video
            src={activeClip.videoUrl}
            className="absolute inset-0 w-full h-full"
            style={{
              objectFit: 'cover',
              filter: `blur(${state.background === 'subtle' ? 10 : state.background === 'medium' ? 20 : 40}px) brightness(0.3)`,
            }}
            muted
            playsInline
            loop
          />
        )}

        {/* Main video layer from clip */}
        {activeClip?.videoUrl && (
          <video
            ref={videoRef}
            src={activeClip.videoUrl}
            className="absolute inset-0 w-full h-full"
            style={{
              objectFit: state.framing === 'fit' ? 'contain' : 'cover',
              transform: `scale(${state.canvasPosition.scale * fxScale}) rotate(${state.canvasPosition.rotation + fxRotate}deg)`,
            }}
            onTimeUpdate={handleVideoTimeUpdate}
            onEnded={() => actions.pause()}
            onClick={() => (state.isPlaying ? actions.pause() : actions.play())}
            playsInline
            muted
          />
        )}

        {/* Hidden audio element for music playback */}
        {state.audioUrl && (
          <audio
            ref={audioRef}
            src={state.audioUrl}
            onTimeUpdate={handleAudioTimeUpdate}
            onEnded={() => actions.pause()}
          />
        )}

        {/* Empty state — no audio */}
        {!state.audioUrl && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-neutral-600 text-sm space-y-2">
              <p className="text-2xl">🎬</p>
              <p>Upload audio to start</p>
              <p className="text-xs text-neutral-700">Then add video clips</p>
            </div>
          </div>
        )}

        {/* No clip but has audio — show audio-only state */}
        {state.audioUrl && !activeClip?.videoUrl && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-neutral-600 text-sm space-y-2">
              <p className="text-2xl">🎵</p>
              <p>Audio loaded — add clips to see video</p>
              <p className="text-xs text-neutral-700">Upload clips or download from YouTube</p>
            </div>
          </div>
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
          {fmtTime(relTime)}
          {' / '}
          {fmtTime(state.trimmedDuration)}
        </span>
        <span className="ml-2 px-2 py-0.5 bg-neutral-800 rounded text-neutral-500">9:16</span>
      </div>
    </div>
  );
}