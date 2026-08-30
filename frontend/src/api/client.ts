import type { 
  VideoInfo, Fragment, FragmentSelection, SubtitleLine, SubtitleStyle, 
  RenderResult, ThumbnailResult, BPMResult, BeatSyncResult, TranscribeResult, WordTiming, AudioInfo, RenderTemplate, TrackAnalysis, PreviewResult
} from '../types';

const API_BASE = '/api';

async function postJSON(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

async function postForm(url: string, form: FormData): Promise<any> {
  const res = await fetch(url, { method: 'POST', body: form, credentials: 'include' });
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
    wordTimings?: WordTiming[],
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
      word_timings: wordTimings || null,
    }),

  getTemplates: (): Promise<{ templates: RenderTemplate[] }> =>
    fetch(`${API_BASE}/templates`, { credentials: 'include' }).then(r => r.json()),

  preparePreview: (
    videoPath: string,
    fragments: Fragment[],
    audioPath?: string | null,
    audioStart?: number,
    wordTimings?: WordTiming[],
    subtitles?: SubtitleLine[],
  ): Promise<PreviewResult> =>
    postJSON(`${API_BASE}/prepare-preview`, {
      video_path: videoPath,
      fragments,
      audio_path: audioPath || null,
      audio_start: audioStart || 0,
      word_timings: wordTimings || null,
      subtitles: subtitles || null,
    }),

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

  // ─── Audio Info (duration, waveform, BPM) ───
  audioInfo: (audioPath: string): Promise<AudioInfo> =>
    postJSON(`${API_BASE}/audio-info`, { audio_path: audioPath }),

  // ─── Deep Track Analysis (mood, energy, genre, hook) ───
  trackAnalysis: (audioPath: string): Promise<TrackAnalysis> =>
    postJSON(`${API_BASE}/track-analysis`, { audio_path: audioPath }),

  // ─── Transcribe full track (WhisperX) ───
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

  // SSE streaming transcription with progress updates
  transcribeFullStream: (
    audioPath: string,
    language: string = 'en',
    lyrics?: string,
    modelSize: string = '',
    onProgress?: (data: { step: string; label: string; progress: number; elapsed?: number }) => void,
  ): Promise<TranscribeResult & { total_duration?: number; bpm?: number }> => {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('audio_path', audioPath);
      form.append('language', language);
      if (lyrics) form.append('lyrics', lyrics);
      if (modelSize) form.append('model_size', modelSize);

      // Use fetch with streaming response
      fetch(`${API_BASE}/transcribe-full-stream`, { method: 'POST', body: form, credentials: 'include' })
        .then(async (res) => {
          const reader = res.body?.getReader();
          if (!reader) { reject(new Error('No response body')); return; }
          
          const decoder = new TextDecoder();
          let buffer = '';
          let finalResult: any = null;
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            
            // Parse SSE events
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.step === 'done') {
                    finalResult = data.result;
                    onProgress?.(data);
                  } else if (data.step === 'error') {
                    reject(new Error(data.label));
                    return;
                  } else {
                    onProgress?.(data);
                  }
                } catch {}
              }
            }
          }
          
          if (finalResult) resolve(finalResult);
          else reject(new Error('No result received'));
        })
        .catch(reject);
    });
  },

  downloadUrl: (filename: string) => `${API_BASE}/download/${filename}`,
  thumbnailUrl: (filename: string) => `${API_BASE}/thumbnail/${filename}`,

  // ─── Features (modular enhancements) ───
  getFeatures: (): Promise<any> =>
    fetch(`${API_BASE}/features`, { credentials: 'include' }).then(r => r.json()),

  // Unified AI Style (genre + emotion in one call)
  aiStyle: (audioPath: string): Promise<any> =>
    postJSON(`${API_BASE}/ai-style`, { audio_path: audioPath }),

  autoCut: (duration: number, beats: number[], energyCurve?: number[], energyTimes?: number[], count = 7, minFrag = 3, maxFrag = 6): Promise<any> =>
    postJSON(`${API_BASE}/features/auto-cut`, {
      duration, beats,
      energy_curve: energyCurve || null,
      energy_times: energyTimes || null,
      count, min_frag: minFrag, max_frag: maxFrag,
    }),

  snapToBeats: (fragments: any[], beats: number[]): Promise<any> =>
    postJSON(`${API_BASE}/features/snap-to-beats`, { fragments, beats }),
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