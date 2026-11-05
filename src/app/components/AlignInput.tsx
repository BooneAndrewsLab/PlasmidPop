import { useRef } from 'react';

import { type SeqDocument, unitName } from '@/core';

import { SEQUENCE_FILE_ACCEPT } from '../openFile';
import { pickerAccept } from '../pickerAccept';
import { BATCH_LIMIT } from '../readBatch';
import type { AlignRun } from './alignRun';
import { OpenTabPicker } from './OpenTabPicker';

interface Props {
  readonly doc: SeqDocument;
  readonly align: AlignRun;
}

/**
 * The box and what feeds it (items 46, 59, 106, 262): the paste-or-drop
 * textarea, Choose file…, Open tab…, the record picker and the note on
 * what was loaded. The slim panel and the workspace's Align page show the
 * same box over the same session (item 129).
 */
export function AlignInput({ doc, align }: Props) {
  const { box, records, otherTabs, all } = align;
  const { picked } = align.session;
  const fileInput = useRef<HTMLInputElement>(null);
  const several = box.several;
  return (
    <>
      <textarea
        className={`panel__textarea${box.dragging ? ' panel__textarea--over' : ''}`}
        rows={5}
        spellCheck={false}
        placeholder={`Paste ${unitName(doc.alphabet, true)}, FASTA or GenBank, or drop one or more files here`}
        aria-label="Sequence to align"
        value={box.text}
        onChange={(e) => {
          box.setText(e.target.value);
        }}
        {...box.dragHandlers}
      />
      <div className="panel__controls">
        <button
          type="button"
          className="button button--quiet button--small"
          onClick={() => fileInput.current?.click()}
        >
          Choose file…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={pickerAccept(SEQUENCE_FILE_ACCEPT)}
          aria-label="File to align"
          multiple
          hidden
          onChange={(e) => {
            box.load(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
        {otherTabs.length > 0 && (
          <OpenTabPicker tabs={otherTabs} limit={BATCH_LIMIT} onUse={align.loadTabs} />
        )}
        {records.length > 1 && (
          <label className="panel__field panel__field--row">
            <select
              className="panel__select"
              aria-label="Record to align"
              value={all ? -1 : Math.min(Math.max(picked, 0), records.length - 1)}
              onChange={(e) => {
                align.setPicked(Number(e.target.value));
              }}
            >
              {records.length <= BATCH_LIMIT && (
                <option value={-1}>All {records.length.toLocaleString()} records</option>
              )}
              {records.map((r, i) => (
                <option key={i} value={i}>
                  {several ? `${r.name} (${r.file ?? ''})` : r.name} (
                  {r.sequence.length.toLocaleString()} bp)
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {(box.note !== null || records.length > 1) && (
        <p className="panel__note">
          {[
            box.note,
            records.length > BATCH_LIMIT
              ? `${records.length.toLocaleString()} records; the one chosen is aligned. Aligning all takes at most ${BATCH_LIMIT} at a time (a plate): split the file to align them all.`
              : records.length > 1
                ? `${records.length} records; the one chosen is aligned, or choose All records to align each of them.`
                : null,
          ]
            .filter((t) => t !== null)
            .join(' ')}
        </p>
      )}
      {box.problem !== null && <p className="panel__error">{box.problem}</p>}
    </>
  );
}

/**
 * The running alignment's bar and Cancel, wherever the run is looked at:
 * under the Align button, and on the Results page a run lands on. Only an
 * alignment long enough to report shows it, so a quick one does not flash it.
 */
export function AlignProgress({ align }: { readonly align: AlignRun }) {
  const { busy, progress, batch } = align.session;
  if (!busy || progress === null) return null;
  return (
    <div className="align-progress">
      <progress
        className="align-progress__bar"
        value={progress}
        max={1}
        aria-label="Alignment progress"
      />
      <span className="align-progress__label" aria-live="polite">
        {batch === null
          ? `${Math.floor(progress * 100)}%`
          : `${batch.rows.length} of ${batch.total}`}
      </span>
      <button type="button" className="button button--quiet button--small" onClick={align.cancel}>
        Cancel
      </button>
    </div>
  );
}

/** The Align button with its progress bar, Cancel and error, the same in both hosts. */
export function AlignAction({
  align,
  primary = false,
  onRun,
}: {
  readonly align: AlignRun;
  readonly primary?: boolean;
  /** Called when a run starts: the workspace goes to Results. */
  readonly onRun?: () => void;
}) {
  const { all, record, box, session } = align;
  const { busy, error } = session;
  return (
    <>
      <div className="panel__controls align-run">
        <button
          type="button"
          className={`button button--small${primary ? ' button--primary' : ''}`}
          disabled={busy || (!all && box.text.trim() === '' && record === undefined)}
          data-tip={
            all
              ? 'Align every record against this document, one after another, and list them'
              : undefined
          }
          onClick={() => {
            if (align.run()) onRun?.();
          }}
        >
          {busy ? (all ? 'Aligning all…' : 'Aligning…') : all ? 'Align all' : 'Align'}
        </button>
      </div>
      <AlignProgress align={align} />
      {error !== null && <p className="panel__error">{error}</p>}
    </>
  );
}
