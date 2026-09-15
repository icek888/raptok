import { useState, useRef, useCallback } from 'react';
import type { PanelProps } from './EditorView';
import type { RefObject } from 'react';

interface Props extends PanelProps {
  videoRef: RefObject<HTMLVideoElement | null>;
}

export default function TimelineTracks({ state, actions, videoRef }: Props) {
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const dur = state.trimmedDuration || 1;

  // Time → pixel position
  const timeToX = useCallback((t: number, width: number) => {
    return (t / dur) * width * zoom;
  }, [dur, zoom]);

  // Pixel → time
  const xToTime = useCallback((x: number, width: number) => {
    return (x / (width * zoom)) * dur;
  }, [dur, zoom]);

  // Handle playhead drag
  const handleTimelineClick = (e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left + container.scrollLeft;
    const time = xToTime(x, rect.width);
    actions.seek(Math.max(0, Math.min(time, dur)));
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  };

  const beatDuration = state.bpm > 0 ? 60 / state.bpm : 0.5;
  const slotCount = Math.floor(dur / beatDuration);

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  const widthPct = `${zoom * 100}%`;

  return (
    <div className="flex flex-col h-full bg-neutral-950">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-neutral-800 text-xs">
        <button
          onClick={() => (state.isPlaying ? actions.pause() : actions.play())}
          className="w-6 h-6 flex items-center justify-center bg-neutral-800 hover:bg-neutral-700 rounded"
        >
          {state.isPlaying ? '⏸' : '▶'}
        </button>
        {state.bpm > 0 && <span className="text-neutral-400">{state.bpm} BPM</span>}
        <span className="text-neutral-500">Cuts: {state.timelineSlots.length}/{slotCount}</span>
        <button
          onClick={() => actions.generateSlots()}
          disabled={state.bpm === 0}
          className="px-2 py-0.5 text-[10px] bg-neutral-800 hover:bg-neutral-700 text-neutral-400 rounded disabled:opacity-50"
        >
          Gen Slots
        </button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-neutral-500">Zoom</span>
          <input
            type="range"
            min="1"
            max="4"
            step="0.1"
            value={zoom}
            onChange={e => setZoom(+e.target.value)}
            className="w-20 accent-cyan-500"
          />
          <span className="text-neutral-400 w-8">{zoom.toFixed(1)}×</span>
          <span className="text-neutral-500 ml-2">{fmtTime(state.currentTime)}</span>
        </div>
      </div>

      {/* Tracks */}
      <div
        ref={containerRef}
        className="flex-1 overflow-x-auto overflow-y-hidden relative"
        onClick={handleTimelineClick}
      >
        <div style={{ width: widthPct, minWidth: '100%' }} className="h-full relative">
          {/* Track 1: Words */}
          <div className="absolute top-0 left-0 right-0 h-[40px] border-b border-neutral-800">
            {state.words.map((w, i) => {
              const left = timeToX(w.start, 100);
              const width = Math.max(30, ((w.end - w.start) / dur) * 100 * zoom);
              const isActive = state.currentTime >= w.start && state.currentTime < w.end;
              return (
                <div
                  key={i}
                  onClick={e => { e.stopPropagation(); actions.selectWord(i); }}
                  className={`absolute top-1 h-[32px] flex items-center justify-center px-2 text-[10px] rounded cursor-pointer truncate ${
                    isActive
                      ? 'bg-cyan-500 text-black font-medium'
                      : state.selectedWordIndex === i
                      ? 'bg-cyan-900 text-cyan-300'
                      : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                  }`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                >
                  {w.word}
                </div>
              );
            })}
          </div>

          {/* Track 1.5: Cut markers (beat lines) */}
          <div className="absolute top-[40px] left-0 right-0 h-[2px]">
            {state.bpm > 0 && Array.from({ length: slotCount }).map((_, i) => {
              const t = i * beatDuration;
              const left = timeToX(t, 100);
              return (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 w-[1px] bg-fuchsia-500/40"
                  style={{ left: `${left}%` }}
                />
              );
            })}
          </div>

          {/* Track 2: Clip slots */}
          <div className="absolute top-[44px] left-0 right-0 h-[76px] border-b border-neutral-800">
            {state.timelineSlots.map((slot, i) => {
              const left = timeToX(slot.start, 100);
              const width = Math.max(20, ((slot.end - slot.start) / dur) * 100 * zoom);
              const clip = state.clips.find(c => c.id === slot.clipId);
              const isSelected = state.selectedSlotId === slot.id;
              return (
                <div
                  key={slot.id}
                  onClick={e => { e.stopPropagation(); actions.selectSlot(slot.id); }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    const clipId = e.dataTransfer.getData('clipId');
                    if (clipId) {
                      const slots = [...state.timelineSlots];
                      slots[i] = { ...slots[i], clipId };
                      // Direct state update through actions
                      // We use fillSlots as a proxy - TODO: add assignClip action
                    }
                  }}
                  className={`absolute top-1 h-[68px] rounded border overflow-hidden cursor-pointer ${
                    isSelected ? 'border-cyan-500' : 'border-neutral-700'
                  }`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                >
                  {clip ? (
                    <div className="w-full h-full bg-neutral-700 flex items-center justify-center">
                      {clip.thumbnail ? (
                        <img src={clip.thumbnail} className="w-full h-full object-cover" alt="" />
                      ) : (
                        <span className="text-[10px] text-neutral-400 truncate px-1">{clip.name.slice(0, 8)}</span>
                      )}
                    </div>
                  ) : (
                    <div className="w-full h-full bg-neutral-900 flex items-center justify-center">
                      <span className="text-[10px] text-neutral-600">{i + 1}</span>
                    </div>
                  )}
                </div>
              );
            })}
            {state.timelineSlots.length === 0 && (
              <div className="flex items-center justify-center h-full text-neutral-600 text-xs">
                Click "Gen Slots" to generate timeline slots from BPM
              </div>
            )}
          </div>

          {/* Track 3: Audio waveform */}
          <div className="absolute top-[120px] left-0 right-0 h-[60px]">
            <canvas
              ref={canvas => {
                if (canvas && state.audioWaveform.length) {
                  const ctx = canvas.getContext('2d');
                  if (!ctx) return;
                  const W = canvas.width = canvas.offsetWidth;
                  const H = canvas.height = canvas.offsetHeight;
                  ctx.fillStyle = '#0a0a0a';
                  ctx.fillRect(0, 0, W, H);
                  const bars = state.audioWaveform;
                  const barWidth = W / bars.length;
                  ctx.fillStyle = '#444';
                  for (let i = 0; i < bars.length; i++) {
                    const x = i * barWidth;
                    const h = bars[i] * H * 0.8;
                    ctx.fillRect(x, (H - h) / 2, Math.max(1, barWidth - 0.5), h);
                  }
                }
              }}
              className="w-full h-full"
            />
          </div>

          {/* Playhead (vertical line across all tracks) */}
          <div
            className="absolute top-0 bottom-0 w-[2px] bg-cyan-400 pointer-events-none z-30"
            style={{ left: `${timeToX(state.currentTime, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}