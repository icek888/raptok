import { useState } from 'react';
import { Film, Scissors, Type, Palette, Wand2, Music } from 'lucide-react';
import { InputPanel } from './components/InputPanel';
import { FragmentEditor } from './components/FragmentEditor';
import { SubtitleEditor } from './components/SubtitleEditor';
import { StyleEditor } from './components/StyleEditor';
import { RenderPanel } from './components/RenderPanel';
import { defaultStyle } from './api/client';
import type { VideoInfo, Fragment, SubtitleLine, SubtitleStyle } from './types';

type Step = 0 | 1 | 2 | 3 | 4;

const STEPS = [
  { id: 0 as Step, label: 'Input', icon: Film },
  { id: 1 as Step, label: 'Fragments', icon: Scissors },
  { id: 2 as Step, label: 'Subtitles', icon: Type },
  { id: 3 as Step, label: 'Style', icon: Palette },
  { id: 4 as Step, label: 'Render', icon: Wand2 },
];

function App() {
  const [step, setStep] = useState<Step>(0);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [lyrics, setLyrics] = useState('');
  const [fragments, setFragments] = useState<Fragment[]>([]);
  const [subtitles, setSubtitles] = useState<SubtitleLine[]>([]);
  const [style, setStyle] = useState<SubtitleStyle>(defaultStyle);

  const canProceed = (s: Step): boolean => {
    switch (s) {
      case 0: return !!videoInfo;
      case 1: return fragments.length >= 3;
      case 2: return subtitles.length > 0;
      case 3: return true;
      default: return true;
    }
  };

  const handleAnalyzed = (info: VideoInfo) => {
    setVideoInfo(info);
    setStep(1);
  };

  const handleFragmentsChange = (frags: Fragment[]) => {
    setFragments(frags);
    // Reset subtitles when fragments change
    if (subtitles.length > 0) setSubtitles([]);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-gray-100">
      {/* Header */}
      <header className="border-b border-[#1a1a2a] bg-[#0a0a0f]/95 backdrop-blur sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-pink-600 rounded-xl flex items-center justify-center glow-purple">
              <Music size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold gradient-text">RapTok</h1>
              <p className="text-xs text-gray-500">TikTok Content Maker for Rappers</p>
            </div>
          </div>

          <a href="https://github.com/icek888/raptok" target="_blank" rel="noopener" className="text-sm text-gray-500 hover:text-gray-300 transition">
            GitHub
          </a>
        </div>
      </header>

      {/* Step indicator */}
      <div className="max-w-5xl mx-auto px-6 py-6">
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

          {step === 1 && videoInfo && (
            <FragmentEditor
              videoInfo={videoInfo}
              fragments={fragments}
              onFragmentsChange={handleFragmentsChange}
            />
          )}

          {step === 2 && (
            <SubtitleEditor
              lyrics={lyrics}
              fragments={fragments}
              subtitles={subtitles}
              onSubtitlesChange={setSubtitles}
            />
          )}

          {step === 3 && (
            <StyleEditor style={style} onChange={setStyle} />
          )}

          {step === 4 && (
            <RenderPanel
              videoInfo={videoInfo}
              fragments={fragments}
              audioPath={audioPath}
              subtitles={subtitles}
              style={style}
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
      </div>
    </div>
  );
}

export default App;