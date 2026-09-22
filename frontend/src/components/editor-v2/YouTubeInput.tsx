import { useState } from 'react';

interface Props {
  onLoad: (url: string) => void;
  loading: boolean;
}

export default function YouTubeInput({ onLoad, loading }: Props) {
  const [url, setUrl] = useState('');

  const handleLoad = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    // Basic URL validation — accept youtube.com, youtu.be, and shorts
    if (!/youtube\.com|youtu\.be/i.test(trimmed)) {
      alert('Please paste a valid YouTube URL');
      return;
    }
    onLoad(trimmed);
  };

  return (
    <div className="flex items-center gap-2 w-80">
      <input
        type="text"
        value={url}
        onChange={e => setUrl(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && !loading && handleLoad()}
        placeholder="https://www.youtube.com/watch?v=..."
        disabled={loading}
        className="flex-1 px-3 py-2 text-xs bg-neutral-800 text-neutral-300 rounded border border-neutral-700 focus:border-cyan-500 focus:outline-none disabled:opacity-50"
      />
      <button
        onClick={handleLoad}
        disabled={loading || !url.trim()}
        className="px-3 py-2 text-xs bg-red-600 hover:bg-red-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white font-medium rounded transition-colors whitespace-nowrap"
      >
        {loading ? '⏳ Downloading...' : '▶ YouTube'}
      </button>
    </div>
  );
}