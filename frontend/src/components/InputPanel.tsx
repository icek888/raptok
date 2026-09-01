import { useState } from 'react';
import { Link2, Loader2, AlertCircle, Film, Upload } from 'lucide-react';
import { api } from '../api/client';
import type { VideoInfo } from '../types';

interface Props {
  onAnalyzed: (info: VideoInfo) => void;
  videoInfo: VideoInfo | null;
  audioDuration: number | null;
}

export function InputPanel({ onAnalyzed, videoInfo, audioDuration }: Props) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const info = await api.analyze(url.trim());
      onAnalyzed(info);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to analyze video');
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const info = await api.uploadVideo(file);
      onAnalyzed(info);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to upload video');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Load Video</h2>
        <p className="text-gray-400 text-sm mb-4">
          {audioDuration
            ? `Pick video for your ${Math.floor(audioDuration / 60)}:${Math.floor(audioDuration % 60).toString().padStart(2, '0')} audio track — fragments will be auto-cut to match.`
            : 'Paste a video URL or upload a file.'}
        </p>
      </div>

      {/* URL input */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-purple-300 mb-2">
          <Link2 size={16} /> Video URL
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
            placeholder="Paste YouTube, rezka.ag, or direct video URL..."
            className="flex-1 bg-[#0f0f17] border border-[#2a2a3a] rounded-lg px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none transition"
          />
          <button
            onClick={handleAnalyze}
            disabled={loading || !url.trim()}
            className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg text-sm font-semibold text-white disabled:opacity-40 hover:from-purple-500 hover:to-pink-500 transition flex items-center gap-2"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Film size={16} />}
            {loading ? 'Loading...' : 'Analyze'}
          </button>
        </div>
      </div>

      {/* Upload */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-pink-300 mb-2">
          <Upload size={16} /> Or upload video file
        </label>
        <label
          className="cursor-pointer border-2 border-dashed border-[#2a2a3a] hover:border-pink-500/50 rounded-lg p-6 transition text-center block"
        >
          {uploading ? (
            <div className="flex items-center justify-center gap-2 text-sm text-gray-400">
              <Loader2 size={16} className="animate-spin" /> Uploading...
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
              <Upload size={16} /> Click to upload MP4/WebM
            </div>
          )}
          <input type="file" accept="video/*" onChange={handleUpload} className="hidden" disabled={uploading} />
        </label>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-red-950/50 border border-red-800/50 rounded-lg p-3 text-sm text-red-300">
          <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {videoInfo && (
        <div className="bg-[#0f0f17] border border-green-800/30 rounded-lg p-4 step-enter">
          <div className="flex items-center gap-2 text-green-400 text-sm font-medium mb-3">
            <Film size={16} /> Video Loaded
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-500">Title:</span>
              <span className="text-gray-200 ml-2">{videoInfo.title || 'N/A'}</span>
            </div>
            <div>
              <span className="text-gray-500">Source:</span>
              <span className="text-purple-300 ml-2 capitalize">{videoInfo.source}</span>
            </div>
            <div>
              <span className="text-gray-500">Duration:</span>
              <span className="text-gray-200 ml-2">{formatTime(videoInfo.duration)}</span>
            </div>
            <div>
              <span className="text-gray-500">Resolution:</span>
              <span className="text-gray-200 ml-2">{videoInfo.width}×{videoInfo.height}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}