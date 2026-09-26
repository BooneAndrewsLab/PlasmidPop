import { type KeyboardEvent, useRef } from 'react';

import { type SeqDocument } from '@/core';

import { analytics } from '../analytics';
import { type SidebarTab, editorStore, sidebarTabsFor } from '../state/editorStore';
import { SIDEBAR_STACKED_QUERY } from '../state/layout';
import { useEditorState } from '../state/useEditorStore';
import { useBindingLabel } from './useAltKey';
import { AlignPanel } from './AlignPanel';
import { CloningPanel } from './CloningPanel';
import { EnzymePanel } from './EnzymePanel';
import { FeatureList } from './FeatureList';
import { HistoryPanel } from './HistoryPanel';
import { OrfPanel } from './OrfPanel';
import { PrimerPanel } from './PrimerPanel';
import { ProteinPanel } from './ProteinPanel';
import { SidebarIcon } from './SidebarIcon';
import { TranslatePanel } from './TranslatePanel';
import { useMediaQuery } from './useMediaQuery';

interface Props {
  readonly doc: SeqDocument;
}

const LABELS: Readonly<Record<SidebarTab, string>> = {
  features: 'Features',
  protein: 'Protein',
  orfs: 'ORFs',
  translate: 'Translate',
  primers: 'Primers',
  enzymes: 'Enzymes',
  cloning: 'Cloning',
  align: 'Align',
  history: 'History',
};

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
  const sidebarKey = useBindingLabel('toggle-sidebar');
  const prevKey = useBindingLabel('sidebar-previous');
  const nextKey = useBindingLabel('sidebar-next');
  // A rail down the edge, or a strip across the top on a narrow window.
  const stacked = useMediaQuery(SIDEBAR_STACKED_QUERY);
  const rail = useRef<HTMLDivElement>(null);
  // A protein has no Enzymes or Primers, and DNA no Protein panel (#66).
  const tabs = sidebarTabsFor(doc);

  // The tabs pattern of WAI-ARIA (#35): one Tab stop for the whole rail, on
  // the tab the panel is on, and the arrow keys along it, which open the
  // tab they reach. Home and End go to either end.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const back = stacked ? 'ArrowLeft' : 'ArrowUp';
    const on = stacked ? 'ArrowRight' : 'ArrowDown';
    const at = tabs.indexOf(sidebarTab);
    const n = tabs.length;
    const to =
      e.key === back
        ? (at - 1 + n) % n
        : e.key === on
          ? (at + 1) % n
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : null;
    const next = to === null ? undefined : tabs[to];
    if (next === undefined || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    analytics.trackOnce('panel', 'open', next);
    editorStore.setSidebarTab(next);
    editorStore.setSidebarOpen(true);
    rail.current?.querySelector<HTMLElement>(`#sidebar-tab-${next}`)?.focus();
  };

  return (
    <aside className={`sidebar${sidebarOpen ? '' : ' sidebar--collapsed'}`}>
      <div
        className="sidebar__tabs"
        role="tablist"
        aria-label="Sidebar"
        aria-orientation={stacked ? 'horizontal' : 'vertical'}
        ref={rail}
        onKeyDown={onKeyDown}
      >
        {tabs.map((tab) => {
          const label = LABELS[tab];
          const active = sidebarOpen && sidebarTab === tab;
          return (
            <button
              key={tab}
              id={`sidebar-tab-${tab}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="sidebar-panel"
              tabIndex={tab === sidebarTab ? 0 : -1}
              title={
                active
                  ? `Hide the panel (${sidebarKey}); ${prevKey} and ${nextKey} step through the tabs`
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
              <SidebarIcon tab={tab} />
              <span className="sidebar__tab-label">{label}</span>
            </button>
          );
        })}
      </div>
      <div
        className="sidebar__panel"
        id="sidebar-panel"
        role="tabpanel"
        aria-labelledby={`sidebar-tab-${sidebarTab}`}
        hidden={!sidebarOpen}
      >
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
    case 'protein':
      return <ProteinPanel doc={doc} />;
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
