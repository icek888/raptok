// Editor v2 types — see spec section 3.1

export interface WordTiming {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface Clip {
  id: string;
  name: string;
  source: 'stock' | 'user';
  thumbnail: string;
  duration: number;
  locked: boolean;
}

export interface TimelineSlot {
  id: string;
  clipId: string | null;
  start: number;
  end: number;
  wordIndices: number[];
}

export interface EditorStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  highlightColor: string;
  position: 'top' | 'center' | 'bottom' | 'custom';
  customX: number;
  customY: number;
  template: 'cinematic' | 'lyrics' | 'hype' | 'custom';
  karaokeProgress: boolean;
}

export interface EditorEffects {
  zoom: boolean;
  flash: boolean;
  shake: boolean;
  vignette: boolean;
  intensity: number;
}

export interface EditorState {
  // Audio
  audioFile: File | null;
  audioUrl: string | null;
  audioDuration: number;
  audioWaveform: number[];
  trimStart: number;
  trimEnd: number;
  trimmedDuration: number;

  // Transcription
  words: WordTiming[];
  language: 'ru' | 'en' | 'auto';
  transcriptModel: string;
  isTranscribing: boolean;

  // Clips
  clips: Clip[];
  timelineSlots: TimelineSlot[];

  // Visuals
  framing: 'fit' | 'fill';
  background: 'black' | 'subtle' | 'medium' | 'heavy';
  canvasPosition: { x: number; y: number; scale: number; rotation: number };

  // Style
  style: EditorStyle;

  // FX
  effects: EditorEffects;

  // Playback
  currentTime: number;
  isPlaying: boolean;
  bpm: number;

  // UI
  activeTab: 'lyrics' | 'style' | 'visuals' | 'fx';
  selectedSlotId: string | null;
  selectedWordIndex: number | null;
  isTrimModalOpen: boolean;
}