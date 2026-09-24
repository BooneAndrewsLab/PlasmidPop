import { type SeqDocument } from '@/core';

import { analytics } from '../analytics';
import { SIDEBAR_TABS, type SidebarTab, editorStore } from '../state/editorStore';
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

const LABELS: Readonly<Record<SidebarTab, string>> = {
  features: 'Features',
  orfs: 'ORFs',
  translate: 'Translate',
  primers: 'Primers',
  enzymes: 'Enzymes',
  cloning: 'Cloning',
  align: 'Align',
  history: 'History',
};

const TABS: readonly [SidebarTab, string][] = SIDEBAR_TABS.map((tab) => [tab, LABELS[tab]]);

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
              title={
                active
                  ? 'Hide the panel (Alt+S); Alt+[ and Alt+] step through the tabs'
                  : `Show ${label}`
              }
              className={`sidebar__tab${active ? ' sidebar__tab--active' : ''}`}
              onClick={() => {
                if (active) {
                  editorStore.setSidebarOpen(false);
                  return;
                }
                analytics.trackOnce('panel', 'open', tab);
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
        <SidebarPanel doc={doc} tab={sidebarTab} />
      </div>
    </aside>
  );
}

interface PanelProps {
  readonly doc: SeqDocument;
  readonly tab: SidebarTab;
  /** The phone reader's panels, which look and do not edit. */
  readonly reader?: boolean;
}

/**
 * The panel a tab names, on its own so the phone reader (`PhoneShell`) can
 * show the two it has a use for without a rail it has no room for.
 */
export function SidebarPanel({ doc, tab, reader = false }: PanelProps) {
  switch (tab) {
    case 'features':
      return <FeatureList doc={doc} reader={reader} />;
    case 'enzymes':
      return <EnzymePanel doc={doc} />;
    case 'orfs':
      return <OrfPanel doc={doc} />;
    case 'translate':
      return <TranslatePanel doc={doc} />;
    case 'primers':
      return <PrimerPanel doc={doc} />;
    case 'align':
      return <AlignPanel doc={doc} />;
    case 'cloning':
      return <CloningPanel doc={doc} />;
    case 'history':
      return <HistoryPanel />;
  }
}
