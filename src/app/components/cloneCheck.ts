import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  CHECK_DEFAULTS,
  type CheckDesign,
  type CheckPair,
  type CloneGeometry,
  type ColonyPcrCheck,
  type PcrPrimer,
  type Range,
  type SeqDocument,
  cleanPrimer,
  formatSpan,
  isEmptyRange,
  unrollRange,
} from '@/core';
import { type OverlaySpan } from '@/view/overlay';
import { analysisClient } from '@/workers/analysisClient';

import { analytics } from '../analytics';
import { type CloneCheckContext, lineagePrimers, recallCloneCheck } from '../cloneCheck';
import { cloningDocuments } from '../state/editorStore';
import { recallPanel, useRemembered } from '../state/panelMemory';
import { usePrimerCollection } from '../state/primerCollection';
import { useEditorState } from '../state/useEditorStore';

/** What the page asks beyond the primer settings: the band's size window and the room from the junction. */
export interface CloneCheckSettings {
  readonly minProduct: number;
  readonly maxProduct: number;
  readonly minDistance: number;
}

export const CLONE_CHECK_SETTINGS: CloneCheckSettings = {
  minProduct: CHECK_DEFAULTS.minProduct,
  maxProduct: CHECK_DEFAULTS.maxProduct,
  minDistance: CHECK_DEFAULTS.minDistance,
};

/** A primer the check may reuse, with where it comes from for the chooser. */
export interface ReusablePrimer {
  readonly key: string;
  readonly group: 'reaction' | 'record' | 'mine';
  readonly primer: PcrPrimer;
}

/** A design kept for the document, with what it was designed on. */
export interface CloneCheckRecord {
  readonly design: CheckDesign;
  /** "the Ligation product" or "the selection 1,200–2,000", for the heading. */
  readonly designedFor: string;
  readonly insert: Range;
  readonly junctions: readonly number[];
  readonly emptyName: string | null;
  readonly orientation: 'open' | 'fixed';
  readonly reused: PcrPrimer | null;
}

export interface CloneCheckState {
  /** What the reaction registered for this product, or null. */
  readonly context: CloneCheckContext | null;
  /** The insert: the context's, else the selection; null when there is neither. */
  readonly insert: Range | null;
  readonly geometry: CloneGeometry | null;
  /** The empty vector the design runs on, and how it was chosen. */
  readonly empty: SeqDocument | null;
  readonly emptyChoice: string;
  readonly setEmptyChoice: (id: string) => void;
  /** Other open circular tabs, for the chooser when the reaction gave no vector. */
  readonly emptyChoices: readonly { readonly id: string; readonly doc: SeqDocument }[];
  readonly orientation: 'open' | 'fixed';
  readonly orientationNote: string;
  readonly settings: CloneCheckSettings;
  readonly setSettings: (next: Partial<CloneCheckSettings>) => void;
  readonly reusable: readonly ReusablePrimer[];
  readonly reuseKey: string;
  readonly setReuseKey: (key: string) => void;
  readonly design: () => void;
  readonly designing: boolean;
  readonly error: string | null;
  /** The last design on this very sequence, or null. */
  readonly record: CloneCheckRecord | null;
  readonly selected: number | null;
  readonly select: (index: number | null) => void;
  /** The insert and the selected pair as the views draw them. */
  readonly preview: readonly OverlaySpan[];
}

/** Where the page's selected pair lies: its sites as arrows, its band as a bracket. */
export function checkPairPreview(pair: CheckPair, seqLength: number): OverlaySpan[] {
  return [
    {
      id: 'band',
      label: `Band ${pair.productLength.toLocaleString()} bp`,
      range: unrollRange(pair.forwardSite.start, pair.reverseSite.end, seqLength),
      strand: 'none',
      shape: 'span',
    },
    { id: 'forward', label: 'Fwd', range: pair.forwardSite, strand: 'forward', shape: 'arrow' },
    { id: 'reverse', label: 'Rev', range: pair.reverseSite, strand: 'reverse', shape: 'arrow' },
  ];
}

/** What the pair's two oligos are called in the features, My primers and the protocol. */
export function checkPairNames(
  pair: CheckPair,
  rank: number,
): { readonly forward: string; readonly reverse: string } {
  const kind =
    pair.kind === 'flank' ? 'flank' : `junction ${((pair.junction ?? 0) + 1).toString()}`;
  return { forward: `Check ${kind} fwd ${rank}`, reverse: `Check ${kind} rev ${rank}` };
}

/** The design kept for `doc` under `documentId`, if its bases are still the ones it was made on. */
export function recallCloneCheckRecord(
  documentId: string | null,
  doc: SeqDocument,
): CloneCheckRecord | null {
  const stored = recallPanel<{
    readonly template: string;
    readonly record: CloneCheckRecord;
  } | null>('primers.cloneRecord', documentId, null);
  if (stored === null) return null;
  return stored.template === `${doc.topology}:${doc.sequence.toString()}` ? stored.record : null;
}

/**
 * The pairs a protocol lists (item 78): the best pair across each junction
 * and the best flanking one, with the bands as the page shows them.
 */
export function protocolChecks(record: CloneCheckRecord): ColonyPcrCheck[] {
  const seen = new Set<string>();
  const out: ColonyPcrCheck[] = [];
  record.design.pairs.forEach((pair, i) => {
    const key = `${pair.kind}:${pair.junction ?? ''}`;
    if (seen.has(key) || pair.problems.length > 0) return;
    seen.add(key);
    const names = checkPairNames(pair, i + 1);
    out.push({
      spans: junctionLabel(pair, record.junctions.length),
      forward: { name: names.forward, sequence: pair.forward.sequence },
      reverse: { name: names.reverse, sequence: pair.reverse.sequence },
      clone: pair.bands.clone,
      empty: pair.bands.empty,
      flipped: pair.bands.flipped,
    });
  });
  return out;
}

/** Which junction a pair spans, as the page names it. */
export function junctionLabel(pair: CheckPair, junctions: number): string {
  if (pair.kind === 'flank') return 'Flank';
  if (pair.junction === 0) return junctions === 1 ? 'Junction' : 'Left junction';
  if (pair.junction === 1) return 'Right junction';
  return `Junction ${((pair.junction ?? 1) - 1).toLocaleString()} inside the insert`;
}

/**
 * The clone check held for a document (item 120): the product in front,
 * the insert and the empty vector from the reaction that made it when it
 * registered them, else the selection and a chosen tab; the design run in
 * the analysis worker and remembered per document while the bases stay.
 */
export function useCloneCheck(doc: SeqDocument): CloneCheckState {
  const { selection, documentId, documents, primerCriteria } = useEditorState();
  const collection = usePrimerCollection();
  const context = useMemo(() => recallCloneCheck(doc), [doc]);
  const template = useMemo(() => `${doc.topology}:${doc.sequence.toString()}`, [doc]);
  const L = doc.length;

  const [settings, setSettingsMemory] = useRemembered<CloneCheckSettings>(
    'primers.cloneSettings',
    documentId,
    CLONE_CHECK_SETTINGS,
  );
  const [reuseKey, setReuseKey] = useRemembered('primers.cloneReuse', documentId, '');
  const [emptyChoice, setEmptyChoice] = useRemembered('primers.cloneEmpty', documentId, '');
  const [stored, setStored] = useRemembered<{
    readonly template: string;
    readonly record: CloneCheckRecord;
  } | null>('primers.cloneRecord', documentId, null);
  const [selected, setSelected] = useRemembered<number | null>(
    'primers.cloneSelected',
    documentId,
    null,
  );
  const [designing, setDesigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);

  const record = stored !== null && stored.template === template ? stored.record : null;

  const insert = useMemo<Range | null>(() => {
    if (context !== null) return context.geometry.insert;
    return selection !== null && !isEmptyRange(selection) ? selection : null;
  }, [context, selection]);
  const geometry = useMemo<CloneGeometry | null>(() => {
    if (context !== null) return context.geometry;
    if (insert === null) return null;
    const junctions = doc.isCircular
      ? [insert.start, insert.end % L]
      : [insert.start, insert.end].filter((j) => j > 0 && j < L);
    return { insert, junctions };
  }, [context, insert, doc.isCircular, L]);

  const emptyChoices = useMemo(
    () =>
      cloningDocuments(documents)
        .filter((d) => d.documentId !== documentId && d.history.present.isCircular)
        .map((d) => ({ id: d.documentId, doc: d.history.present })),
    [documents, documentId],
  );
  const empty = useMemo<SeqDocument | null>(() => {
    if (context !== null) return context.empty;
    return emptyChoices.find((c) => c.id === emptyChoice)?.doc ?? null;
  }, [context, emptyChoices, emptyChoice]);

  const orientation = context?.orientation ?? 'open';
  const orientationNote =
    context?.orientationNote ??
    'Whether the insert could have gone in the other way round is not known here, so the reversed clone is simulated as if it could.';

  const reusable = useMemo<ReusablePrimer[]>(() => {
    const out: ReusablePrimer[] = [];
    const seen = new Set<string>();
    const add = (group: ReusablePrimer['group'], primer: PcrPrimer): void => {
      const sequence = cleanPrimer(primer.sequence);
      if (sequence === '' || seen.has(sequence)) return;
      seen.add(sequence);
      out.push({ key: `${group}:${sequence}`, group, primer: { name: primer.name, sequence } });
    };
    for (const p of context?.primers ?? []) add('reaction', p);
    for (const p of lineagePrimers(doc.metadata.lineage)) add('record', p);
    for (const p of collection.primers) add('mine', p);
    return out;
  }, [context, doc, collection.primers]);
  const reused = reusable.find((r) => r.key === reuseKey)?.primer ?? null;

  const setSettings = useCallback(
    (next: Partial<CloneCheckSettings>) => {
      setSettingsMemory((s) => ({ ...s, ...next }));
    },
    [setSettingsMemory],
  );

  const design = useCallback(() => {
    if (geometry === null) return;
    const id = ++run.current;
    setDesigning(true);
    setError(null);
    analytics.track('primers', 'design-check', reused === null ? 'both' : 'reuse');
    const product = { name: doc.name, sequence: doc.sequence.toString(), topology: doc.topology };
    const emptyMolecule =
      empty === null
        ? null
        : { name: empty.name, sequence: empty.sequence.toString(), topology: empty.topology };
    analysisClient
      .checkPrimers(product, emptyMolecule, geometry, {
        minProduct: settings.minProduct,
        maxProduct: settings.maxProduct,
        minDistance: settings.minDistance,
        criteria: primerCriteria,
        reuse: reused,
        orientation,
      })
      .then(
        (result) => {
          if (id !== run.current) return;
          setStored({
            template,
            record: {
              design: result,
              designedFor:
                context !== null
                  ? `the ${context.method} product`
                  : `the selection ${formatSpan(geometry.insert, L)}`,
              insert: geometry.insert,
              junctions: geometry.junctions,
              emptyName: empty?.name ?? null,
              orientation,
              reused,
            },
          });
          setSelected(result.pairs.length === 0 ? null : 0);
          setDesigning(false);
        },
        (e: unknown) => {
          if (id !== run.current) return;
          setError(e instanceof Error ? e.message : String(e));
          setDesigning(false);
        },
      );
  }, [
    geometry,
    reused,
    doc,
    empty,
    settings,
    primerCriteria,
    orientation,
    template,
    context,
    L,
    setStored,
    setSelected,
  ]);

  // A request still out when the document changes answers for nothing.
  useEffect(
    () => () => {
      run.current++;
    },
    [documentId],
  );

  const preview = useMemo<OverlaySpan[]>(() => {
    const spans: OverlaySpan[] = [];
    if (record !== null) {
      spans.push({
        id: 'insert',
        label: 'Insert',
        range: record.insert,
        strand: 'none',
        shape: 'span',
      });
      const pair = selected === null ? undefined : record.design.pairs[selected];
      if (pair !== undefined) spans.push(...checkPairPreview(pair, L));
    } else if (context !== null) {
      spans.push({
        id: 'insert',
        label: 'Insert',
        range: context.geometry.insert,
        strand: 'none',
        shape: 'span',
      });
    }
    return spans;
  }, [record, selected, context, L]);

  return {
    context,
    insert,
    geometry,
    empty,
    emptyChoice,
    setEmptyChoice,
    emptyChoices,
    orientation,
    orientationNote,
    settings,
    setSettings,
    reusable,
    reuseKey,
    setReuseKey,
    design,
    designing,
    error,
    record,
    selected,
    select: setSelected,
    preview,
  };
}
