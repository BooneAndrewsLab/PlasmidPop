import { useEffect, useRef } from 'react';

import { analytics } from '../analytics';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

interface Props {
  /** Picks a file on disk to compare with (the toolbar's, which owns the fallback input). */
  readonly onPickFile: () => void;
}

/**
 * The first question Compare with… asks when there is more than one tab
 * open (#37): which of the other open documents, or a file on disk. The
 * document in front is not offered, nor is the Bench, which is not one.
 */
export function CompareChooser({ onPickFile }: Props) {
  const { comparison, documents, documentId, history } = useEditorState();
  const choosing = comparison?.stage === 'choose';
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!choosing) return;
    firstRef.current?.focus();
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') editorStore.dismissComparison();
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
    };
  }, [choosing]);

  if (!choosing || history === null) return null;
  const others = documents.filter((d) => d.documentId !== documentId);

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-choose-title"
      >
        <h2 id="compare-choose-title" className="dialog__title">
          Compare “{history.present.name}” with…
        </h2>
        <p className="dialog__body">
          Another open document as it is now, or a file on disk. Neither is changed.
        </p>
        <ul className="compare-choices" aria-label="Other open documents">
          {others.map((d, i) => {
            const doc = d.history.present;
            return (
              <li key={d.documentId}>
                <button
                  ref={i === 0 ? firstRef : undefined}
                  type="button"
                  className="button compare-choices__item"
                  title={d.fileName ?? undefined}
                  onClick={() => {
                    analytics.track('compare', 'target', 'tab');
                    editorStore.compareWithTab(d.documentId);
                  }}
                >
                  <span className="compare-choices__name">{doc.name}</span>
                  <span className="compare-choices__meta">
                    {' '}
                    {doc.length.toLocaleString()} bp, {doc.topology}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="dialog__actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              // The chooser goes first, so cancelling the picker leaves
              // nothing up, as it does with no other tab open.
              editorStore.dismissComparison();
              onPickFile();
            }}
          >
            A file on disk…
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              editorStore.dismissComparison();
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
