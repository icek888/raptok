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

export interface SubtitleLine {
  id: number;
  start: number;
  end: number;
  text: string;
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