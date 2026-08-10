import type { VideoInfo, Fragment, FragmentSelection, SubtitleLine, SubtitleStyle, RenderResult, ThumbnailResult } from '../types';

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

  render: (
    videoPath: string,
    fragments: Fragment[],
    audioPath: string,
    subtitles: SubtitleLine[],
    style: SubtitleStyle,
  ): Promise<RenderResult> =>
    postJSON(`${API_BASE}/render`, {
      video_path: videoPath,
      fragments,
      audio_path: audioPath,
      subtitles,
      style,
    }),

  uploadAudio: (file: File): Promise<{ path: string; filename: string; size: number }> => {
    const form = new FormData();
    form.append('file', file);
    return postForm(`${API_BASE}/upload/audio`, form);
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
  outline_color: '&H00000000',
  outline_width: 3,
  position: 'bottom',
  bold: true,
};