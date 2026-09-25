import { useCallback, useEffect, useRef, useState } from 'react';

import { isAbort } from '@/io';

import { checkAccessionInput, openFromNcbi } from '../openFromNcbi';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

/**
 * File ▸ Open from NCBI… (#65, item 58): accession numbers typed, checked,
 * and fetched only when the user presses Open. The dialog says what is sent
 * and to whom before anything is.
 */
export function NcbiDialog() {
  const { ncbiDialog } = useEditorState();
  return ncbiDialog ? <NcbiForm /> : null;
}

/** What was last typed, so a mistyped accession is there to fix next time. */
let lastInput = '';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toString()} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024).toString()} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function NcbiForm() {
  const [input, setInput] = useState(lastInput);
  const [error, setError] = useState<string | null>(null);
  /** Bytes received while a fetch is under way; null when none is. */
  const [received, setReceived] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** Cancel: stops a fetch under way, or closes the dialog when none is. */
  const cancel = useCallback((): void => {
    if (controller.current !== null) {
      controller.current.abort();
      controller.current = null;
      setReceived(null);
      inputRef.current?.focus();
      return;
    }
    editorStore.dismissNcbi();
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancel();
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
      // Closed some other way while fetching: nothing is left running.
      controller.current?.abort();
    };
  }, [cancel]);

  const submit = (): void => {
    if (controller.current !== null) return;
    lastInput = input;
    const check = checkAccessionInput(input);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setError(null);
    setReceived(0);
    const mine = new AbortController();
    controller.current = mine;
    openFromNcbi(check.accessions, {
      signal: mine.signal,
      onProgress: (bytes) => {
        if (controller.current === mine) setReceived(bytes);
      },
    })
      .then(() => {
        if (controller.current !== mine) return;
        controller.current = null;
        lastInput = '';
        editorStore.dismissNcbi();
      })
      .catch((e: unknown) => {
        if (isAbort(e) || controller.current !== mine) return;
        controller.current = null;
        setReceived(null);
        setError(e instanceof Error ? e.message : String(e));
        inputRef.current?.focus();
      });
  };

  const busy = received !== null;
  return (
    <div className="dialog-backdrop">
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ncbi-title"
        aria-describedby="ncbi-privacy"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 id="ncbi-title" className="dialog__title">
          Open from NCBI
        </h2>
        <div className="dialog__body ncbi-open">
          <label className="panel__field ncbi-open__field">
            <span>Accession</span>
            <input
              ref={inputRef}
              className="panel__search"
              type="text"
              value={input}
              disabled={busy}
              placeholder="L09137, NC_001422"
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="characters"
              aria-invalid={error !== null}
              onChange={(e) => {
                setInput(e.target.value);
                setError(null);
              }}
            />
          </label>
          <p id="ncbi-privacy" className="ncbi-open__hint">
            One nucleotide accession or several, separated by spaces or commas; each opens in a tab
            of its own. Only the accession numbers are sent, to NCBI (eutils.ncbi.nlm.nih.gov), and
            nothing else leaves your browser.
          </p>
          {busy && (
            <p className="ncbi-open__status" role="status">
              Fetching from NCBI… {received > 0 ? formatBytes(received) : ''}
            </p>
          )}
          {error !== null && (
            <p className="panel__error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="dialog__actions">
          <button type="button" className="button" onClick={cancel}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={busy}>
            Open
          </button>
        </div>
      </form>
    </div>
  );
}
