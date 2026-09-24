import { analytics } from '../analytics';
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';

import {
  type BindingSite,
  type PrimerPair,
  type Range,
  type SeqDocument,
  analyzePrimer,
  createFeature,
  describePrimerCriteria,
  designPrimers,
  findPrimerBindingSites,
  isEmptyRange,
  mismatchPositions,
  rangeSegment,
  unrollRange,
} from '@/core';
import { type OverlaySpan } from '@/view/overlay';

import { editorStore } from '../state/editorStore';
import { useRemembered } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';
import { PrimerSettings } from './PrimerSettings';

interface Props {
  readonly doc: SeqDocument;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function tm(x: number): string {
  return Number.isNaN(x) ? '–' : `${x.toFixed(1)} °C`;
}

/**
 * The stretch a pair amplifies: the forward primer's 5′ end through the
 * reverse primer's. Unrolled, because on a plasmid the product may be the
 * piece that runs over the origin.
 */
function productRange(pair: PrimerPair, seqLength: number): Range {
  return unrollRange(pair.forwardSite.start, pair.reverseSite.end, seqLength);
}

/**
 * What a pair looks like in the views before it is anything in the
 * document: the two sites as arrows and the product between them as a
 * bracket. Nothing here is an edit, so three candidates can be compared
 * without three add-and-undo rounds.
 */
function pairPreview(pair: PrimerPair, n: number, seqLength: number): OverlaySpan[] {
  return [
    {
      id: 'product',
      label: `Product ${pair.productLength.toLocaleString()} bp`,
      range: productRange(pair, seqLength),
      strand: 'none',
      shape: 'span',
    },
    {
      id: 'forward',
      label: `Fwd ${n}`,
      range: pair.forwardSite,
      strand: 'forward',
      shape: 'arrow',
    },
    {
      id: 'reverse',
      label: `Rev ${n}`,
      range: pair.reverseSite,
      strand: 'reverse',
      shape: 'arrow',
    },
  ];
}

function sitePreview(
  sites: readonly BindingSite[],
  template: string,
  primer: string,
): OverlaySpan[] {
  return sites.map((s, i) => ({
    id: `site-${i}`,
    label: s.mismatches === 0 ? 'Primer' : `Primer (${s.mismatches} mm)`,
    range: s.range,
    strand: s.strand,
    shape: 'arrow' as const,
    ...(s.mismatches === 0 ? {} : { marks: mismatchPositions(template, s, primer) }),
  }));
}

function addPrimerFeature(
  name: string,
  site: { start: number; end: number },
  strand: 'forward' | 'reverse',
  sequence: string,
): void {
  const feature = createFeature({
    type: 'primer_bind',
    name,
    strand,
    segments: [rangeSegment(site.start, site.end)],
    qualifiers: [{ name: 'note', value: `sequence: ${sequence}` }],
  });
  editorStore.apply({ type: 'addFeature', feature }, site);
}

/**
 * Gives back the selection **Show** made. A preview that is taken off the
 * views but leaves the product highlighted behind it reads as a pair still
 * being shown, which is confusing while hovering the others. Only the range
 * this panel selected is cleared: a selection the user has made since is
 * theirs, and is left alone.
 */
function releaseSelection(owned: RefObject<Range | null>): void {
  const product = owned.current;
  owned.current = null;
  if (product === null) return;
  const current = editorStore.getState().selection;
  if (current === null) return;
  if (current.start !== product.start || current.end !== product.end) return;
  editorStore.setSelection(null);
}

export function PrimerPanel({ doc }: Props) {
  const { selection, primerCriteria, documentId } = useEditorState();
  // Remembered per document, so leaving the tab and coming back finds the
  // design, the primer being checked and the pair shown still there (#32).
  const [probe, setProbe] = useRemembered('primers.probe', documentId, '');
  const [pairs, setPairs] = useRemembered<PrimerPair[] | null>('primers.pairs', documentId, null);
  const [designedFor, setDesignedFor] = useRemembered('primers.designedFor', documentId, '');
  /** The pair whose preview is held on screen, and the one under the pointer. */
  const [shown, setShown] = useRemembered<number | null>('primers.shown', documentId, null);
  const [hovered, setHovered] = useState<number | null>(null);
  /**
   * The product range **Show** put on the selection, so that **Hide** and
   * leaving the tab can take it off again. Held as the range rather than as
   * a flag: the user may have selected something else in the meantime, and
   * that selection is theirs to keep.
   */
  const ownedSelection = useRef<Range | null>(null);

  const hasTarget = selection !== null && !isEmptyRange(selection);
  const report = useMemo(
    () => (probe.trim() === '' ? null : analyzePrimer(probe, primerCriteria)),
    [probe, primerCriteria],
  );
  const sites: BindingSite[] = useMemo(
    () =>
      report === null || report.length < 8
        ? []
        : findPrimerBindingSites(doc.sequence.toString(), doc.topology, report.sequence),
    [doc, report],
  );

  // A pair held on screen wins over one merely under the pointer, and the
  // binding sites of "Check a primer" show when no pair is being looked at.
  const previewed = useMemo<OverlaySpan[]>(() => {
    const index = shown ?? hovered;
    if (index !== null) {
      const pair = pairs?.[index];
      if (pair !== undefined) return pairPreview(pair, index + 1, doc.length);
    }
    return sitePreview(sites, doc.sequence.toString(), report?.sequence ?? '');
  }, [shown, hovered, pairs, sites, doc, report]);

  useEffect(() => {
    editorStore.setPreview('primers', previewed);
  }, [previewed]);
  // Leaving the tab takes this panel's preview with it, and nobody else's,
  // and the selection it made along with it.
  useEffect(
    () => () => {
      editorStore.clearPreview('primers');
      releaseSelection(ownedSelection);
    },
    [],
  );

  const design = (): void => {
    if (selection === null) return;
    analytics.track('primers', 'design');
    const result = designPrimers(doc.sequence.toString(), doc.topology, selection, primerCriteria);
    setPairs(result);
    setShown(null);
    setHovered(null);
    // The selection is the target being designed for now, not a product
    // this panel put there; forget it rather than clearing it.
    ownedSelection.current = null;
    setDesignedFor(`${(selection.start + 1).toLocaleString()}–${selection.end.toLocaleString()}`);
  };

  /** Holds a pair's preview on screen and selects what it would amplify. */
  const showPair = (index: number, pair: PrimerPair): void => {
    if (shown === index) {
      setShown(null);
      releaseSelection(ownedSelection);
      return;
    }
    setShown(index);
    const product = productRange(pair, doc.length);
    editorStore.setSelection(product);
    ownedSelection.current = product;
    editorStore.revealPosition(product.start);
  };

  return (
    <div className="panel">
      <section>
        <h3 className="panel__heading">Design primers for the selection</h3>
        <p className="panel__note">
          {hasTarget
            ? `Target ${(selection.start + 1).toLocaleString()}–${selection.end.toLocaleString()} (${(selection.end - selection.start).toLocaleString()} bp). Primers ${describePrimerCriteria(primerCriteria)}.`
            : 'Select the region to amplify, then design.'}
        </p>
        <PrimerSettings criteria={primerCriteria} />
        <button
          type="button"
          className="button button--small"
          disabled={!hasTarget}
          onClick={design}
        >
          Design primers
        </button>
        {pairs !== null && (
          <div className="panel__section">
            {pairs.length === 0 ? (
              <p className="panel__note">
                No suitable pairs for {designedFor}. Try a different region, look further from it,
                or loosen the settings.
              </p>
            ) : (
              <ol className="pair-list">
                {pairs.map((p, i) => (
                  <li
                    key={i}
                    className={`pair${shown === i ? ' pair--shown' : ''}`}
                    onMouseEnter={() => {
                      setHovered(i);
                    }}
                    onMouseLeave={() => {
                      setHovered((h) => (h === i ? null : h));
                    }}
                    onFocus={() => {
                      setHovered(i);
                    }}
                    onBlur={() => {
                      setHovered((h) => (h === i ? null : h));
                    }}
                  >
                    <div className="pair__row">
                      <span className="pair__label">Fwd</span>
                      <span className="pair__seq">{p.forward.sequence}</span>
                      <span className="pair__meta">
                        {tm(p.forward.tm)}, GC {pct(p.forward.gc)}
                      </span>
                    </div>
                    <div className="pair__row">
                      <span className="pair__label">Rev</span>
                      <span className="pair__seq">{p.reverse.sequence}</span>
                      <span className="pair__meta">
                        {tm(p.reverse.tm)}, GC {pct(p.reverse.gc)}
                      </span>
                    </div>
                    <div className="pair__foot">
                      <span>
                        Product {p.productLength.toLocaleString()} bp, ΔTm{' '}
                        {p.tmDifference.toFixed(1)} °C
                      </span>
                      <span className="pair__buttons">
                        <button
                          type="button"
                          className="button button--quiet button--small"
                          aria-pressed={shown === i}
                          onClick={() => {
                            showPair(i, p);
                          }}
                        >
                          {shown === i ? 'Hide' : 'Show'}
                        </button>
                        <button
                          type="button"
                          className="button button--quiet button--small"
                          onClick={() => {
                            addPrimerFeature(
                              `Fwd primer ${i + 1}`,
                              p.forwardSite,
                              'forward',
                              p.forward.sequence,
                            );
                            addPrimerFeature(
                              `Rev primer ${i + 1}`,
                              p.reverseSite,
                              'reverse',
                              p.reverse.sequence,
                            );
                          }}
                        >
                          Add both as features
                        </button>
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </section>

      <section className="panel__section">
        <h3 className="panel__heading">Check a primer</h3>
        <input
          className="panel__search"
          type="text"
          spellCheck={false}
          placeholder="Paste a primer sequence"
          aria-label="Primer sequence"
          value={probe}
          onChange={(e) => {
            setProbe(e.target.value);
          }}
        />
        {report !== null && report.length > 0 && (
          <>
            <p className="panel__mono">
              {report.length} nt, Tm{' '}
              {report.degenerate === 0
                ? tm(report.tm)
                : report.tmRange === null
                  ? '–'
                  : `${report.tmRange.min.toFixed(1)}–${report.tmRange.max.toFixed(1)} °C`}
              , GC{' '}
              {report.degenerate === 0
                ? pct(report.gc)
                : `${pct(report.gcRange.min)}–${pct(report.gcRange.max)}`}
              {report.gcClamp ? ', GC clamp' : ''}
            </p>
            {report.degenerate > 0 && (
              <p className="panel__note panel__note--quiet">
                Degenerate: {report.degenerate} {report.degenerate === 1 ? 'position' : 'positions'}
                , a mix of {report.molecules.toLocaleString()} molecules. Tm and GC are ranges over
                the mix; hairpins and dimers are counted on the plain bases. A code binds wherever
                it stands for the template&rsquo;s base.
              </p>
            )}
            {report.warnings.length > 0 && (
              <ul className="panel__warnings">
                {report.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            <p className="panel__note">
              {report.length < 8
                ? 'Enter at least 8 bases to search for binding sites.'
                : sites.length === 0
                  ? 'No binding site in this sequence (exact 3′ end, up to 2 mismatches elsewhere).'
                  : `${sites.length} binding ${sites.length === 1 ? 'site' : 'sites'}:`}
            </p>
            {sites.length > 0 && (
              <ul className="orf-list">
                {sites.map((s) => (
                  <li key={`${s.strand}-${s.range.start}`}>
                    <button
                      type="button"
                      className="orf-row"
                      onClick={() => {
                        editorStore.setSelection(s.range);
                        editorStore.revealPosition(s.range.start);
                      }}
                    >
                      <span className="orf-row__strand">{s.strand === 'forward' ? '→' : '←'}</span>
                      <span className="orf-row__range">
                        {(s.range.start + 1).toLocaleString()}–
                        {(((s.range.end - 1) % Math.max(1, doc.length)) + 1).toLocaleString()}
                      </span>
                      <span className="orf-row__length">
                        {s.mismatches === 0 ? 'exact' : `${s.mismatches} mm`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {sites.length > 0 && (
              <button
                type="button"
                className="button button--small"
                onClick={() => {
                  for (const s of sites)
                    addPrimerFeature('Primer', s.range, s.strand, report.sequence);
                }}
              >
                Add {sites.length === 1 ? 'site' : 'sites'} as primer_bind
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}
