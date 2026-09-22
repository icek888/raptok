import { useState } from 'react';

interface Props {
  onLoad: (url: string) => void;
  loading: boolean;
}

export default function YouTubeInput({ onLoad, loading }: Props) {
  const [url, setUrl] = useState('');
  const [downloading, setDownloading] = useState(false);

  const handleLoad = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!/youtube\.com|youtu\.be/i.test(trimmed)) {
      alert('Please paste a valid YouTube URL');
      return;
    }
    setDownloading(true);
    try {
      await onLoad(trimmed);
    } finally {
      setDownloading(false);
    }
  };

  const isLoading = loading || downloading;

  return (
    <div className="flex items-center gap-2 w-80">
      <input
        type="text"
        value={url}
        onChange={e => setUrl(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && !isLoading && handleLoad()}
        placeholder="https://www.youtube.com/watch?v=..."
        disabled={isLoading}
        className="flex-1 px-3 py-2 text-xs bg-neutral-800 text-neutral-300 rounded border border-neutral-700 focus:border-cyan-500 focus:outline-none disabled:opacity-50"
      />
      <button
        onClick={handleLoad}
        disabled={isLoading || !url.trim()}
        className="px-3 py-2 text-xs bg-red-600 hover:bg-red-500 disabled:bg-neutral-800 disabled:text-neutral-600 text-white font-medium rounded transition-colors whitespace-nowrap"
      >
        {isLoading ? '⏳ Downloading...' : '▶ YouTube'}
      </button>
    </div>
  );
}