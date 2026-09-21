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

/**
 * The panels, behind the tab rail on the window's outer edge. The rail is
 * always there; the panel beside it is not. Clicking the tab that is open
 * puts the panel away and gives the views the width, clicking any other
 * label brings it back on that tab — the tool-window behaviour of the IDEs
 * the rail is modelled on, and the reason there is no separate control for
 * hiding it.
 */
export function Sidebar({ doc }: Props) {
  const { sidebarTab, sidebarOpen } = useEditorState();
  return (
    <aside className={`sidebar${sidebarOpen ? '' : ' sidebar--collapsed'}`}>
      <div className="sidebar__tabs" role="tablist">
        {TABS.map(([tab, label]) => {
          const active = sidebarOpen && sidebarTab === tab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={active}
              title={active ? 'Hide the panel' : `Show ${label}`}
              className={`sidebar__tab${active ? ' sidebar__tab--active' : ''}`}
              onClick={() => {
                if (active) {
                  editorStore.setSidebarOpen(false);
                  return;
                }
                editorStore.setSidebarTab(tab);
                editorStore.setSidebarOpen(true);
              }}
            >
              <span className="sidebar__tab-label">{label}</span>
            </button>
          );
        })}
      </div>
      <div className="sidebar__panel" role="tabpanel" hidden={!sidebarOpen}>
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
