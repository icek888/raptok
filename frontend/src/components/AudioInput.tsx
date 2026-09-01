import { useState, useRef } from 'react';
import { Upload, Link, Music, Loader2, CheckCircle2 } from 'lucide-react';

interface Props {
  onAudioReady: (path: string, name: string, duration: number) => void;
  audioName: string | null;
  audioDuration: number | null;
}

export function AudioInput({ onAudioReady, audioName, audioDuration }: Props) {
  const [mode, setMode] = useState<'upload' | 'url'>('upload');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload/audio', { method: 'POST', body: form, credentials: 'include' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Upload failed' }));
        throw new Error(err.detail || 'Upload failed');
      }
      const data = await res.json();
      onAudioReady(data.path, data.filename, data.duration || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const handleYouTube = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('url', url.trim());
      const res = await fetch('/api/audio-from-youtube', { method: 'POST', body: form, credentials: 'include' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Download failed' }));
        throw new Error(err.detail || 'Download failed');
      }
      const data = await res.json();
      onAudioReady(data.path, data.filename, data.duration || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setLoading(false);
    }
  };

  const fmtDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (audioName && audioDuration) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4 p-6 bg-green-500/10 border border-green-500/30 rounded-2xl">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
            <Music size={28} className="text-white" />
          </div>
          <div className="flex-1">
            <div className="text-white font-bold text-lg flex items-center gap-2">
              {audioName}
              <CheckCircle2 size={18} className="text-green-400" />
            </div>
            <div className="text-white/50 text-sm">
              Duration: {fmtDuration(audioDuration)} · Ready for analysis
            </div>
          </div>
          <button
            onClick={() => { setUrl(''); }}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white border border-white/10 hover:border-white/20 rounded-lg transition"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Upload Audio Track</h2>
        <p className="text-gray-400">Upload your music track — this will be the base for your TikTok clip.</p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 p-1 bg-white/5 rounded-xl w-fit">
        <button
          onClick={() => setMode('upload')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition ${
            mode === 'upload' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          <Upload size={16} /> Upload File
        </button>
        <button
          onClick={() => setMode('url')}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition ${
            mode === 'url' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
          }`}
        >
          <Music size={16} /> YouTube URL
        </button>
      </div>

      {/* Upload mode */}
      {mode === 'upload' && (
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-purple-500', 'bg-purple-500/5'); }}
          onDragLeave={(e) => { e.currentTarget.classList.remove('border-purple-500', 'bg-purple-500/5'); }}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('border-purple-500', 'bg-purple-500/5');
            const file = e.dataTransfer.files[0];
            if (file) handleUpload(file);
          }}
          className="border-2 border-dashed border-white/10 hover:border-purple-500/50 rounded-2xl p-12 text-center cursor-pointer transition-all group"
        >
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }}
          />
          {loading ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={40} className="animate-spin text-purple-400" />
              <p className="text-gray-400">Uploading...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Upload size={32} className="text-white" />
              </div>
              <p className="text-white font-medium">Drop audio file here or click to browse</p>
              <p className="text-gray-500 text-sm">MP3, WAV, M4A · up to 50MB</p>
            </div>
          )}
        </div>
      )}

      {/* YouTube URL mode */}
      {mode === 'url' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Link size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleYouTube()}
                placeholder="https://www.youtube.com/watch?v=..."
                className="w-full bg-white/5 border border-white/10 rounded-xl pl-12 pr-4 py-3.5 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50"
              />
            </div>
            <button
              onClick={handleYouTube}
              disabled={!url.trim() || loading}
              className="px-6 py-3.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-30 rounded-xl text-white font-medium transition flex items-center gap-2"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Music size={18} />}
              {loading ? 'Downloading...' : 'Get Audio'}
            </button>
          </div>
          <p className="text-gray-500 text-sm">We'll extract the audio track from the YouTube video automatically.</p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 bg-red-950/50 border border-red-800/50 rounded-lg p-3 text-sm text-red-300">
          ⚠️ {error}
        </div>
      )}
    </div>
  );
}