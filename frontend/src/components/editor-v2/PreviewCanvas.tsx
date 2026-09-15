import type { PanelProps } from './EditorView';
import type { RefObject } from 'react';
import { useEffect, useCallback, useRef, useState } from 'react';

// Real output resolution: 1080×1920 (9:16 TikTok)
const CANVAS_W = 1080;
const CANVAS_H = 1920;

interface Props extends PanelProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  audioRef: RefObject<HTMLAudioElement | null>;
}

export default function PreviewCanvas({ state, actions, videoRef, audioRef }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  // Thumbnails: slotId → dataURL of video frame
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const thumbVideoRef = useRef<HTMLVideoElement | null>(null);

  // Calculate scale to fit container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const resize = () => {
      const availW = container.clientWidth - 16;
      const availH = container.clientHeight - 48;
      const s = Math.min(availW / CANVAS_W, availH / CANVAS_H);
      setScale(Math.max(0.1, s));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Generate thumbnails for each slot's clip
  useEffect(() => {
    const slots = state.timelineSlots.filter(s => s.clipId);
    if (slots.length === 0) {
      setThumbnails({});
      return;
    }

    // Create hidden video element for thumbnail generation
    let video: HTMLVideoElement | null = thumbVideoRef.current;
    if (!video) {
      video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.playsInline = true;
      thumbVideoRef.current = video;
    }

    const clips = state.clips;
    const newThumbs: Record<string, string> = {};
    let cancelled = false;

    const generateThumbs = async () => {
      // Unique clips (one thumb per unique clip)
      const uniqueClips = new Map<string, string>(); // clipId → videoUrl
      for (const slot of slots) {
        if (slot.clipId && !uniqueClips.has(slot.clipId)) {
          const clip = clips.find(c => c.id === slot.clipId);
          if (clip?.videoUrl) uniqueClips.set(slot.clipId, clip.videoUrl);
        }
      }

      for (const [clipId, url] of uniqueClips) {
        if (cancelled) return;
        try {
          await new Promise<void>((resolve) => {
            if (!video) return resolve();
            video.src = url;
            video.currentTime = 0.1; // grab frame near start
            const onSeeked = () => {
              if (!video || cancelled) return resolve();
              try {
                const canvas = document.createElement('canvas');
                canvas.width = 108;
                canvas.height = 192; // 9:16 small thumb
                const ctx = canvas.getContext('2d');
                if (ctx) {
                  ctx.drawImage(video, 0, 0, 108, 192);
                  newThumbs[clipId] = canvas.toDataURL('image/jpeg', 0.7);
                }
              } catch (e) {
                // CORS or other error — skip
              }
              resolve();
            };
            const onError = () => resolve(); // skip on error
            video.addEventListener('seeked', onSeeked, { once: true });
            video.addEventListener('error', onError, { once: true });
            setTimeout(() => resolve(), 3000); // timeout fallback
          });
        } catch (e) {
          // skip
        }
      }
      if (!cancelled) setThumbnails(newThumbs);
    };

    generateThumbs();
    return () => { cancelled = true; };
  }, [state.timelineSlots, state.clips]);

  // Words are in absolute time, currentTime is absolute
  const currentWordIdx = state.words.findIndex(
    w => state.currentTime >= w.start && state.currentTime < w.end
  );
  const currentWord = currentWordIdx >= 0 ? state.words[currentWordIdx] : null;

  // Relative time for display and timeline slots
  const relTime = Math.max(0, state.currentTime - state.trimStart);

  // Position in canvas pixels (1080×1920)
  const wordY = state.style.position === 'top' ? CANVAS_H * 0.12
    : state.style.position === 'center' ? CANVAS_H * 0.45
    : state.style.position === 'bottom' ? CANVAS_H * 0.82
    : (state.style.customY / 100) * CANVAS_H;
  const wordX = state.style.position === 'custom'
    ? (state.style.customX / 100) * CANVAS_W
    : CANVAS_W / 2;

  // FX transforms
  const fxScale = state.effects.zoom ? 1 + state.effects.intensity * 0.05 : 1;
  const fxRotate = state.effects.shake ? state.effects.intensity * 2 : 0;

  // Find currently active clip
  const activeSlot = state.timelineSlots.find(
    s => relTime >= s.start && relTime < s.end
  );
  const activeClip = activeSlot?.clipId
    ? state.clips.find(c => c.id === activeSlot.clipId)
    : null;

  // Sync play/pause — audio is the master timeline, video follows
  useEffect(() => {
    const audio = audioRef.current;
    const video = videoRef.current;
    if (!audio && !video) return;
    if (state.isPlaying) {
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

  // When active SLOT changes, reset video to beginning.
  // When active CLIP changes (different source), load new video src.
  // Video loops within slot if clip is shorter than slot.
  const prevSlotIdRef = useRef<string | null>(null);
  const activeClipIdRef = useRef<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!activeClip?.videoUrl) {
      prevSlotIdRef.current = null;
      activeClipIdRef.current = null;
      return;
    }

    const slotChanged = prevSlotIdRef.current !== activeSlot?.id;
    const clipChanged = activeClipIdRef.current !== activeClip.id;

    if (slotChanged || clipChanged) {
      prevSlotIdRef.current = activeSlot?.id ?? null;
      activeClipIdRef.current = activeClip.id;

      // Load new source if clip changed
      if (clipChanged) {
        video.src = activeClip.videoUrl;
      }
      // Always reset to beginning on slot change
      video.currentTime = 0;
      video.loop = true; // loop within slot if clip is short

      if (state.isPlaying) video.play().catch(() => {});
    }
  }, [activeSlot?.id, activeClip?.id, activeClip?.videoUrl, state.isPlaying]);

  const handleAudioTimeUpdate = useCallback((e: React.SyntheticEvent<HTMLAudioElement>) => {
    const t = e.currentTarget.currentTime;
    actions.seek(t);
    if (t >= state.trimEnd) {
      e.currentTarget.pause();
      actions.pause();
    }
  }, [actions, state.trimEnd]);

  // Video does NOT update state.currentTime — audio is the master timeline
  // Video just follows audio's time via its own onTimeUpdate being ignored

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  // Scaled pixel helper — converts canvas px to displayed px
  const px = (n: number) => n * scale;

  return (
    <div ref={containerRef} className="relative flex flex-col items-center justify-center h-full w-full">
      {/* 1080×1920 Canvas — scaled to fit */}
      <div
        className="relative bg-black overflow-hidden rounded-lg shadow-2xl"
        style={{
          width: `${px(CANVAS_W)}px`,
          height: `${px(CANVAS_H)}px`,
          flexShrink: 0,
        }}
      >
        {/* Inner canvas: 1080×1920 coordinate system, scaled */}
        <div
          className="absolute top-0 left-0"
          style={{
            width: `${CANVAS_W}px`,
            height: `${CANVAS_H}px`,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {/* Background blur layer */}
          {activeClip?.videoUrl && state.background !== 'black' && (
            <video
              src={activeClip.videoUrl}
              className="absolute inset-0"
              style={{
                width: `${CANVAS_W}px`,
                height: `${CANVAS_H}px`,
                objectFit: 'cover',
                filter: `blur(${state.background === 'subtle' ? 20 : state.background === 'medium' ? 40 : 60}px) brightness(0.3)`,
              }}
              muted
              playsInline
              loop
            />
          )}

          {/* Main video layer */}
          {activeClip?.videoUrl && (
            <video
              ref={videoRef}
              src={activeClip.videoUrl}
              className="absolute inset-0"
              style={{
                width: `${CANVAS_W}px`,
                height: `${CANVAS_H}px`,
                objectFit: state.framing === 'fit' ? 'contain' : 'cover',
                transform: `scale(${state.canvasPosition.scale * fxScale}) rotate(${state.canvasPosition.rotation + fxRotate}deg)`,
                transformOrigin: 'center',
              }}
              onEnded={() => { /* video loops, no action needed */ }}
              onClick={() => (state.isPlaying ? actions.pause() : actions.play())}
              playsInline
              muted
              loop
            />
          )}

          {/* Hidden audio element */}
          {state.audioUrl && (
            <audio
              ref={audioRef}
              src={state.audioUrl}
              onTimeUpdate={handleAudioTimeUpdate}
              onEnded={() => actions.pause()}
              style={{ display: 'none' }}
            />
          )}

          {/* Empty state — no audio */}
          {!state.audioUrl && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center space-y-4" style={{ color: '#555', fontSize: '48px' }}>
                <p style={{ fontSize: '96px' }}>🎬</p>
                <p>Upload audio to start</p>
                <p style={{ fontSize: '32px', color: '#333' }}>Then add video clips</p>
              </div>
            </div>
          )}

          {/* No clip but has audio — show video grid storyboard */}
          {state.audioUrl && !activeClip?.videoUrl && state.timelineSlots.length > 0 && (
            <div className="absolute inset-0 flex items-center justify-center z-5">
              <div
                className="grid gap-2 p-4"
                style={{
                  gridTemplateColumns: state.timelineSlots.length <= 2 ? '1fr' : '1fr 1fr',
                  maxWidth: `${CANVAS_W - 80}px`,
                }}
              >
                {state.timelineSlots.slice(0, 4).map((slot, i) => {
                  const clip = slot.clipId ? state.clips.find(c => c.id === slot.clipId) : null;
                  const thumb = clip ? thumbnails[clip.id] : null;
                  return (
                    <div
                      key={slot.id}
                      className="relative rounded-lg overflow-hidden border-2"
                      style={{
                        width: `${CANVAS_W * 0.28}px`,
                        height: `${CANVAS_H * 0.28}px`,
                        borderColor: slot.id === activeSlot?.id ? '#3b82f6' : '#333',
                      }}
                    >
                      {thumb ? (
                        <img src={thumb} alt={`Slot ${i+1}`} className="w-full h-full object-cover" />
                      ) : clip?.videoUrl ? (
                        <div className="w-full h-full bg-neutral-900 flex items-center justify-center">
                          <span style={{ fontSize: '24px' }}>⏳</span>
                        </div>
                      ) : (
                        <div className="w-full h-full bg-neutral-900 flex items-center justify-center">
                          <span style={{ fontSize: '32px', color: '#333' }}>📹</span>
                        </div>
                      )}
                      {/* Slot label */}
                      <div
                        className="absolute bottom-1 left-1 px-2 py-0.5 rounded text-white"
                        style={{ fontSize: '14px', background: 'rgba(0,0,0,0.6)' }}
                      >
                        #{i+1} · {slot.end - slot.start}s
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* No clip and no slots */}
          {state.audioUrl && !activeClip?.videoUrl && state.timelineSlots.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center space-y-4" style={{ color: '#555', fontSize: '48px' }}>
                <p style={{ fontSize: '96px' }}>🎵</p>
                <p>Audio loaded — add clips to see video</p>
                <p style={{ fontSize: '32px', color: '#333' }}>Upload clips or download from YouTube</p>
              </div>
            </div>
          )}

          {/* Lyrics overlay — positioned in 1080×1920 canvas pixels */}
          {currentWord && (
            <div
              className="absolute z-10 text-center pointer-events-none"
              style={{
                top: `${wordY}px`,
                left: `${wordX}px`,
                transform: 'translate(-50%, -50%)',
                fontFamily: state.style.fontFamily,
                fontSize: `${state.style.fontSize}px`,
                fontWeight: state.style.fontWeight,
                color: state.style.color,
                textShadow: '0 4px 16px rgba(0,0,0,0.8), 0 0 4px rgba(0,0,0,0.9)',
                whiteSpace: 'nowrap',
                maxWidth: `${CANVAS_W - 80}px`,
              }}
            >
              <span style={{ color: state.style.highlightColor }}>
                {currentWord.word}
              </span>
            </div>
          )}

          {/* Video grid storyboard — shown when paused, has slots with clips */}
          {state.audioUrl && activeClip?.videoUrl && !state.isPlaying && state.timelineSlots.length > 1 && (
            <div className="absolute inset-0 flex items-center justify-center z-25 pointer-events-none">
              <div
                className="grid gap-2 p-4 bg-black/60 rounded-xl"
                style={{
                  gridTemplateColumns: state.timelineSlots.length <= 2 ? '1fr' : '1fr 1fr',
                }}
              >
                {state.timelineSlots.slice(0, 4).map((slot, i) => {
                  const clip = slot.clipId ? state.clips.find(c => c.id === slot.clipId) : null;
                  const thumb = clip ? thumbnails[clip.id] : null;
                  return (
                    <div
                      key={slot.id}
                      className="relative rounded-lg overflow-hidden border-2"
                      style={{
                        width: `${CANVAS_W * 0.25}px`,
                        height: `${CANVAS_H * 0.25}px`,
                        borderColor: slot.id === activeSlot?.id ? '#3b82f6' : '#444',
                      }}
                    >
                      {thumb ? (
                        <img src={thumb} alt={`Slot ${i+1}`} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-neutral-800 flex items-center justify-center">
                          <span style={{ fontSize: '24px', color: '#555' }}>📹</span>
                        </div>
                      )}
                      <div
                        className="absolute bottom-1 left-1 px-2 py-0.5 rounded text-white"
                        style={{ fontSize: '12px', background: 'rgba(0,0,0,0.7)' }}
                      >
                        #{i+1} · {(slot.end - slot.start).toFixed(1)}s
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {state.effects.vignette && (
            <div
              className="absolute inset-0 pointer-events-none z-20"
              style={{ boxShadow: `inset 0 0 ${200 * state.effects.intensity}px rgba(0,0,0,0.6)` }}
            />
          )}

          {/* Flash */}
          {state.effects.flash && currentWordIdx >= 0 && (
            <div
              className="absolute inset-0 pointer-events-none z-20"
              style={{ background: 'white', opacity: state.effects.intensity * 0.15 }}
            />
          )}

          {/* Resolution label — top-left corner */}
          <div
            className="absolute top-2 left-2 z-30 pointer-events-none"
            style={{
              fontSize: '24px',
              color: 'rgba(255,255,255,0.3)',
              fontFamily: 'monospace',
            }}
          >
            1080×1920
          </div>

          {/* Safe zone indicators — TikTok safe areas */}
          {/* Top safe zone (status bar ~150px) */}
          <div
            className="absolute top-0 left-0 right-0 pointer-events-none z-30"
            style={{
              height: '150px',
              background: 'rgba(255,0,0,0.03)',
              borderBottom: '1px dashed rgba(255,0,0,0.15)',
            }}
          />
          {/* Bottom safe zone (UI controls ~400px) */}
          <div
            className="absolute bottom-0 left-0 right-0 pointer-events-none z-30"
            style={{
              height: '400px',
              background: 'rgba(255,0,0,0.03)',
              borderTop: '1px dashed rgba(255,0,0,0.15)',
            }}
          />
        </div>
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
        <span className="ml-2 px-2 py-0.5 bg-neutral-800 rounded text-neutral-500">
          1080×1920 · {(scale * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
}