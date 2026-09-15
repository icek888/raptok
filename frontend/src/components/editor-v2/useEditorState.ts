import { useState, useCallback, useRef } from 'react';
import type { EditorState, WordTiming, Clip, TimelineSlot, EditorStyle, EditorEffects } from './types';
import { api } from '../../api/client';

const initialState: EditorState = {
  audioFile: null,
  audioUrl: null,
  audioDuration: 0,
  audioWaveform: [],
  trimStart: 0,
  trimEnd: 30,
  trimmedDuration: 30,
  words: [],
  language: 'ru',
  transcriptModel: 'openai/whisper-1',
  transcriptPrompt: '',        // optional context prompt for Whisper
  isolateVocals: false,          // isolate vocals before transcription
  isTranscribing: false,
  clips: [],
  timelineSlots: [],
  framing: 'fit',
  background: 'black',
  canvasPosition: { x: 50, y: 50, scale: 1, rotation: 0 },
  style: {
    fontFamily: 'Arial',
    fontSize: 96,  // canvas px (1080×1920) — real output size
    fontWeight: 700,
    color: '#ffffff',
    highlightColor: '#22d3ee',
    position: 'center',
    customX: 50,
    customY: 50,
    template: 'custom',
    karaokeProgress: false,
  },
  effects: { zoom: false, flash: false, shake: false, vignette: false, intensity: 0.5 },
  currentTime: 0,
  isPlaying: false,
  bpm: 0,
  activeTab: 'lyrics',
  selectedSlotId: null,
  selectedWordIndex: null,
  selectedClipId: null,
  splitFragments: 4,
  isTrimModalOpen: false,
};

export function useEditorState() {
  const [state, setState] = useState<EditorState>(initialState);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const update = useCallback(<K extends keyof EditorState>(key: K, value: EditorState[K]) => {
    setState(prev => ({ ...prev, [key]: value }));
  }, []);

  const loadAudio = useCallback(async (file: File) => {
    update('audioFile', file);
    update('audioUrl', URL.createObjectURL(file));
    try {
      const result = await api.uploadAudio(file);
      const info = await api.audioInfo(result.path);
      update('audioDuration', info.duration);
      update('audioWaveform', info.rms_values || []);
      update('bpm', info.bpm);
      update('trimStart', info.suggested_start);
      update('trimEnd', info.suggested_end);
      update('trimmedDuration', info.suggested_end - info.suggested_start);
    } catch (e) {
      console.error('loadAudio error:', e);
    }
  }, [update]);

  const trimAudio = useCallback((start: number, end: number) => {
    update('trimStart', start);
    update('trimEnd', end);
    update('trimmedDuration', end - start);
  }, [update]);

  const transcribe = useCallback(async () => {
    if (!state.audioFile) return;
    update('isTranscribing', true);
    try {
      const result = await api.transcribeOpenRouter(
        state.audioFile,
        state.language,
        state.transcriptModel,
        state.trimStart,
        state.trimEnd,
        state.transcriptPrompt,
        state.isolateVocals,
      );
      update('words', result.words);
    } catch (e) {
      console.warn('OpenRouter STT failed, falling back to CrisperWhisper:', e);
      // TODO: implement CrisperWhisper fallback
    } finally {
      update('isTranscribing', false);
    }
  }, [state.audioFile, state.language, state.transcriptModel, state.trimStart, state.trimEnd, update]);

  const setWords = useCallback((words: WordTiming[]) => update('words', words), [update]);
  const addClip = useCallback((clip: Clip) => setState(prev => ({ ...prev, clips: [...prev.clips, clip] })), []);
  const removeClip = useCallback((id: string) => setState(prev => ({ ...prev, clips: prev.clips.filter(c => c.id !== id) })), []);
  const lockClip = useCallback((id: string) => setState(prev => ({ ...prev, clips: prev.clips.map(c => c.id === id ? { ...c, locked: !c.locked } : c) })), []);

  const fillSlots = useCallback(() => {
    setState(prev => {
      const unlocked = prev.clips.filter(c => !c.locked);
      if (unlocked.length === 0) return prev;
      const slots = prev.timelineSlots.map((slot, i) => {
        // Keep locked clips in place, fill everything else
        const existingClip = prev.clips.find(c => c.id === slot.clipId);
        if (existingClip?.locked) return slot;
        return { ...slot, clipId: unlocked[i % unlocked.length].id };
      });
      return { ...prev, timelineSlots: slots };
    });
  }, []);

  const shuffleSlots = useCallback(() => {
    setState(prev => {
      const unlocked = prev.clips.filter(c => !c.locked);
      const shuffled = [...unlocked].sort(() => Math.random() - 0.5);
      let clipIdx = 0;
      const slots = prev.timelineSlots.map(slot => {
        const existingClip = prev.clips.find(c => c.id === slot.clipId);
        if (existingClip?.locked) return slot;
        const newClipId = shuffled[clipIdx % shuffled.length]?.id || null;
        clipIdx++;
        return { ...slot, clipId: newClipId };
      });
      return { ...prev, timelineSlots: slots };
    });
  }, []);

  const selectSlot = useCallback((id: string | null) => update('selectedSlotId', id), [update]);
  const selectWord = useCallback((idx: number | null) => update('selectedWordIndex', idx), [update]);
  const selectClip = useCallback((id: string | null) => update('selectedClipId', id), [update]);
  const setSplitFragments = useCallback((n: number) => update('splitFragments', n), [update]);
  const assignClip = useCallback((slotId: string, clipId: string) => {
    setState(prev => ({
      ...prev,
      timelineSlots: prev.timelineSlots.map(s =>
        s.id === slotId ? { ...s, clipId } : s
      ),
    }));
  }, []);
  const setStyle = useCallback((partial: Partial<EditorStyle>) => setState(prev => ({ ...prev, style: { ...prev.style, ...partial } })), []);
  const setEffects = useCallback((partial: Partial<EditorEffects>) => setState(prev => ({ ...prev, effects: { ...prev.effects, ...partial } })), []);
  const setVisuals = useCallback((partial: Partial<Pick<EditorState, 'framing' | 'background' | 'canvasPosition'>>) => setState(prev => ({ ...prev, ...partial })), []);
  const play = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      // If outside trim range, seek to trimStart
      if (state.currentTime < state.trimStart || state.currentTime >= state.trimEnd) {
        audio.currentTime = state.trimStart;
      }
    }
    update('isPlaying', true);
  }, [update, state.currentTime, state.trimStart, state.trimEnd]);
  const pause = useCallback(() => update('isPlaying', false), [update]);
  const seek = useCallback((time: number) => update('currentTime', time), [update]);
  const setTab = useCallback((tab: EditorState['activeTab']) => update('activeTab', tab), [update]);
  const openTrimModal = useCallback(() => update('isTrimModalOpen', true), [update]);
  const closeTrimModal = useCallback(() => update('isTrimModalOpen', false), [update]);

  const uploadClip = useCallback(async (file: File) => {
    try {
      const result = await api.uploadVideo(file);
      const newClip: Clip = {
        id: crypto.randomUUID(),
        name: file.name,
        source: 'user',
        thumbnail: '',
        duration: result.duration,
        locked: false,
        videoUrl: URL.createObjectURL(file),
        serverPath: result.local_path,
      };
      addClip(newClip);
    } catch (e) {
      console.error('uploadClip error:', e);
    }
  }, [addClip]);

  const generateSlots = useCallback((count?: number) => {
    if (state.trimmedDuration === 0) return;
    // If count is provided, create N equal slots regardless of BPM
    if (count && count > 0) {
      const slotDur = state.trimmedDuration / count;
      const slots: TimelineSlot[] = Array.from({ length: count }, (_, i) => ({
        id: `slot-${i}`,
        clipId: null,
        start: i * slotDur,
        end: (i + 1) * slotDur,
        wordIndices: [],
      }));
      update('timelineSlots', slots);
      return;
    }
    // Otherwise use BPM
    if (state.bpm === 0) return;
    const beatDuration = 60 / state.bpm;
    const slotCount = Math.floor(state.trimmedDuration / beatDuration);
    const slots: TimelineSlot[] = Array.from({ length: slotCount }, (_, i) => ({
      id: `slot-${i}`,
      clipId: null,
      start: i * beatDuration,
      end: (i + 1) * beatDuration,
      wordIndices: [],
    }));
    update('timelineSlots', slots);
  }, [state.bpm, state.trimmedDuration, update]);

  // Split a single clip to ALL slots (same clip fills every slot).
  // splitFragments controls how many pieces the clip will be cut into at render time.
  const splitClipToSlots = useCallback((clipId: string, fragments: number) => {
    setState(prev => {
      if (prev.timelineSlots.length === 0) return prev;
      const f = Math.max(2, Math.min(10, Math.floor(fragments)));
      const clip = prev.clips.find(c => c.id === clipId);
      if (!clip) return prev;

      // Get clip duration (if known, e.g. from video metadata)
      // Default to 5s if unknown
      const clipDur = clip.duration || 5;
      // Each fragment = clipDur / fragments
      const fragDur = clipDur / f;

      // Assign fragments to random slots
      const slotCount = prev.timelineSlots.length;
      const slots = [...prev.timelineSlots];

      // Shuffle slot indices for random assignment
      const indices = Array.from({ length: slotCount }, (_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }

      // Assign each slot a random fragment (0..f-1)
      for (let i = 0; i < slotCount; i++) {
        const slotIdx = indices[i];
        const fragIdx = Math.floor(Math.random() * f);
        slots[slotIdx] = {
          ...slots[slotIdx],
          clipId,
          // Store fragment offset for render: startTime within clip = fragIdx * fragDur
          fragmentStart: fragIdx * fragDur,
          fragmentDuration: fragDur,
        };
      }

      return { ...prev, timelineSlots: slots, selectedClipId: clipId, splitFragments: f };
    });
  }, []);

  const setTranscriptPrompt = useCallback((prompt: string) => setState(prev => ({ ...prev, transcriptPrompt: prompt })), []);
  const setIsolateVocals = useCallback((v: boolean) => setState(prev => ({ ...prev, isolateVocals: v })), []);

  return {
    state,
    videoRef,
    audioRef,
    actions: {
      loadAudio, trimAudio, transcribe, setWords, addClip, removeClip, lockClip,
      fillSlots, shuffleSlots, splitClipToSlots, selectSlot, selectWord, selectClip,
      setSplitFragments, assignClip, setStyle, setEffects, setVisuals,
      play, pause, seek, setTab, openTrimModal, closeTrimModal, uploadClip, generateSlots,
      setTranscriptPrompt, setIsolateVocals,
    },
  };
}

export type EditorActions = ReturnType<typeof useEditorState>['actions'];