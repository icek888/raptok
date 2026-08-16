import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, Type, Mic, Sparkles, Scissors, Zap, Play, Pause, Plus, X } from 'lucide-react';
import { api } from '../api/client';
import type { Fragment, SubtitleLine, WordTiming, AudioInfo, SubtitleStyle } from '../types';
import { TimelinePreview } from './TimelinePreview';

interface Props {
  lyrics: string;
  fragments: Fragment[];
  subtitles: SubtitleLine[];
  onSubtitlesChange: (subs: SubtitleLine[]) => void;
  audioPath: string | null;
  wordTimings: WordTiming[];
  onWordTimingsChange: (timings: WordTiming[]) => void;
  karaoke: boolean;
  onKaraokeChange: (v: boolean) => void;
  displayMode: 'auto' | 'line_highlight' | 'word_by_word' | 'single_word';
  onDisplayModeChange: (v: 'auto' | 'line_highlight' | 'word_by_word' | 'single_word') => void;
  videoUrl?: string | null;
  onAudioStartChange?: (start: number) => void;
  style: SubtitleStyle;
  onStyleChange: (style: SubtitleStyle) => void;
}

export function SubtitleEditor({
  lyrics, fragments, subtitles, onSubtitlesChange,
  audioPath, wordTimings, onWordTimingsChange,
  karaoke, onKaraokeChange,
  displayMode, onDisplayModeChange,
  videoUrl, onAudioStartChange,
  style, onStyleChange,
}: Props) {
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeLang, setTranscribeLang] = useState('ru');
  const [wordSplitLoading, setWordSplitLoading] = useState(false);
  const [audioInfo, setAudioInfo] = useState<AudioInfo | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioStart, setAudioStart] = useState(0);
  const [audioEnd, setAudioEnd] = useState(0);
  const [stretch, setStretch] = useState(1.0);
  const [offset, setOffset] = useState(0.0);
  const [adjusting, setAdjusting] = useState(false);
  const [showWordEditor, setShowWordEditor] = useState(false);
  const [showSyncPanel, setShowSyncPanel] = useState(true);

  // ── Audio URL for preview ──
  const audioUrl = audioPath ? `/api/audio-preview/${audioPath.split('/').pop()}` : null;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playTime, setPlayTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // ── Load audio info ──
  useEffect(() => {
    if (audioPath && !audioInfo) {
      setAudioLoading(true);
      api.audioInfo(audioPath)
        .then(info => {
          setAudioInfo(info);
          setAudioStart(info.suggested_start);
          setAudioEnd(info.suggested_end);
          onAudioStartChange?.(info.suggested_start);
        })
        .catch(e => console.error('Audio info failed:', e))
        .finally(() => setAudioLoading(false));
    }
  }, [audioPath, audioInfo, onAudioStartChange]);

  useEffect(() => {
    onAudioStartChange?.(audioStart);
  }, [audioStart, onAudioStartChange]);

  // ── Audio playback tracking ──
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setPlayTime(audio.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, [audioUrl]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) audio.pause();
    else audio.play();
  }, [isPlaying]);

  const seekTo = useCallback((t: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = t;
  }, []);

  // ── Range change ──
  const handleRangeChange = (start: number, end: number) => {
    setAudioStart(start);
    setAudioEnd(end);
  };

  // ── Transcribe + Forced Alignment ──
  const handleTranscribe = async () => {
    if (!audioPath) return;
    setTranscribing(true);
    try {
      const result = await api.transcribeFragment(
        audioPath, transcribeLang, audioStart, audioEnd, lyrics,
      );
      onWordTimingsChange(result.words);
      // Generate subtitles from word timings (audio_start=0, already adjusted)
      const subResult = await api.wordSplitSubtitles(
        lyrics || result.text, fragments, result.words, 0,
      );
      onSubtitlesChange(subResult.subtitles);
      // Reset stretch/offset since we have fresh timings
      setStretch(1.0);
      setOffset(0.0);
    } catch (e) {
      console.error('Transcribe failed:', e);
    } finally {
      setTranscribing(false);
    }
  };

  // ── Word Split (even distribution) ──
  const handleWordSplit = async () => {
    if (fragments.length === 0) return;
    setWordSplitLoading(true);
    try {
      const result = await api.wordSplitSubtitles(
        lyrics, fragments,
        wordTimings.length > 0 ? wordTimings : undefined,
        0,  // audio_start=0, word timings already on video timeline
      );
      onSubtitlesChange(result.subtitles);
    } catch (e) {
      console.error('Word split failed:', e);
    } finally {
      setWordSplitLoading(false);
    }
  };

  // ── Apply stretch + offset ──
  const handleAdjust = async () => {
    if (wordTimings.length === 0) return;
    setAdjusting(true);
    try {
      const result = await api.adjustSubtitles(
        lyrics || '', fragments, wordTimings, stretch, offset,
      );
      onWordTimingsChange(result.words);
      onSubtitlesChange(result.subtitles);
    } catch (e) {
      console.error('Adjust failed:', e);
    } finally {
      setAdjusting(false);
    }
  };

  // ── Quick stretch presets ──
  const applyStretch = (factor: number) => {
    setStretch(factor);
  };

  // ── Per-word edit (with live subtitle regen) ──
  const updateWordTiming = (idx: number, field: 'start' | 'end' | 'word', value: string | number) => {
    const updated = wordTimings.map((w, i) =>
      i === idx ? { ...w, [field]: value } : w
    );
    onWordTimingsChange(updated);
    // Live regen subtitles from updated word timings
    if (lyrics && fragments.length > 0) {
      api.wordSplitSubtitles(lyrics, fragments, updated, 0)
        .then(r => onSubtitlesChange(r.subtitles))
        .catch(() => {});
    }
  };

  const deleteWord = (idx: number) => {
    const updated = wordTimings.filter((_, i) => i !== idx);
    onWordTimingsChange(updated);
    if (lyrics && fragments.length > 0) {
      api.wordSplitSubtitles(lyrics, fragments, updated, 0)
        .then(r => onSubtitlesChange(r.subtitles))
        .catch(() => {});
    }
  };

  const insertWord = (idx: number) => {
    const prevEnd = idx > 0 ? wordTimings[idx - 1].end : 0;
    const nextStart = idx < wordTimings.length ? wordTimings[idx].start : prevEnd + 0.5;
    const midTime = (prevEnd + nextStart) / 2;
    const dur = Math.max(0.2, (nextStart - prevEnd) / 4);
    const newWord: WordTiming = {
      word: '...',
      start: Math.round(midTime * 1000) / 1000,
      end: Math.round((midTime + dur) * 1000) / 1000,
    };
    const updated = [...wordTimings];
    updated.splice(idx, 0, newWord);
    onWordTimingsChange(updated);
    if (lyrics && fragments.length > 0) {
      api.wordSplitSubtitles(lyrics, fragments, updated, 0)
        .then(r => onSubtitlesChange(r.subtitles))
        .catch(() => {});
    }
  };

  // ── Active word for karaoke highlight ──
  const activeWordIndex = wordTimings.findIndex(w =>
    playTime - audioStart >= w.start && playTime - audioStart <= w.end
  );

  return (
    <div className="space-y-4">
      {/* Hidden audio element for playback */}
      {audioUrl && (
        <audio ref={audioRef} src={audioUrl} preload="metadata" />
      )}

      {/* ── Top: Unified Timeline + Audio Player ── */}
      {audioPath && audioInfo && (
        <div className="bg-[#0f0f17] border border-[#1a1a2a] rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={togglePlay}
              className="p-1.5 rounded-full bg-purple-600 hover:bg-purple-500 transition"
            >
              {isPlaying ? <Pause size={14} className="text-white" /> : <Play size={14} className="text-white" />}
            </button>
            <span className="text-sm text-gray-300 font-mono">
              {playTime.toFixed(1)}s / {audioInfo.duration.toFixed(1)}s
            </span>
            {audioInfo && (
              <span className="ml-auto text-xs text-gray-500">
                ♩ {audioInfo.bpm} BPM
                {audioInfo.bpm_raw != null && audioInfo.bpm_raw !== audioInfo.bpm && (
                  <span className="text-gray-600"> (raw: {audioInfo.bpm_raw})</span>
                )}
              </span>
            )}
          </div>
          <TimelinePreview
            fragments={fragments}
            subtitles={subtitles}
            audioUrl={audioUrl}
            videoUrl={videoUrl}
            wordTimings={wordTimings}
            audioInfo={audioInfo}
            audioStart={audioStart}
            audioEnd={audioEnd}
            onRangeChange={handleRangeChange}
            onSeek={seekTo}
            currentTime={playTime}
            isPlaying={isPlaying}
            onPlayPause={togglePlay}
            displayMode={displayMode}
            style={style}
          />
        </div>
      )}

      {/* ── Audio Range + Transcribe (compact) ── */}
      {audioPath && (
        <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Scissors size={14} className="text-blue-400" />
            <span className="text-xs font-medium text-blue-300">Audio Range</span>
            {audioLoading && <Loader2 size={12} className="animate-spin text-gray-400" />}
            <span className="text-xs text-gray-500 ml-auto">
              {audioStart.toFixed(0)}s - {audioEnd.toFixed(0)}s ({(audioEnd - audioStart).toFixed(0)}s)
            </span>
          </div>
          {audioInfo && !audioLoading && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="range" min={0} max={audioInfo.duration} step={0.1}
                  value={audioStart}
                  onChange={e => setAudioStart(Math.min(parseFloat(e.target.value), audioEnd - 1))}
                  className="flex-1 accent-blue-500"
                />
                <input
                  type="range" min={0} max={audioInfo.duration} step={0.1}
                  value={audioEnd}
                  onChange={e => setAudioEnd(Math.max(parseFloat(e.target.value), audioStart + 1))}
                  className="flex-1 accent-blue-500"
                />
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500">
                  Start: <input
                    type="number" step={0.1} min={0} max={audioInfo.duration}
                    value={audioStart}
                    onChange={e => setAudioStart(Math.min(parseFloat(e.target.value) || 0, audioEnd - 1))}
                    className="w-14 bg-[#0a0a0f] border border-[#2a2a3a] rounded px-1 py-0.5 text-blue-400 font-mono"
                  />s
                </span>
                <span className="text-gray-500">
                  End: <input
                    type="number" step={0.1} min={0} max={audioInfo.duration}
                    value={audioEnd}
                    onChange={e => setAudioEnd(Math.max(parseFloat(e.target.value) || audioInfo.duration, audioStart + 1))}
                    className="w-14 bg-[#0a0a0f] border border-[#2a2a3a] rounded px-1 py-0.5 text-blue-400 font-mono"
                  />s
                </span>
                <button
                  onClick={() => { setAudioStart(0); setAudioEnd(audioInfo.duration); }}
                  className="ml-auto px-2 py-0.5 text-xs bg-blue-500/20 hover:bg-blue-500/30 rounded text-blue-300"
                >
                  Select All
                </button>
                {audioInfo.suggested_start > 0 && (
                  <button
                    onClick={() => { setAudioStart(audioInfo.suggested_start); setAudioEnd(audioInfo.suggested_end); }}
                    className="px-2 py-0.5 text-xs bg-yellow-500/20 hover:bg-yellow-500/30 rounded text-yellow-300"
                  >
                    💡 Suggested
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <select
              value={transcribeLang}
              onChange={e => setTranscribeLang(e.target.value)}
              className="bg-[#0a0a0f] border border-[#2a2a3a] rounded-lg px-2 py-1.5 text-xs text-gray-200"
            >
              <option value="ru">🇷🇺 Russian</option>
              <option value="en">🇬🇧 English</option>
              <option value="auto">🌍 Auto</option>
            </select>
            <button
              onClick={handleTranscribe}
              disabled={transcribing}
              className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition disabled:opacity-40"
            >
              {transcribing ? <Loader2 size={12} className="animate-spin" /> : <Mic size={12} />}
              {lyrics.trim() ? 'Transcribe & Align' : 'Transcribe'}
            </button>
            {wordTimings.length > 0 && (
              <span className="text-xs text-green-400">✓ {wordTimings.length} words</span>
            )}
          </div>
        </div>
      )}

      {/* ── Sync Controls (collapsible) ── */}
      {wordTimings.length > 0 && (
        <div className="bg-orange-500/5 border border-orange-500/20 rounded-xl p-3 space-y-2">
          <button
            onClick={() => setShowSyncPanel(!showSyncPanel)}
            className="flex items-center gap-2 w-full"
          >
            <Zap size={14} className="text-orange-400" />
            <span className="text-sm font-medium text-orange-300">Sync Adjustment</span>
            <span className="text-xs text-gray-500 ml-auto">
              {wordTimings.length} words · {wordTimings[0]?.start.toFixed(1)}s → {wordTimings[wordTimings.length - 1]?.end.toFixed(1)}s
            </span>
          </button>
          {showSyncPanel && (
            <div className="space-y-2 pt-1">
              {/* Speed buttons */}
              <div className="flex items-center gap-1">
                <span className="text-xs text-gray-500 w-12">Speed:</span>
                <div className="flex gap-1 flex-1">
                  {[
                    { v: 0.5, l: '½x' },
                    { v: 0.75, l: '¾x' },
                    { v: 1.0, l: '1x' },
                    { v: 1.25, l: '1¼x' },
                    { v: 1.5, l: '1½x' },
                    { v: 2.0, l: '2x' },
                  ].map(b => (
                    <button
                      key={b.v}
                      onClick={() => applyStretch(b.v)}
                      className={`flex-1 py-1 text-xs rounded transition ${
                        stretch === b.v
                          ? 'bg-orange-600 text-white'
                          : 'bg-orange-500/20 hover:bg-orange-500/30 text-orange-300'
                      }`}
                    >
                      {b.l}
                    </button>
                  ))}
                </div>
              </div>
              {/* Fine speed slider */}
              <input
                type="range" min={0.25} max={3.0} step={0.05}
                value={stretch}
                onChange={e => setStretch(parseFloat(e.target.value))}
                className="w-full accent-orange-500"
              />
              {/* Offset */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-12">Offset:</span>
                <input
                  type="range" min={-10} max={10} step={0.1}
                  value={offset}
                  onChange={e => setOffset(parseFloat(e.target.value))}
                  className="flex-1 accent-orange-500"
                />
                <input
                  type="number" step={0.1}
                  value={offset}
                  onChange={e => setOffset(parseFloat(e.target.value) || 0)}
                  className="w-16 bg-[#0a0a0f] border border-[#2a2a3a] rounded px-1 py-1 text-xs text-orange-400 font-mono text-right"
                />
              </div>
              <button
                onClick={handleAdjust}
                disabled={adjusting || (stretch === 1.0 && offset === 0)}
                className="w-full py-1.5 bg-orange-600 hover:bg-orange-500 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition disabled:opacity-40"
              >
                {adjusting ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                Apply Sync ({stretch.toFixed(2)}x, {offset > 0 ? '+' : ''}{offset.toFixed(1)}s)
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Quick Style Controls ── */}
      <div className="bg-pink-500/5 border border-pink-500/20 rounded-xl p-2.5 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-pink-300">🎨 Style</span>
          <select
            value={style.font}
            onChange={e => onStyleChange({ ...style, font: e.target.value })}
            className="bg-[#0a0a0f] border border-[#2a2a3a] rounded px-1.5 py-1 text-xs text-gray-200"
          >
            {['Arial', 'Helvetica', 'Impact', 'Georgia', 'Verdana', 'Courier New'].map(f =>
              <option key={f} value={f}>{f}</option>
            )}
          </select>
          <select
            value={style.position}
            onChange={e => onStyleChange({ ...style, position: e.target.value as 'bottom' | 'center' | 'top' })}
            className="bg-[#0a0a0f] border border-[#2a2a3a] rounded px-1.5 py-1 text-xs text-gray-200"
          >
            <option value="bottom">↓ Bottom</option>
            <option value="center">↕ Center</option>
            <option value="top">↑ Top</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-gray-400">
            Size
            <input
              type="range" min="36" max="120"
              value={style.size}
              onChange={e => onStyleChange({ ...style, size: parseInt(e.target.value) })}
              className="w-16 accent-pink-500"
            />
            <span className="text-pink-300 font-mono w-7">{style.size}</span>
          </label>
          <label className="flex items-center gap-1 text-xs text-gray-400">
            Outline
            <input
              type="range" min="0" max="8"
              value={style.outline_width}
              onChange={e => onStyleChange({ ...style, outline_width: parseInt(e.target.value) })}
              className="w-12 accent-pink-500"
            />
            <span className="text-pink-300 font-mono w-4">{style.outline_width}</span>
          </label>
          <input
            type="color"
            value={(() => {
              const hex = style.primary_color.replace('&H', '').replace(/[^0-9A-Fa-f]/g, '');
              if (hex.length < 8) return '#ffffff';
              return `#${hex.substring(6, 8)}${hex.substring(4, 6)}${hex.substring(2, 4)}`;
            })()}
            onChange={e => {
              const r = e.target.value.substring(1, 3);
              const g = e.target.value.substring(3, 5);
              const b = e.target.value.substring(5, 7);
              onStyleChange({ ...style, primary_color: `&H00${b}${g}${r}` });
            }}
            className="w-6 h-6 bg-transparent border border-[#2a2a3a] rounded cursor-pointer"
            title="Text color"
          />
          <input
            type="color"
            value={(() => {
              const hex = style.outline_color.replace('&H', '').replace(/[^0-9A-Fa-f]/g, '');
              if (hex.length < 8) return '#000000';
              return `#${hex.substring(6, 8)}${hex.substring(4, 6)}${hex.substring(2, 4)}`;
            })()}
            onChange={e => {
              const r = e.target.value.substring(1, 3);
              const g = e.target.value.substring(3, 5);
              const b = e.target.value.substring(5, 7);
              onStyleChange({ ...style, outline_color: `&H00${b}${g}${r}` });
            }}
            className="w-6 h-6 bg-transparent border border-[#2a2a3a] rounded cursor-pointer"
            title="Outline color"
          />
          <label className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={style.bold}
              onChange={e => onStyleChange({ ...style, bold: e.target.checked })}
              className="w-3 h-3 accent-pink-500"
            />
            Bold
          </label>
        </div>
      </div>

      {/* ── Karaoke toggle + Display mode + Split ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => onKaraokeChange(!karaoke)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition ${
            karaoke ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400'
          }`}
        >
          <Sparkles size={14} />
          Karaoke
        </button>
        {karaoke && (
          <div className="flex items-center gap-1 bg-[#0a0a0f] border border-[#1a1a2a] rounded-lg p-0.5">
            <button
              onClick={() => onDisplayModeChange('auto')}
              className={`px-2.5 py-1.5 text-xs rounded transition ${
                displayMode === 'auto'
                  ? 'bg-purple-600 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              🤖 Auto
            </button>
            <button
              onClick={() => onDisplayModeChange('line_highlight')}
              className={`px-2.5 py-1.5 text-xs rounded transition ${
                displayMode === 'line_highlight'
                  ? 'bg-purple-600 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              📝 Line
            </button>
            <button
              onClick={() => onDisplayModeChange('word_by_word')}
              className={`px-2.5 py-1.5 text-xs rounded transition ${
                displayMode === 'word_by_word'
                  ? 'bg-purple-600 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              ✨ Word
            </button>
            <button
              onClick={() => onDisplayModeChange('single_word')}
              className={`px-2.5 py-1.5 text-xs rounded transition ${
                displayMode === 'single_word'
                  ? 'bg-purple-600 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              🔤 Single
            </button>
          </div>
        )}
        <button
          onClick={handleWordSplit}
          disabled={wordSplitLoading || fragments.length === 0}
          className="flex items-center gap-1.5 px-3 py-2 bg-purple-600/50 hover:bg-purple-500/50 rounded-lg text-sm text-purple-200 transition disabled:opacity-40"
        >
          {wordSplitLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Word Split {wordTimings.length > 0 ? '(synced)' : '(even)'}
        </button>
        {wordTimings.length > 0 && (
          <button
            onClick={() => setShowWordEditor(!showWordEditor)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition ${
              showWordEditor ? 'bg-orange-600/50 text-orange-200' : 'bg-gray-800 text-gray-400'
            }`}
          >
            <Type size={14} />
            Edit Words
          </button>
        )}
        <span className="text-xs text-gray-500 ml-auto">
          {subtitles.length} lines
        </span>
      </div>

      {/* ── Word Timing Editor (collapsible) ── */}
      {showWordEditor && wordTimings.length > 0 && (
        <div className="bg-[#0f0f17] border border-[#1a1a2a] rounded-xl p-3 space-y-1">
          <div className="max-h-[250px] overflow-y-auto pr-2 space-y-0.5">
            {wordTimings.map((w, i) => (
              <div
                key={i}
                className={`flex items-center gap-1 text-xs rounded px-1 py-0.5 transition ${
                  i === activeWordIndex ? 'bg-yellow-500/20' : ''
                }`}
              >
                <span className="text-gray-600 w-5 text-right font-mono">{i + 1}</span>
                <input
                  type="text"
                  value={w.word}
                  onChange={e => updateWordTiming(i, 'word', e.target.value)}
                  className="w-20 bg-[#0a0a0f] border border-[#2a2a3a] rounded px-1.5 py-1 text-gray-200"
                />
                <input
                  type="number" step={0.01}
                  value={w.start}
                  onChange={e => updateWordTiming(i, 'start', parseFloat(e.target.value) || 0)}
                  className="w-14 bg-[#0a0a0f] border border-[#2a2a3a] rounded px-1 py-1 text-blue-400 font-mono"
                />
                <span className="text-gray-600">→</span>
                <input
                  type="number" step={0.01}
                  value={w.end}
                  onChange={e => updateWordTiming(i, 'end', parseFloat(e.target.value) || 0)}
                  className="w-14 bg-[#0a0a0f] border border-[#2a2a3a] rounded px-1 py-1 text-blue-400 font-mono"
                />
                <button
                  onClick={() => seekTo(w.start + audioStart)}
                  className="px-1 py-1 text-purple-400 hover:bg-purple-500/10 rounded"
                  title="Play from here"
                >
                  <Play size={10} />
                </button>
                <button
                  onClick={() => insertWord(i)}
                  className="px-1 py-1 text-green-400 hover:bg-green-500/10 rounded"
                  title="Insert before"
                >
                  <Plus size={10} />
                </button>
                <button
                  onClick={() => deleteWord(i)}
                  className="px-1 py-1 text-red-400 hover:bg-red-500/10 rounded"
                  title="Delete"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Subtitle Lines ── */}
      {subtitles.length > 0 && (
        <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-2">
          {subtitles.map(sub => {
            const isActive = playTime - audioStart >= sub.start && playTime - audioStart <= sub.end;
            return (
              <div
                key={sub.id}
                className={`flex items-start gap-2 rounded-lg p-2 border transition ${
                  isActive
                    ? 'bg-yellow-500/10 border-yellow-500/30'
                    : 'bg-[#0f0f17] border-[#1a1a2a] hover:border-purple-500/20'
                }`}
              >
                <div className="text-xs text-gray-500 font-mono pt-1 w-5">#{sub.id + 1}</div>
                <div className="flex flex-col gap-0.5 w-20">
                  <input
                    type="number" step="0.1"
                    value={sub.start}
                    onChange={e => onSubtitlesChange(subtitles.map(s => s.id === sub.id ? { ...s, start: parseFloat(e.target.value) || 0 } : s))}
                    className="w-full bg-[#0a0a0f] border border-[#2a2a3a] rounded px-1 py-0.5 text-[10px] text-gray-300 font-mono"
                  />
                  <input
                    type="number" step="0.1"
                    value={sub.end}
                    onChange={e => onSubtitlesChange(subtitles.map(s => s.id === sub.id ? { ...s, end: parseFloat(e.target.value) || 0 } : s))}
                    className="w-full bg-[#0a0a0f] border border-[#2a2a3a] rounded px-1 py-0.5 text-[10px] text-gray-300 font-mono"
                  />
                </div>
                <div className="flex-1">
                  <input
                    type="text"
                    value={sub.text}
                    onChange={e => onSubtitlesChange(subtitles.map(s => s.id === sub.id ? { ...s, text: e.target.value } : s))}
                    className="w-full bg-[#0a0a0f] border border-[#2a2a3a] rounded px-2 py-1 text-sm text-gray-100"
                  />
                  {sub.words && sub.words.length > 0 && (
                    <div className="flex flex-wrap gap-0.5 mt-1">
                      {sub.words.map((w, i) => {
                        const wActive = playTime - audioStart >= w.start && playTime - audioStart <= w.end;
                        return (
                          <span
                            key={i}
                            className={`text-[10px] px-1.5 py-0.5 rounded font-mono cursor-pointer transition ${
                              wActive
                                ? 'bg-yellow-500 text-black'
                                : 'bg-purple-500/10 text-purple-300 hover:bg-purple-500/20'
                            }`}
                            onClick={() => seekTo(w.start + audioStart)}
                            title={`${w.start.toFixed(2)}s - ${w.end.toFixed(2)}s`}
                          >
                            {w.word}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {subtitles.length === 0 && (
        <div className="text-center py-8 text-gray-500 text-sm">
          {audioPath
            ? 'Select audio range → click "Transcribe & Align" for auto-lyrics sync'
            : 'Upload audio → paste lyrics → Transcribe & Align'}
        </div>
      )}
    </div>
  );
}