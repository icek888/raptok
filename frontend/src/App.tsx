import { useState, useEffect } from 'react';
import { Film, Scissors, Type, Wand2, Music, Eye, LogOut, LayoutDashboard } from 'lucide-react';
import { InputPanel } from './components/InputPanel';
import { FragmentEditor } from './components/FragmentEditor';
import { SubtitleEditor } from './components/SubtitleEditor';
import { VideoPreviewEditor } from './components/VideoPreviewEditor';
import { RenderPanel } from './components/RenderPanel';
import { CutToolsPanel } from './components/CutToolsPanel';
import { BeatEffectsPanel } from './components/BeatEffectsPanel';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';
import { defaultStyle, api } from './api/client';
import type { VideoInfo, Fragment, SubtitleLine, SubtitleStyle, WordTiming, BPMResult, TrackAnalysis } from './types';

type Step = 0 | 1 | 2 | 3 | 4;

const STEPS = [
  { id: 0 as Step, label: 'Input', icon: Film },
  { id: 1 as Step, label: 'Fragments', icon: Scissors },
  { id: 2 as Step, label: 'Lyrics', icon: Type },
  { id: 3 as Step, label: 'Preview', icon: Eye },
  { id: 4 as Step, label: 'Render', icon: Wand2 },
];

function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [step, setStep] = useState<Step>(0);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [lyrics, setLyrics] = useState('');
  const [fragments, setFragments] = useState<Fragment[]>([]);
  const [subtitles, setSubtitles] = useState<SubtitleLine[]>([]);
  const [style, setStyle] = useState<SubtitleStyle>(defaultStyle);
  const [wordTimings, setWordTimings] = useState<WordTiming[]>([]);
  const [bpmData, setBpmData] = useState<BPMResult | null>(null);
  const [karaoke, setKaraoke] = useState(true);
  const [displayMode, setDisplayMode] = useState<'auto' | 'line_highlight' | 'word_by_word' | 'single_word'>('auto');
  const [templateId, setTemplateId] = useState('');
  const [beatDivision, setBeatDivision] = useState('1/4');
  const [audioStart, setAudioStart] = useState(0);
  const [trackAnalysis, setTrackAnalysis] = useState<TrackAnalysis | null>(null);

  // Beat effects state
  const [beatEffectsOn, setBeatEffectsOn] = useState(false);
  const [zoomIntensity, setZoomIntensity] = useState(0.08);
  const [flashIntensity, setFlashIntensity] = useState(0.3);
  const [shakeIntensity, setShakeIntensity] = useState(0);
  const [showDashboard, setShowDashboard] = useState(false);

  // ── Auth check on mount ──
  useEffect(() => {
    fetch('/api/auth/check', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.authenticated) {
          setAuthed(true);
          setUsername(data.username);
        } else {
          setAuthed(false);
        }
      })
      .catch(() => setAuthed(false));
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setAuthed(false);
    setUsername('');
  };

  const canProceed = (s: Step): boolean => {
    switch (s) {
      case 0: return !!videoInfo;
      case 1: return fragments.length >= 3;
      case 2: return subtitles.length > 0 || wordTimings.length > 0;
      case 3: return true;
      case 4: return true;
      default: return true;
    }
  };

  const handleAnalyzed = (info: VideoInfo) => {
    setVideoInfo(info);
    setStep(1);
  };

  // Auto-analyze track when audio is uploaded
  useEffect(() => {
    if (audioPath && !trackAnalysis) {
      api.trackAnalysis(audioPath)
        .then((data: TrackAnalysis) => setTrackAnalysis(data))
        .catch((e: unknown) => console.error('Track analysis failed:', e));
    }
  }, [audioPath, trackAnalysis]);

  const handleFragmentsChange = (frags: Fragment[]) => {
    setFragments(frags);
    if (subtitles.length > 0) setSubtitles([]);
  };

  // ── AI Style handlers ──
  const handleApplyStyle = (s: Partial<SubtitleStyle>) => {
    setStyle(prev => ({ ...prev, ...s }));
  };

  const handleApplyTemplate = (tid: string) => {
    setTemplateId(tid);
  };

  // ── Cut Tools handlers ──
  const handleAutoCut = (newFrags: any[]) => {
    if (newFrags?.length) {
      setFragments(newFrags.map((f: any, i: number) => ({
        id: i, start: f.start, end: f.end, duration: f.duration
      })));
    }
  };

  const handleSnapToBeats = (newFrags: any[]) => {
    if (newFrags?.length) {
      setFragments(newFrags.map((f: any) => ({
        id: f.id, start: f.start, end: f.end, duration: f.duration
      })));
    }
  };

  const handleIntensityChange = (type: 'zoom' | 'flash' | 'shake', value: number) => {
    if (type === 'zoom') setZoomIntensity(value);
    else if (type === 'flash') setFlashIntensity(value);
    else setShakeIntensity(value);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-gray-100">
      {/* Auth gate */}
      {authed === null && (
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-10 h-10 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {authed === false && (
        <Login onLogin={(u) => { setAuthed(true); setUsername(u); }} />
      )}
      {authed === true && (
        <>
      {/* Header */}
      <header className="border-b border-[#1a1a2a] bg-[#0a0a0f]/95 backdrop-blur sticky top-0 z-50">
        <div className="max-w-[1800px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-pink-600 rounded-xl flex items-center justify-center glow-purple">
              <Music size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold gradient-text">RapTok</h1>
              <p className="text-xs text-gray-500">TikTok Content Maker for Rappers</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {bpmData && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                <span className="text-sm text-purple-400 font-mono">♩ {bpmData.bpm}</span>
                <span className="text-xs text-gray-500">BPM</span>
              </div>
            )}

            <button
              onClick={() => setShowDashboard(true)}
              className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-purple-400 transition px-2 py-1 rounded-lg hover:bg-white/5"
              title="Dashboard"
            >
              <LayoutDashboard size={16} />
            </button>

            <span className="text-xs text-gray-500">{username}</span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-400 transition"
              title="Logout"
            >
              <LogOut size={16} />
            </button>

            <a href="https://github.com/icek888/raptok" target="_blank" rel="noopener" className="text-sm text-gray-500 hover:text-gray-300 transition">
              GitHub
            </a>
          </div>
        </div>
      </header>

      {/* Step indicator */}
      <div className="max-w-[1800px] mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-8">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isActive = step === s.id;
            const isDone = step > s.id;
            const canClick = s.id <= step || canProceed(s.id as Step);
            return (
              <div key={s.id} className="flex items-center flex-1">
                <button
                  onClick={() => canClick && setStep(s.id)}
                  disabled={!canClick}
                  className={`flex flex-col items-center gap-1 transition ${isActive ? 'text-purple-400' : isDone ? 'text-green-400' : 'text-gray-600'} ${!canClick ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition ${
                    isActive ? 'border-purple-500 bg-purple-500/10' :
                    isDone ? 'border-green-500 bg-green-500/10' :
                    'border-gray-700 bg-[#0f0f17]'
                  }`}>
                    <Icon size={18} />
                  </div>
                  <span className="text-xs font-medium">{s.label}</span>
                </button>
                {i < STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-2 ${step > s.id ? 'bg-green-500' : 'bg-[#1a1a2a]'}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Step content */}
        <div className="bg-[#0f0f17] border border-[#1a1a2a] rounded-2xl p-6 step-enter">
          {step === 0 && (
            <InputPanel
              onAnalyzed={handleAnalyzed}
              onAudioUploaded={(path, name) => { setAudioPath(path); setAudioName(name); }}
              onLyricsChange={setLyrics}
              videoInfo={videoInfo}
              audioName={audioName}
              lyrics={lyrics}
            />
          )}

          {/* Step 1: Fragments + CutToolsPanel */}
          {step === 1 && videoInfo && (
            <div className="flex gap-4">
              <div className="flex-1 min-w-0">
            <FragmentEditor
              videoInfo={videoInfo}
              fragments={fragments}
              onFragmentsChange={handleFragmentsChange}
              audioPath={audioPath}
              beatDivision={beatDivision}
              onBeatDivisionChange={setBeatDivision}
              onBpmDetected={setBpmData}
              bpmData={bpmData}
            />
              </div>
              <div className="w-72 flex-shrink-0">
                <CutToolsPanel
                  bpmData={bpmData}
                  trackAnalysis={trackAnalysis}
                  onAutoCut={handleAutoCut}
                  onSnapToBeats={handleSnapToBeats}
                  fragments={fragments}
                />
              </div>
            </div>
          )}

          {/* Step 2: Lyrics — SubtitleEditor with integrated AIStylePanel (keep mounted, hide) */}
          <div style={{ display: step === 2 ? 'block' : 'none' }}>
            <SubtitleEditor
              lyrics={lyrics}
              fragments={fragments}
              subtitles={subtitles}
              onSubtitlesChange={setSubtitles}
              audioPath={audioPath}
              wordTimings={wordTimings}
              onWordTimingsChange={setWordTimings}
              karaoke={karaoke}
              onKaraokeChange={setKaraoke}
              displayMode={displayMode}
              onDisplayModeChange={setDisplayMode}
              videoUrl={videoInfo?.local_path || null}
              onAudioStartChange={setAudioStart}
              style={style}
              onStyleChange={setStyle}
              templateId={templateId}
              onTemplateChange={setTemplateId}
              onApplyStyle={handleApplyStyle}
              onApplyTemplate={handleApplyTemplate}
            />
          </div>

          {/* Step 3: Preview + BeatEffectsPanel (keep mounted) */}
          <div style={{ display: step === 3 ? 'flex' : 'none' }} className="gap-4">
            <div className="flex-1 min-w-0">
            <VideoPreviewEditor
              videoInfo={videoInfo}
              videoUrl={videoInfo?.local_path || null}
              fragments={fragments}
              audioPath={audioPath}
              audioStart={audioStart}
              subtitles={subtitles}
              wordTimings={wordTimings}
              style={style}
              onStyleChange={setStyle}
              karaoke={karaoke}
              onKaraokeChange={setKaraoke}
              displayMode={displayMode}
              onDisplayModeChange={setDisplayMode}
              templateId={templateId}
              onTemplateChange={setTemplateId}
            />
            </div>
            <div className="w-72 flex-shrink-0">
              <BeatEffectsPanel
                bpmData={bpmData}
                beatEffectsEnabled={beatEffectsOn}
                onToggle={setBeatEffectsOn}
                onIntensityChange={handleIntensityChange}
                zoomIntensity={zoomIntensity}
                flashIntensity={flashIntensity}
                shakeIntensity={shakeIntensity}
              />
            </div>
          </div>

          {/* Step 4: Render (summary) */}
          {step === 4 && (
            <RenderPanel
              videoInfo={videoInfo}
              fragments={fragments}
              audioPath={audioPath}
              audioStart={audioStart}
              subtitles={subtitles}
              wordTimings={wordTimings}
              style={style}
              karaoke={karaoke}
              displayMode={displayMode}
              templateId={templateId}
              beatEffects={beatEffectsOn ? {
                enabled: true,
                beats: bpmData?.beats || [],
                zoom: zoomIntensity,
                flash: flashIntensity,
                shake: shakeIntensity,
                energyCurve: trackAnalysis?.energy_curve,
                energyTimes: trackAnalysis?.energy_times,
              } : undefined}
            />
          )}
        </div>

        {/* Navigation */}
        {step < 4 && (
          <div className="flex justify-between mt-4">
            <button
              onClick={() => setStep(Math.max(0, step - 1) as Step)}
              disabled={step === 0}
              className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition disabled:opacity-30"
            >
              ← Back
            </button>
            <button
              onClick={() => canProceed(step) && setStep(Math.min(4, step + 1) as Step)}
              disabled={!canProceed(step)}
              className="px-6 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium transition disabled:opacity-30"
            >
              Next →
            </button>
          </div>
        )}

      {showDashboard && (
        <Dashboard
          username={username}
          onClose={() => setShowDashboard(false)}
          onNewProject={() => {
            setShowDashboard(false);
            setStep(0);
          }}
        />
      )}
      </div>
        </>
      )}
    </div>
  );
}

export default App;