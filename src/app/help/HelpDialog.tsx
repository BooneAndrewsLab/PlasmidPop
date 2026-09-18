import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

import { GUIDE, guidePage } from './guide';
import { Markdown } from './Markdown';

interface Props {
  readonly initialPage?: string;
  readonly onClose: () => void;
}

/**
 * The user guide as a modal: a list of pages on the left, the current page
 * on the right. Escape or a click on the backdrop closes it.
 */
export function HelpDialog({ initialPage, onClose }: Props) {
  const [pageId, setPageId] = useState(initialPage ?? GUIDE[0]?.id ?? '');
  const dialogRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const page = guidePage(pageId) ?? GUIDE[0];

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (articleRef.current !== null) articleRef.current.scrollTop = 0;
  }, [pageId]);

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
                }}
              >
                {p.title}
              </button>
            ))}
          </nav>
          <article ref={articleRef} className="help__page">
            {page !== undefined && <Markdown markdown={page.markdown} onNavigate={setPageId} />}
          </article>
        </div>
      </div>
    </div>
  );
}
