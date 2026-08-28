/** Time formatting utilities */

/** Format seconds as M:SS.s (e.g. 73.4 → "1:13.4") */
export function formatTime(seconds: number, decimals: number = 1): string {
  if (!seconds || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(decimals).padStart(decimals > 0 ? 4 : 2, '0')}`;
}

/** Convert a container path (/tmp/raptok/abc.mp4) to an API URL (/api/video/abc.mp4) */
export function pathToApiUrl(path: string, endpoint: 'video' | 'audio-preview' | 'thumbnail' | 'download'): string {
  const filename = path.split('/').pop();
  if (!filename) return '';
  return `/api/${endpoint}/${filename}`;
}