import type { 
  VideoInfo, Fragment, FragmentSelection, SubtitleLine, SubtitleStyle, 
  RenderResult, ThumbnailResult, BPMResult, BeatSyncResult, TranscribeResult, WordTiming, AudioInfo, RenderTemplate, TrackAnalysis
} from '../types';

const API_BASE = '/api';

async function postJSON(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

async function postForm(url: string, form: FormData): Promise<any> {
  const res = await fetch(url, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  health: () => fetch(`${API_BASE.replace('/api', '/health')}`).then(r => r.json()),

  analyze: (url: string): Promise<VideoInfo> =>
    postJSON(`${API_BASE}/analyze`, { url }),

  selectFragments: (duration: number, count: number = 7, minFrag = 3, maxFrag = 5, seed?: number): Promise<FragmentSelection> =>
    postJSON(`${API_BASE}/fragments/select`, { duration, count, min_frag: minFrag, max_frag: maxFrag, seed }),

  replaceFragment: (duration: number, fragments: Fragment[], fragmentId: number, newStart: number, fragDuration = 4): Promise<FragmentSelection> =>
    postJSON(`${API_BASE}/fragments/replace`, { duration, fragments, fragment_id: fragmentId, new_start: newStart, frag_duration: fragDuration }),

  getThumbnails: (videoPath: string, timestamps: number[]): Promise<{ thumbnails: ThumbnailResult[] }> =>
    postForm(`${API_BASE}/thumbnails`, createThumbnailForm(videoPath, timestamps)),

  splitSubtitles: (lyrics: string, fragments: Fragment[], style?: SubtitleStyle): Promise<{ subtitles: SubtitleLine[] }> =>
    postJSON(`${API_BASE}/subtitles/split`, {
      lyrics,
      fragments,
      style: style || defaultStyle,
    }),

  // ─── New: Word-level subtitles ───
  wordSplitSubtitles: (
    lyrics: string,
    fragments: Fragment[],
    wordTimings?: WordTiming[],
    audioStart: number = 0,
    style?: SubtitleStyle,
  ): Promise<{ subtitles: SubtitleLine[] }> =>
    postJSON(`${API_BASE}/subtitles/word-split`, {
      lyrics,
      fragments,
      word_timings: wordTimings || null,
      audio_start: audioStart,
      style: style || defaultStyle,
    }),

  // ─── New: Adjust subtitles (stretch + offset) ───
  adjustSubtitles: (
    lyrics: string,
    fragments: Fragment[],
    wordTimings: WordTiming[],
    stretch: number,
    offset: number,
    style?: SubtitleStyle,
  ): Promise<{ subtitles: SubtitleLine[]; words: WordTiming[] }> =>
    postJSON(`${API_BASE}/subtitles/adjust`, {
      lyrics,
      fragments,
      word_timings: wordTimings,
      audio_start: offset,
      stretch,
      style: style || defaultStyle,
    }),

  render: (
    videoPath: string,
    fragments: Fragment[],
    audioPath: string,
    subtitles: SubtitleLine[],
    style: SubtitleStyle,
    karaoke: boolean = false,
    audioStart: number = 0,
    displayMode: string = 'line_highlight',
    templateId: string = '',
  ): Promise<RenderResult> =>
    postJSON(`${API_BASE}/render`, {
      video_path: videoPath,
      fragments,
      audio_path: audioPath,
      audio_start: audioStart,
      subtitles,
      style,
      karaoke,
      display_mode: displayMode,
      template_id: templateId,
    }),

  getTemplates: (): Promise<{ templates: RenderTemplate[] }> =>
    fetch(`${API_BASE}/templates`).then(r => r.json()),

  uploadAudio: (file: File): Promise<{ path: string; filename: string; size: number }> => {
    const form = new FormData();
    form.append('file', file);
    return postForm(`${API_BASE}/upload/audio`, form);
  },

  // ─── New: BPM Detection ───
  detectBPM: (audioPath: string): Promise<BPMResult> =>
    postJSON(`${API_BASE}/bpm`, { audio_path: audioPath }),

  // ─── New: Beat-Synced Fragments ───
  beatSync: (
    audioPath: string,
    duration: number,
    count: number = 7,
    beatDivision: string = '1/4',
    minFrag: number = 2,
    maxFrag: number = 5,
  ): Promise<BeatSyncResult> =>
    postJSON(`${API_BASE}/beat-sync`, {
      audio_path: audioPath,
      duration,
      count,
      beat_division: beatDivision,
      min_frag: minFrag,
      max_frag: maxFrag,
    }),

  // ─── New: Speech Recognition ───
  transcribe: (audioPath: string, language: string = 'en'): Promise<TranscribeResult> =>
    postJSON(`${API_BASE}/transcribe`, { audio_path: audioPath, language }),

  // ─── New: Audio Info (duration, waveform, BPM) ───
  audioInfo: (audioPath: string): Promise<AudioInfo> =>
    postJSON(`${API_BASE}/audio-info`, { audio_path: audioPath }),

  // ─── Deep Track Analysis (mood, energy, genre, hook) ───
  trackAnalysis: (audioPath: string): Promise<TrackAnalysis> =>
    postJSON(`${API_BASE}/track-analysis`, { audio_path: audioPath }),

  // ─── New: Transcribe fragment (with start/end selection + forced alignment) ───
  transcribeFragment: (
    audioPath: string,
    language: string,
    start: number,
    end: number,
    lyrics?: string,
  ): Promise<TranscribeResult> => {
    const form = new FormData();
    form.append('audio_path', audioPath);
    form.append('language', language);
    form.append('start', String(start));
    form.append('end', String(end));
    if (lyrics) form.append('lyrics', lyrics);
    return postForm(`${API_BASE}/transcribe-fragment`, form);
  },

  // ─── NEW: Transcribe ENTIRE audio (absolute timestamps) ───
  transcribeFull: (
    audioPath: string,
    language: string = 'en',
    lyrics?: string,
    modelSize: string = '',
  ): Promise<TranscribeResult & { total_duration?: number; bpm?: number }> => {
    const form = new FormData();
    form.append('audio_path', audioPath);
    form.append('language', language);
    if (lyrics) form.append('lyrics', lyrics);
    if (modelSize) form.append('model_size', modelSize);
    return postForm(`${API_BASE}/transcribe-full`, form);
  },

  downloadUrl: (filename: string) => `${API_BASE}/download/${filename}`,
  thumbnailUrl: (filename: string) => `${API_BASE}/thumbnail/${filename}`,
};

function createThumbnailForm(videoPath: string, timestamps: number[]): FormData {
  const form = new FormData();
  form.append('video_path', videoPath);
  form.append('timestamps', timestamps.join(','));
  return form;
}

export const defaultStyle: SubtitleStyle = {
  font: 'Arial',
  size: 48,
  primary_color: '&H00FFFFFF',
  active_color: '&H00D7FF',
  outline_color: '&H00000000',
  outline_width: 3,
  position: 'bottom',
  margin_v: 80,
  bold: true,
};