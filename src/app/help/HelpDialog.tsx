import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';

import { analytics } from '../analytics';
import { isTextTarget } from '../keys';
import { GUIDE, guidePage } from './guide';
import { buildGuideIndex } from './guideIndex';
import { type GuideIndex, SEARCH_PLACEHOLDER, type Snippet, search } from './guideSearch';
import { Markdown } from './Markdown';
import { StatsSwitch } from './StatsSwitch';

interface Props {
  /** A page id, optionally with a section: `02-files` or `02-files#saving`. */
  readonly initialPage?: string | undefined;
  readonly onClose: () => void;
}

/** Splits `02-files#saving` into its page and its section. */
function splitAnchor(page: string | undefined): [string | undefined, string | null] {
  if (page === undefined) return [undefined, null];
  const hash = page.indexOf('#');
  return hash === -1 ? [page, null] : [page.slice(0, hash), page.slice(hash + 1)];
}

// Built when the first query is typed (#409), not when the dialog opens, and
// kept: the guide does not change while the app runs.
let guideIndex: GuideIndex | null = null;
function searchGuide(query: string) {
  guideIndex ??= buildGuideIndex(GUIDE);
  return search(guideIndex, query);
}

/** A snippet of a section's text, with the words that matched marked. */
function Highlighted({ snippet }: { readonly snippet: Snippet }) {
  const parts: (string | { readonly mark: string })[] = [];
  let at = 0;
  for (const [a, b] of snippet.marks) {
    parts.push(snippet.text.slice(at, a), { mark: snippet.text.slice(a, b) });
    at = b;
  }
  parts.push(snippet.text.slice(at));
  return <>{parts.map((p, i) => (typeof p === 'string' ? p : <mark key={i}>{p.mark}</mark>))}</>;
}

/**
 * The user guide as a modal: a list of pages on the left, the current page
 * on the right, or the results of a search of the guide in its place.
 * Escape clears the search box first; with it empty, Escape or a click on the
 * backdrop closes the dialog.
 */
export function HelpDialog({ initialPage, onClose }: Props) {
  // `initialPage` may name a section too: `02-files#saving-in-firefox-and-safari`.
  const [initialId, initialAnchor] = splitAnchor(initialPage);
  const [pageId, setPageId] = useState(initialId ?? GUIDE[0]?.id ?? '');
  const dialogRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLOListElement>(null);
  const page = guidePage(pageId) ?? GUIDE[0];
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const results = useMemo(() => (searching ? searchGuide(query) : []), [query, searching]);
  /** Counts the results opened, so opening the heading the page is already at still scrolls to it. */
  const [jumps, setJumps] = useState(0);

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
  }, []);

  // The id of a page the guide has, never whatever id was asked for.
  const readId = page?.id;
  useEffect(() => {
    if (readId !== undefined) analytics.trackOnce('help', 'page', readId);
  }, [readId]);

  /**
   * Where a `#…` link, or the section `initialPage` named, has asked to be:
   * a heading id to scroll to once the page below is rendered, or null for
   * the top of the page.
   */
  const [anchor, setAnchor] = useState<string | null>(initialAnchor);

  useEffect(() => {
    const article = articleRef.current;
    if (article === null) return;
    const heading = anchor === null ? null : article.querySelector(`#${CSS.escape(anchor)}`);
    if (heading instanceof HTMLElement) article.scrollTop = heading.offsetTop - article.offsetTop;
    else article.scrollTop = 0;
  }, [pageId, anchor, jumps]);

  // The result that was opened was the focus; the page is where it goes.
  useEffect(() => {
    if (jumps > 0) articleRef.current?.focus({ preventScroll: true });
  }, [jumps]);

  const openResult = (r: (typeof results)[number]): void => {
    setPageId(r.page);
    setAnchor(r.anchor);
    setQuery('');
    setJumps((n) => n + 1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (query === '') onClose();
      else {
        setQuery('');
        searchRef.current?.focus();
      }
      return;
    }
    // `/` and Ctrl+K (Cmd+K) jump to the search box, as `/` does in most
    // docs sites; `/` stays a plain key in a field.
    const mod = e.ctrlKey || e.metaKey;
    const jump = mod
      ? e.key.toLowerCase() === 'k' && !e.altKey && !e.shiftKey
      : e.key === '/' && !e.altKey && !isTextTarget(e.target);
    if (jump) {
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  };

  const resultButtons = (): HTMLElement[] =>
    Array.from(resultsRef.current?.querySelectorAll<HTMLElement>('.help__result') ?? []);

  return (
    <div
      className="help-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="help"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="help__header">
          <h1 id="help-title" className="help__title">
            PlasmidPop guide
          </h1>
          <span className="help__version">Version {__APP_VERSION__}</span>
          {/* The standalone tutorials (#312): a page of the site, not of the dialog. */}
          <a
            className="button button--small button--primary help__tutorials"
            href={`${import.meta.env.BASE_URL}tutorials/`}
            target="_blank"
            rel="noopener"
          >
            Tutorials
          </a>
          <button
            type="button"
            className="button button--quiet button--small"
            aria-label="Close guide"
            onClick={onClose}
          >
            Close
          </button>
        </header>
        <div className="help__body">
          <div className="help__side">
            <div className="help__search" role="search">
              <input
                ref={searchRef}
                type="search"
                className="help__search-input"
                placeholder={SEARCH_PLACEHOLDER}
                aria-label={SEARCH_PLACEHOLDER}
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    resultButtons()[0]?.focus();
                  } else if (e.key === 'Enter') {
                    const first = results[0];
                    if (first !== undefined) openResult(first);
                  }
                }}
              />
            </div>
            <nav className="help__nav" aria-label="Guide pages">
              {GUIDE.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`help__nav-item${p.id === page?.id ? ' help__nav-item--active' : ''}`}
                  aria-current={p.id === page?.id ? 'page' : undefined}
                  onClick={() => {
                    setPageId(p.id);
                    setAnchor(null);
                    setQuery('');
                  }}
                >
                  {p.title}
                </button>
              ))}
            </nav>
          </div>
          {searching && (
            <section className="help__page help__results" aria-label="Search results">
              <p className="help__results-count" role="status">
                {results.length === 0
                  ? `No matches for “${query.trim()}”.`
                  : `${results.length} ${results.length === 1 ? 'result' : 'results'}`}
              </p>
              <ol
                ref={resultsRef}
                className="help__result-list"
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                  e.preventDefault();
                  const all = resultButtons();
                  const at = all.findIndex((b) => b === document.activeElement);
                  if (e.key === 'ArrowDown') all[at + 1]?.focus();
                  else (all[at - 1] ?? searchRef.current)?.focus();
                }}
              >
                {results.map((r) => (
                  <li key={`${r.page}#${r.anchor}`}>
                    <button
                      type="button"
                      className="help__result"
                      onClick={() => {
                        openResult(r);
                      }}
                    >
                      <span className="help__result-where">
                        {r.pageTitle}
                        {r.heading !== r.pageTitle && (
                          <>
                            {' › '}
                            <strong>{r.heading}</strong>
                          </>
                        )}
                      </span>
                      <span className="help__result-snippet">
                        <Highlighted snippet={r.snippet} />
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <article ref={articleRef} className="help__page" tabIndex={-1} hidden={searching}>
            {page !== undefined && (
              <Markdown
                markdown={page.markdown}
                onNavigate={(id) => {
                  setPageId(id);
                  setAnchor(null);
                }}
                onAnchor={setAnchor}
              />
            )}
          </article>
        </div>
        <StatsSwitch />
      </div>
    </div>
  );
}
