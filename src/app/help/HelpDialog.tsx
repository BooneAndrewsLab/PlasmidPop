import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

import { GUIDE, guidePage } from './guide';
import { Markdown } from './Markdown';

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

/**
 * The user guide as a modal: a list of pages on the left, the current page
 * on the right. Escape or a click on the backdrop closes it.
 */
export function HelpDialog({ initialPage, onClose }: Props) {
  // `initialPage` may name a section too: `02-files#saving-in-firefox-and-safari`.
  const [initialId, initialAnchor] = splitAnchor(initialPage);
  const [pageId, setPageId] = useState(initialId ?? GUIDE[0]?.id ?? '');
  const dialogRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const page = guidePage(pageId) ?? GUIDE[0];

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
  }, []);

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
  }, [pageId, anchor]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };

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
                }}
              >
                {p.title}
              </button>
            ))}
          </nav>
          <article ref={articleRef} className="help__page">
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
      </div>
    </div>
  );
}
