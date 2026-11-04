import { useMemo, useRef, useState } from 'react';

import { MAX_MSA_SEQUENCES } from '@/core';
import type { MultipleAlignment, SeqDocument } from '@/core';
import { AnalysisCancelledError, analysisClient } from '@/workers/analysisClient';

import { analytics } from '../analytics';
import { type AlphabetChoice, alphabetInUse, documentJoins } from '../msaAlphabet';
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

  const [choice, setChoice] = useState<AlphabetChoice>('auto');
  // Nucleotide or protein from the records' letters, not the document's (#369).
  const use = useMemo(
    () =>
      alphabetInUse(
        records.map((r) => r.sequence),
        choice,
      ),
    [records, choice],
  );
  const joins = documentJoins(doc.alphabet, doc.length, use);
  const include = withDoc && joins.ok;
  const total = records.length + (include ? 1 : 0);
  const names = [...(include ? [doc.name] : []), ...records.map((r) => r.name)];
  const sequences = [
    ...(include ? [doc.sequence.toString()] : []),
    ...records.map((r) => r.sequence),
  ];
  const reason =
    use.alphabet === null
      ? use.detection.message
      : total < 3
        ? 'A multiple alignment needs at least three sequences: add records to the box, or include this document.'
        : total > MAX_MSA_SEQUENCES
          ? `A multiple alignment takes at most ${MAX_MSA_SEQUENCES} sequences; the box and this document make ${total}.`
          : null;
  const detected = use.detection.alphabet ?? 'not settled';
  const alphabetNote = use.chosen
    ? `Scored as ${use.alphabet}, as chosen${use.detection.alphabet !== null && use.detection.alphabet !== use.alphabet ? `; the letters read as ${use.detection.alphabet}` : ''}.`
    : use.alphabet === null
      ? null
      : `Scored as ${use.alphabet}: ${use.detection.message.toLowerCase()}`;
  const docNote = !withDoc
    ? `${doc.name} is not included (unticked).`
    : include
      ? `${doc.name} is included as one more sequence.`
      : `${doc.name} is not included. ${joins.why ?? ''}`;

  const run = (): void => {
    if (reason !== null || busy) return;
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setProgress(0);
    setError(null);
    analytics.track('align', 'msa', use.alphabet ?? 'nucleotide');
    analysisClient
      .alignMultiple(
        sequences,
        { alphabet: use.alphabet ?? 'nucleotide' },
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
        <label className="toggle" data-tip="Add this document to the sequences aligned">
          <input
            type="checkbox"
            checked={include}
            disabled={busy || !joins.ok}
            onChange={(e) => {
              setWithDoc(e.target.checked);
            }}
          />
          Include this document
        </label>
        <label className="panel__field">
          <span>Letters are</span>
          <select
            aria-label="Alphabet of the records"
            value={choice}
            disabled={busy}
            onChange={(e) => {
              setChoice(e.target.value as AlphabetChoice);
            }}
          >
            <option value="auto">Detected ({detected})</option>
            <option value="nucleotide">Nucleotide</option>
            <option value="protein">Protein</option>
          </select>
        </label>
        <button
          type="button"
          className="button button--small"
          disabled={busy || reason !== null}
          data-tip={reason ?? `Align ${total} sequences together`}
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
      {alphabetNote !== null && <p className="panel__note">{alphabetNote}</p>}
      <p className="panel__note">{docNote}</p>
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
