import { useState, useEffect, useCallback } from 'react';
import {
  Film, FolderOpen, Download, Trash2, Settings,
  Clock, Plus, Loader2, Music, Video, Palette, X,
  Shield, Users, UserPlus, Ban, Check, Crown, Zap, Sparkles, Gauge,
} from 'lucide-react';
import { api } from '../api/client';

interface Project {
  id: string; name: string; status: string; video_url: string | null;
  audio_name: string | null; created_at: number; updated_at: number;
}
interface Render {
  id: string; filename: string; duration: number; resolution: string;
  file_size: number; created_at: number;
}
interface Preset {
  id: string; name: string; style_json: string; template_id: string | null; created_at: number;
}
interface Stats { projects: number; renders: number; presets: number; total_render_duration: number; }
interface UserSettings { whisper_model: string; default_template: string | null; render_quality: string; }
interface QuotaInfo {
  plan: string; plan_label: string; plan_price: string;
  max_renders_per_day: number; renders_today: number; remaining: number;
  max_resolution: string; watermark: boolean; features: string[];
}
interface AdminUser {
  username: string; role: string; plan: string; is_active: number;
  created_at: number; updated_at: number;
}
interface AdminStats {
  total_users: number; active_users: number; total_projects: number;
  total_renders: number; renders_24h: number; plan_distribution: Record<string, number>;
}

interface DashboardProps {
  username: string;
  role: string;
  onClose: () => void;
  onOpenProject?: (id: string) => void;
  onNewProject?: () => void;
}

type Tab = 'projects' | 'renders' | 'presets' | 'settings' | 'admin';

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

const PLAN_COLORS: Record<string, string> = {
  free: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
  pro: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  artist: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  team: 'bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-300 border-amber-500/30',
};
const PLAN_ICONS: Record<string, typeof Zap> = {
  free: Zap, pro: Zap, artist: Sparkles, team: Crown,
};

export function Dashboard({ username, role, onClose, onOpenProject, onNewProject }: DashboardProps) {
  const [tab, setTab] = useState<Tab>('projects');
  const [projects, setProjects] = useState<Project[]>([]);
  const [renders, setRenders] = useState<Render[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [loading, setLoading] = useState(false);

  // Admin state
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', plan: 'free' });
  const [showNewUser, setShowNewUser] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [p, r, pr, s, st, q] = await Promise.all([
        api.listProjects(), api.listRenders(), api.listPresets(),
        api.getSettings(), api.getStats(), api.getQuota(),
      ]);
      setProjects(p.projects || []);
      setRenders(r.renders || []);
      setPresets(pr.presets || []);
      setSettings(st);
      setStats(s);
      setQuota(q);
    } catch (e) { console.error('Dashboard load:', e); }
    finally { setLoading(false); }
  }, []);

  const loadAdmin = useCallback(async () => {
    if (role !== 'admin') return;
    try {
      const [s, u] = await Promise.all([api.adminStats(), api.adminListUsers()]);
      setAdminStats(s);
      setAdminUsers(u.users || []);
    } catch (e) { console.error('Admin load:', e); }
  }, [role]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { if (tab === 'admin') loadAdmin(); }, [tab, loadAdmin]);

  const handleDeleteProject = async (id: string) => {
    if (!confirm('Delete this project?')) return;
    await api.deleteProject(id); loadAll();
  };
  const handleDeleteRender = async (id: string) => {
    if (!confirm('Delete this render?')) return;
    await api.deleteRender(id); loadAll();
  };
  const handleDeletePreset = async (id: string) => { await api.deletePreset(id); loadAll(); };

  const handleCreateUser = async () => {
    if (!newUser.username.trim() || !newUser.password.trim()) return;
    try {
      await api.adminCreateUser(newUser.username, newUser.password, 'user', newUser.plan);
      setNewUser({ username: '', password: '', plan: 'free' });
      setShowNewUser(false);
      loadAdmin();
    } catch (e) { alert((e as Error).message); }
  };

  const handleUpdateUser = async (uname: string, data: any) => {
    try { await api.adminUpdateUser(uname, data); loadAdmin(); }
    catch (e) { alert((e as Error).message); }
  };

  const handleDeleteUser = async (uname: string) => {
    if (!confirm(`Delete user "${uname}"? This cannot be undone.`)) return;
    try { await api.adminDeleteUser(uname); loadAdmin(); }
    catch (e) { alert((e as Error).message); }
  };

  const handleSaveSettings = async (key: string, value: string) => {
    await api.updateSettings({ [key]: value }); loadAll();
  };

  const tabs: { id: Tab; label: string; icon: typeof Film; count?: number; admin?: boolean }[] = [
    { id: 'projects', label: 'Projects', icon: FolderOpen, count: projects.length },
    { id: 'renders', label: 'My Videos', icon: Video, count: renders.length },
    { id: 'presets', label: 'Presets', icon: Palette, count: presets.length },
    { id: 'settings', label: 'Settings', icon: Settings },
    ...(role === 'admin' ? [{ id: 'admin' as Tab, label: 'Admin', icon: Shield, admin: true }] : []),
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#0f0f1a] border border-white/10 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
              {username.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h2 className="text-white font-bold text-lg flex items-center gap-2">
                {username}
                {role === 'admin' && <Shield size={14} className="text-amber-400" />}
              </h2>
              <p className="text-white/40 text-xs">Personal Dashboard</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Quota bar */}
        {quota && (
          <div className="flex items-center gap-3 px-6 py-2.5 border-b border-white/5 bg-white/[0.02]">
            <PlanBadge plan={quota.plan} label={quota.plan_label} price={quota.plan_price} />
            <div className="flex items-center gap-1.5 text-xs">
              <Gauge size={13} className="text-white/40" />
              <span className="text-white/40">Renders today:</span>
              <span className="text-white font-medium">
                {quota.renders_today}{quota.max_renders_per_day > 0 ? ` / ${quota.max_renders_per_day}` : ' (unlimited)'}
              </span>
              {quota.remaining > 0 && (
                <span className="text-green-400 ml-1">({quota.remaining} left)</span>
              )}
              {quota.remaining === 0 && quota.max_renders_per_day > 0 && (
                <span className="text-red-400 ml-1">(limit reached)</span>
              )}
            </div>
            {quota.watermark && (
              <span className="text-xs text-orange-400/80 ml-auto">720p · Watermark</span>
            )}
            {!quota.watermark && (
              <span className="text-xs text-green-400/80 ml-auto">{quota.max_resolution} · No watermark</span>
            )}
          </div>
        )}

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
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t.id
                  ? t.admin
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
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

          {/* ── Projects Tab ── */}
          {!loading && tab === 'projects' && (
            <div className="space-y-2">
              <button onClick={onNewProject}
                className="w-full flex items-center gap-3 p-4 rounded-xl border border-dashed border-white/10 hover:border-purple-500/50 hover:bg-purple-500/5 transition-all group">
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
                      <Clock size={11} />{fmtDate(p.updated_at)}
                      {p.audio_name && (<><Music size={11} className="ml-2" /><span className="truncate">{p.audio_name}</span></>)}
                    </div>
                  </div>
                  <div className={`text-xs px-2 py-1 rounded ${
                    p.status === 'rendered' ? 'bg-green-500/20 text-green-300' :
                    p.status === 'draft' ? 'bg-white/10 text-white/50' : 'bg-yellow-500/20 text-yellow-300'
                  }`}>{p.status}</div>
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
              {projects.length === 0 && <p className="text-white/30 text-center py-8">No projects yet. Click "New Project" to start.</p>}
            </div>
          )}

          {/* ── Renders Tab ── */}
          {!loading && tab === 'renders' && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {renders.map(r => (
                <div key={r.id} className="bg-white/5 rounded-xl overflow-hidden group hover:bg-white/8 transition-colors">
                  <div className="aspect-[9/16] bg-gradient-to-br from-purple-900/30 to-pink-900/30 flex items-center justify-center relative">
                    <Video className="text-white/20" size={32} />
                    <button onClick={() => handleDeleteRender(r.id)}
                      className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/50 opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-all">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="p-3">
                    <div className="text-white/80 text-sm font-medium truncate">{r.filename}</div>
                    <div className="text-white/40 text-xs flex items-center gap-2 mt-1">
                      <Clock size={11} />{fmtDate(r.created_at)}<span>·</span>{fmtSize(r.file_size)}
                      {r.duration > 0 && (<><span>·</span>{fmtDuration(r.duration)}</>)}
                    </div>
                    <a href={`/api/download/${r.filename}`} className="mt-2 flex items-center gap-1.5 text-xs text-purple-300 hover:text-purple-200 transition-colors">
                      <Download size={14} />Download
                    </a>
                  </div>
                </div>
              ))}
              {renders.length === 0 && <div className="col-span-full text-white/30 text-center py-8">No renders yet.</div>}
            </div>
          )}

          {/* ── Presets Tab ── */}
          {!loading && tab === 'presets' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <input type="text" placeholder="Preset name" value={newUser.username}
                  onChange={e => setNewUser({ ...newUser, username: e.target.value })}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white text-sm placeholder-white/30 focus:outline-none focus:border-purple-500/50" />
                <input type="text" placeholder="Style JSON"
                  onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white text-sm placeholder-white/30 focus:outline-none focus:border-purple-500/50 font-mono" />
                <button className="px-4 py-2 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 transition-all text-sm font-medium">
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
              {presets.length === 0 && <p className="text-white/30 text-center py-8">No presets saved.</p>}
            </div>
          )}

          {/* ── Settings Tab ── */}
          {!loading && tab === 'settings' && settings && (
            <div className="space-y-6 max-w-lg">
              <div>
                <label className="text-white/60 text-sm font-medium mb-2 block">WhisperX Model</label>
                <select value={settings.whisper_model} onChange={e => handleSaveSettings('whisper_model', e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500/50">
                  <option value="small">small (fast, basic)</option>
                  <option value="medium">medium (balanced)</option>
                  <option value="large-v3">large-v3 (best quality, slow)</option>
                </select>
              </div>
              <div>
                <label className="text-white/60 text-sm font-medium mb-2 block">Default Template</label>
                <select value={settings.default_template || ''} onChange={e => handleSaveSettings('default_template', e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500/50">
                  <option value="">None (manual)</option>
                  <option value="cinematic">Cinematic</option>
                  <option value="big_words">Big Words</option>
                  <option value="neon_pop">Neon Pop</option>
                </select>
              </div>
              <div>
                <label className="text-white/60 text-sm font-medium mb-2 block">Render Quality</label>
                <select value={settings.render_quality} onChange={e => handleSaveSettings('render_quality', e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-purple-500/50">
                  <option value="1080p">1080p (Full HD)</option>
                  <option value="720p">720p (HD)</option>
                </select>
              </div>
              <div className="border-t border-white/10 pt-6">
                <div className="text-white/40 text-sm mb-2">Account</div>
                <div className="text-white/60 text-sm">Username: <span className="text-white font-medium">{username}</span></div>
                <div className="text-white/60 text-sm">Role: <span className="text-white font-medium">{role}</span></div>
                {quota && <div className="text-white/60 text-sm">Plan: <span className="text-white font-medium">{quota.plan_label}</span> ({quota.plan_price})</div>}
              </div>
            </div>
          )}

          {/* ── Admin Tab ── */}
          {!loading && tab === 'admin' && role === 'admin' && (
            <div className="space-y-4">
              {/* Admin stats */}
              {adminStats && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <AdminStatCard icon={Users} label="Total Users" value={adminStats.total_users} color="text-blue-400" />
                  <AdminStatCard icon={Check} label="Active" value={adminStats.active_users} color="text-green-400" />
                  <AdminStatCard icon={Video} label="Total Renders" value={adminStats.total_renders} color="text-purple-400" />
                  <AdminStatCard icon={Gauge} label="Renders 24h" value={adminStats.renders_24h} color="text-orange-400" />
                </div>
              )}

              {/* Plan distribution */}
              {adminStats && Object.keys(adminStats.plan_distribution).length > 0 && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5">
                  <span className="text-white/40 text-xs">Plan distribution:</span>
                  {Object.entries(adminStats.plan_distribution).map(([plan, count]) => (
                    <span key={plan} className={`text-xs px-2 py-1 rounded border ${PLAN_COLORS[plan] || PLAN_COLORS.free}`}>
                      {plan}: {count}
                    </span>
                  ))}
                </div>
              )}

              {/* Add user button */}
              <button onClick={() => setShowNewUser(!showNewUser)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 transition-all text-sm font-medium w-fit">
                <UserPlus size={16} />Add User
              </button>

              {/* New user form */}
              {showNewUser && (
                <div className="flex gap-2 p-4 rounded-xl bg-white/5 border border-white/10">
                  <input type="text" placeholder="Username" value={newUser.username}
                    onChange={e => setNewUser({ ...newUser, username: e.target.value })}
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/30 focus:outline-none focus:border-amber-500/50" />
                  <input type="text" placeholder="Password" value={newUser.password}
                    onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                    className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder-white/30 focus:outline-none focus:border-amber-500/50" />
                  <select value={newUser.plan} onChange={e => setNewUser({ ...newUser, plan: e.target.value })}
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500/50">
                    <option value="free">Free</option>
                    <option value="pro">Pro</option>
                    <option value="artist">Artist</option>
                    <option value="team">Team</option>
                  </select>
                  <button onClick={handleCreateUser}
                    className="px-4 py-2 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-all text-sm font-medium">
                    Create
                  </button>
                </div>
              )}

              {/* Users table */}
              <div className="space-y-1">
                {adminUsers.map(u => (
                  <div key={u.username} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/8 transition-colors group">
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center text-white/60 font-bold text-xs">
                      {u.username.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white font-medium flex items-center gap-2">
                        {u.username}
                        {u.role === 'admin' && <Shield size={12} className="text-amber-400" />}
                      </div>
                      <div className="text-white/30 text-xs">Created {fmtDate(u.created_at)}</div>
                    </div>

                    {/* Plan selector */}
                    <select value={u.plan}
                      onChange={e => handleUpdateUser(u.username, { plan: e.target.value })}
                      disabled={u.role === 'admin'}
                      className={`text-xs px-2 py-1 rounded border bg-transparent focus:outline-none cursor-pointer disabled:opacity-50 ${PLAN_COLORS[u.plan] || PLAN_COLORS.free}`}>
                      <option value="free" className="bg-[#0f0f1a]">Free</option>
                      <option value="pro" className="bg-[#0f0f1a]">Pro</option>
                      <option value="artist" className="bg-[#0f0f1a]">Artist</option>
                      <option value="team" className="bg-[#0f0f1a]">Team</option>
                    </select>

                    {/* Active toggle */}
                    <button onClick={() => handleUpdateUser(u.username, { is_active: u.is_active ? 0 : 1 })}
                      disabled={u.role === 'admin'}
                      className={`p-1.5 rounded-lg transition-all disabled:opacity-30 ${
                        u.is_active ? 'text-green-400 hover:text-green-300' : 'text-red-400 hover:text-red-300'
                      }`}
                      title={u.is_active ? 'Deactivate' : 'Activate'}>
                      {u.is_active ? <Check size={16} /> : <Ban size={16} />}
                    </button>

                    {/* Delete */}
                    {u.role !== 'admin' && (
                      <button onClick={() => handleDeleteUser(u.username)}
                        className="opacity-0 group-hover:opacity-100 text-red-400/60 hover:text-red-400 transition-all">
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                ))}
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

function AdminStatCard({ icon: Icon, label, value, color }: { icon: typeof Film; label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center p-3 rounded-xl bg-white/5">
      <Icon size={20} className={color} />
      <span className="text-white font-bold text-xl mt-1">{value}</span>
      <span className="text-white/40 text-xs">{label}</span>
    </div>
  );
}

function PlanBadge({ plan, label, price }: { plan: string; label: string; price: string }) {
  const Icon = PLAN_ICONS[plan] || Zap;
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium ${PLAN_COLORS[plan] || PLAN_COLORS.free}`}>
      <Icon size={12} />
      {label}
      <span className="opacity-60">{price}</span>
    </div>
  );
}