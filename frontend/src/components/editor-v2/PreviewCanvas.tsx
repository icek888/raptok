import type { PanelProps } from './EditorView';
import type { RefObject } from 'react';

interface Props extends PanelProps {
  videoRef: RefObject<HTMLVideoElement | null>;
}

export default function PreviewCanvas(_props: Props) {
  return <div className="p-3 text-sm text-neutral-500">PreviewCanvas</div>;
}