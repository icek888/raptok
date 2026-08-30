import { useState, useEffect, useCallback } from 'react';
import {
  Film, FolderOpen, Download, Trash2, Settings,
  Clock, Plus, Loader2, Music, Video, Palette, X,
} from 'lucide-react';
import { api } from '../api/client';

interface Project {
  id: string;
  name: string;
  status: string;
  video_url: string | null;
  audio_name: string | null;
  created_at: number;
  updated_at: number;
}

interface Render {
  id: string;
  filename: string;
  duration: number;
  resolution: string;
  file_size: number;
  created_at: number;
}

interface Preset {
  id: string;
  name: string;
  style_json: string;
  template_id: string | null;
  created_at: number;
}

interface Stats {
  projects: number;
  renders: number;
  presets: number;
  total_render_duration: number;
}

interface UserSettings {
  whisper_model: string;
  default_template: string | null;
  render_quality: string;
}

interface DashboardProps {
  username: string;
  onClose: () => void;
  onOpenProject?: (projectId: string) => void;
  onNewProject?: () => void;
}

type Tab = 'projects' | 'renders' | 'presets' | 'settings';

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function Dashboard({ username, onClose, onOpenProject, onNewProject }: DashboardProps) {
  const [tab, setTab] = useState<Tab>('projects');
  const [projects, setProjects] = useState<Project[]>([]);
  const [renders, setRenders] = useState<Render[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetStyle, setPresetStyle] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [p, r, pr, s, st] = await Promise.all([
        api.listProjects(),
        api.listRenders(),
        api.listPresets(),
        api.getSettings(),
        api.getStats(),
      ]);
      setProjects(p.projects || []);
      setRenders(p.renders || r.renders || []);
      setPresets(pr.presets || []);
      setSettings(st || s);
      setStats(s);
    } catch (e) {
      console.error('Dashboard load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleDeleteProject = async (id: string) => {
    if (!confirm('Delete this project?')) return;
    await api.deleteProject(id);
    loadAll();
  };

  const handleDeleteRender = async (id: string) => {
    if (!confirm('Delete this render?')) return;
    await api.deleteRender(id);
    loadAll();
  };

  const handleDeletePreset = async (id: string) => {
    await api.deletePreset(id);
    loadAll();
  };

  const handleSavePreset = async () => {
    if (!presetName.trim()) return;
    await api.createPreset(presetName, presetStyle || '{}');
    setPresetName('');
    setPresetStyle('');
    loadAll();
  };

  const handleSaveSettings = async (key: string, value: string) => {
    await api.updateSettings({ [key]: value });
    loadAll();
  };

  const tabs: { id: Tab; label: string; icon: typeof Film; count?: number }[] = [
    { id: 'projects', label: 'Projects', icon: FolderOpen, count: projects.length },
    { id: 'renders', label: 'My Videos', icon: Video, count: renders.length },
    { id: 'presets', label: 'Presets', icon: Palette, count: presets.length },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0f0f1a] border border-white/10 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white font-bold">
              {username.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h2 className="text-white font-bold text-lg">{username}</h2>
              <p className="text-white/40 text-xs">Personal Dashboard</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Stats bar */}
        {stats && (
          <div className="flex gap-3 px-6 py-3 border-b border-white/5">
            <StatCard icon={FolderOpen} label="Projects" value={stats.projects} color="text-blue-400" />
            <StatCard icon={Video} label="Renders" value={stats.renders} color="text-green-400" />
            <StatCard icon={Palette} label="Presets" value={stats.presets} color="text-purple-400" />
            <StatCard icon={Clock} label="Total Time" value={fmtDuration(stats.total_render_duration)} color="text-orange-400" />
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 px-6 py-2 border-b border-white/5">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t.id
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  : 'text-white/40 hover:text-white/70 hover:bg-white/5'
              }`}
            >
              <t.icon size={16} />
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-white/10">{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-purple-400" size={32} />
            </div>
          )}

          {/* Projects Tab */}
          {!loading && tab === 'projects' && (
            <div className="space-y-2">
              <button
                onClick={onNewProject}
                className="w-full flex items-center gap-3 p-4 rounded-xl border border-dashed border-white/10 hover:border-purple-500/50 hover:bg-purple-500/5 transition-all group"
              >
                <div className="w-10 h-10 rounded-lg bg-white/5 group-hover:bg-purple-500/20 flex items-center justify-center transition-colors">
                  <Plus className="text-white/40 group-hover:text-purple-300" size={20} />
                </div>
                <span className="text-white/60 group-hover:text-white font-medium">New Project</span>
              </button>
              {projects.map(p => (
                <div key={p.id} className="flex items-center gap-3 p-4 rounded-xl bg-white/5 hover:bg-white/8 transition-colors group">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center">
                    <Film className="text-blue-300" size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-medium truncate">{p.name}</div>
                    <div className="text-white/40 text-xs flex items-center gap-2">
                      <Clock size={11} />
                      {fmtDate(p.updated_at)}
                      {p.audio_name && (
                        <>
                          <Music size={11} className="ml-2" />
                          <span className="truncate">{p.audio_name}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className={`text-xs px-2 py-1 rounded ${
                    p.status === 'rendered' ? 'bg-green-500/20 text-green-300' :
                    p.status === 'draft' ? 'bg-white/10 text-white/50' :
                    'bg-yellow-500/20 text-yellow-300'
                  }`}>
                    {p.status}
                  </div>
                  {onOpenProject && (
                    <button onClick={() => onOpenProject(p.id)} className="opacity-0 group-hover:opacity-100 text-purple-300 hover:text-purple-200 transition-all">
                      <FolderOpen size={18} />
                    </button>
                  )}
                  <button onClick={() => handleDeleteProject(p.id)} className="opacity-0 group-hover:opacity-100 text-red-400/60 hover:text-red-400 transition-all">
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
              {projects.length === 0 && (
                <p className="text-white/30 text-center py-8">No projects yet. Click "New Project" to start.</p>
              )}
            </div>
          )}

          {/* Renders Tab */}
          {!loading && tab === 'renders' && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {renders.map(r => (
                <div key={r.id} className="bg-white/5 rounded-xl overflow-hidden group hover:bg-white/8 transition-colors">
                  <div className="aspect-[9/16] bg-gradient-to-br from-purple-900/30 to-pink-900/30 flex items-center justify-center relative">
                    <Video className="text-white/20" size={32} />
                    <button
                      onClick={() => handleDeleteRender(r.id)}
                      className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/50 opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="p-3">
                    <div className="text-white/80 text-sm font-medium truncate">{r.filename}</div>
                    <div className="text-white/40 text-xs flex items-center gap-2 mt-1">
                      <Clock size={11} />
                      {fmtDate(r.created_at)}
                      <span>·</span>
                      {fmtSize(r.file_size)}
                      {r.duration > 0 && (
                        <>
                          <span>·</span>
                          {fmtDuration(r.duration)}
                        </>
                      )}
                    </div>
                    <a
                      href={`/api/download/${r.filename}`}
                      className="mt-2 flex items-center gap-1.5 text-xs text-purple-300 hover:text-purple-200 transition-colors"
                    >
                      <Download size={14} />
                      Download
                    </a>
                  </div>
                </div>
              ))}
              {renders.length === 0 && (
                <div className="col-span-full text-white/30 text-center py-8">No renders yet. Render a video to see it here.</div>
              )}
            </div>
          )}

          {/* Presets Tab */}
          {!loading && tab === 'presets' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={presetName}
                  onChange={e => setPresetName(e.target.value)}
                  placeholder="Preset name (e.g. 'Aggressive Style')"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white text-sm placeholder-white/30 focus:outline-none focus:border-purple-500/50"
                />
                <input
                  type="text"
                  value={presetStyle}
                  onChange={e => setPresetStyle(e.target.value)}
                  placeholder='Style JSON (optional)'
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white text-sm placeholder-white/30 focus:outline-none focus:border-purple-500/50 font-mono"
                />
                <button
                  onClick={handleSavePreset}
                  disabled={!presetName.trim()}
                  className="px-4 py-2 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 disabled:opacity-30 transition-all text-sm font-medium"
                >
                  Save
                </button>
              </div>
              {presets.map(p => (
                <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/8 transition-colors group">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                    <Palette className="text-purple-300" size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-medium">{p.name}</div>
                    <div className="text-white/30 text-xs">{fmtDate(p.created_at)}</div>
                  </div>
                  <button onClick={() => handleDeletePreset(p.id)} className="opacity-0 group-hover:opacity-100 text-red-400/60 hover:text-red-400 transition-all">
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
              {presets.length === 0 && (
                <p className="text-white/30 text-center py-8">No presets saved. Create style presets to reuse across projects.</p>
              )}
            </div>
          )}

          {/* Settings Tab */}
          {!loading && tab === 'settings' && settings && (
            <div className="space-y-6 max-w-lg">
              <div>
                <label className="text-white/60 text-sm font-medium mb-2 block">WhisperX Model</label>
                <select
                  value={settings.whisper_model}
                  onChange={e => handleSaveSettings('whisper_model', e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500/50"
                >
                  <option value="small">small (fast, basic)</option>
                  <option value="medium">medium (balanced)</option>
                  <option value="large-v3">large-v3 (best quality, slow)</option>
                </select>
                <p className="text-white/30 text-xs mt-1">large-v3 gives best results but takes longer on CPU</p>
              </div>

              <div>
                <label className="text-white/60 text-sm font-medium mb-2 block">Default Template</label>
                <select
                  value={settings.default_template || ''}
                  onChange={e => handleSaveSettings('default_template', e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500/50"
                >
                  <option value="">None (manual)</option>
                  <option value="cinematic">Cinematic</option>
                  <option value="big_words">Big Words</option>
                  <option value="neon_pop">Neon Pop</option>
                </select>
              </div>

              <div>
                <label className="text-white/60 text-sm font-medium mb-2 block">Render Quality</label>
                <select
                  value={settings.render_quality}
                  onChange={e => handleSaveSettings('render_quality', e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500/50"
                >
                  <option value="1080p">1080p (Full HD)</option>
                  <option value="720p">720p (HD)</option>
                </select>
              </div>

              <div className="border-t border-white/10 pt-6">
                <div className="text-white/40 text-sm mb-2">Account</div>
                <div className="text-white/60 text-sm">Username: <span className="text-white font-medium">{username}</span></div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: typeof Film; label: string; value: string | number; color: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5">
      <Icon size={14} className={color} />
      <span className="text-white/40 text-xs">{label}:</span>
      <span className="text-white font-medium text-sm">{value}</span>
    </div>
  );
}