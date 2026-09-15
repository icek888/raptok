import type { PanelProps } from './EditorView';
import LyricsTab from './tabs/LyricsTab';
import StyleTab from './tabs/StyleTab';
import VisualsTab from './tabs/VisualsTab';
import FXTab from './tabs/FXTab';
import type { EditorState } from './types';
import type { EditorActions } from './useEditorState';

type TabId = EditorState['activeTab'];

const TABS: { id: TabId; label: string }[] = [
  { id: 'lyrics', label: 'Lyrics' },
  { id: 'style', label: 'Style' },
  { id: 'visuals', label: 'Visuals' },
  { id: 'fx', label: 'FX' },
];

export default function EditorTabs({ state, actions }: PanelProps) {
  const activeTab = state.activeTab;

  const switchTab = (tab: TabId) => {
    actions.setTab(tab);
  };

  const tabProps = { state, actions };

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-neutral-800">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-cyan-400 border-b-2 border-cyan-400'
                : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'lyrics' && <LyricsTab {...tabProps} />}
        {activeTab === 'style' && <StyleTab {...tabProps} />}
        {activeTab === 'visuals' && <VisualsTab {...tabProps} />}
        {activeTab === 'fx' && <FXTab {...tabProps} />}
      </div>
    </div>
  );
}

export type TabProps = { state: EditorState; actions: EditorActions };