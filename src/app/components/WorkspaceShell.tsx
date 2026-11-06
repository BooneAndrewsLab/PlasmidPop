import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react';

import type { SeqDocument } from '@/core';

import type { WorkspaceLayout } from '../workspaceController';
import { SHORT_WINDOW_QUERY } from '../state/layout';
import { useRemembered } from '../state/panelMemory';
import { MapStrip } from './MapStrip';
import { useMediaQuery } from './useMediaQuery';

/** The strip's height: a phone's rows are dear, a laptop's less so. */
const STRIP_HEIGHT: Readonly<Record<WorkspaceLayout, number>> = { split: 0, full: 72, phone: 56 };

export interface WorkspacePageSpec<P extends string> {
  readonly id: P;
  /** The rail's label. */
  readonly label: string;
  /** The page's heading. */
  readonly heading: string;
  /** The rail's icon, a path in a 15 × 15 box. */
  readonly icon: string;
  /** A count beside the label, when there is something to count. */
  readonly badge?: number | null;
}

interface Props<P extends string> {
  readonly doc: SeqDocument;
  /** "Primer" or "Align": names the region, its rail and its close button. */
  readonly name: string;
  /** The top bar's title, beside the document's name. */
  readonly title: string;
  readonly layout: WorkspaceLayout;
  readonly pages: readonly WorkspacePageSpec<P>[];
  readonly page: P;
  /**
   * The page the rail asks for. The shell keeps the keyboard on the rail
   * for its own changes; a change the owner makes (a result landing) puts
   * it on the new page's heading, as does opening.
   */
  readonly onPage: (next: P) => void;
  /** Shuts the workspace; with `returnFocus`, the slim panel takes the keyboard. */
  readonly onClose: (returnFocus: boolean) => void;
  /** Beside the heading: a subtitle, a status line. */
  readonly head?: ReactNode;
  /** Beside the heading text itself. */
  readonly headingNote?: ReactNode;
  readonly children: ReactNode;
}

/**
 * The chrome the workspaces share (item 107, item 129): a modeless
 * `region` in the sidebar's column — no focus trap, no backdrop — with a
 * top bar, the document as a foldable strip where the map cannot be beside
 * it, a rail of pages that is a `tablist` walked with the arrow keys, and
 * the page with its heading. Escape shuts it only with the keyboard inside
 * it and nothing inner having taken the key; a window of the page's own
 * (a portal) is outside the region and keeps its Escape to itself.
 */
export function WorkspaceShell<P extends string>({
  doc,
  name,
  title,
  layout,
  pages,
  page,
  onPage,
  onClose,
  head,
  headingNote,
  children,
}: Props<P>) {
  const region = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  /** Whether the next page change is the rail's own, which keeps the keyboard there. */
  const railChange = useRef(false);
  const current = pages.find((p) => p.id === page) ?? pages[0];

  useEffect(() => {
    if (railChange.current) {
      railChange.current = false;
      return;
    }
    region.current?.querySelector<HTMLElement>('.ws__heading')?.focus();
  }, [page]);

  const horizontal = layout === 'phone';
  // The map strip (item 107, point 5), where the map cannot be beside the
  // workspace: folded to begin with on a window too short to spare its
  // rows, and remembered either way, browser-wide and for both workspaces.
  const short = useMediaQuery(SHORT_WINDOW_QUERY);
  const [stripFolded, setStripFolded] = useRemembered('workspace.stripFolded', null, short);

  const goTo = (next: P): void => {
    railChange.current = next !== page;
    onPage(next);
  };

  const onRailKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const back = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const on = horizontal ? 'ArrowRight' : 'ArrowDown';
    const at = pages.findIndex((p) => p.id === page);
    const n = pages.length;
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
    const next = to === null ? undefined : pages[to];
    if (next === undefined || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    goTo(next.id);
    rail.current?.querySelector<HTMLElement>(`#ws-tab-${next.id}`)?.focus();
  };

  // An acronym (CRISPR) keeps its capitals; a word (Primer) reads as one in a sentence.
  const lower = name === name.toUpperCase() ? name : name.toLowerCase();
  return (
    <div
      className={`ws ws--${layout}`}
      role="region"
      aria-label={`${name} workspace`}
      ref={region}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        // A window of the page's own is a portal: in the React tree, not the region.
        if (e.target instanceof Node && region.current?.contains(e.target) !== true) return;
        e.preventDefault();
        onClose(true);
      }}
    >
      <div className="ws__top">
        {layout === 'phone' && (
          <button
            type="button"
            className="button button--quiet ws__back"
            aria-label={`Back to ${doc.name}`}
            onClick={() => {
              onClose(false);
            }}
          >
            ‹
          </button>
        )}
        <span className="ws__title">
          {title} <span className="ws__title-doc">· {doc.name}</span>
        </span>
        <button
          type="button"
          className="button button--quiet ws__close"
          aria-label={`Close the ${lower} workspace`}
          data-tip="Close (Esc)"
          onClick={() => {
            onClose(true);
          }}
        >
          ✕
        </button>
      </div>
      {layout !== 'split' && (
        <details
          className="ws__strip"
          open={!stripFolded}
          onToggle={(e) => {
            setStripFolded(!e.currentTarget.open);
          }}
        >
          <summary
            className="ws__strip-summary"
            data-tip="The document as a ribbon: fold or unfold"
          >
            Map
          </summary>
          {!stripFolded && <MapStrip doc={doc} height={STRIP_HEIGHT[layout]} />}
        </details>
      )}
      <div
        className="ws__rail"
        role="tablist"
        aria-label={`${name} workspace pages`}
        aria-orientation={horizontal ? 'horizontal' : 'vertical'}
        ref={rail}
        onKeyDown={onRailKeyDown}
      >
        {pages.map((p) => {
          const active = p.id === page;
          const count = p.badge ?? null;
          return (
            <button
              key={p.id}
              id={`ws-tab-${p.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="ws-page"
              tabIndex={active ? 0 : -1}
              className={`ws__tab${active ? ' ws__tab--on' : ''}`}
              onClick={() => {
                goTo(p.id);
              }}
            >
              <svg className="ws__icon" viewBox="0 0 15 15" aria-hidden="true">
                <path d={p.icon} />
              </svg>
              <span className="ws__tab-label">{p.label}</span>
              {count !== null && <span className="ws__badge">{count.toLocaleString()}</span>}
            </button>
          );
        })}
      </div>
      <section className="ws__body" id="ws-page" role="tabpanel" aria-labelledby={`ws-tab-${page}`}>
        <header className="ws__head">
          <h2 className="ws__heading" tabIndex={-1}>
            {current?.heading}
            {headingNote}
          </h2>
          {head}
        </header>
        <div className="ws__page">{children}</div>
      </section>
    </div>
  );
}
