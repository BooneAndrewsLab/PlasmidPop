import { useRef, useState } from 'react';

import { MAX_MSA_SEQUENCES } from '@/core';
import type { MultipleAlignment, SeqDocument } from '@/core';
import { AnalysisCancelledError, analysisClient } from '@/workers/analysisClient';

import { analytics } from '../analytics';
import { MsaDialog } from './MsaDialog';

interface Props {
  readonly doc: SeqDocument;
  /** The records of the box, to be aligned with each other. */
  readonly records: readonly { readonly name: string; readonly sequence: string }[];
}

/**
 * Align all the records of the Align box with each other, optionally with
 * this document as one more (#207): three to fifty sequences, in the
 * worker, shown in a window of its own.
 */
export function MsaControls({ doc, records }: Props) {
  const [withDoc, setWithDoc] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<{
    readonly names: readonly string[];
    readonly alignment: MultipleAlignment;
  } | null>(null);
  const running = useRef<AbortController | null>(null);

  const include = withDoc && doc.length > 0;
  const total = records.length + (include ? 1 : 0);
  const names = [...(include ? [doc.name] : []), ...records.map((r) => r.name)];
  const sequences = [
    ...(include ? [doc.sequence.toString()] : []),
    ...records.map((r) => r.sequence),
  ];
  const reason =
    total < 3
      ? 'A multiple alignment needs at least three sequences: add records to the box, or include this document.'
      : total > MAX_MSA_SEQUENCES
        ? `A multiple alignment takes at most ${MAX_MSA_SEQUENCES} sequences; the box and this document make ${total}.`
        : null;

  const run = (): void => {
    if (reason !== null || busy) return;
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setProgress(0);
    setError(null);
    analytics.track('align', 'msa', doc.alphabet);
    analysisClient
      .alignMultiple(
        sequences,
        { alphabet: doc.alphabet },
        { onProgress: setProgress, signal: controller.signal },
      )
      .then((alignment) => {
        setShown({ names, alignment });
      })
      .catch((e: unknown) => {
        if (e instanceof AnalysisCancelledError) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        running.current = null;
        setBusy(false);
      });
  };

  return (
    <fieldset className="panel__group">
      <legend>Multiple alignment</legend>
      <p className="panel__note">
        Align the {records.length.toLocaleString()} records of the box with each other
        {include ? ' and with this document' : ''}, all in one view with a consensus.
      </p>
      <div className="panel__controls">
        <label className="toggle" title="Add this document to the sequences aligned">
          <input
            type="checkbox"
            checked={withDoc}
            disabled={busy}
            onChange={(e) => {
              setWithDoc(e.target.checked);
            }}
          />
          Include this document
        </label>
        <button
          type="button"
          className="button button--small"
          disabled={busy || reason !== null}
          title={reason ?? `Align ${total} sequences together`}
          onClick={run}
        >
          {busy ? 'Aligning…' : `Align ${total.toLocaleString()} together`}
        </button>
        {busy && (
          <>
            <progress className="align-progress__bar" value={progress} max={1} />
            <button
              type="button"
              className="button button--quiet button--small"
              onClick={() => {
                running.current?.abort();
              }}
            >
              Cancel
            </button>
          </>
        )}
      </div>
      {reason !== null && !busy && <p className="panel__note">{reason}</p>}
      {error !== null && <p className="panel__error">{error}</p>}
      {shown !== null && (
        <MsaDialog
          names={shown.names}
          alignment={shown.alignment}
          onClose={() => {
            setShown(null);
          }}
        />
      )}
    </fieldset>
  );
}
