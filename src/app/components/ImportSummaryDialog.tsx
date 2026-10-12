import { useEffect, useRef } from 'react';

import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

/** The line a count gets: "1 document", "212 documents". */
function documents(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? 'document' : 'documents'}`;
}

/**
 * What opening several files, or a ZIP of them, came to (#213): how many
 * documents are open now, which files were left out and why, and what the
 * parsers had to say about each record. Opening hundreds of files and then
 * seeing only the last of them would hide all of that.
 */
export function ImportSummaryDialog() {
  const { importSummary } = useEditorState();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (importSummary === null) return;
    closeRef.current?.focus();
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') editorStore.dismissImportSummary();
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
    };
  }, [importSummary]);

  if (importSummary === null) return null;
  const { source, opened, alreadyOpen, skipped, warnings } = importSummary;

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-summary-title"
      >
        <h2 id="import-summary-title" className="dialog__title">
          Opened {source}
        </h2>
        <p className="dialog__body">
          {documents(opened)} opened
          {alreadyOpen > 0 && `, ${alreadyOpen.toLocaleString()} already open`}
          {skipped.length > 0 && `, ${skipped.length.toLocaleString()} skipped`}.
        </p>
        {skipped.length > 0 && (
          <>
            <h3>Skipped</h3>
            <ul className="import-summary__list" aria-label="Skipped files">
              {skipped.map((s) => (
                <li key={s.name}>
                  <strong>{s.name}</strong>: {s.reason}
                </li>
              ))}
            </ul>
          </>
        )}
        {warnings.length > 0 && (
          <>
            <h3>Warnings</h3>
            <ul className="import-summary__list" aria-label="Warnings">
              {warnings.map((w, i) => (
                <li key={`${w.name}-${i}`}>
                  <strong>{w.name}</strong>
                  <ul>
                    {w.messages.map((m, j) => (
                      <li key={j}>{m}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="dialog__actions">
          <button
            ref={closeRef}
            type="button"
            className="button button--primary"
            onClick={() => {
              editorStore.dismissImportSummary();
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
