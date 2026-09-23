import { useEffect, useRef, useState } from 'react';

import { type SeqDocument } from '@/core';

import { type SidebarTab, editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { CircularMapView } from './CircularMapView';
import { LinearSequenceView } from './LinearSequenceView';
import { SidebarPanel } from './Sidebar';

/** The three things a phone shows, one at a time. */
export type PhonePane = 'map' | 'sequence' | 'details';

const PANES: readonly [PhonePane, string][] = [
  ['map', 'Map'],
  ['sequence', 'Sequence'],
  ['details', 'Details'],
];

/**
 * The sidebar tabs a reader has a use for. The others make things — primers,
 * assemblies, alignments — and want a keyboard and a desk; nobody designs a
 * primer standing at the freezer.
 */
const DETAIL_TABS: readonly [SidebarTab, string][] = [
  ['features', 'Features'],
  ['enzymes', 'Enzymes'],
];

interface Props {
  readonly doc: SeqDocument;
}

/**
 * The app on a phone: a reader for a link someone sent, not a smaller
 * editor. One pane at a time — the map, the sequence, or the Features and
 * Enzymes lists — behind a bar of three tabs within reach of a thumb. The
 * pane is local state on purpose: it is not a view preference, and it
 * starts on the map because that is what a link is opened to look at.
 *
 * Tapping a row in a list asks the views to reveal a position (every list
 * does, through `reveal`), and on a phone the view is on another pane, so
 * the shell answers by going to the view pane last looked at. A reveal
 * raised while a view is already showing changes nothing.
 */
export function PhoneShell({ doc }: Props) {
  const { reveal, sidebarTab } = useEditorState();
  const [pane, setPane] = useState<PhonePane>('map');
  const lastView = useRef<Exclude<PhonePane, 'details'>>('map');
  // The nonce this shell has already answered, so a reveal from before it
  // mounted — the selection a document was opened with — does not move it.
  const answered = useRef(reveal?.nonce ?? 0);
  useEffect(() => {
    const nonce = reveal?.nonce ?? 0;
    if (nonce === answered.current) return;
    answered.current = nonce;
    setPane((current) => (current === 'details' ? lastView.current : current));
  }, [reveal]);

  const show = (next: PhonePane): void => {
    if (next !== 'details') lastView.current = next;
    setPane(next);
  };
  const detailTab: SidebarTab = DETAIL_TABS.some(([t]) => t === sidebarTab)
    ? sidebarTab
    : 'features';

  return (
    <div className="phone">
      <PhoneNotice />
      <div className="phone__pane">
        {pane === 'map' && <CircularMapView doc={doc} />}
        {pane === 'sequence' && <LinearSequenceView doc={doc} reader />}
        {pane === 'details' && (
          <div className="phone__details">
            <div className="phone__subtabs" role="tablist" aria-label="Details">
              {DETAIL_TABS.map(([tab, label]) => {
                const active = detailTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`phone__subtab${active ? ' phone__subtab--active' : ''}`}
                    onClick={() => {
                      editorStore.setSidebarTab(tab);
                      editorStore.setSidebarOpen(true);
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="phone__panel" role="tabpanel">
              <SidebarPanel doc={doc} tab={detailTab} reader />
            </div>
          </div>
        )}
      </div>
      <nav className="phone__bar" role="tablist" aria-label="Panes">
        {PANES.map(([p, label]) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={pane === p}
            className={`phone__tab${pane === p ? ' phone__tab--active' : ''}`}
            onClick={() => {
              show(p);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

/** Remembers that the notice has been read, so it is said once per browser. */
const SEEN_KEY = 'plasmidpop.phoneNoticeSeen';

function wasSeen(): boolean {
  try {
    return globalThis.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false; // Storage unavailable (private mode, blocked cookies).
  }
}

function rememberSeen(): void {
  try {
    globalThis.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Best effort, like the rest of local persistence.
  }
}

/**
 * Says once that this is the reader. Without it the missing toolbar reads
 * as something broken, and a user who tries to type into the sequence and
 * gets nothing has no way to know that was the design.
 */
function PhoneNotice() {
  const [seen, setSeen] = useState(wasSeen);
  if (seen) return null;
  return (
    <div className="copy-banner copy-banner--quiet phone__notice" role="status">
      <span className="copy-banner__text">
        On a small screen PlasmidPop is a reader: the map, the sequence and the lists are here, and
        editing works best on a larger one.
      </span>
      <button
        type="button"
        className="copy-banner__link"
        onClick={() => {
          rememberSeen();
          setSeen(true);
        }}
      >
        Got it
      </button>
    </div>
  );
}
