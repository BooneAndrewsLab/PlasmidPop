import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import type { SeqDocument } from '@/core';

import {
  differenceRegions,
  nextDifference,
  stackAlignments,
  type StackSample,
} from '../alignmentStack';
import {
  annotationsOf,
  buildTrack,
  classifyColumns,
  countByClass,
  differencesText,
} from '../alignmentTrack';
import { alignedRegionInDocument, type ReferenceInput } from '../readAlignment';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { buildFrames } from '../alignmentResidues';
import { AlignmentStackView } from './AlignmentStackView';

/** Lanes of features and ORFs drawn above the reference; more are left out and counted. */
const MAX_LANES = 8;

const LEGEND: readonly (readonly [string, string])[] = [
  ['In a CDS or ORF', 'var(--diff-cds)'],
  ['In another feature', 'var(--diff-feature)'],
  ['Outside features', 'var(--diff-none)'],
];

interface Props {
  /** What every sample was aligned to. */
  readonly reference: ReferenceInput;
  readonly referenceName: string;
  readonly samples: readonly StackSample[];
  /** Whether the document is the read and the reference the box's record (#57). */
  readonly documentIsRead: boolean;
  /**
   * The document the reference was cut from, whose features and ORFs are
   * drawn above the alignment (#102); null when the reference is a record
   * pasted in the box, which brings none.
   */
  readonly document: SeqDocument | null;
  /** The sample to start on, an index into `samples`. */
  readonly initialRow?: number;
  readonly onClose: () => void;
}

/**
 * The alignment results in a window of their own (#103): the reference and
 * every sample stacked as rows under one scroll, with an overview of every
 * difference above. The sidebar's Align panel is too narrow for a plasmid
 * against a plasmid, or ninety-six reads at once.
 *
 * Esc closes it and focus goes back to where it was. Alt+N goes to the next
 * difference, with Shift the previous, as Next change does in the views.
 */
export function AlignmentDialog({
  reference,
  referenceName,
  samples,
  documentIsRead,
  document: source,
  initialRow,
  onClose,
}: Props) {
  const { readConfidentQuality, analysis, orfMinCodons } = useEditorState();
  const [showFeatures, setShowFeatures] = useState(true);
  const [showOrfs, setShowOrfs] = useState(false);
  const [showTrace, setShowTrace] = useState(true);
  const [showResidues, setShowResidues] = useState(false);
  const stack = useMemo(() => stackAlignments(reference, samples), [reference, samples]);
  // The ORFs the app has already found in the open document, at its own minimum length.
  const orfs = source !== null && analysis?.doc === source ? analysis.orfs : null;
  const track = useMemo(() => {
    if (source === null) return null;
    const annotations = annotationsOf(
      showFeatures ? source.features.all() : [],
      showOrfs ? (orfs ?? []) : [],
    );
    return buildTrack(stack, annotations, source.isCircular ? source.length : 0, MAX_LANES);
  }, [source, stack, showFeatures, showOrfs, orfs]);
  // Where each column falls in the document, whatever the Features and ORFs boxes show (#104).
  const classes = useMemo(
    () =>
      source === null
        ? null
        : classifyColumns(
            stack,
            annotationsOf(source.features.all(), orfs ?? []),
            source.isCircular ? source.length : 0,
          ),
    [source, stack, orfs],
  );
  const frames = useMemo(
    () =>
      source === null
        ? []
        : buildFrames(stack, source, source.features.all(), source.isCircular ? source.length : 0),
    [source, stack],
  );
  const counts = useMemo(
    () => (classes === null ? null : countByClass(stack.differences, classes)),
    [stack, classes],
  );
  const [selected, setSelected] = useState<number | null>(
    initialRow ?? (samples.length === 1 ? 0 : null),
  );
  const [focus, setFocus] = useState<{ start: number; end: number; nonce: number } | null>(null);
  const hasTrace = stack.rows.some((r) => r.readIndex !== null);
  const regions = useMemo(() => differenceRegions(stack.differences), [stack.differences]);
  const current = useRef(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      before?.focus();
    };
  }, []);

  const go = useCallback(
    (backwards: boolean): void => {
      const region = nextDifference(regions, current.current, backwards);
      if (region === null) return;
      current.current = region.start;
      setFocus((f) => ({ ...region, nonce: (f?.nonce ?? 0) + 1 }));
    },
    [regions],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.altKey && e.code === 'KeyN') {
        e.preventDefault();
        go(e.shiftKey);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose, go]);

  const row = selected === null ? null : (stack.rows[selected] ?? null);
  const shown = row?.result.alignment ?? null;
  const reads =
    samples.length === 1 ? 'one sequence' : `${samples.length.toLocaleString()} sequences`;

  return createPortal(
    <div className="dialog-backdrop dialog-backdrop--full">
      <div
        className="dialog dialog--alignment"
        role="dialog"
        aria-modal="true"
        aria-labelledby="alignment-title"
      >
        <div className="astack-head">
          <h2 id="alignment-title" className="dialog__title">
            Alignment of {reads} to {referenceName}
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="button button--quiet button--small"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="astack-tools">
          <span className="astack-tools__note" aria-live="polite">
            {shown === null
              ? `${differencesText(stack.differences.length, counts)}. Click a name to see its score.`
              : `${row?.name ?? ''}: ${shown.mode === 'global' ? 'global' : 'local'}, score ${shown.score}, identity ${Math.round(shown.identity * 100)}% over ${shown.columns.toLocaleString()} columns, ${shown.gaps} gap ${shown.gaps === 1 ? 'column' : 'columns'}${row?.result.strand === 'reverse' ? ', reverse complement' : ''}`}
          </span>
          {source !== null && (
            <>
              <span
                className="astack-legend"
                aria-label="Differences are coloured by where they fall"
              >
                {LEGEND.map(([label, colour]) => (
                  <span key={label} className="astack-legend__item">
                    <span
                      className="astack-legend__swatch"
                      style={{ '--swatch': colour } as CSSProperties}
                    />
                    {label}
                  </span>
                ))}
              </span>
              <label className="astack-tools__check">
                <input
                  type="checkbox"
                  checked={showFeatures}
                  onChange={(e) => {
                    setShowFeatures(e.target.checked);
                  }}
                />{' '}
                Features
              </label>
              {frames.length > 0 && (
                <label className="astack-tools__check">
                  <input
                    type="checkbox"
                    checked={showResidues}
                    onChange={(e) => {
                      setShowResidues(e.target.checked);
                    }}
                  />{' '}
                  Amino acids
                </label>
              )}
              <label
                className="astack-tools__check"
                title={
                  orfs === null
                    ? 'The open reading frames are still being found.'
                    : `ORFs of ${orfMinCodons} codons or more, as in the ORFs panel`
                }
              >
                <input
                  type="checkbox"
                  checked={showOrfs}
                  disabled={orfs === null}
                  onChange={(e) => {
                    setShowOrfs(e.target.checked);
                  }}
                />{' '}
                ORFs
              </label>
              <span className="astack-tools__hidden">
                {track !== null && track.hidden > 0 ? `${track.hidden} not shown` : ''}
              </span>
            </>
          )}
          {hasTrace && (
            <label className="astack-tools__check">
              <input
                type="checkbox"
                checked={showTrace}
                onChange={(e) => {
                  setShowTrace(e.target.checked);
                }}
              />{' '}
              Trace
            </label>
          )}
          <span className="astack-tools__actions">
            <button
              type="button"
              className="button button--small"
              disabled={stack.differences.length === 0}
              title="Alt+Shift+N"
              onClick={() => {
                go(true);
              }}
            >
              Previous difference
            </button>
            <button
              type="button"
              className="button button--small"
              disabled={stack.differences.length === 0}
              title="Alt+N"
              onClick={() => {
                go(false);
              }}
            >
              Next difference
            </button>
            <button
              type="button"
              className="button button--small"
              disabled={row === null}
              onClick={() => {
                if (row === null) return;
                const range = alignedRegionInDocument(row.result, documentIsRead);
                if (range !== null) {
                  editorStore.setSelection(range);
                  editorStore.revealPosition(range.start);
                }
              }}
            >
              Select aligned region in this document
            </button>
          </span>
        </div>
        <AlignmentStackView
          stack={stack}
          referenceName={referenceName}
          confidentFrom={readConfidentQuality}
          selectedRow={selected}
          track={track}
          classes={classes}
          showTrace={showTrace}
          residues={showResidues && frames.length > 0 ? frames : null}
          onSelectRow={setSelected}
          focus={focus}
        />
      </div>
    </div>,
    document.body,
  );
}
