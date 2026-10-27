import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';

import {
  type BindingSite,
  type Feature,
  type PrimerCriteria,
  type PrimerPair,
  type PrimerReport,
  type Range,
  type SeqDocument,
  analyzePrimer,
  createFeature,
  designPrimers,
  findPrimerBindingSites,
  formatSpan,
  mismatchPositions,
  rangeSegment,
  unrollRange,
} from '@/core';
import { type OverlaySpan } from '@/view/overlay';

import { analytics } from '../analytics';
import { editorStore } from '../state/editorStore';
import { useRemembered } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';

/**
 * What the Primers tab and the primer workspace share (items 93 and 107):
 * the design held per document, the pair shown on the map, the primer
 * being checked. Hooks rather than a component, because the slim panel and
 * the workspace's pages render them differently and are never mounted at
 * once — the memory under `primers.*` is what carries a design from one to
 * the other.
 */

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function tm(x: number): string {
  return Number.isNaN(x) ? '–' : `${x.toFixed(1)} °C`;
}

/**
 * The stretch a pair amplifies: the forward primer's 5′ end through the
 * reverse primer's. Unrolled, because on a plasmid the product may be the
 * piece that runs over the origin.
 */
export function productRange(pair: PrimerPair, seqLength: number): Range {
  return unrollRange(pair.forwardSite.start, pair.reverseSite.end, seqLength);
}

/**
 * What a pair looks like in the views before it is anything in the
 * document: the two sites as arrows and the product between them as a
 * bracket. Nothing here is an edit, so three candidates can be compared
 * without three add-and-undo rounds.
 */
export function pairPreview(pair: PrimerPair, n: number, seqLength: number): OverlaySpan[] {
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

export function sitePreview(
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

/** "374–390" as the site lists write it, the end wrapped onto a circle. */
export function siteSpan(site: BindingSite, seqLength: number): string {
  return `${(site.range.start + 1).toLocaleString()}–${(((site.range.end - 1) % Math.max(1, seqLength)) + 1).toLocaleString()}`;
}

/** Selects what a site anneals to and brings it into view. */
export function goToSite(site: BindingSite): void {
  editorStore.setSelection(site.range);
  editorStore.revealPosition(site.range.start);
}

/** One search window as a range of the document, or null when it is empty or off the sequence. */
function windowOf(from: number, to: number, doc: SeqDocument): Range | null {
  const L = doc.length;
  if (L === 0 || to <= from) return null;
  if (doc.topology === 'circular') {
    if (to - from >= L) return { start: 0, end: L };
    const wrap = (x: number): number => ((x % L) + L) % L;
    return unrollRange(wrap(from), wrap(to), L);
  }
  const start = Math.max(0, from);
  const end = Math.min(L, to);
  return end <= start ? null : { start, end };
}

/**
 * The two stretches the designer searches, drawn on the map rather than
 * explained (item 107): the forward primer's window before the target and
 * the reverse primer's after it, as the settings' distances have them.
 */
export function searchWindows(target: Range, c: PrimerCriteria, doc: SeqDocument): OverlaySpan[] {
  const spans: OverlaySpan[] = [];
  const fwd = windowOf(
    target.start - c.forwardRegion.far,
    target.start - c.forwardRegion.near,
    doc,
  );
  if (fwd !== null) {
    spans.push({
      id: 'fwd-window',
      label: 'Forward primer window',
      range: fwd,
      strand: 'none',
      shape: 'span',
    });
  }
  const rev = windowOf(target.end + c.reverseRegion.near, target.end + c.reverseRegion.far, doc);
  if (rev !== null) {
    spans.push({
      id: 'rev-window',
      label: 'Reverse primer window',
      range: rev,
      strand: 'none',
      shape: 'span',
    });
  }
  return spans;
}

export function primerFeature(
  name: string,
  site: { start: number; end: number },
  strand: 'forward' | 'reverse',
  sequence: string,
): Feature {
  return createFeature({
    type: 'primer_bind',
    name,
    strand,
    segments: [rangeSegment(site.start, site.end)],
    qualifiers: [{ name: 'note', value: `sequence: ${sequence}` }],
  });
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

function sameRange(a: Range | null, b: Range | null): boolean {
  if (a === null || b === null) return a === b;
  return a.start === b.start && a.end === b.end;
}

export interface PrimerDesign {
  /** The pairs designed on this very sequence, or null when none were. */
  readonly pairs: readonly PrimerPair[] | null;
  /** The target the pairs were designed for, as the status bar writes it. */
  readonly designedFor: string;
  /** Whether the selection is still the target the pairs were designed for. */
  readonly targetUnchanged: boolean;
  /** The pair whose preview is held on screen, and the one under the pointer. */
  readonly shown: number | null;
  readonly hovered: number | null;
  readonly setHovered: (next: number | null | ((h: number | null) => number | null)) => void;
  /** The pair to draw, held over hovered, as overlay spans; empty when none. */
  readonly preview: readonly OverlaySpan[];
  /** Designs for `target`, dropping whatever was shown. */
  readonly design: (target: Range) => readonly PrimerPair[];
  /** Holds a pair's preview on screen and selects what it would amplify; again hides it. */
  readonly showPair: (index: number, pair: PrimerPair) => void;
  /**
   * The Results table's row (item 107): the pair the detail pane is about.
   * Selecting it shows it on the map while `followMap` is on; the row stays
   * selected when the map preview is taken off (point 3).
   */
  readonly selected: number | null;
  readonly select: (index: number | null) => void;
  readonly followMap: boolean;
  readonly setFollowMap: (on: boolean) => void;
}

/**
 * The design held for a document (#32, #132): remembered per document, so
 * leaving the tab and coming back finds the design and the pair shown
 * still there, and dropped once the bases or the topology change, because
 * the coordinates and oligos mean nothing on anything else.
 */
export function usePrimerDesign(doc: SeqDocument): PrimerDesign {
  const { selection, primerCriteria, documentId } = useEditorState();
  const [storedPairs, setPairs] = useRemembered<PrimerPair[] | null>(
    'primers.pairs',
    documentId,
    null,
  );
  const [designedOn, setDesignedOn] = useRemembered('primers.template', documentId, '');
  const template = useMemo(() => `${doc.topology}:${doc.sequence.toString()}`, [doc]);
  const pairs = designedOn === template ? storedPairs : null;
  const [designedFor, setDesignedFor] = useRemembered('primers.designedFor', documentId, '');
  const [designedTarget, setDesignedTarget] = useRemembered<Range | null>(
    'primers.target',
    documentId,
    null,
  );
  const [shown, setShown] = useRemembered<number | null>('primers.shown', documentId, null);
  const [selected, setSelected] = useRemembered<number | null>(
    'primers.selected',
    documentId,
    null,
  );
  // Whether selecting a row shows the pair on the map: the user's, from
  // plasmid to plasmid, since unticking it is a way of working.
  const [followMap, setFollowMapMemory] = useRemembered('primers.followMap', null, true);
  const [hovered, setHovered] = useState<number | null>(null);
  /**
   * The product range **Show** put on the selection, so that **Hide** and
   * leaving the tab can take it off again. Held as the range rather than as
   * a flag: the user may have selected something else in the meantime, and
   * that selection is theirs to keep.
   */
  const ownedSelection = useRef<Range | null>(null);

  useEffect(() => {
    if (storedPairs === null || designedOn === template) return;
    setPairs(null);
    setShown(null);
    setSelected(null);
    releaseSelection(ownedSelection);
  }, [storedPairs, designedOn, template, setPairs, setShown, setSelected]);
  // Leaving takes the selection this design made with it, and nobody else's.
  useEffect(
    () => () => {
      releaseSelection(ownedSelection);
    },
    [],
  );

  const preview = useMemo<OverlaySpan[]>(() => {
    const index = shown ?? hovered;
    if (index === null) return [];
    const pair = pairs?.[index];
    return pair === undefined ? [] : pairPreview(pair, index + 1, doc.length);
  }, [shown, hovered, pairs, doc]);

  const design = (target: Range): readonly PrimerPair[] => {
    analytics.track('primers', 'design');
    const result = designPrimers(doc.sequence.toString(), doc.topology, target, primerCriteria);
    setPairs(result);
    setDesignedOn(template);
    setShown(null);
    setSelected(null);
    setHovered(null);
    // The selection is the target being designed for now, not a product
    // this panel put there; forget it rather than clearing it.
    ownedSelection.current = null;
    setDesignedFor(formatSpan(target, doc.length));
    setDesignedTarget(target);
    return result;
  };

  const show = (index: number, pair: PrimerPair): void => {
    setShown(index);
    const product = productRange(pair, doc.length);
    editorStore.setSelection(product);
    ownedSelection.current = product;
    editorStore.revealPosition(product.start);
  };
  const hide = (): void => {
    setShown(null);
    releaseSelection(ownedSelection);
  };

  const showPair = (index: number, pair: PrimerPair): void => {
    if (shown === index) hide();
    else show(index, pair);
  };

  const select = (index: number | null): void => {
    setSelected(index);
    const pair = index === null ? undefined : pairs?.[index];
    if (pair === undefined || index === null) {
      if (shown !== null) hide();
      return;
    }
    if (followMap) show(index, pair);
  };

  const setFollowMap = (on: boolean): void => {
    setFollowMapMemory(on);
    const pair = selected === null ? undefined : pairs?.[selected];
    if (on && pair !== undefined && selected !== null) show(selected, pair);
    else if (!on && shown !== null) hide();
  };

  // A shown pair's product is this design's own selection, not a new target;
  // nor is no selection at all (Escape on the map, or the product given back).
  const shownPair = shown === null ? undefined : pairs?.[shown];
  const targetUnchanged =
    pairs === null ||
    selection === null ||
    sameRange(selection, designedTarget) ||
    (shownPair !== undefined && sameRange(selection, productRange(shownPair, doc.length)));

  return {
    pairs,
    designedFor,
    targetUnchanged,
    shown,
    hovered,
    setHovered,
    preview,
    design,
    showPair,
    selected,
    select,
    followMap,
    setFollowMap,
  };
}

export interface PrimerProbe {
  readonly probe: string;
  readonly setProbe: (next: string) => void;
  /** What the bases come to, or null while the box is empty. */
  readonly report: PrimerReport | null;
  /** Where the primer binds on the document, with eight or more bases. */
  readonly sites: readonly BindingSite[];
  readonly preview: readonly OverlaySpan[];
}

/** The primer pasted into Check, remembered per document (#32). */
export function usePrimerProbe(doc: SeqDocument): PrimerProbe {
  const { primerCriteria, documentId } = useEditorState();
  const [probe, setProbe] = useRemembered('primers.probe', documentId, '');
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
  const preview = useMemo(
    () => sitePreview(sites, doc.sequence.toString(), report?.sequence ?? ''),
    [sites, doc, report],
  );
  return { probe, setProbe, report, sites, preview };
}

/**
 * Puts `spans` on the views as the Primers tab's preview while mounted,
 * and takes them off on the way out, nobody else's with them.
 */
export function usePrimersPreview(spans: readonly OverlaySpan[]): void {
  useEffect(() => {
    editorStore.setPreview('primers', spans);
  }, [spans]);
  useEffect(
    () => () => {
      editorStore.clearPreview('primers');
    },
    [],
  );
}
