export type VideoSource = 'youtube' | 'rezka' | 'direct';

export interface VideoInfo {
  url: string;
  source: VideoSource;
  title: string;
  duration: number;
  width: number;
  height: number;
  local_path: string;
  job_id: string;
}

export interface Fragment {
  id: number;
  start: number;
  end: number;
  duration: number;
  thumbnail?: string | null;
}

export interface FragmentSelection {
  fragments: Fragment[];
  total_duration: number;
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
  probability?: number;
}

export interface SubtitleLine {
  id: number;
  start: number;
  end: number;
  text: string;
  words?: WordTiming[] | null;
}

export interface SubtitleStyle {
  font: string;
  size: number;
  primary_color: string;
  outline_color: string;
  outline_width: number;
  position: 'bottom' | 'center' | 'top';
  bold: boolean;
}

export interface RenderResult {
  status: string;
  output_path: string;
  filename: string;
}

export interface ThumbnailResult {
  index: number;
  timestamp: number;
  path: string;
  error?: string;
}

// ─── New: BPM & Beat Sync ───

export interface BPMResult {
  bpm: number;
  bpm_raw?: number;
  bpm_half?: number;
  bpm_double?: number;
  beats: number[];
  downbeats: number[];
  duration: number;
}

export interface BeatSyncResult {
  bpm: number;
  beats: number[];
  fragments: Fragment[];
  total_duration: number;
}

// ─── New: Speech Recognition ───

export interface TranscribeResult {
  text: string;
  lines: { text: string; start: number; end: number; words: WordTiming[] }[];
  words: WordTiming[];
  language: string;
}

// ─── New: Audio Info ───

export interface AudioInfo {
  duration: number;
  bpm: number;
  bpm_raw?: number;
  bpm_half?: number;
  bpm_double?: number;
  beats: number[];
  suggested_start: number;
  suggested_end: number;
  rms_times: number[];
  rms_values: number[];
}