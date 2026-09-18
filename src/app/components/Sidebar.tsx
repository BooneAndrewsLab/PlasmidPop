import { type SeqDocument } from '@/core';

import { type SidebarTab, editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { AlignPanel } from './AlignPanel';
import { CloningPanel } from './CloningPanel';
import { EnzymePanel } from './EnzymePanel';
import { FeatureList } from './FeatureList';
import { HistoryPanel } from './HistoryPanel';
import { OrfPanel } from './OrfPanel';
import { PrimerPanel } from './PrimerPanel';
import { TranslatePanel } from './TranslatePanel';

interface Props {
  readonly doc: SeqDocument;
}

const TABS: readonly [SidebarTab, string][] = [
  ['features', 'Features'],
  ['enzymes', 'Enzymes'],
  ['orfs', 'ORFs'],
  ['translate', 'Translate'],
  ['primers', 'Primers'],
  ['align', 'Align'],
  ['cloning', 'Cloning'],
  ['history', 'History'],
];

export function Sidebar({ doc }: Props) {
  const { sidebarTab } = useEditorState();
  return (
    <aside className="sidebar">
      <div className="sidebar__tabs" role="tablist">
        {TABS.map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={sidebarTab === tab}
            className={`sidebar__tab${sidebarTab === tab ? ' sidebar__tab--active' : ''}`}
            onClick={() => {
              editorStore.setSidebarTab(tab);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="sidebar__panel" role="tabpanel">
        {sidebarTab === 'features' && <FeatureList doc={doc} />}
        {sidebarTab === 'enzymes' && <EnzymePanel doc={doc} />}
        {sidebarTab === 'orfs' && <OrfPanel doc={doc} />}
        {sidebarTab === 'translate' && <TranslatePanel doc={doc} />}
        {sidebarTab === 'primers' && <PrimerPanel doc={doc} />}
        {sidebarTab === 'align' && <AlignPanel doc={doc} />}
        {sidebarTab === 'cloning' && <CloningPanel doc={doc} />}
        {sidebarTab === 'history' && <HistoryPanel />}
      </div>
    </aside>
  );
}
