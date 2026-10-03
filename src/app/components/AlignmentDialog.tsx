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
import { formatBinding, matchesBinding, resolveBindings, withShift } from '../keyBindings';
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

/** The Show toggles as the last window left them, so reopening does not reset them. */
const remembered = { features: true, orfs: false, trace: true, residues: false };

function segmentedClass(active: boolean): string {
  return `segmented__button${active ? ' segmented__button--active' : ''}`;
}

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
  const { readConfidentQuality, analysis, orfMinCodons, keyBindings } = useEditorState();
  const [showFeatures, setShowFeatures] = useState(remembered.features);
  const [showOrfs, setShowOrfs] = useState(remembered.orfs);
  const [showTrace, setShowTrace] = useState(remembered.trace);
  const [showResidues, setShowResidues] = useState(remembered.residues);
  useEffect(() => {
    Object.assign(remembered, {
      features: showFeatures,
      orfs: showOrfs,
      trace: showTrace,
      residues: showResidues,
    });
  }, [showFeatures, showOrfs, showTrace, showResidues]);
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
  const hasFrames = frames.length > 0;
  const hasTrace = stack.rows.some((r) => r.readIndex !== null);
  const regions = useMemo(() => differenceRegions(stack.differences), [stack.differences]);
  const current = useRef(0);
  const [stop, setStop] = useState<number | null>(null);
  const bindings = resolveBindings(keyBindings);
  const nextBinding = bindings.get('next-change') ?? 'alt+KeyN';
  const translationsBinding = bindings.get('toggle-translations');
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
      setStop(regions.findIndex((r) => r.start === region.start));
      setFocus((f) => ({ ...region, nonce: (f?.nonce ?? 0) + 1 }));
    },
    [regions],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (matchesBinding(e, nextBinding) || matchesBinding(e, withShift(nextBinding))) {
        e.preventDefault();
        e.stopPropagation();
        go(e.shiftKey);
      } else if (
        hasFrames &&
        translationsBinding !== undefined &&
        matchesBinding(e, translationsBinding)
      ) {
        // The editor's Translations key is this window's Amino acids.
        e.preventDefault();
        e.stopPropagation();
        setShowResidues((on) => !on);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose, go, nextBinding, translationsBinding, hasFrames]);

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
          <div className="segmented" role="group" aria-label="Differences">
            <button
              type="button"
              className={segmentedClass(false)}
              disabled={regions.length === 0}
              aria-label="Previous difference"
              title={`Previous difference (${formatBinding(withShift(nextBinding))})`}
              onClick={() => {
                go(true);
              }}
            >
              ‹ Prev
            </button>
            <button
              type="button"
              className={segmentedClass(false)}
              disabled={regions.length === 0}
              aria-label="Next difference"
              title={`Next difference (${formatBinding(nextBinding)})`}
              onClick={() => {
                go(false);
              }}
            >
              Next ›
            </button>
          </div>
          <span className="astack-tools__counter" aria-live="polite">
            {stop === null
              ? `${regions.length.toLocaleString()} ${regions.length === 1 ? 'difference' : 'differences'}`
              : `${(stop + 1).toLocaleString()} of ${regions.length.toLocaleString()}`}
          </span>
          <label className="astack-tools__sample">
            Sample
            <select
              className="panel__select"
              value={selected ?? ''}
              onChange={(e) => {
                setSelected(e.target.value === '' ? null : Number(e.target.value));
              }}
            >
              {selected === null && <option value="">Pick one</option>}
              {stack.rows.map((r, i) => (
                <option key={i} value={i}>
                  {r.name}
                  {r.result.strand === 'reverse' ? ' (reverse)' : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button button--small"
            disabled={row === null}
            title={
              row === null ? 'Pick a sample first' : 'Select the aligned region in this document'
            }
            onClick={() => {
              if (row === null) return;
              const range = alignedRegionInDocument(row.result, documentIsRead);
              if (range !== null) {
                editorStore.setSelection(range);
                editorStore.revealPosition(range.start);
              }
            }}
          >
            Select in document
          </button>
          {(source !== null || hasTrace) && (
            <div className="segmented astack-tools__show" role="group" aria-label="Show">
              {source !== null && (
                <>
                  <button
                    type="button"
                    className={segmentedClass(showFeatures)}
                    aria-pressed={showFeatures}
                    title={
                      track !== null && track.hidden > 0
                        ? `${track.hidden} lanes not shown`
                        : 'The features above the reference'
                    }
                    onClick={() => {
                      setShowFeatures((on) => !on);
                    }}
                  >
                    Features
                  </button>
                  <button
                    type="button"
                    className={segmentedClass(showOrfs)}
                    aria-pressed={showOrfs}
                    disabled={orfs === null}
                    title={
                      orfs === null
                        ? 'The open reading frames are still being found.'
                        : `ORFs of ${orfMinCodons} codons or more, as in the ORFs panel`
                    }
                    onClick={() => {
                      setShowOrfs((on) => !on);
                    }}
                  >
                    ORFs
                  </button>
                  {hasFrames && (
                    <button
                      type="button"
                      className={segmentedClass(showResidues)}
                      aria-pressed={showResidues}
                      title={
                        translationsBinding === undefined
                          ? 'The CDS residues under each row'
                          : `The CDS residues under each row (${formatBinding(translationsBinding)})`
                      }
                      onClick={() => {
                        setShowResidues((on) => !on);
                      }}
                    >
                      Amino acids
                    </button>
                  )}
                </>
              )}
              {hasTrace && (
                <button
                  type="button"
                  className={segmentedClass(showTrace)}
                  aria-pressed={showTrace}
                  onClick={() => {
                    setShowTrace((on) => !on);
                  }}
                >
                  Trace
                </button>
              )}
            </div>
          )}
        </div>
        <div className="astack-status">
          <span className="astack-tools__note" aria-live="polite">
            {shown === null
              ? `${differencesText(stack.differences.length, counts)}. Pick a sample to see its score.`
              : `${row?.name ?? ''}: ${shown.mode === 'global' ? 'global' : 'local'}, score ${shown.score}, identity ${Math.round(shown.identity * 100)}% over ${shown.columns.toLocaleString()} columns, ${shown.gaps} gap ${shown.gaps === 1 ? 'column' : 'columns'}${row?.result.strand === 'reverse' ? ', reverse complement' : ''}`}
            {track !== null && track.hidden > 0 ? ` · ${track.hidden} lanes not shown` : ''}
          </span>
          {source !== null && (
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
          )}
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
