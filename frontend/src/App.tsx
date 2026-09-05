import { useState, useEffect, useRef } from 'react';
import { Music, Activity, Type, Film, Scissors, Eye, Wand2, LogOut, LayoutDashboard } from 'lucide-react';
import { AudioInput } from './components/AudioInput';
import { AnalysisPanel } from './components/AnalysisPanel';
import { InputPanel } from './components/InputPanel';
import { FragmentEditor } from './components/FragmentEditor';
import { SubtitleEditor } from './components/SubtitleEditor';
import { VideoPreviewEditor } from './components/VideoPreviewEditor';
import { RenderPanel } from './components/RenderPanel';
import { CutToolsPanel } from './components/CutToolsPanel';
import { BeatEffectsPanel } from './components/BeatEffectsPanel';
import { AIStylePanel } from './components/AIStylePanel';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';
import { defaultStyle, api } from './api/client';
import type { VideoInfo, Fragment, SubtitleLine, SubtitleStyle, WordTiming, BPMResult, TrackAnalysis } from './types';

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const STEPS = [
  { id: 0 as Step, label: 'Audio', icon: Music },
  { id: 1 as Step, label: 'Analysis', icon: Activity },
  { id: 2 as Step, label: 'Lyrics', icon: Type },
  { id: 3 as Step, label: 'Video', icon: Film },
  { id: 4 as Step, label: 'Fragments', icon: Scissors },
  { id: 5 as Step, label: 'Preview', icon: Eye },
  { id: 6 as Step, label: 'Render', icon: Wand2 },
];

function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [userRole, setUserRole] = useState('user');
  const [step, setStep] = useState<Step>(0);

  // ── Persisted state: saved to localStorage on every change, restored on mount ──
  const STORAGE_KEY = 'raptok_session_v3';

  // Helper: load from localStorage
  const loadState = (): Partial<typeof initialState> => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  };

  const initialState = {
    audioPath: null as string | null,
    audioName: null as string | null,
    audioDuration: null as number | null,
    bpmData: null as BPMResult | null,
    trackAnalysis: null as TrackAnalysis | null,
    lyrics: '',
    subtitles: [] as SubtitleLine[],
    wordTimings: [] as WordTiming[],
    style: defaultStyle,
    karaoke: true,
    displayMode: 'single_word' as 'auto' | 'line_highlight' | 'word_by_word' | 'single_word',
    templateId: '',
    beatDivision: '1/4',
    audioStart: 0,
    clipRange: null as { start: number; end: number } | null,
    videoInfo: null as VideoInfo | null,
    fragments: [] as Fragment[],
    beatEffectsOn: false,
    zoomIntensity: 0.08,
    flashIntensity: 0.3,
    shakeIntensity: 0,
    step: 0 as Step,
  };

  const saved = loadState();

  // Audio (Step 0)
  const [audioPath, setAudioPath] = useState<string | null>(saved.audioPath ?? initialState.audioPath);
  const [audioName, setAudioName] = useState<string | null>(saved.audioName ?? initialState.audioName);
  const [audioDuration, setAudioDuration] = useState<number | null>(saved.audioDuration ?? initialState.audioDuration);

  // Analysis (Step 1)
  const [bpmData, setBpmData] = useState<BPMResult | null>(saved.bpmData ?? initialState.bpmData);
  const [trackAnalysis, setTrackAnalysis] = useState<TrackAnalysis | null>(saved.trackAnalysis ?? initialState.trackAnalysis);
  const [whisperText, setWhisperText] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  // Lyrics (Step 2)
  const [lyrics, setLyrics] = useState(saved.lyrics ?? initialState.lyrics);
  const [subtitles, setSubtitles] = useState<SubtitleLine[]>(saved.subtitles ?? initialState.subtitles);
  const [wordTimings, setWordTimings] = useState<WordTiming[]>(saved.wordTimings ?? initialState.wordTimings);
  const [style, setStyle] = useState<SubtitleStyle>(saved.style ?? initialState.style);
  const [karaoke, setKaraoke] = useState(saved.karaoke ?? initialState.karaoke);
  const [displayMode, setDisplayMode] = useState<'auto' | 'line_highlight' | 'word_by_word' | 'single_word'>(saved.displayMode ?? initialState.displayMode);
  const [templateId, setTemplateId] = useState(saved.templateId ?? initialState.templateId);
  const [beatDivision, setBeatDivision] = useState(saved.beatDivision ?? initialState.beatDivision);
  const [audioStart, setAudioStart] = useState(saved.audioStart ?? initialState.audioStart);
  const [clipRange, setClipRange] = useState<{ start: number; end: number } | null>(saved.clipRange ?? initialState.clipRange);
  const [segmentPath, setSegmentPath] = useState<string | null>(null);

  // Video (Step 3)
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(saved.videoInfo ?? initialState.videoInfo);

  // Fragments (Step 4)
  const [fragments, setFragments] = useState<Fragment[]>(saved.fragments ?? initialState.fragments);

  // Beat effects (Step 5)
  const [beatEffectsOn, setBeatEffectsOn] = useState(saved.beatEffectsOn ?? initialState.beatEffectsOn);
  const [zoomIntensity, setZoomIntensity] = useState(saved.zoomIntensity ?? initialState.zoomIntensity);
  const [flashIntensity, setFlashIntensity] = useState(saved.flashIntensity ?? initialState.flashIntensity);
  const [shakeIntensity, setShakeIntensity] = useState(saved.shakeIntensity ?? initialState.shakeIntensity);

  // Dashboard
  const [showDashboard, setShowDashboard] = useState(false);
  // Project persistence
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cutting, setCutting] = useState(false);

  // ── Persist to localStorage on every state change ──
  useEffect(() => {
    const data = {
      audioPath, audioName, audioDuration,
      bpmData, trackAnalysis,
      lyrics, subtitles, wordTimings, style, karaoke, displayMode,
      templateId, beatDivision, audioStart, clipRange,
      videoInfo, fragments,
      beatEffectsOn, zoomIntensity, flashIntensity, shakeIntensity,
      step,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to save session:', e);
    }
  }, [audioPath, audioName, audioDuration, bpmData, trackAnalysis, lyrics, subtitles, wordTimings, style, karaoke, displayMode, templateId, beatDivision, audioStart, clipRange, videoInfo, fragments, beatEffectsOn, zoomIntensity, flashIntensity, shakeIntensity, step]);

  // ── Auto-save to SQLite (debounced 3s) ──
  useEffect(() => {
    if (!currentProjectId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const stateData = {
        audioPath, audioName, audioDuration,
        bpmData, trackAnalysis,
        lyrics, subtitles, wordTimings, style, karaoke, displayMode,
        templateId, beatDivision, audioStart, clipRange,
        videoInfo, fragments,
        beatEffectsOn, zoomIntensity, flashIntensity, shakeIntensity,
        step,
      };
      api.saveProjectState(currentProjectId, stateData)
        .then(() => console.log('Auto-saved project:', currentProjectId))
        .catch(e => console.warn('Auto-save failed:', e));
    }, 3000);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [currentProjectId, audioPath, audioName, audioDuration, bpmData, trackAnalysis, lyrics, subtitles, wordTimings, style, karaoke, displayMode, templateId, beatDivision, audioStart, clipRange, videoInfo, fragments, beatEffectsOn, zoomIntensity, flashIntensity, shakeIntensity, step]);

  // ── Auth check on mount ──
  useEffect(() => {
    fetch('/api/auth/check', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.authenticated) {
          setAuthed(true);
          setUsername(data.username);
          setUserRole(data.role || 'user');
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

  // ── Step 0: Audio ready → auto-trigger Step 1 analysis ──
  // ── New Project: create in DB, reset state ──
  const handleNewProject = async () => {
    try {
      const project = await api.createProject();
      setCurrentProjectId(project.id);
      console.log('New project created:', project.id);
    } catch (e) {
      console.error('Create project failed:', e);
    }
  };

  // ── Open Project: load state from DB ──
  const handleOpenProject = async (projectId: string) => {
    try {
      const res = await api.getProjectState(projectId);
      const s = res.state;
      setShowDashboard(false);
      setCurrentProjectId(projectId);
      setAudioPath(s.audioPath || null);
      setAudioName(s.audioName || null);
      setAudioDuration(s.audioDuration || null);
      setBpmData(s.bpmData || null);
      setTrackAnalysis(s.trackAnalysis || null);
      setLyrics(s.lyrics || '');
      setSubtitles(s.subtitles || []);
      setWordTimings(s.wordTimings || []);
      if (s.style) setStyle(s.style);
      setKaraoke(s.karaoke ?? true);
      if (s.displayMode) setDisplayMode(s.displayMode);
      if (s.templateId) setTemplateId(s.templateId);
      if (s.beatDivision) setBeatDivision(s.beatDivision);
      setAudioStart(s.audioStart || 0);
      setClipRange(s.clipRange || null);
      setVideoInfo(s.videoInfo || null);
      setFragments(s.fragments || []);
      setBeatEffectsOn(s.beatEffectsOn || false);
      setZoomIntensity(s.zoomIntensity || 0.08);
      setFlashIntensity(s.flashIntensity || 0.3);
      setShakeIntensity(s.shakeIntensity || 0);
      setStep(s.step || 0);
      console.log('Project loaded:', projectId, 'step:', s.step);
    } catch (e) {
      console.error('Open project failed:', e);
      alert('Failed to load project. It may be empty or corrupted.');
    }
  };

  const handleAudioReady = async (path: string, name: string, duration: number) => {
    setAudioPath(path);
    setAudioName(name);
    setAudioDuration(duration);
    setStep(1); // Auto-advance to Analysis

    // Auto-create project in DB if not already in one
    if (!currentProjectId) {
      try {
        const project = await api.createProject();
        setCurrentProjectId(project.id);
        console.log('Auto-created project for:', name, project.id);
      } catch (e) {
        console.error('Auto-create project failed:', e);
      }
    }
  };

  // ── Step 1: Auto-analysis when audio is loaded (BPM + mood only, NO transcription) ──
  const analysisStarted = useRef(false);
  useEffect(() => {
    if (audioPath && step === 1 && !analysisStarted.current) {
      analysisStarted.current = true;
      setAnalysisLoading(true);

      // Parallel: BPM + track analysis (transcription is manual on Lyrics step)
      Promise.all([
        api.detectBPM(audioPath).then((d: BPMResult) => setBpmData(d)).catch(e => console.error('BPM failed:', e)),
        api.trackAnalysis(audioPath).then((d: TrackAnalysis) => setTrackAnalysis(d)).catch(e => console.error('Track analysis failed:', e)),
      ]).finally(() => setAnalysisLoading(false));
    }
  }, [audioPath, step]);

  // ── canProceed logic ──
  const canProceed = (s: Step): boolean => {
    switch (s) {
      case 0: return !!audioPath;          // Audio uploaded
      case 1: return !!bpmData;             // Analysis done
      case 2: return subtitles.length > 0 || wordTimings.length > 0;  // Lyrics ready
      case 3: return !!videoInfo;           // Video loaded
      case 4: return fragments.length >= 3; // Fragments selected
      case 5: return true;                  // Preview always OK
      case 6: return true;                  // Render always OK
      default: return true;
    }
  };

  // ── Step 2: Lyrics range selected → this defines the clip length (SOURCE OF TRUTH) ──
  const handleClipRangeChange = (start: number, end: number) => {
    setClipRange({ start, end });
    // Segment cut happens on Next click, not during dragging
  };

  // ── Step 3: Video analyzed ──
  const handleVideoAnalyzed = (info: VideoInfo) => {
    setVideoInfo(info);
    // v3: Auto-cut runs on step 4 via CutToolsPanel button, not here.
    // Video load just stores videoInfo — clip range (from Lyrics) drives fragment count/duration.
  };

  // ── Handlers ──
  // NOTE (v3): subtitles are built from WhisperX word timestamps (absolute),
  // NOT distributed across fragment slots — they survive fragment changes.
  // Do NOT clear them when fragments change (that was v2 behavior).
  const handleFragmentsChange = (frags: Fragment[]) => {
    setFragments(frags);
  };

  const handleApplyStyle = (s: Partial<SubtitleStyle>) => setStyle(prev => ({ ...prev, ...s }));
  const handleApplyTemplate = (tid: string) => setTemplateId(tid);

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
            {audioName && (
              <div className="ml-4 flex items-center gap-1.5">
                <span className="text-gray-600 text-sm">·</span>
                <input
                  type="text"
                  value={audioName}
                  onChange={e => setAudioName(e.target.value)}
                  className="text-sm text-gray-300 bg-transparent border border-transparent hover:border-white/10 focus:border-purple-500/50 rounded-lg px-2 py-1 outline-none transition w-48"
                  placeholder="Project name"
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            {bpmData && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                <span className="text-sm text-purple-400 font-mono">♩ {bpmData.bpm}</span>
                <span className="text-xs text-gray-500">BPM</span>
              </div>
            )}
            {audioDuration && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                <span className="text-sm text-blue-400 font-mono">{Math.floor(audioDuration / 60)}:{Math.floor(audioDuration % 60).toString().padStart(2, '0')}</span>
                <span className="text-xs text-gray-500">Audio</span>
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
          {/* Step 0: Audio Input */}
          {step === 0 && (
            <AudioInput
              onAudioReady={handleAudioReady}
              audioName={audioName}
              audioDuration={audioDuration}
            />
          )}

          {/* Step 1: Auto Analysis + Range Selection */}
          {step === 1 && (
            <AnalysisPanel
              loading={analysisLoading}
              bpmData={bpmData}
              trackAnalysis={trackAnalysis}
              audioDuration={audioDuration}
              audioPath={audioPath}
              clipRange={clipRange}
              onClipRangeChange={handleClipRangeChange}
            />
          )}

          {/* Step 2: Lyrics — SubtitleEditor with integrated AIStylePanel */}
          <div style={{ display: step === 2 ? 'block' : 'none' }}>
            {audioPath && (
              <SubtitleEditor
                lyrics={lyrics}
                onLyricsChange={setLyrics}
                fragments={[]}
                subtitles={subtitles}
                onSubtitlesChange={setSubtitles}
                wordTimings={wordTimings}
                onWordTimingsChange={setWordTimings}
                karaoke={karaoke}
                onKaraokeChange={setKaraoke}
                displayMode={displayMode}
                onDisplayModeChange={setDisplayMode}
                videoUrl={null}
                audioPath={segmentPath || audioPath}
                onAudioStartChange={setAudioStart}
                onRangeChange={handleClipRangeChange}
                active={step === 2}
                clipRange={clipRange}
                style={style}
                onStyleChange={setStyle}
                templateId={templateId}
                onTemplateChange={setTemplateId}
                onApplyStyle={handleApplyStyle}
                onApplyTemplate={handleApplyTemplate}
                autoDetectedText={whisperText || ''}
              />
            )}
          </div>

          {/* Step 3: Video Input */}
          {step === 3 && (
            <InputPanel
              onAnalyzed={handleVideoAnalyzed}
              videoInfo={videoInfo}
              audioDuration={audioDuration}
            />
          )}

          {/* Step 4: Fragments + CutToolsPanel */}
          {step === 4 && videoInfo && (
            <div className="flex gap-4">
              <div className="flex-1 min-w-0">
                <FragmentEditor
                  videoInfo={videoInfo}
                  fragments={fragments}
                  onFragmentsChange={handleFragmentsChange}
                  audioPath={segmentPath || audioPath}
                  beatDivision={beatDivision}
                  onBeatDivisionChange={setBeatDivision}
                  onBpmDetected={setBpmData}
                  bpmData={bpmData}
                  clipRange={clipRange}
                />
              </div>
              <div className="w-72 flex-shrink-0">
                <CutToolsPanel
                  bpmData={bpmData}
                  trackAnalysis={trackAnalysis}
                  onAutoCut={handleAutoCut}
                  onSnapToBeats={handleSnapToBeats}
                  fragments={fragments}
                  audioPath={segmentPath || audioPath}
                  videoDuration={videoInfo?.duration || 0}
                  clipRange={clipRange}
                />
              </div>
            </div>
          )}

          {/* Step 5: Preview + BeatEffectsPanel (keep mounted) */}
          <div style={{ display: step === 5 ? 'flex' : 'none' }} className="gap-4">
            <div className="flex-1 min-w-0">
              <VideoPreviewEditor
                videoInfo={videoInfo}
                videoUrl={videoInfo?.local_path || null}
                fragments={fragments}
                audioPath={segmentPath || audioPath}
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
            <div className="w-72 flex-shrink-0 space-y-4">
              <AIStylePanel
                audioPath={segmentPath || audioPath || undefined}
                onApplyStyle={(s: Partial<SubtitleStyle>) => setStyle(prev => ({ ...prev, ...s }))}
                onApplyTemplate={(tid: string) => setTemplateId(tid)}
              />
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

          {/* Step 6: Render */}
          {step === 6 && (
            <RenderPanel
              videoInfo={videoInfo}
              fragments={fragments}
              audioPath={segmentPath || audioPath}
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
        {step < 6 && (
          <div className="flex justify-between mt-4">
            <button
              onClick={() => setStep(Math.max(0, step - 1) as Step)}
              disabled={step === 0}
              className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition disabled:opacity-30"
            >
              ← Back
            </button>
            <button
              onClick={async () => {
                if (!canProceed(step)) return;
                if (step === 1 && clipRange && audioPath) {
                  setCutting(true);
                  try {
                    const res = await api.cutSegment(audioPath, clipRange.start, clipRange.end - clipRange.start);
                    setSegmentPath(res.segment_path);
                    console.log('Segment cut:', res.segment_path, res.duration + 's');
                    setStep(Math.min(6, step + 1) as Step);
                  } catch (e) {
                    console.error('Cut segment failed:', e);
                    alert('Failed to cut segment. Using full track.');
                    setStep(Math.min(6, step + 1) as Step);
                  } finally {
                    setCutting(false);
                  }
                } else {
                  setStep(Math.min(6, step + 1) as Step);
                }
              }}
              disabled={!canProceed(step) || cutting}
              className="px-6 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium transition disabled:opacity-30"
            >
              {cutting ? '⏳ Cutting...' : 'Next →'}
            </button>
          </div>
        )}

      {showDashboard && (
        <Dashboard
          username={username}
          role={userRole}
          onClose={() => setShowDashboard(false)}
          onOpenProject={handleOpenProject}
          onNewProject={() => {
            setShowDashboard(false);
            setStep(0);
            // Reset state
            setAudioPath(null);
            setAudioName(null);
            setAudioDuration(null);
            setBpmData(null);
            setTrackAnalysis(null);
            setWhisperText(null);
            analysisStarted.current = false;
            setLyrics('');
            setSubtitles([]);
            setWordTimings([]);
            setVideoInfo(null);
            setFragments([]);
            setClipRange(null);
            setAudioStart(0);
            setSegmentPath(null);
            // Clear localStorage
            localStorage.removeItem('raptok_session_v3');
            // Create new project in DB
            handleNewProject();
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