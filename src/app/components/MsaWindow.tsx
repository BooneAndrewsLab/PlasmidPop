import { useEffect, useRef, useState } from 'react';

import { MAX_MSA_SEQUENCES } from '@/core';

import { analytics } from '../analytics';
import { type AlphabetChoice } from '../msaAlphabet';
import { planMsa } from '../msaPlan';
import { SEQUENCE_FILE_ACCEPT } from '../openFile';
import { pickerAccept } from '../pickerAccept';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { MsaDialog } from './MsaDialog';
import { MsaRunNotices } from './MsaRunNotices';
import { useMultipleAlignment } from './useMultipleAlignment';
import { EMPTY_RECORD_BOX, useRecordBox } from './useRecordBox';

/**
 * File ▸ Multiple alignment… (#369, item 129): several records aligned
 * with each other with no document open. A box to paste or drop records
 * into, the alphabet read from their letters with the same override as the
 * Align tab's group, and the same results window (`MsaDialog`) with its
 * selection, bar and Advanced copy. Closing the results comes back here
 * with the records kept, so a second run is a click.
 */
export function MsaWindow() {
  const { msaDialog } = useEditorState();
  if (!msaDialog) return null;
  return <MsaWindowBody />;
}

function MsaWindowBody() {
  const [choice, setChoice] = useState<AlphabetChoice>('auto');
  const [box, setBox] = useState(EMPTY_RECORD_BOX);
  // Raw pasted letters are one record, which no multiple alignment is made
  // of; a chosen alphabet still says how they are cleaned.
  const records = useRecordBox(box, setBox, choice === 'protein' ? 'protein' : 'nucleotide');
  const msa = useMultipleAlignment();
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const plan = planMsa(records.records, choice, null, false);
  const { use, total, reason } = plan;
  const detected = use.detection.alphabet ?? 'not settled';
  const shown = msa.shown;

  useEffect(() => {
    analytics.trackOnce('panel', 'open', 'msa-window');
    textarea.current?.focus();
  }, []);

  // Escape closes the window, unless the results window is up: that one
  // listens for its own Escape (clearing a selection, then closing itself).
  const resultsUp = shown !== null;
  useEffect(() => {
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !resultsUp && !e.defaultPrevented) editorStore.dismissMsa();
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
    };
  }, [resultsUp]);

  const run = (): void => {
    if (reason !== null || msa.busy || use.alphabet === null) return;
    msa.run(plan.names, plan.sequences, use.alphabet);
  };

  const n = records.records.length;
  const fromFiles = records.loaded !== null && records.text === '';
  const unit = use.alphabet === 'protein' ? 'aa' : 'bp';

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog dialog--wide msa-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="msa-window-title"
      >
        <h2 id="msa-window-title" className="dialog__title">
          Multiple alignment
        </h2>
        <p className="dialog__body">
          Align three to {MAX_MSA_SEQUENCES} sequences with each other, in one view with a
          consensus, without opening any of them. Paste FASTA or GenBank records, or drop or choose
          files (GenBank, FASTA, SnapGene, AB1, FASTQ). Whether they are bases or residues is read
          from their letters.
        </p>
        <textarea
          ref={textarea}
          className={`panel__textarea${records.dragging ? ' panel__textarea--over' : ''}${fromFiles ? ' panel__textarea--filled' : ''}`}
          rows={fromFiles ? 3 : 8}
          spellCheck={false}
          placeholder={
            fromFiles
              ? 'The files were taken: their records are listed below. Pasting here replaces them.'
              : 'Paste FASTA or GenBank records, or drop files here'
          }
          aria-label="Sequences to align"
          value={records.text}
          disabled={msa.busy}
          onChange={(e) => {
            records.setText(e.target.value);
          }}
          {...records.dragHandlers}
        />
        <div className="panel__controls">
          <button
            type="button"
            className="button button--small"
            disabled={msa.busy}
            onClick={() => fileInput.current?.click()}
          >
            Choose files…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={pickerAccept(SEQUENCE_FILE_ACCEPT)}
            aria-label="Files to align"
            multiple
            hidden
            onChange={(e) => {
              records.load(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
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
        </div>
        {!records.parsed.ok && <p className="panel__error">{records.parsed.message}</p>}
        {records.problem !== null && <p className="panel__error">{records.problem}</p>}
        {n > 0 && (
          <section className="msa-window__records" aria-labelledby="msa-window-count">
            <h3 id="msa-window-count" className="msa-window__count">
              {n.toLocaleString()} {n === 1 ? 'sequence' : 'sequences'}
              {records.note !== null && <span className="panel__heading-note">{records.note}</span>}
            </h3>
            <ul className="msa-window__chips" aria-label="Sequences to align, each with a way out">
              {records.records.map((r, i) => (
                <li key={i} className="msa-window__chip">
                  <span className="msa-window__chip-name">{r.name}</span>
                  <span className="msa-window__chip-meta">
                    {r.sequence.length.toLocaleString()} {unit}
                    {records.several && r.file !== undefined ? ` · ${r.file}` : ''}
                  </span>
                  <button
                    type="button"
                    className="msa-window__chip-remove"
                    aria-label={`Remove ${r.name}`}
                    data-tip="Leave this one out"
                    disabled={msa.busy}
                    onClick={() => {
                      records.removeRecord(i);
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {plan.alphabetNote !== null && <p className="panel__note">{plan.alphabetNote}</p>}
        {reason !== null && !msa.busy && <p className="panel__note">{reason}</p>}
        <MsaRunNotices msa={msa} />
        {msa.busy && (
          <div className="align-progress">
            <progress
              className="align-progress__bar"
              value={msa.progress}
              max={1}
              aria-label="Alignment progress"
            />
            <span className="align-progress__label" aria-live="polite">
              {Math.floor(msa.progress * 100)}%
            </span>
            <button
              type="button"
              className="button button--quiet button--small"
              onClick={msa.cancel}
            >
              Cancel
            </button>
          </div>
        )}
        <div className="dialog__actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              editorStore.dismissMsa();
            }}
          >
            Close
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={msa.busy || reason !== null}
            data-tip={reason ?? `Align ${total} sequences together`}
            onClick={run}
          >
            {msa.busy ? 'Aligning…' : `Align ${total.toLocaleString()} together`}
          </button>
        </div>
        {shown !== null && (
          <MsaDialog names={shown.names} alignment={shown.alignment} onClose={msa.dismiss} />
        )}
      </div>
    </div>
  );
}
