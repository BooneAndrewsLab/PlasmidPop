import { useCallback, useEffect, useRef, useState } from 'react';

import { isAbort } from '@/io';

import { checkAccessionInput, openFromNcbi } from '../openFromNcbi';

/** What was last typed, so a mistyped accession is there to fix next time. */
let lastInput = '';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toString()} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024).toString()} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export interface NcbiSearchProps {
  /** The records were fetched and opened. */
  onOpened: () => void;
  /** Cancel or Escape pressed with no fetch under way. */
  onCancel: () => void;
  /** Escape listens on the whole document (a modal host) rather than the form. */
  globalEscape?: boolean;
  className?: string;
  /** Id of the host's heading, when it has one. */
  titleId?: string;
}

/**
 * The NCBI accession lookup: field, privacy hint, progress, errors, and the
 * request lifecycle. No dialog chrome; the host says what happens next (item 107).
 */
export function NcbiSearch({
  onOpened,
  onCancel,
  globalEscape = false,
  className,
  titleId,
}: NcbiSearchProps) {
  const [input, setInput] = useState(lastInput);
  const [error, setError] = useState<string | null>(null);
  /** Bytes received while a fetch is under way; null when none is. */
  const [received, setReceived] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Hosts pass fresh closures every render; holding them in refs keeps a
  // host re-render from restarting (aborting) a fetch.
  const onOpenedRef = useRef(onOpened);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onOpenedRef.current = onOpened;
    onCancelRef.current = onCancel;
  });

  /** Cancel: stops a fetch under way, or closes the dialog when none is. */
  const cancel = useCallback((): void => {
    if (controller.current !== null) {
      controller.current.abort();
      controller.current = null;
      setReceived(null);
      inputRef.current?.focus();
      return;
    }
    onCancelRef.current();
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    if (!globalEscape) return;
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancel();
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
    };
  }, [globalEscape, cancel]);

  // Closed some other way while fetching: nothing is left running.
  useEffect(() => {
    return () => {
      controller.current?.abort();
    };
  }, []);

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
        onOpenedRef.current();
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
    <form
      className={className}
      aria-labelledby={titleId}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (!globalEscape && e.key === 'Escape') cancel();
      }}
    >
      <div className="dialog__body ncbi-open">
        <label className="panel__field ncbi-open__field">
          <span>Accession</span>
          <input
            ref={inputRef}
            className="panel__search"
            type="text"
            value={input}
            disabled={busy}
            placeholder="L09137, NC_001422, NP_000509"
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
          One accession or several, nucleotide or protein, separated by spaces or commas; each opens
          in a tab of its own. Only the accession numbers are sent, to NCBI
          (eutils.ncbi.nlm.nih.gov), and nothing else leaves your browser.
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
  );
}
