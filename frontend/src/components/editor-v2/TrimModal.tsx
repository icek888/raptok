import { useState, useRef, useEffect, useCallback } from 'react';
import type { PanelProps } from './EditorView';

const DURATION_PRESETS = [15, 20, 25, 30];

export default function TrimModal({ state, actions }: PanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [zoom, setZoom] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(state.trimStart);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Draw waveform on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !state.audioWaveform.length) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, W, H);

    // Draw waveform bars
    const bars = state.audioWaveform;
    const visibleBars = Math.floor(bars.length * zoom);
    const startBar = 0;
    const barWidth = W / visibleBars;
    ctx.fillStyle = '#333';
    for (let i = 0; i < visibleBars && i < bars.length; i++) {
      const x = i * barWidth;
      const h = bars[startBar + i] * H * 0.8;
      ctx.fillRect(x, (H - h) / 2, Math.max(1, barWidth - 1), h);
    }

    // Draw selection region
    const dur = state.audioDuration || 1;
    const startX = (state.trimStart / dur) * W;
    const endX = (state.trimEnd / dur) * W;
    ctx.fillStyle = 'rgba(34, 211, 238, 0.15)';
    ctx.fillRect(startX, 0, endX - startX, H);

    // Draw selection bars in cyan
    ctx.fillStyle = '#22d3ee';
    for (let i = 0; i < visibleBars && i < bars.length; i++) {
      const x = i * barWidth;
      const barTime = (i / visibleBars) * dur;
      if (barTime >= state.trimStart && barTime <= state.trimEnd) {
        const h = bars[startBar + i] * H * 0.8;
        ctx.fillRect(x, (H - h) / 2, Math.max(1, barWidth - 1), h);
      }
    }

    // Draw handles
    ctx.fillStyle = '#fff';
    ctx.fillRect(startX - 2, 0, 4, H);
    ctx.fillRect(endX - 2, 0, 4, H);

    // Draw playhead
    const phX = (playhead / dur) * W;
    ctx.fillStyle = '#22d3ee';
    ctx.fillRect(phX - 1, 0, 2, H);
  }, [state.audioWaveform, state.trimStart, state.trimEnd, state.audioDuration, playhead, zoom]);

  // Space to play/pause
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && state.audioFile) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [state.audioFile, playing, playhead]);

  // Handle file upload
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await actions.loadAudio(file);
    } finally {
      setUploading(false);
    }
  }, [actions]);

  // Handle mouse events on canvas
  const handleMouseDown = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || !state.audioDuration) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = (x / rect.width) * state.audioDuration;
    const distStart = Math.abs(time - state.trimStart);
    const distEnd = Math.abs(time - state.trimEnd);
    if (distStart < 2) {
      setDragging('start');
    } else if (distEnd < 2) {
      setDragging('end');
    } else {
      // Click on waveform → seek playhead
      setPlayhead(time);
      if (audioRef.current) {
        audioRef.current.currentTime = time;
        if (playing) {
          audioRef.current.play().catch(() => {});
        }
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !state.audioDuration) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const time = (x / rect.width) * state.audioDuration;
    if (dragging === 'start') {
      actions.trimAudio(Math.min(time, state.trimEnd - 5), state.trimEnd);
    } else {
      actions.trimAudio(state.trimStart, Math.max(time, state.trimStart + 5));
    }
  };

  const handleMouseUp = () => setDragging(null);

  const setDuration = (dur: number) => {
    actions.trimAudio(state.trimStart, Math.min(state.trimStart + dur, state.audioDuration || dur));
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.currentTime = playhead;
      audioRef.current.play();
      setPlaying(true);
    }
  };

  const handleAudioTimeUpdate = () => {
    if (!audioRef.current) return;
    const t = audioRef.current.currentTime;
    setPlayhead(t);
    if (t >= state.trimEnd) {
      audioRef.current.pause();
      setPlaying(false);
    }
  };

  const handleConfirm = () => {
    actions.closeTrimModal();
    actions.transcribe();
  };

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
      <div className="bg-neutral-900 rounded-xl p-6 w-[800px] max-w-[90vw]">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-white">TRIM YOUR AUDIO</h2>
            <p className="text-xs text-neutral-500 mt-1">
              {state.audioFile ? state.audioFile.name : 'No file selected'}
            </p>
          </div>
          <button
            onClick={() => actions.closeTrimModal()}
            className="text-neutral-500 hover:text-white text-xl w-8 h-8 flex items-center justify-center"
          >
            ×
          </button>
        </div>

        {/* Upload button (if no file) */}
        {!state.audioFile && (
          <div className="mb-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full py-8 border-2 border-dashed border-neutral-700 hover:border-cyan-500 rounded-lg text-neutral-400 hover:text-cyan-400 transition-colors"
            >
              {uploading ? 'Uploading...' : 'Click to upload MP3/WAV'}
            </button>
          </div>
        )}

        {/* Waveform canvas */}
        {state.audioFile && (
          <>
            <div className="relative mb-4">
              <canvas
                ref={canvasRef}
                width={760}
                height={120}
                className="w-full rounded-lg cursor-pointer"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              />
              <p className="text-xs text-neutral-600 mt-1">
                Drag the white handles to pick your 15-30s clip · Space to play · Ctrl+scroll to zoom
              </p>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-4 mb-4">
              <button
                onClick={togglePlay}
                className="w-10 h-10 flex items-center justify-center bg-cyan-500 text-black rounded-full hover:bg-cyan-400"
              >
                {playing ? '⏸' : '▶'}
              </button>
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-500">Zoom</span>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="0.5"
                  value={zoom}
                  onChange={e => setZoom(+e.target.value)}
                  className="w-24 accent-cyan-500"
                />
                <span className="text-xs text-neutral-400">{zoom.toFixed(1)}×</span>
              </div>
              <div className="text-xs text-neutral-400 ml-auto">
                Position: {fmtTime(playhead)}
              </div>
            </div>

            {/* Duration presets */}
            <div className="flex items-center gap-2 mb-6">
              <span className="text-xs text-neutral-500 mr-2">Duration:</span>
              {DURATION_PRESETS.map(d => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    Math.abs(state.trimmedDuration - d) < 0.5
                      ? 'bg-cyan-500 text-black'
                      : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                  }`}
                >
                  {d}s
                </button>
              ))}
              <span className="text-xs text-neutral-500 ml-auto">
                Selected: {state.trimmedDuration.toFixed(1)}s
              </span>
            </div>

            {/* Confirm button */}
            <button
              onClick={handleConfirm}
              className="w-full py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-lg transition-colors"
            >
              CONFIRM SELECTION
            </button>

            {/* Hidden audio element */}
            {state.audioUrl && (
              <audio
                ref={audioRef}
                src={state.audioUrl}
                onTimeUpdate={handleAudioTimeUpdate}
                onEnded={() => setPlaying(false)}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}