import { type KeyboardEvent, useEffect, useMemo, useRef } from 'react';

import { type SeqDocument, isEmptyRange } from '@/core';
import { type OverlaySpan } from '@/view/overlay';

import {
  WORKSPACE_PAGES,
  type WorkspaceLayout,
  type WorkspaceMemory,
  type WorkspacePage,
  closePrimerWorkspace,
} from '../primerWorkspace';
import { useRemembered } from '../state/panelMemory';
import { usePrimerCollection } from '../state/primerCollection';
import { useEditorState } from '../state/useEditorStore';
import { PrimerCandidates } from './PrimerCandidates';
import { PrimerCheck } from './PrimerCheck';
import { PrimerCollection } from './PrimerCollection';
import { PrimerDesignPage } from './PrimerDesignPage';
import { searchWindows, usePrimerDesign, usePrimerProbe, usePrimersPreview } from './primerDesign';

const LABELS: Readonly<Record<WorkspacePage, string>> = {
  design: 'Design',
  results: 'Results',
  check: 'Check',
  mine: 'My primers',
};

const HEADINGS: Readonly<Record<WorkspacePage, string>> = {
  design: 'Design primers',
  results: 'Results',
  check: 'Check a primer',
  mine: 'My primers',
};

/** The rail's icons, the mockup's: two primers, an arrow, a list, a longer list. */
const ICONS: Readonly<Record<WorkspacePage, string>> = {
  design: 'M2 5h8l-2-2m2 2-2 2M13 10H5l2-2m-2 2 2 2',
  results: 'M2 8h11m-3-3 3 3-3 3',
  check: 'M2 4h11M2 7h7M2 10h11',
  mine: 'M2 4h11M2 8h7M2 12h9',
};

export type { WorkspaceLayout };

interface Props {
  readonly doc: SeqDocument;
  /** Beside the live map, the whole main area, or the whole screen (point 5). */
  readonly layout?: WorkspaceLayout;
}

/**
 * The primer workspace (item 107, #300): a modeless `region` — no focus
 * trap, no backdrop — in the sidebar's column, with a left rail of four
 * pages that each have a heading of their own. Escape shuts it only with
 * the keyboard inside it and nothing inner having taken the key; the slim
 * Primers panel then takes the keyboard back on "Design primers…". Opening
 * it puts the keyboard on the page's heading; the rail is a `tablist`
 * walked with the arrow keys.
 */
export function PrimerWorkspace({ doc, layout = 'split' }: Props) {
  const { documentId, selection } = useEditorState();
  const [memory, setMemory] = useRemembered<WorkspaceMemory>('primers.workspace', documentId, {
    page: 'design',
  });
  const { page } = memory;
  const design = usePrimerDesign(doc);
  const probe = usePrimerProbe(doc);
  const { primerCriteria } = useEditorState();
  const collection = usePrimerCollection();
  const region = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  /** Whether the next render of a page should put the keyboard on its heading. */
  const focusHeading = useRef(true);

  // What the views draw for the page in front: the search windows around
  // the target while designing, the pair looked at on Results, the binding
  // sites on Check. My primers draws its own (`collection`).
  const preview = useMemo<readonly OverlaySpan[]>(() => {
    switch (page) {
      case 'design':
        return selection === null || isEmptyRange(selection)
          ? []
          : searchWindows(selection, primerCriteria, doc);
      case 'results':
        // A target changed since the design takes the preview off, keeping the row (point 3).
        return design.targetUnchanged ? design.preview : [];
      case 'check':
        return probe.preview;
      case 'mine':
        return [];
    }
  }, [page, selection, primerCriteria, doc, design.preview, design.targetUnchanged, probe.preview]);
  usePrimersPreview(preview);

  useEffect(() => {
    if (!focusHeading.current) return;
    focusHeading.current = false;
    region.current?.querySelector<HTMLElement>('.ws__heading')?.focus();
  }, [page]);

  const goTo = (next: WorkspacePage, focus: boolean): void => {
    focusHeading.current = focus;
    setMemory((m) => ({ ...m, page: next }));
  };

  const horizontal = layout === 'phone';
  const onRailKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const back = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const on = horizontal ? 'ArrowRight' : 'ArrowDown';
    const at = WORKSPACE_PAGES.indexOf(page);
    const n = WORKSPACE_PAGES.length;
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
    const next = to === null ? undefined : WORKSPACE_PAGES[to];
    if (next === undefined || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    goTo(next, false);
    rail.current?.querySelector<HTMLElement>(`#ws-tab-${next}`)?.focus();
  };

  const badge = (p: WorkspacePage): number | null => {
    if (p === 'results') return design.pairs?.length ?? null;
    if (p === 'mine') return collection.primers.length;
    return null;
  };

  return (
    <div
      className={`ws ws--${layout}`}
      role="region"
      aria-label="Primer workspace"
      ref={region}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        e.preventDefault();
        closePrimerWorkspace(true);
      }}
    >
      <div className="ws__top">
        {layout === 'phone' && (
          <button
            type="button"
            className="button button--quiet ws__back"
            aria-label={`Back to ${doc.name}`}
            onClick={() => {
              closePrimerWorkspace(false);
            }}
          >
            ‹
          </button>
        )}
        <span className="ws__title">
          Primers <span className="ws__title-doc">· {doc.name}</span>
        </span>
        <button
          type="button"
          className="button button--quiet ws__close"
          aria-label="Close the primer workspace"
          data-tip="Close (Esc)"
          onClick={() => {
            closePrimerWorkspace(true);
          }}
        >
          ✕
        </button>
      </div>
      <div
        className="ws__rail"
        role="tablist"
        aria-label="Primer workspace pages"
        aria-orientation={horizontal ? 'horizontal' : 'vertical'}
        ref={rail}
        onKeyDown={onRailKeyDown}
      >
        {WORKSPACE_PAGES.map((p) => {
          const active = p === page;
          const count = badge(p);
          return (
            <button
              key={p}
              id={`ws-tab-${p}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="ws-page"
              tabIndex={active ? 0 : -1}
              className={`ws__tab${active ? ' ws__tab--on' : ''}`}
              onClick={() => {
                goTo(p, false);
              }}
            >
              <svg className="ws__icon" viewBox="0 0 15 15" aria-hidden="true">
                <path d={ICONS[p]} />
              </svg>
              <span className="ws__tab-label">{LABELS[p]}</span>
              {count !== null && <span className="ws__badge">{count.toLocaleString()}</span>}
            </button>
          );
        })}
      </div>
      <section className="ws__body" id="ws-page" role="tabpanel" aria-labelledby={`ws-tab-${page}`}>
        <header className="ws__head">
          <h2 className="ws__heading" tabIndex={-1}>
            {HEADINGS[page]}
            {page === 'mine' && collection.status === 'ready' && (
              <span className="panel__heading-note">{collection.primers.length}</span>
            )}
          </h2>
          {page === 'design' && <span className="ws__sub">Up to 10 pairs, best first</span>}
          {page === 'results' && design.pairs !== null && !design.targetUnchanged && (
            <span className="ws__sub ws__sub--note" role="status">
              Target changed —{' '}
              <button
                type="button"
                className="link"
                onClick={() => {
                  goTo('design', true);
                }}
              >
                Design again
              </button>
            </span>
          )}
        </header>
        <div className="ws__page">
          {page === 'design' && (
            <PrimerDesignPage
              doc={doc}
              design={design}
              onDesigned={() => {
                goTo('results', true);
              }}
              onResults={() => {
                goTo('results', true);
              }}
            />
          )}
          {page === 'results' && <PrimerCandidates doc={doc} design={design} layout={layout} />}
          {page === 'check' && <PrimerCheck doc={doc} probe={probe} />}
          {page === 'mine' && <PrimerCollection doc={doc} />}
        </div>
      </section>
    </div>
  );
}
