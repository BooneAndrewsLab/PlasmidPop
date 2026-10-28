import { useEffect, useMemo, useRef, useState } from 'react';

import {
  CLONING_DEFAULTS,
  type CloningContext,
  type CloningDesign,
  type CloningInsert,
  type CloningResults,
  type CloningScans,
  type CutSite,
  type EnzymePairSuggestions,
  type Feature,
  type Range,
  type SeqDocument,
  type Strand,
  type StrandEnd,
  type VectorRegion,
  cutLabel,
  designCloningResults,
  featureExtent,
  formatSpan,
  getEnzyme,
  insertSequence,
  isEmptyRange,
  resolveVectorRegion,
  scanForCloning,
  suggestEnzymePairs,
} from '@/core';
import { type OverlaySpan } from '@/view/overlay';
import { analysisClient } from '@/workers/analysisClient';

import { analytics } from '../analytics';
import { type DocumentState, cloningDocuments } from '../state/editorStore';
import { useRemembered } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';

/**
 * The Design page's cloning mode (#303, item 108): what the page holds for
 * the vector in front — the insert (a stretch of another tab), Flip, the
 * picked enzyme pair, the scans and the last design — as panel memory per
 * document, like the plain design, so leaving the tab and coming back finds
 * it all as it was. The engine (`core/cloning/cloningEnds.ts`) is pure; the
 * two scans go through the analysis worker and are the one thing waited for.
 */

/** Which stretch of which tab the insert is; resolved against the open tabs on every render. */
export interface InsertRef {
  readonly documentId: string;
  /** The feature it is, when it is one: its extent is read live, so an edit follows. */
  readonly featureId: string | null;
  readonly range: Range;
  readonly strand: Strand;
  readonly name: string;
}

export interface EnzymePick {
  readonly forward: string;
  readonly reverse: string;
}

/** One thing the insert chooser offers: a feature of another tab, or that tab's selection. */
export interface InsertChoice {
  readonly value: string;
  readonly label: string;
  readonly ref: InsertRef;
}

export interface InsertChoiceGroup {
  readonly documentId: string;
  readonly tab: string;
  readonly choices: readonly InsertChoice[];
}

const SELECTION = 'selection';

export function insertChoiceValue(ref: InsertRef): string {
  return `${ref.documentId}:${ref.featureId ?? SELECTION}`;
}

/**
 * What the other open DNA tabs offer as an insert: every feature with an
 * extent, and the tab's own selection when it has one. The vector's own
 * features are not offered — an insert is cloned into the vector from
 * somewhere else.
 */
export function insertChoices(
  documents: readonly DocumentState[],
  vectorId: string | null,
): InsertChoiceGroup[] {
  const groups: InsertChoiceGroup[] = [];
  for (const d of cloningDocuments(documents)) {
    if (d.documentId === vectorId) continue;
    const doc = d.history.present;
    const choices: InsertChoice[] = [];
    if (d.selection !== null && !isEmptyRange(d.selection)) {
      const ref: InsertRef = {
        documentId: d.documentId,
        featureId: null,
        range: d.selection,
        strand: 'forward',
        name: `${doc.name} ${formatSpan(d.selection, doc.length)}`,
      };
      choices.push({
        value: insertChoiceValue(ref),
        label: `Selection ${formatSpan(d.selection, doc.length)} · ${(d.selection.end - d.selection.start).toLocaleString()} bp`,
        ref,
      });
    }
    for (const f of doc.features.all()) {
      const extent = featureExtent(f);
      if (extent === null || extent.end <= extent.start) continue;
      const ref: InsertRef = {
        documentId: d.documentId,
        featureId: f.id,
        range: extent,
        strand: f.strand === 'reverse' ? 'reverse' : 'forward',
        name: f.name === '' ? f.type : f.name,
      };
      choices.push({
        value: insertChoiceValue(ref),
        label: `${ref.name} (${f.type}) · ${formatSpan(extent, doc.length)}${f.strand === 'reverse' ? ' · reverse' : ''}`,
        ref,
      });
    }
    if (choices.length > 0) groups.push({ documentId: d.documentId, tab: doc.name, choices });
  }
  return groups;
}

/**
 * The insert as the engine takes it, read off the tab it is on now: null
 * when that tab was closed, or the feature it was is gone.
 */
export function resolveInsert(
  ref: InsertRef | null,
  documents: readonly DocumentState[],
): CloningInsert | null {
  if (ref === null) return null;
  const tab = documents.find((d) => d.documentId === ref.documentId);
  if (tab === undefined) return null;
  const doc = tab.history.present;
  let range = ref.range;
  let strand = ref.strand;
  if (ref.featureId !== null) {
    const f = doc.features.get(ref.featureId);
    if (f === undefined) return null;
    const extent = featureExtent(f);
    if (extent === null || extent.end <= extent.start) return null;
    range = extent;
    strand = f.strand === 'reverse' ? 'reverse' : 'forward';
  } else if (range.start < 0 || range.end > 2 * doc.length || range.end <= range.start) {
    return null;
  }
  return { document: doc, range, strand, name: ref.name };
}

/**
 * The feature of a fetched record that is the insert: its one CDS, else its
 * `gene`, else nothing (the whole record is the insert then).
 */
export function fetchedInsertFeature(doc: SeqDocument): Feature | null {
  const withExtent = doc.features.all().filter((f) => {
    const e = featureExtent(f);
    return e !== null && e.end > e.start;
  });
  const cds = withExtent.filter((f) => f.type === 'CDS');
  if (cds.length === 1) return cds[0] ?? null;
  const gene = withExtent.filter((f) => f.type === 'gene');
  if (gene.length === 1) return gene[0] ?? null;
  return cds[0] ?? gene[0] ?? null;
}

/** An `InsertRef` for a fetched record just opened as the tab `documentId`. */
export function fetchedInsertRef(doc: SeqDocument, documentId: string): InsertRef {
  const feature = fetchedInsertFeature(doc);
  const extent = feature === null ? null : featureExtent(feature);
  if (feature !== null && extent !== null) {
    return {
      documentId,
      featureId: feature.id,
      range: extent,
      strand: feature.strand === 'reverse' ? 'reverse' : 'forward',
      name: feature.name === '' ? doc.name : feature.name,
    };
  }
  return {
    documentId,
    featureId: null,
    range: { start: 0, end: doc.length },
    strand: 'forward',
    name: doc.name,
  };
}

/** "AATT 5′", "TGCA 3′" or "blunt": the end as the pair table writes it. */
export function endText(end: StrandEnd | null): string {
  if (end === null) return '—';
  if (end.kind === 'blunt') return 'blunt';
  return `${end.overhang.toUpperCase()} ${end.kind === "5'" ? '5′' : '3′'}`;
}

/** "G^AATTC" for an enzyme cutting inside its site; "GGTCTC(1/5)" for one cutting beside it. */
export function siteWithCut(name: string): string {
  const e = getEnzyme(name);
  if (e === undefined) return '';
  const site = e.site.toUpperCase();
  if (e.cutTop > 0 && e.cutTop < site.length) {
    return `${site.slice(0, e.cutTop)}^${site.slice(e.cutTop)}`;
  }
  const top = e.cutTop >= site.length ? e.cutTop - site.length : e.cutTop;
  const bottom = e.cutBottom >= site.length ? e.cutBottom - site.length : e.cutBottom;
  return `${site}(${top.toString()}/${bottom.toString()})`;
}

/** The number a cut on the vector is called by, or null without a cut. */
export function cutAt(site: CutSite | null, vector: SeqDocument): number | null {
  return site === null ? null : cutLabel(site.cut, vector.length, vector.topology);
}

/** The region's enzymes that cut inside the insert, with where, for the insert's own line. */
export function internalSites(
  scans: CloningScans,
  candidates: readonly string[],
): { readonly enzyme: string; readonly positions: readonly number[] }[] {
  const wanted = new Set(candidates);
  const byEnzyme = new Map<string, number[]>();
  for (const s of scans.insertSites) {
    if (!wanted.has(s.enzyme)) continue;
    const list = byEnzyme.get(s.enzyme) ?? [];
    list.push(s.cut);
    byEnzyme.set(s.enzyme, list);
  }
  return [...byEnzyme.entries()]
    .map(([enzyme, positions]) => ({ enzyme, positions: positions.sort((a, b) => a - b) }))
    .sort((a, b) => a.enzyme.localeCompare(b.enzyme));
}

/** Every enzyme with a site on the vector, for the override's two lists. */
export function vectorEnzymes(scans: CloningScans): string[] {
  return [...new Set(scans.vectorSites.map((s) => s.enzyme))].sort((a, b) => a.localeCompare(b));
}

/**
 * What the map draws for the cloning mode: the region as a span when it
 * was not the selection (the selection is drawn as itself), and the picked
 * pair's two sites in the preview colour.
 */
export function cloningPreview(
  vector: SeqDocument,
  region: VectorRegion,
  sites: readonly (CutSite | null)[],
): OverlaySpan[] {
  const spans: OverlaySpan[] = [];
  if (region.source === 'mcs') {
    spans.push({
      id: 'region',
      label: region.feature?.name ?? 'Region',
      range: region.range,
      strand: 'none',
      shape: 'span',
    });
  }
  sites.forEach((site, i) => {
    if (site === null) return;
    const length = getEnzyme(site.enzyme)?.site.length ?? 6;
    const start = site.siteStart;
    spans.push({
      id: `cut-${i.toString()}`,
      label: `${site.enzyme} ${cutLabel(site.cut, vector.length, vector.topology).toLocaleString()}`,
      range: { start, end: start + length },
      strand: 'none',
      shape: 'arrow',
    });
  });
  return spans;
}

/** The pair's two enzymes as the page writes them. */
export function pairLabel(pick: EnzymePick): string {
  return `${pick.forward} · ${pick.reverse}`;
}

/** What a design was made of, so Results can tell when any of it changed. */
interface DesignKey {
  readonly template: string;
  readonly insert: string;
  readonly region: string;
  readonly flipped: boolean;
  readonly picked: EnzymePick;
}

export interface CloningDesignRecord {
  readonly results: CloningResults;
  readonly key: DesignKey;
  /** "ACT1 CDS (ACT1_cDNA.gb) into pUC19 396–454", the Results heading's line. */
  readonly designedFor: string;
  readonly insert: CloningInsert;
  /** The insert's tab, which Use in PCR makes the template. */
  readonly insertDocumentId: string;
  /** The vector as it was designed on (the same bases as the document in front while the record lives). */
  readonly vector: SeqDocument;
  readonly vectorName: string;
  readonly padding: number;
}

export interface CloningSettingsMemory {
  readonly padding: number;
  readonly avoidJunctionSites: boolean;
}

export interface CloningDesignState {
  readonly vector: SeqDocument;
  readonly region: VectorRegion;
  readonly insertRef: InsertRef | null;
  /** The insert read off its tab now; null when there is none, or its tab is gone. */
  readonly insert: CloningInsert | null;
  readonly setInsert: (ref: InsertRef | null) => void;
  readonly flipped: boolean;
  readonly setFlipped: (next: boolean) => void;
  /** The scans, once both are back from the worker; null while they are under way or without an insert. */
  readonly scans: CloningScans | null;
  readonly scanning: boolean;
  readonly context: CloningContext | null;
  readonly suggestions: EnzymePairSuggestions | null;
  readonly picked: EnzymePick | null;
  readonly setPicked: (pick: EnzymePick | null) => void;
  readonly settings: CloningSettingsMemory;
  readonly setSettings: (next: CloningSettingsMemory) => void;
  /** Why Design is off, or null when it can run. */
  readonly blocked: string | null;
  readonly design: () => CloningResults | null;
  /** The last design on this vector, dropped once the vector's bases change. */
  readonly record: CloningDesignRecord | null;
  /** Whether the region, the insert, Flip and the pick are still what the design was made of. */
  readonly designUnchanged: boolean;
  /** The Results row (the picked pair is 0, the alternatives follow). */
  readonly selected: number | null;
  readonly select: (index: number | null) => void;
  /** What the views draw: the region and the picked pair's sites. */
  readonly preview: readonly OverlaySpan[];
}

export const CLONING_SETTINGS: CloningSettingsMemory = {
  padding: CLONING_DEFAULTS.padding,
  avoidJunctionSites: CLONING_DEFAULTS.avoidJunctionSites,
};

function keyOfDoc(doc: SeqDocument): string {
  return `${doc.topology}:${doc.sequence.toString()}`;
}

function keyOfInsert(insert: CloningInsert | null): string {
  return insert === null ? '' : insertSequence(insert);
}

function keyOfRegion(region: VectorRegion): string {
  return `${region.range.start.toString()}-${region.range.end.toString()}`;
}

function samePick(a: EnzymePick | null, b: EnzymePick | null): boolean {
  if (a === null || b === null) return a === b;
  return a.forward === b.forward && a.reverse === b.reverse;
}

/** The rows of a design: the picked pair first, then the alternatives. */
export function designRows(results: CloningResults): readonly CloningDesign[] {
  return [results.picked, ...results.alternatives];
}

/** What a scan was of, so one is not run twice for the same bases. */
interface HeldScans {
  readonly key: string;
  readonly scans: CloningScans;
}

export function useCloningDesign(doc: SeqDocument): CloningDesignState {
  const { selection, documentId, documents, primerCriteria } = useEditorState();
  const [insertRef, setInsertRef] = useRemembered<InsertRef | null>(
    'primers.cloning.insert',
    documentId,
    null,
  );
  const [flipped, setFlipped] = useRemembered('primers.cloning.flipped', documentId, false);
  const [picked, setPickedMemory] = useRemembered<EnzymePick | null>(
    'primers.cloning.picked',
    documentId,
    null,
  );
  // Padding and the junction rule are the user's way of working, not the
  // vector's, like the plain designer's criteria (shared by every document).
  const [settings, setSettings] = useRemembered<CloningSettingsMemory>(
    'primers.cloning.settings',
    null,
    CLONING_SETTINGS,
  );
  const [held, setHeld] = useRemembered<HeldScans | null>(
    'primers.cloning.scans',
    documentId,
    null,
  );
  const [record, setRecord] = useRemembered<CloningDesignRecord | null>(
    'primers.cloning.results',
    documentId,
    null,
  );
  const [selected, setSelected] = useRemembered<number | null>(
    'primers.cloning.selected',
    documentId,
    null,
  );
  /** A scan the worker could not do, so the page does not wait on it forever. */
  const [failed, setFailed] = useState<string | null>(null);

  const region = useMemo(() => resolveVectorRegion(doc, selection), [doc, selection]);
  const insert = useMemo(() => resolveInsert(insertRef, documents), [insertRef, documents]);
  const template = useMemo(() => keyOfDoc(doc), [doc]);
  const insertKey = useMemo(() => keyOfInsert(insert), [insert]);
  const scanKey = insert === null ? null : `${template}\u0000${insertKey}`;

  // The scans, off the main thread: asked for once per vector-and-insert,
  // and the answer kept with the rest of the page's memory. A stale answer
  // (the insert changed while the worker was at it) is dropped.
  const wanted = useRef<string | null>(null);
  useEffect(() => {
    wanted.current = scanKey;
    if (scanKey === null || insert === null || held?.key === scanKey) return;
    let live = true;
    scanForCloning(analysisClient, doc, insert)
      .then((scans) => {
        if (!live || wanted.current !== scanKey) return;
        setHeld({ key: scanKey, scans });
      })
      .catch(() => {
        if (live && wanted.current === scanKey) setFailed(scanKey);
      });
    return () => {
      live = false;
    };
  }, [scanKey, doc, insert, held, setHeld]);
  const scans = held !== null && held.key === scanKey ? held.scans : null;
  const scanning = scanKey !== null && scans === null && failed !== scanKey;

  const context = useMemo<CloningContext | null>(
    () =>
      insert === null || scans === null ? null : { vector: doc, region, insert, flipped, scans },
    [doc, region, insert, flipped, scans],
  );
  const suggestions = useMemo(
    () => (context === null ? null : suggestEnzymePairs(context, picked)),
    [context, picked],
  );

  const setInsert = (ref: InsertRef | null): void => {
    setInsertRef(ref);
  };
  const setPicked = (pick: EnzymePick | null): void => {
    setPickedMemory(pick);
  };

  const blocked =
    insertRef !== null && insert === null
      ? "The insert's tab was closed — choose an insert again"
      : insert === null
        ? 'Choose an insert'
        : context === null
          ? scanning
            ? 'Scanning the vector and the insert for cut sites…'
            : 'The cut-site scan failed; choose the insert again'
          : picked === null
            ? 'Choose two enzymes'
            : null;

  const key = useMemo<DesignKey | null>(
    () =>
      picked === null
        ? null
        : { template, insert: insertKey, region: keyOfRegion(region), flipped, picked },
    [template, insertKey, region, flipped, picked],
  );

  const design = (): CloningResults | null => {
    if (
      context === null ||
      picked === null ||
      key === null ||
      insert === null ||
      insertRef === null
    ) {
      return null;
    }
    analytics.track('primers', 'design-cloning');
    const results = designCloningResults(context, picked, {
      padding: settings.padding,
      avoidJunctionSites: settings.avoidJunctionSites,
      criteria: primerCriteria,
    });
    setRecord({
      results,
      key,
      designedFor: `${insert.name} (${insert.document.name}) into ${doc.name} ${formatSpan(region.range, doc.length)}`,
      insert,
      insertDocumentId: insertRef.documentId,
      vector: doc,
      vectorName: doc.name,
      padding: settings.padding,
    });
    setSelected(0);
    return results;
  };

  // A design on other bases means nothing: dropped, as the plain one is.
  const liveRecord = record !== null && record.key.template === template ? record : null;
  useEffect(() => {
    if (record !== null && liveRecord === null) {
      setRecord(null);
      setSelected(null);
    }
  }, [record, liveRecord, setRecord, setSelected]);

  const designUnchanged =
    liveRecord === null ||
    (liveRecord.key.insert === insertKey &&
      liveRecord.key.region === keyOfRegion(region) &&
      liveRecord.key.flipped === flipped &&
      samePick(liveRecord.key.picked, picked));

  const preview = useMemo<OverlaySpan[]>(() => {
    const report = suggestions?.picked ?? null;
    return cloningPreview(
      doc,
      region,
      report === null ? [] : [report.forward.site, report.reverse.site],
    );
  }, [doc, region, suggestions]);

  return {
    vector: doc,
    region,
    insertRef,
    insert,
    setInsert,
    flipped,
    setFlipped,
    scans,
    scanning,
    context,
    suggestions,
    picked,
    setPicked,
    settings,
    setSettings,
    blocked,
    design,
    record: liveRecord,
    designUnchanged,
    selected,
    select: setSelected,
    preview,
  };
}
