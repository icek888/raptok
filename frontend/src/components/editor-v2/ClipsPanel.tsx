import { useState, useRef, useCallback } from 'react';
import type { PanelProps } from './EditorView';
import type { Clip } from './types';

export default function ClipsPanel({ state, actions }: PanelProps) {
  const [activeTab, setActiveTab] = useState<'stock' | 'user'>('user');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const userClips = state.clips.filter(c => c.source === 'user');
  const shufflable = state.clips.filter(c => !c.locked).length;

  const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(f => actions.uploadClip(f));
    e.target.value = '';
  }, [actions]);

  const handleDragStart = (e: React.DragEvent, clipId: string) => {
    e.dataTransfer.setData('clipId', clipId);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-neutral-800">
        <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">Clips</h3>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-3 py-2 border-b border-neutral-800">
        <button
          onClick={() => setActiveTab('user')}
          className={`px-2 py-1 text-xs rounded ${activeTab === 'user' ? 'bg-neutral-700 text-white' : 'text-neutral-500 hover:text-neutral-300'}`}
        >
          User
        </button>
        <button
          onClick={() => setActiveTab('stock')}
          className={`px-2 py-1 text-xs rounded ${activeTab === 'stock' ? 'bg-neutral-700 text-white' : 'text-neutral-500 hover:text-neutral-300'}`}
        >
          Stock
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="ml-auto px-2 py-1 text-xs text-cyan-400 hover:text-cyan-300"
        >
          + Upload
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          multiple
          onChange={handleUpload}
          className="hidden"
        />
      </div>

      {/* Clip grid */}
      <div className="flex-1 overflow-y-auto p-2">
        {activeTab === 'stock' ? (
          <div className="flex items-center justify-center h-full text-neutral-600 text-xs text-center px-4">
            Stock library coming soon
          </div>
        ) : userClips.length === 0 ? (
          <div className="flex items-center justify-center h-full text-neutral-600 text-xs text-center px-4">
            No clips yet.<br />Upload to get started.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {userClips.map((clip: Clip) => (
              <div
                key={clip.id}
                draggable
                onDragStart={e => handleDragStart(e, clip.id)}
                onClick={() => actions.lockClip(clip.id)}
                className={`relative aspect-video bg-neutral-800 rounded cursor-grab active:cursor-grabbing overflow-hidden group ${clip.locked ? 'ring-2 ring-amber-500' : ''}`}
              >
                {clip.thumbnail ? (
                  <img src={clip.thumbnail} alt={clip.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-neutral-600 text-xs">
                    {clip.name.slice(0, 12)}
                  </div>
                )}
                <span className="absolute bottom-1 right-1 text-[10px] bg-black/70 px-1 rounded text-neutral-300">
                  {clip.duration.toFixed(1)}s
                </span>
                {clip.locked && (
                  <span className="absolute top-1 left-1 text-[10px] bg-amber-500 text-black px-1 rounded">🔒</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div className="border-t border-neutral-800 px-3 py-2 space-y-2">
        <p className="text-xs text-neutral-500">{shufflable} shufflable</p>
        <div className="flex gap-2">
          <button
            onClick={() => actions.fillSlots()}
            disabled={state.clips.length === 0}
            className="flex-1 py-1.5 text-xs bg-cyan-500 hover:bg-cyan-400 disabled:bg-neutral-800 disabled:text-neutral-600 text-black font-medium rounded"
          >
            FILL
          </button>
          <button
            onClick={() => actions.shuffleSlots()}
            disabled={shufflable === 0}
            className="flex-1 py-1.5 text-xs bg-neutral-800 hover:bg-neutral-700 disabled:text-neutral-600 text-neutral-300 rounded"
          >
            SHUFFLE
          </button>
        </div>
      </div>
    </div>
  );
}