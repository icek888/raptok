import { useState, useRef } from 'react';
import { Link2, Upload, FileText, Loader2, AlertCircle, Film, Music } from 'lucide-react';
import { api } from '../api/client';
import type { VideoInfo } from '../types';

interface Props {
  onAnalyzed: (info: VideoInfo) => void;
  onAudioUploaded: (path: string, filename: string) => void;
  onLyricsChange: (lyrics: string) => void;
  videoInfo: VideoInfo | null;
  audioName: string | null;
  lyrics: string;
}

export function InputPanel({ onAnalyzed, onAudioUploaded, onLyricsChange, videoInfo, audioName, lyrics }: Props) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAudio(true);
    setError(null);
    try {
      const result = await api.uploadAudio(file);
      onAudioUploaded(result.path, result.filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to upload audio');
    } finally {
      setUploadingAudio(false);
    }
  };

  return (
    <div className="space-y-5">
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

      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-pink-300 mb-2">
          <Music size={16} /> Audio Track (MP3)
        </label>
        <div
          onClick={() => fileRef.current?.click()}
          className="cursor-pointer border-2 border-dashed border-[#2a2a3a] hover:border-pink-500/50 rounded-lg p-4 transition text-center"
        >
          {uploadingAudio ? (
            <div className="flex items-center justify-center gap-2 text-sm text-gray-400">
              <Loader2 size={16} className="animate-spin" /> Uploading...
            </div>
          ) : audioName ? (
            <div className="flex items-center justify-center gap-2 text-sm text-green-400">
              <Music size={16} /> {audioName}
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
              <Upload size={16} /> Click to upload MP3
            </div>
          )}
          <input ref={fileRef} type="file" accept=".mp3,audio/*" onChange={handleAudioUpload} className="hidden" />
        </div>
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-purple-300 mb-2">
          <FileText size={16} /> Lyrics
        </label>
        <textarea
          value={lyrics}
          onChange={e => onLyricsChange(e.target.value)}
          placeholder="Paste your song lyrics here..."
          rows={6}
          className="w-full bg-[#0f0f17] border border-[#2a2a3a] rounded-lg px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none transition resize-y"
        />
      </div>
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}