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
  active_color: string;
  outline_color: string;
  outline_width: number;
  position: 'bottom' | 'center' | 'top';
  margin_v: number;
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

// ─── Render Templates ───

export interface RenderTemplate {
  id: string;
  name: string;
  description: string;
  // Subtitle style
  font: string;
  size: number;
  primary_color: string;
  active_color: string;
  outline_color: string;
  outline_width: number;
  position: string;
  margin_v: number;
  bold: boolean;
  // Display
  display_mode: string;
  karaoke: boolean;
  // Video rendering
  video_mode: string;
  blur_sigma: number;
  dark_overlay: number;
  scale_factor: number;
  active_scale?: number;
  glow_border?: number;
  fade_in?: number;
}

// ─── Deep Track Analysis ───

export interface MoodScores {
  energy: number;
  valence: number;
  aggressiveness: number;
  brightness: number;
  danceability: number;
}

export interface EnergySegment {
  start: number;
  end: number;
  energy: number;
  label: 'peak' | 'high' | 'mid' | 'low';
}

export interface SongSection {
  start: number;
  end: number;
  energy: number;
  label: string;  // intro, verse, chorus, hook, break, outro
}

export interface TrackAnalysis {
  duration: number;
  bpm: number;
  key: string;
  key_confidence: number;
  mood: string;
  mood_emoji: string;
  mood_color: string;
  mood_description: string;
  mood_scores: MoodScores;
  energy_profile: EnergySegment[];
  energy_curve: number[];
  energy_times: number[];
  hook_time: number;
  hook_score: number;
  genre_hint: string;
  spectral_features: {
    centroid: number;
    rolloff: number;
    zcr: number;
    bass_ratio: number;
    contrast_mean: number;
  };
  sections: SongSection[];
}