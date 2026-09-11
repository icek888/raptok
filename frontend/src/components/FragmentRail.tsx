import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Trash2, Plus, GripVertical, ArrowLeftRight } from 'lucide-react';
import { api } from '../api/client';
import type { Fragment, VideoInfo } from '../types';

interface Props {
  videoInfo: VideoInfo;
  fragments: Fragment[];
  onFragmentsChange: (fragments: Fragment[]) => void;
  segmentDuration: number;
  cropMode: string;
  activeFragmentIdx: number;
  onFragmentClick: (idx: number) => void;
}

export function FragmentRail({
  videoInfo, fragments, onFragmentsChange, segmentDuration,
  cropMode, activeFragmentIdx, onFragmentClick,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const [multiFrames, setMultiFrames] = useState<Record<number, string[]>>({});
  const [hoveredFrag, setHoveredFrag] = useState<number | null>(null);
  const [hoverFrameIdx, setHoverFrameIdx] = useState(0);
  const [dragIdx, setDragIdx] = useState(-1);
  const [dropIdx, setDropIdx] = useState(-1);
  const [adjustingFrag, setAdjustingFrag] = useState<number | null>(null);

  // Fetch 9:16 preview for all fragments
  const fetchPreviews = useCallback(async (frags: Fragment[]) => {
    const map: Record<number, string> = {};
    await Promise.all(frags.map(async (frag) => {
      const midTs = (frag.start + frag.end) / 2;
      try {
        const res = await api.fragmentPreview916(videoInfo.local_path, midTs, cropMode);
        map[frag.id] = res.preview_url;
      } catch (e) {
        console.error('Preview fetch failed for frag', frag.id, e);
      }
    }));
    setPreviews(map);
  }, [videoInfo.local_path, cropMode]);

  // Fetch multi-frame previews for hover scrub (3 frames: 25%, 50%, 75%)
  const fetchMultiFrames = useCallback(async (frag: Fragment) => {
    const ts25 = frag.start + frag.duration * 0.25;
    const ts50 = frag.start + frag.duration * 0.50;
    const ts75 = frag.start + frag.duration * 0.75;
    try {
      const res = await api.fragmentPreviewMulti(
        videoInfo.local_path, [ts25, ts50, ts75], cropMode,
      );
      const urls = res.frames
        .filter(f => f.preview_url)
        .map(f => f.preview_url);
      if (urls.length > 0) {
        setMultiFrames(prev => ({ ...prev, [frag.id]: urls }));
      }
    } catch (e) {
      console.error('Multi-frame fetch failed', e);
    }
  }, [videoInfo.local_path, cropMode]);

  // Re-fetch previews when fragment content changes (start/end/duration)
  const fragsKey = JSON.stringify(fragments.map(f => `${f.id}:${f.start}:${f.end}`));
  useEffect(() => {
    if (fragments.length > 0) {
      fetchPreviews(fragments);
    }
  }, [fragsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Animate hover frames (cycle through multi-frames every 500ms)
  useEffect(() => {
    if (hoveredFrag === null) return;
    const frames = multiFrames[hoveredFrag];
    if (!frames || frames.length <= 1) return;
    const interval = setInterval(() => {
      setHoverFrameIdx(prev => (prev + 1) % frames.length);
    }, 500);
    return () => clearInterval(interval);
  }, [hoveredFrag, multiFrames]);

  // ── Drag-swap ──
  const handleDragStart = (e: React.DragEvent, idx: number) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (idx !== dragIdx) setDropIdx(idx);
  };

  const handleDrop = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx < 0 || dragIdx === idx) {
      setDragIdx(-1);
      setDropIdx(-1);
      return;
    }
    // Swap fragment positions (array order, not timing)
    const newFrags = [...fragments];
    const tmp = newFrags[dragIdx];
    newFrags[dragIdx] = newFrags[idx];
    newFrags[idx] = tmp;
    // Re-assign IDs to match new positions
    newFrags.forEach((f, i) => { f.id = i; });
    onFragmentsChange(newFrags);
    setDragIdx(-1);
    setDropIdx(-1);
  };

  const handleDragEnd = () => {
    setDragIdx(-1);
    setDropIdx(-1);
  };

  // ── Replace (random new start) ──
  const handleReplace = async (fragId: number) => {
    const frag = fragments.find(f => f.id === fragId);
    if (!frag) return;
    const maxStart = Math.max(0, videoInfo.duration - frag.duration);
    const newStart = Math.round(Math.random() * maxStart * 10) / 10;
    const newFrags = fragments.map(f =>
      f.id === fragId
        ? { ...f, start: newStart, end: Math.round((newStart + frag.duration) * 10) / 10 }
        : f
    );
    onFragmentsChange(newFrags);
    // Fetch new preview
    const replaced = newFrags.find(f => f.id === fragId)!;
    const midTs = (replaced.start + replaced.end) / 2;
    try {
      const res = await api.fragmentPreview916(videoInfo.local_path, midTs, cropMode);
      setPreviews(prev => ({ ...prev, [fragId]: res.preview_url }));
      setMultiFrames(prev => { const c = { ...prev }; delete c[fragId]; return c; });
    } catch (e) { console.error('Replace preview failed', e); }
  };

  // ── Adjust (shift start ±N seconds) ──
  const handleAdjust = (fragId: number, delta: number) => {
    const frag = fragments.find(f => f.id === fragId);
    if (!frag) return;
    const maxStart = Math.max(0, videoInfo.duration - frag.duration);
    let newStart = Math.round((frag.start + delta) * 10) / 10;
    newStart = Math.max(0, Math.min(newStart, maxStart));
    const newFrags = fragments.map(f =>
      f.id === fragId
        ? { ...f, start: newStart, end: Math.round((newStart + frag.duration) * 10) / 10 }
        : f
    );
    onFragmentsChange(newFrags);
  };

  // ── Remove ──
  const handleRemove = (fragId: number) => {
    if (fragments.length <= 3) return;
    const remaining = fragments.filter(f => f.id !== fragId);
    const newCount = remaining.length;
    const fragDur = segmentDuration / newCount;
    const maxStart = Math.max(0, videoInfo.duration - fragDur);
    const newFrags = remaining.map((f, i) => ({
      ...f,
      id: i,
      duration: Math.round(fragDur * 10) / 10,
      start: Math.round(Math.random() * maxStart * 10) / 10,
      end: 0 as number,
    }));
    newFrags.forEach(f => { f.end = Math.round((f.start + fragDur) * 10) / 10; });
    onFragmentsChange(newFrags);
    setPreviews(prev => { const c = { ...prev }; delete c[fragId]; return c; });
    setMultiFrames(prev => { const c = { ...prev }; delete c[fragId]; return c; });
  };

  // ── Add ──
  const handleAdd = () => {
    if (fragments.length >= 12) return;
    const newCount = fragments.length + 1;
    const fragDur = segmentDuration / newCount;
    const maxStart = Math.max(0, videoInfo.duration - fragDur);
    const newFrags = Array.from({ length: newCount }, (_, i) => {
      const start = Math.round(Math.random() * maxStart * 10) / 10;
      return {
        id: i,
        start,
        end: Math.round((start + fragDur) * 10) / 10,
        duration: Math.round(fragDur * 10) / 10,
      };
    });
    onFragmentsChange(newFrags);
  };

  // ── Shuffle (re-roll all starts) ──
  const handleShuffle = async () => {
    setLoading(true);
    const fragDur = segmentDuration / fragments.length;
    const maxStart = Math.max(0, videoInfo.duration - fragDur);
    const newFrags = fragments.map(f => {
      const start = Math.round(Math.random() * maxStart * 10) / 10;
      return {
        ...f,
        start,
        end: Math.round((start + fragDur) * 10) / 10,
      };
    });
    onFragmentsChange(newFrags);
    setMultiFrames({});
    setLoading(false);
  };

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-1 pb-2">
        <span className="text-xs text-gray-500 font-medium">
          {fragments.length} clips · {segmentDuration.toFixed(1)}s
        </span>
        <button
          onClick={handleShuffle}
          disabled={loading}
          className="ml-auto px-2 py-1 bg-purple-600 hover:bg-purple-500 rounded text-[10px] font-medium flex items-center gap-1 transition disabled:opacity-40"
        >
          {loading ? '...' : '🎲 Shuffle'}
        </button>
      </div>

      {/* Fragment rail — vertical scroll */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[440px]">
        {fragments.map((frag, i) => (
          <div
            key={`frag-${i}`}
            draggable
            onDragStart={(e) => handleDragStart(e, i)}
            onDragOver={(e) => handleDragOver(e, i)}
            onDrop={(e) => handleDrop(e, i)}
            onDragEnd={handleDragEnd}
            onMouseEnter={() => {
              setHoveredFrag(frag.id);
              if (!multiFrames[frag.id]) fetchMultiFrames(frag);
            }}
            onMouseLeave={() => { setHoveredFrag(null); setHoverFrameIdx(0); }}
            onClick={() => onFragmentClick(i)}
            className={`relative bg-[#0f0f17] border rounded-lg overflow-hidden cursor-grab active:cursor-grabbing transition ${
              activeFragmentIdx === i
                ? 'border-purple-500 ring-2 ring-purple-500/30'
                : dropIdx === i
                ? 'border-purple-400 border-dashed'
                : 'border-[#1a1a2a] hover:border-[#2a2a3a]'
            }`}
          >
            {/* Drag handle */}
            <div className="absolute top-1 left-1 z-10 cursor-grab opacity-50 hover:opacity-100">
              <GripVertical size={12} className="text-gray-400" />
            </div>

            {/* 9:16 preview */}
            <div className="relative mx-auto bg-[#0a0a0f]" style={{ width: '100%', aspectRatio: '9/16', maxHeight: '180px' }}>
              {previews[frag.id] ? (
                <img
                  src={
                    hoveredFrag === frag.id && multiFrames[frag.id]?.length
                      ? multiFrames[frag.id][hoverFrameIdx % multiFrames[frag.id].length]
                      : previews[frag.id]
                  }
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {/* Fragment number */}
              <div className="absolute top-1 right-1 bg-black/70 px-1.5 py-0.5 rounded text-[10px] text-gray-300 font-mono">
                #{i + 1}
              </div>
              {/* Duration badge */}
              <div className="absolute bottom-1 left-1 bg-black/70 px-1.5 py-0.5 rounded text-[10px] text-gray-400 font-mono">
                {frag.duration.toFixed(1)}s · {formatTime(frag.start)}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-between px-1.5 py-1">
              <button
                onClick={(e) => { e.stopPropagation(); handleReplace(frag.id); }}
                className="p-1 hover:bg-purple-600/20 rounded text-purple-400 transition"
                title="Replace with random"
              >
                <RefreshCw size={11} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setAdjustingFrag(adjustingFrag === frag.id ? null : frag.id); }}
                className={`p-1 rounded transition ${
                  adjustingFrag === frag.id ? 'bg-purple-600/30 text-purple-300' : 'hover:bg-purple-600/20 text-purple-400'
                }`}
                title="Adjust start"
              >
                <ArrowLeftRight size={11} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleRemove(frag.id); }}
                disabled={fragments.length <= 3}
                className="p-1 hover:bg-red-600/20 rounded text-red-400 transition disabled:opacity-30"
                title="Remove"
              >
                <Trash2 size={11} />
              </button>
            </div>

            {/* Adjust slider */}
            {adjustingFrag === frag.id && (
              <div className="px-2 pb-2">
                <input
                  type="range"
                  min={-5}
                  max={5}
                  step={0.5}
                  defaultValue={0}
                  onChange={(e) => handleAdjust(frag.id, parseFloat(e.target.value))}
                  className="w-full accent-purple-500"
                />
                <div className="text-[9px] text-gray-600 text-center mt-0.5">
                  Shift: ±5s · now {formatTime(frag.start)}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Add card */}
        {fragments.length < 12 && (
          <button
            onClick={handleAdd}
            className="bg-[#0a0a0f] border border-dashed border-[#2a2a3a] rounded-lg flex items-center justify-center gap-1 text-gray-500 hover:text-purple-400 hover:border-purple-500/30 transition py-3"
          >
            <Plus size={14} />
            <span className="text-[10px]">Add fragment</span>
          </button>
        )}
      </div>

      {/* Filmstrip — horizontal overview at bottom */}
      <div className="border-t border-[#1a1a2a] pt-2 mt-2">
        <div className="flex gap-1 overflow-x-auto">
          {fragments.map((frag, i) => (
            <button
              key={`film-${i}`}
              onClick={() => onFragmentClick(i)}
              className={`relative shrink-0 rounded overflow-hidden border transition ${
                activeFragmentIdx === i ? 'border-purple-500' : 'border-[#1a1a2a]'
              }`}
              style={{ width: 28, height: 50 }}
              title={`#${i + 1} ${formatTime(frag.start)}`}
            >
              {previews[frag.id] ? (
                <img src={previews[frag.id]} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-[#0a0a0f]" />
              )}
              <span className="absolute bottom-0 left-0 right-0 text-[7px] text-white bg-black/60 text-center">
                {i + 1}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}