import { useState } from 'react';

import type { SeqDocument } from '@/core';

import { type AlphabetChoice } from '../msaAlphabet';
import { type MsaRecord, planMsa } from '../msaPlan';
import { MsaDialog } from './MsaDialog';
import { useMultipleAlignment } from './useMultipleAlignment';

interface Props {
  readonly doc: SeqDocument;
  /** The records of the box, to be aligned with each other. */
  readonly records: readonly MsaRecord[];
}

/**
 * Align all the records of the Align box with each other, optionally with
 * this document as one more (#207): three to fifty sequences, in the
 * worker, shown in a window of its own. The plan is `planMsa`'s and the run
 * `useMultipleAlignment`'s, shared with the window that needs no document
 * (#369, `MsaWindow`).
 */
export function MsaControls({ doc, records }: Props) {
  const [withDoc, setWithDoc] = useState(true);
  const [choice, setChoice] = useState<AlphabetChoice>('auto');
  const msa = useMultipleAlignment();
  // Nucleotide or protein from the records' letters, not the document's (#369).
  const plan = planMsa(
    records,
    choice,
    {
      name: doc.name,
      alphabet: doc.alphabet,
      length: doc.length,
      sequence: () => doc.sequence.toString(),
    },
    withDoc,
  );
  const { use, include, joins, total, reason } = plan;
  const detected = use.detection.alphabet ?? 'not settled';

  const run = (): void => {
    if (reason !== null || msa.busy || use.alphabet === null) return;
    msa.run(plan.names, plan.sequences, use.alphabet);
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
            disabled={msa.busy || !joins.ok}
            onChange={(e) => {
              setWithDoc(e.target.checked);
            }}
          />
          Include this document
        </label>
        <label className="panel__field">
          <span>Letters are</span>
          <select
            className="panel__select"
            aria-label="Alphabet of the records"
            value={choice}
            disabled={msa.busy}
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
          disabled={msa.busy || reason !== null}
          data-tip={reason ?? `Align ${total} sequences together`}
          onClick={run}
        >
          {msa.busy ? 'Aligning…' : `Align ${total.toLocaleString()} together`}
        </button>
        {msa.busy && (
          <>
            <progress className="align-progress__bar" value={msa.progress} max={1} />
            <button
              type="button"
              className="button button--quiet button--small"
              onClick={msa.cancel}
            >
              Cancel
            </button>
          </>
        )}
      </div>
      {plan.alphabetNote !== null && <p className="panel__note">{plan.alphabetNote}</p>}
      {plan.docNote !== null && <p className="panel__note">{plan.docNote}</p>}
      {reason !== null && !msa.busy && <p className="panel__note">{reason}</p>}
      {msa.error !== null && <p className="panel__error">{msa.error}</p>}
      {msa.shown !== null && (
        <MsaDialog names={msa.shown.names} alignment={msa.shown.alignment} onClose={msa.dismiss} />
      )}
    </fieldset>
  );
}
