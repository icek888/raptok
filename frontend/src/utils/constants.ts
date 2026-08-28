/** Shared constants used across components */

/** Word chip colors for timeline/editor — index by word position */
export const WORD_COLORS = [
  '#a855f7', '#3b82f6', '#06b6d4', '#10b981',
  '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6',
  '#14b8a6', '#f97316', '#84cc16', '#6366f1',
];

/** CSS align-items mapping for subtitle positions */
export const POSITION_MAP: Record<string, string> = {
  bottom: 'flex-end',
  center: 'center',
  top: 'flex-start',
};