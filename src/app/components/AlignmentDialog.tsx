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
import {
  confidentDifferences,
  coverageOf,
  sortVerdicts,
  summariseVerdicts,
  type VerdictOrder,
  verdictsOf,
  verdictSummaryText,
  verdictText,
} from '../alignmentVerdict';
import { hiddenNote, shownSamples, type SampleSort } from '../alignmentOrder';
import { disagreementColumns } from '../alignmentDisagreement';
import { differenceRows, type DifferenceRow } from '../alignmentDifferences';
import { AlignmentFind, type SearchMode } from './AlignmentFind';
import { AlignmentDifferencesList } from './AlignmentDifferencesList';
import { AlignmentExport } from './AlignmentExport';
import { AlignmentSamples } from './AlignmentSamples';
import { AlignmentVerdictTable } from './AlignmentVerdictTable';
import { AlignmentStackView, type StackHandle } from './AlignmentStackView';

/** Lanes of features and ORFs drawn above the reference; more are left out and counted. */
const MAX_LANES = 8;

const LEGEND: readonly (readonly [string, string])[] = [
  ['In a CDS or ORF', 'var(--diff-cds)'],
  ['In another feature', 'var(--diff-feature)'],
  ['Outside features', 'var(--diff-none)'],
];

/** The Show toggles as the last window left them, so reopening does not reset them. */
const remembered = { features: true, orfs: false, trace: true, residues: false, list: false };

/** The most features needing a look named on the verification line; past it, "and N more". */
const MAX_EXCEPTIONS = 5;

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
  const [showList, setShowList] = useState(remembered.list);
  // The table of every feature's verdict (#120): per opening, not remembered.
  const [showVerdicts, setShowVerdicts] = useState(false);
  const [verdictOrder, setVerdictOrder] = useState<VerdictOrder>('position');
  useEffect(() => {
    Object.assign(remembered, {
      features: showFeatures,
      orfs: showOrfs,
      trace: showTrace,
      residues: showResidues,
      list: showList,
    });
  }, [showFeatures, showOrfs, showTrace, showResidues, showList]);
  // Which samples are shown and in what order (#127). Everything below works over the
  // stack of the shown ones, so a hidden sample is out of the verdicts as well.
  const [sort, setSort] = useState<SampleSort>('original');
  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set());
  const shownIndices = useMemo(
    () =>
      shownSamples(
        samples.map((s) => ({
          name: s.name,
          identity: s.result.alignment.identity,
          start: s.result.alignment.startA,
        })),
        sort,
        hidden,
      ),
    [samples, sort, hidden],
  );
  const stack = useMemo(
    () =>
      stackAlignments(
        reference,
        shownIndices.flatMap((i) => samples[i] ?? []),
      ),
    [reference, samples, shownIndices],
  );
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
  // Reads at good quality per column, and a verdict for each feature of the document (#120).
  const coverage = useMemo(
    () => coverageOf(stack, readConfidentQuality),
    [stack, readConfidentQuality],
  );
  const verdicts = useMemo(
    () =>
      source === null
        ? []
        : verdictsOf(
            stack,
            annotationsOf(source.features.all(), []),
            coverage,
            confidentDifferences(stack, readConfidentQuality),
            source.isCircular ? source.length : 0,
          ),
    [source, stack, coverage, readConfidentQuality],
  );
  const summary = useMemo(() => summariseVerdicts(verdicts), [verdicts]);
  // The features needing a look, differences first; past a handful, the rest are counted.
  const exceptions = useMemo(() => sortVerdicts(summary.exceptions, 'status'), [summary]);
  const shownExceptions =
    exceptions.length > MAX_EXCEPTIONS ? exceptions.slice(0, MAX_EXCEPTIONS - 1) : exceptions;
  const moreExceptions = exceptions.length - shownExceptions.length;
  // Columns where samples carry different bases from each other (#124).
  const disagreement = useMemo(
    () => disagreementColumns(stack, readConfidentQuality),
    [stack, readConfidentQuality],
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
  // The picked sample, as an index into `samples`; `selected` is its row in the shown stack.
  const [pickedSample, setPickedSample] = useState<number | null>(
    initialRow ?? (samples.length === 1 ? 0 : null),
  );
  const selected = useMemo(() => {
    const r = pickedSample === null ? -1 : shownIndices.indexOf(pickedSample);
    return r < 0 ? null : r;
  }, [pickedSample, shownIndices]);
  const setSelected = useCallback(
    (r: number | null): void => {
      setPickedSample(r === null ? null : (shownIndices[r] ?? null));
    },
    [shownIndices],
  );
  const [focus, setFocus] = useState<{ start: number; end: number; nonce: number } | null>(null);
  const hasFrames = frames.length > 0;
  const hasTrace = stack.rows.some((r) => r.readIndex !== null);
  const regions = useMemo(() => differenceRegions(stack.differences), [stack.differences]);
  const rows = useMemo(
    () =>
      showList
        ? differenceRows(
            stack,
            regions,
            source === null ? [] : annotationsOf(source.features.all(), orfs ?? []),
            frames,
            source,
            disagreement,
          )
        : [],
    [showList, stack, regions, source, orfs, frames, disagreement],
  );
  const current = useRef(0);
  // One popover at a time: Go to, Find, Export or Samples.
  const [popover, setPopover] = useState<SearchMode | 'export' | 'samples' | null>(null);
  const search = popover === 'export' || popover === 'samples' ? null : popover;
  const stackHandle = useRef<StackHandle>(null);
  const searchOpen = useRef(false);
  useEffect(() => {
    searchOpen.current = popover !== null;
  }, [popover]);
  // A click anywhere outside the open popover closes it. The tables stay until their button.
  useEffect(() => {
    if (popover === null) return;
    const onDown = (e: PointerEvent): void => {
      const target = e.target;
      if (target instanceof Element && target.closest('.astack-tools__search') !== null) return;
      setPopover(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('pointerdown', onDown);
    };
  }, [popover]);
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
  // A column span to show from Go to or Find: it is not a difference, so no stop.
  const jump = useCallback((start: number, end: number): void => {
    current.current = start;
    setStop(null);
    setFocus((f) => ({ start, end, nonce: (f?.nonce ?? 0) + 1 }));
  }, []);
  const pick = useCallback(
    (diff: DifferenceRow): void => {
      current.current = diff.start;
      setStop(diff.index);
      setFocus((f) => ({ start: diff.start, end: diff.end, nonce: (f?.nonce ?? 0) + 1 }));
      // Keep the picked sample when it carries this one, else the first that does.
      const keep = diff.carriers.some((c) => c.row === selected);
      const row = keep ? selected : (diff.carriers[0]?.row ?? selected);
      if (row !== null) setSelected(row);
    },
    [selected, setSelected],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        // The popover closes first, the window on a second Esc.
        if (searchOpen.current) setPopover(null);
        else onClose();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        (e.code === 'KeyF' || e.code === 'KeyG')
      ) {
        // The editor's Find (Ctrl+F) is this window's Find; Go to has no key there.
        e.preventDefault();
        e.stopPropagation();
        setPopover(e.code === 'KeyF' ? 'find' : 'goto');
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
          <div className="segmented" role="group" aria-label="Difference list">
            <button
              type="button"
              className={segmentedClass(showList)}
              aria-pressed={showList}
              disabled={regions.length === 0}
              title="A table of the differences, with their effect on the protein, to copy"
              onClick={() => {
                setShowList((on) => !on);
                setShowVerdicts(false);
              }}
            >
              List
            </button>
          </div>
          <div className="astack-tools__search">
            <div className="segmented" role="group" aria-label="Search">
              <button
                type="button"
                className={segmentedClass(search === 'goto')}
                aria-pressed={search === 'goto'}
                title="Go to a position of the reference (Ctrl+G)"
                onClick={() => {
                  setPopover((m) => (m === 'goto' ? null : 'goto'));
                }}
              >
                Go to
              </button>
              <button
                type="button"
                className={segmentedClass(search === 'find')}
                aria-pressed={search === 'find'}
                title="Find a motif in the reference or a sample (Ctrl+F)"
                onClick={() => {
                  setPopover((m) => (m === 'find' ? null : 'find'));
                }}
              >
                Find
              </button>
            </div>
            {search !== null && (
              <AlignmentFind
                stack={stack}
                mode={search}
                row={selected}
                getFrom={() => current.current}
                onRow={setSelected}
                onJump={jump}
                onClose={() => {
                  setPopover(null);
                }}
              />
            )}
          </div>
          <div className="astack-tools__search">
            <div className="segmented" role="group" aria-label="Export">
              <button
                type="button"
                className={segmentedClass(popover === 'export')}
                aria-pressed={popover === 'export'}
                aria-label="Export"
                title="Save the alignment as SVG or PNG, or copy it as text or aligned FASTA"
                onClick={() => {
                  setPopover((m) => (m === 'export' ? null : 'export'));
                }}
              >
                Export
              </button>
            </div>
            {popover === 'export' && (
              <AlignmentExport
                stack={stack}
                referenceName={referenceName}
                getVisible={() =>
                  stackHandle.current?.visibleColumns() ?? { start: 0, end: stack.columns }
                }
                getDrawing={() => stackHandle.current?.drawing() ?? null}
                onClose={() => {
                  setPopover(null);
                }}
              />
            )}
          </div>
          {samples.length > 1 && (
            <span className="astack-tools__search">
              <div className="segmented" role="group" aria-label="Samples">
                <button
                  type="button"
                  className={segmentedClass(popover === 'samples' || hidden.size > 0)}
                  aria-pressed={popover === 'samples'}
                  title="Sort the samples, or bring back hidden ones"
                  onClick={() => {
                    setPopover((m) => (m === 'samples' ? null : 'samples'));
                  }}
                >
                  {hidden.size > 0 ? `Samples (${hidden.size.toLocaleString()} hidden)` : 'Samples'}
                </button>
              </div>
              {popover === 'samples' && (
                <AlignmentSamples
                  names={samples.map((s) => s.name)}
                  sort={sort}
                  onSort={setSort}
                  hidden={hidden}
                  onShow={(i) => {
                    setHidden((h) => {
                      const next = new Set(h);
                      next.delete(i);
                      return next;
                    });
                  }}
                  onShowAll={() => {
                    setHidden(new Set());
                  }}
                />
              )}
            </span>
          )}
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
          <span className="astack-status__sample">
            <span className="astack-tools__note" aria-live="polite">
              {shown === null
                ? `${differencesText(stack.differences.length, counts)}. Click a name, or use ↑ and ↓, to see a sample's score.`
                : `${row?.name ?? ''}: ${shown.mode === 'global' ? 'global' : 'local'}, score ${shown.score}, identity ${Math.round(shown.identity * 100)}% over ${shown.columns.toLocaleString()} columns, ${shown.gaps} gap ${shown.gaps === 1 ? 'column' : 'columns'}${row?.result.strand === 'reverse' ? ', reverse complement' : ''}`}
              {track !== null && track.hidden > 0 ? ` · ${track.hidden} lanes not shown` : ''}
              {hidden.size > 0 ? ` · ${hidden.size.toLocaleString()} hidden` : ''}
            </span>
            {row !== null && pickedSample !== null && stack.rows.length > 1 && (
              <button
                type="button"
                className="button button--small"
                title={`Take ${row.name} out of the alignment; Samples brings it back`}
                onClick={() => {
                  setHidden((h) => new Set(h).add(pickedSample));
                }}
              >
                Hide
              </button>
            )}
            {row !== null && (
              <button
                type="button"
                className="button button--small astack-status__select"
                title={`Select the region ${row.name} aligned to in this document`}
                onClick={() => {
                  const range = alignedRegionInDocument(row.result, documentIsRead);
                  if (range !== null) {
                    editorStore.setSelection(range);
                    editorStore.revealPosition(range.start);
                  }
                }}
              >
                Select in document
              </button>
            )}
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
          {disagreement.length > 0 && (
            <span
              className="astack-tools__note"
              title="Columns where two or more samples, at good quality, carry different bases from each other: more often a base-calling error than a real change. A difference every sample shares is not marked."
            >
              {'\u25BC'} {disagreement.length.toLocaleString()}{' '}
              {disagreement.length === 1 ? 'column' : 'columns'} where samples disagree
            </span>
          )}
        </div>
        {verdicts.length > 0 && hidden.size > 0 && (
          <div className="astack-tools__note">
            Verification {hiddenNote(samples.length, shownIndices.length)}; hidden samples do not
            count.
          </div>
        )}
        {verdicts.length > 0 && (
          <div className="astack-verify" aria-label="Verification of each feature">
            <span className="astack-verify__summary">
              {verdictSummaryText(summary, shownIndices.length)}
            </span>
            {shownExceptions.map((v, i) => (
              <button
                key={i}
                type="button"
                className={`astack-verdict astack-verdict--${v.kind}`}
                title="Show this feature in the alignment"
                onClick={() => {
                  setFocus((f) => ({ start: v.start, end: v.end, nonce: (f?.nonce ?? 0) + 1 }));
                }}
              >
                {verdictText(v)}
              </button>
            ))}
            {moreExceptions > 0 && (
              <button
                type="button"
                className="astack-verdict astack-verdict--more"
                title="Open the table of all features with the ones needing a look first"
                onClick={() => {
                  setVerdictOrder('status');
                  setShowVerdicts(true);
                  setShowList(false);
                }}
              >
                and {moreExceptions.toLocaleString()} more
              </button>
            )}
            <button
              type="button"
              className={`${segmentedClass(showVerdicts)} astack-verify__all`}
              aria-pressed={showVerdicts}
              title="A table of every feature: status, position, reads and strands"
              onClick={() => {
                setShowVerdicts((on) => !on);
                // One table at a time under the toolbar: this one or the differences.
                setShowList(false);
              }}
            >
              All features
            </button>
          </div>
        )}
        {showList && <AlignmentDifferencesList rows={rows} current={stop} onPick={pick} />}
        {showVerdicts && verdicts.length > 0 && (
          <AlignmentVerdictTable
            verdicts={verdicts}
            order={verdictOrder}
            onOrder={setVerdictOrder}
            onPick={(v) => {
              setFocus((f) => ({ start: v.start, end: v.end, nonce: (f?.nonce ?? 0) + 1 }));
            }}
          />
        )}
        <AlignmentStackView
          stack={stack}
          referenceName={referenceName}
          confidentFrom={readConfidentQuality}
          selectedRow={selected}
          track={track}
          classes={classes}
          coverage={coverage}
          disagreement={disagreement}
          showTrace={showTrace}
          residues={showResidues && frames.length > 0 ? frames : null}
          onSelectRow={setSelected}
          focus={focus}
          handle={stackHandle}
        />
      </div>
    </div>,
    document.body,
  );
}
