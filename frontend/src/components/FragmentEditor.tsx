import { useState, useEffect } from 'react';
import { Shuffle, RefreshCw, Plus, Trash2, Clock, Image as ImageIcon, Loader2 } from 'lucide-react';
import { api } from '../api/client';
import type { Fragment, VideoInfo } from '../types';

interface Props {
  videoInfo: VideoInfo;
  fragments: Fragment[];
  onFragmentsChange: (fragments: Fragment[]) => void;
}

export function FragmentEditor({ videoInfo, fragments, onFragmentsChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [rerolling, setRerolling] = useState(false);
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const [totalDuration, setTotalDuration] = useState(0);

  useEffect(() => {
    setTotalDuration(fragments.reduce((s, f) => s + f.duration, 0));
  }, [fragments]);

  const selectFragments = async (seed?: number) => {
    setLoading(true);
    try {
      const result = await api.selectFragments(videoInfo.duration, 7, 3, 5, seed);
      onFragmentsChange(result.fragments);
      await fetchThumbnails(result.fragments);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchThumbnails = async (frags: Fragment[]) => {
    const timestamps = frags.map(f => (f.start + f.end) / 2);
    try {
      const result = await api.getThumbnails(videoInfo.local_path, timestamps);
      const map: Record<number, string> = {};
      for (const t of result.thumbnails) {
        if (t.path) {
          const filename = t.path.split('/').pop();
          if (filename) map[frags[t.index].id] = api.thumbnailUrl(filename);
        }
      }
      setThumbnails(map);
    } catch (e) {
      console.error('Thumbnail fetch failed:', e);
    }
  };

  const handleReroll = async () => {
    setRerolling(true);
    await selectFragments(Math.floor(Math.random() * 100000));
    setRerolling(false);
  };

  const handleReplace = async (fragId: number) => {
    const frag = fragments.find(f => f.id === fragId);
    if (!frag) return;
    // Replace with a random new start within video duration
    const maxStart = Math.max(0, videoInfo.duration - frag.duration - 5);
    const newStart = Math.random() * maxStart;
    try {
      const result = await api.replaceFragment(videoInfo.duration, fragments, fragId, newStart, frag.duration);
      onFragmentsChange(result.fragments);
      // Update thumbnail for replaced fragment
      const newFrags = result.fragments;
      const replaced = newFrags.find(f => f.id === fragId);
      if (replaced) {
        const ts = [(replaced.start + replaced.end) / 2];
        const thumbResult = await api.getThumbnails(videoInfo.local_path, ts);
        if (thumbResult.thumbnails[0]?.path) {
          const filename = thumbResult.thumbnails[0].path.split('/').pop();
          if (filename) {
            setThumbnails(prev => ({ ...prev, [fragId]: api.thumbnailUrl(filename) }));
          }
        }
      }
    } catch (e) {
      console.error('Replace failed:', e);
    }
  };

  const handleAdd = () => {
    if (totalDuration >= 30) return;
    const newId = Math.max(...fragments.map(f => f.id), -1) + 1;
    const maxStart = Math.max(0, videoInfo.duration - 4);
    const newStart = Math.random() * maxStart;
    const newFrag: Fragment = { id: newId, start: newStart, end: newStart + 4, duration: 4 };
    onFragmentsChange([...fragments, newFrag]);
  };

  const handleRemove = (fragId: number) => {
    if (fragments.length <= 3) return;
    onFragmentsChange(fragments.filter(f => f.id !== fragId));
    setThumbnails(prev => {
      const copy = { ...prev };
      delete copy[fragId];
      return copy;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">
            {fragments.length} fragments · {totalDuration.toFixed(1)}s
          </span>
          {totalDuration < 21 && (
            <span className="text-xs text-yellow-500 ml-2">Min 21s recommended</span>
          )}
          {totalDuration > 30 && (
            <span className="text-xs text-red-500 ml-2">Max 30s exceeded</span>
          )}
        </div>
        <div className="flex gap-2">
          {fragments.length === 0 ? (
            <button
              onClick={() => selectFragments()}
              disabled={loading}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium flex items-center gap-2 transition disabled:opacity-40"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Shuffle size={14} />}
              Select Fragments
            </button>
          ) : (
            <>
              <button
                onClick={handleReroll}
                disabled={rerolling}
                className="px-3 py-2 bg-[#1a1a2a] hover:bg-[#2a2a3a] rounded-lg text-sm flex items-center gap-2 transition disabled:opacity-40"
              >
                {rerolling ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Re-roll
              </button>
              <button
                onClick={handleAdd}
                disabled={totalDuration >= 30 || fragments.length >= 10}
                className="px-3 py-2 bg-[#1a1a2a] hover:bg-[#2a2a3a] rounded-lg text-sm flex items-center gap-2 transition disabled:opacity-40"
              >
                <Plus size={14} /> Add
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {fragments.map(frag => (
          <div key={frag.id} className="bg-[#0f0f17] border border-[#1a1a2a] rounded-lg overflow-hidden group hover:border-purple-500/30 transition">
            <div className="relative aspect-video bg-[#0a0a0f] flex items-center justify-center">
              {thumbnails[frag.id] ? (
                <img src={thumbnails[frag.id]} alt="" className="w-full h-full object-cover" />
              ) : (
                <ImageIcon size={24} className="text-gray-600" />
              )}
              <div className="absolute top-2 left-2 bg-black/70 px-2 py-1 rounded text-xs text-gray-300 font-mono">
                {formatTime(frag.start)} - {formatTime(frag.end)}
              </div>
              <div className="absolute top-2 right-2 bg-purple-600/80 px-2 py-1 rounded text-xs text-white font-mono">
                {frag.duration.toFixed(1)}s
              </div>
            </div>
            <div className="flex items-center justify-between p-2">
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <Clock size={12} /> #{frag.id + 1}
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
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}