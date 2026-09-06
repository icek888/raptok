import { useState, useEffect, useCallback } from 'react';
import { Shuffle, RefreshCw, Trash2, Clock, Image as ImageIcon, Loader2, Scissors } from 'lucide-react';
import { api } from '../api/client';
import type { Fragment, VideoInfo } from '../types';

interface Props {
  videoInfo: VideoInfo;
  fragments: Fragment[];
  onFragmentsChange: (fragments: Fragment[]) => void;
  audioPath: string | null;
  /** Duration of the audio segment — fragments MUST sum to this. */
  segmentDuration: number;
}

/**
 * Simple fragment editor:
 * - User picks how many fragments they want (slider 3–12)
 * - Each fragment = segmentDuration / count (equal split)
 * - Random start points from the uploaded video
 * - Shuffle re-rolls random starts
 * - Total duration is ALWAYS locked to segmentDuration
 */
export function FragmentEditor({
  videoInfo, fragments, onFragmentsChange, segmentDuration,
}: Props) {
  const [count, setCount] = useState(7);
  const [loading, setLoading] = useState(false);
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});

  const totalDuration = fragments.reduce((s, f) => s + f.duration, 0);

  /**
   * Generate `n` random fragments from the video that sum exactly to segmentDuration.
   * Each fragment has duration = segmentDuration / n.
   * Start points are random within [0, videoDuration - fragDuration].
   */
  const generateFragments = useCallback((n: number): Fragment[] => {
    const fragDur = segmentDuration / n;
    const maxStart = Math.max(0, videoInfo.duration - fragDur);
    return Array.from({ length: n }, (_, i) => {
      const start = Math.random() * maxStart;
      return {
        id: i,
        start: Math.round(start * 10) / 10,
        end: Math.round((start + fragDur) * 10) / 10,
        duration: Math.round(fragDur * 10) / 10,
      };
    });
  }, [segmentDuration, videoInfo.duration]);

  // Auto-generate on mount if no fragments
  useEffect(() => {
    if (fragments.length === 0 && segmentDuration > 0 && videoInfo.duration > 0) {
      const frags = generateFragments(count);
      onFragmentsChange(frags);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerate = async (newCount?: number) => {
    const n = newCount ?? count;
    setLoading(true);
    const frags = generateFragments(n);
    onFragmentsChange(frags);
    await fetchThumbnails(frags);
    setLoading(false);
  };

  const handleCountChange = async (newCount: number) => {
    setCount(newCount);
    await handleGenerate(newCount);
  };

  const handleShuffle = async () => {
    setLoading(true);
    // Keep same count, just re-roll start points
    const fragDur = segmentDuration / count;
    const maxStart = Math.max(0, videoInfo.duration - fragDur);
    const frags = fragments.map(f => {
      const start = Math.random() * maxStart;
      return {
        ...f,
        start: Math.round(start * 10) / 10,
        end: Math.round((start + fragDur) * 10) / 10,
      };
    });
    onFragmentsChange(frags);
    await fetchThumbnails(frags);
    setLoading(false);
  };

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
    // Fetch thumbnail for just the replaced fragment
    try {
      const replaced = newFrags.find(f => f.id === fragId)!;
      const ts = [(replaced.start + replaced.end) / 2];
      const result = await api.getThumbnails(videoInfo.local_path, ts);
      if (result.thumbnails[0]?.path) {
        const filename = result.thumbnails[0].path.split('/').pop();
        if (filename) {
          setThumbnails(prev => ({ ...prev, [fragId]: api.thumbnailUrl(filename) }));
        }
      }
    } catch (e) {
      console.error('Thumbnail fetch failed:', e);
    }
  };

  const handleRemove = (fragId: number) => {
    if (fragments.length <= 3) return;
    const newCount = fragments.length - 1;
    setCount(newCount);
    // Redistribute durations evenly
    const fragDur = segmentDuration / newCount;
    const maxStart = Math.max(0, videoInfo.duration - fragDur);
    const remaining = fragments.filter(f => f.id !== fragId);
    const newFrags = remaining.map((f, i) => ({
      ...f,
      id: i,
      duration: Math.round(fragDur * 10) / 10,
      start: Math.round(Math.random() * maxStart * 10) / 10,
      end: 0, // will be set below
    }));
    newFrags.forEach(f => { f.end = Math.round((f.start + fragDur) * 10) / 10; });
    onFragmentsChange(newFrags);
    setThumbnails(prev => {
      const copy = { ...prev };
      delete copy[fragId];
      return copy;
    });
  };

  const handleAdd = () => {
    if (fragments.length >= 12) return;
    const newCount = fragments.length + 1;
    setCount(newCount);
    // Redistribute durations evenly
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

  const fetchThumbnails = async (frags: Fragment[]) => {
    const timestamps = frags.map(f => (f.start + f.end) / 2);
    try {
      const result = await api.getThumbnails(videoInfo.local_path, timestamps);
      const map: Record<number, string> = {};
      for (const t of result.thumbnails) {
        if (t.path && frags[t.index]) {
          const filename = t.path.split('/').pop();
          if (filename) map[frags[t.index].id] = api.thumbnailUrl(filename);
        }
      }
      setThumbnails(map);
    } catch (e) {
      console.error('Thumbnail fetch failed:', e);
    }
  };

  // Fetch thumbnails when fragments change (if not already loaded)
  useEffect(() => {
    if (fragments.length > 0 && Object.keys(thumbnails).length === 0) {
      fetchThumbnails(fragments);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fragments]);

  return (
    <div className="space-y-4">
      {/* Header — clean and simple */}
      <div className="flex items-center gap-2 mb-1">
        <Scissors size={18} className="text-purple-400" />
        <h2 className="text-base font-semibold text-white">Video Fragments</h2>
        <span className="text-xs text-gray-500 ml-auto">
          {fragments.length} clips · {totalDuration.toFixed(1)}s total
        </span>
      </div>

      {/* Count slider + Shuffle */}
      <div className="flex items-center gap-4 bg-[#0f0f17] border border-[#1a1a2a] rounded-xl p-3">
        <div className="flex-1">
          <label className="text-xs text-gray-400 mb-1 block">
            Fragments: <span className="text-purple-300 font-mono font-bold">{count}</span>
            <span className="text-gray-600 ml-2">({(segmentDuration / count).toFixed(1)}s each)</span>
          </label>
          <input
            type="range" min={3} max={12} step={1}
            value={count}
            onChange={e => handleCountChange(parseInt(e.target.value))}
            className="w-full accent-purple-500"
          />
        </div>
        <button
          onClick={handleShuffle}
          disabled={loading}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium flex items-center gap-2 transition disabled:opacity-40"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Shuffle size={14} />}
          Shuffle
        </button>
      </div>

      {/* Fragment grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {fragments.map((frag, i) => (
          <div
            key={frag.id}
            className="bg-[#0f0f17] border border-[#1a1a2a] rounded-lg overflow-hidden group hover:border-purple-500/30 transition"
          >
            <div className="relative aspect-video bg-[#0a0a0f] flex items-center justify-center">
              {thumbnails[frag.id] ? (
                <img src={thumbnails[frag.id]} alt="" className="w-full h-full object-cover" />
              ) : (
                <ImageIcon size={24} className="text-gray-600" />
              )}
              {/* Fragment number badge */}
              <div className="absolute top-2 left-2 bg-black/70 px-2 py-0.5 rounded text-xs text-gray-300 font-mono">
                #{i + 1}
              </div>
              {/* Duration badge */}
              <div className="absolute top-2 right-2 bg-purple-600/80 px-2 py-0.5 rounded text-xs text-white font-mono">
                {frag.duration.toFixed(1)}s
              </div>
              {/* Timestamp */}
              <div className="absolute bottom-2 left-2 bg-black/70 px-2 py-0.5 rounded text-[10px] text-gray-400 font-mono">
                {formatTime(frag.start)} — {formatTime(frag.end)}
              </div>
            </div>
            <div className="flex items-center justify-between p-2">
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <Clock size={12} /> clip {i + 1}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => handleReplace(frag.id)}
                  className="p-1.5 hover:bg-purple-600/20 rounded text-purple-400 transition"
                  title="Replace with random"
                >
                  <RefreshCw size={14} />
                </button>
                <button
                  onClick={() => handleRemove(frag.id)}
                  disabled={fragments.length <= 3}
                  className="p-1.5 hover:bg-red-600/20 rounded text-red-400 transition disabled:opacity-30"
                  title="Remove"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}

        {/* Add card */}
        {fragments.length < 12 && (
          <button
            onClick={handleAdd}
            className="aspect-video bg-[#0a0a0f] border border-dashed border-[#2a2a3a] rounded-lg flex flex-col items-center justify-center gap-2 text-gray-500 hover:text-purple-400 hover:border-purple-500/30 transition"
          >
            <Scissors size={20} />
            <span className="text-xs">Add fragment</span>
          </button>
        )}
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}