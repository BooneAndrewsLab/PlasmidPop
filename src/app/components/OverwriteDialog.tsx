import { useEffect, useRef } from 'react';

import { editorStore } from '../state/editorStore';
import { persistence } from '../state/persistence';
import { useEditorState } from '../state/useEditorStore';

/**
 * Asked once per file before Save first writes back into the file the user
 * opened: most people do not expect a web page to overwrite a file on disk.
 */
export function OverwriteDialog() {
  const { overwritePrompt } = useEditorState();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (overwritePrompt === null) return;
    cancelRef.current?.focus();
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') editorStore.dismissOverwrite();
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
    };
  }, [overwritePrompt]);

  if (overwritePrompt === null) return null;
  const { fileName } = overwritePrompt;
  const report = (p: Promise<unknown>): void => {
    p.catch((e: unknown) => {
      editorStore.fail(e instanceof Error ? e.message : String(e));
    });
  };

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="overwrite-title"
        aria-describedby="overwrite-body"
      >
        <h2 id="overwrite-title" className="dialog__title">
          Overwrite {fileName}?
        </h2>
        <p id="overwrite-body" className="dialog__body">
          Save writes the current sequence straight into <strong>{fileName}</strong> on your disk,
          replacing the file you opened. You will not be asked again for this file.
        </p>
        <div className="dialog__actions">
          <button
            type="button"
            className="button button--danger"
            onClick={() => {
              report(persistence.confirmOverwrite());
            }}
          >
            Overwrite
          </button>
          <button
            type="button"
            className="button"
            title="Keep the original and choose where to save the new file"
            onClick={() => {
              editorStore.dismissOverwrite();
              report(persistence.saveAs());
            }}
          >
            Save a copy…
          </button>
          <button
            ref={cancelRef}
            type="button"
            className="button button--quiet"
            onClick={() => {
              editorStore.dismissOverwrite();
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
