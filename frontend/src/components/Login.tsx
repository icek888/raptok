import { useState } from 'react';
import { Music, Lock, User } from 'lucide-react';

export function Login({ onLogin }: { onLogin: (username: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Login failed' }));
        throw new Error(err.detail);
      }
      const data = await res.json();
      onLogin(data.username);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-purple-600 to-pink-600 rounded-2xl flex items-center justify-center glow-purple mb-4">
            <Music size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold gradient-text">RapTok</h1>
          <p className="text-sm text-gray-500 mt-1">TikTok Content Maker for Rappers</p>
        </div>

        {/* Login form */}
        <form onSubmit={handleSubmit} className="bg-[#0f0f17] border border-[#1a1a2a] rounded-2xl p-6 space-y-4">
          <div>
            <label className="text-xs text-gray-400 mb-1.5 block">Username</label>
            <div className="relative">
              <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoFocus
                required
                className="w-full bg-[#0a0a0f] border border-[#1a1a2a] rounded-lg pl-10 pr-3 py-2.5 text-sm text-gray-100 focus:border-purple-500 focus:outline-none transition"
                placeholder="admin"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-400 mb-1.5 block">Password</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full bg-[#0a0a0f] border border-[#1a1a2a] rounded-lg pl-10 pr-3 py-2.5 text-sm text-gray-100 focus:border-purple-500 focus:outline-none transition"
                placeholder="••••••••"
              />
            </div>
          </div>

          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium transition"
          >
            {loading ? 'Loading...' : 'Login →'}
          </button>
        </form>
      </div>
    </div>
  );
}