import { useState, useEffect } from 'react';
import type { RenderTemplate } from '../types';
import { api } from '../api/client';

/** Cached templates — single API call across all components */
let _templates: RenderTemplate[] | null = null;

/** Shared hook: fetch templates once, cache for all components */
export function useTemplates() {
  const [templates, setTemplates] = useState<RenderTemplate[]>(_templates || []);
  const [loading, setLoading] = useState(!_templates);

  useEffect(() => {
    if (_templates) return;
    api.getTemplates()
      .then(data => {
        _templates = data.templates;
        setTemplates(data.templates);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return { templates, loading };
}

/** Apply template fields to a SubtitleStyle — shared between SubtitleEditor and VideoPreviewEditor */
export function applyTemplateToStyle(
  tmpl: RenderTemplate,
  onStyleChange: (s: any) => void,
  onDisplayModeChange: (m: 'auto' | 'line_highlight' | 'word_by_word' | 'single_word') => void,
  onTemplateChange: (id: string) => void,
) {
  onStyleChange({
    font: tmpl.font,
    size: tmpl.size,
    primary_color: tmpl.primary_color,
    active_color: tmpl.active_color,
    outline_color: tmpl.outline_color,
    outline_width: tmpl.outline_width,
    position: tmpl.position as 'bottom' | 'center' | 'top',
    margin_v: tmpl.margin_v,
    bold: tmpl.bold,
  });
  onDisplayModeChange(tmpl.display_mode as 'auto' | 'line_highlight' | 'word_by_word' | 'single_word');
  onTemplateChange(tmpl.id);
}