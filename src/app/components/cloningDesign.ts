import { useEffect, useMemo, useRef, useState } from 'react';

import {
  CLONING_DEFAULTS,
  type CloningContext,
  type CloningDesign,
  type CloningInsert,
  type CloningResults,
  type CloningScans,
  type CutSite,
  type DestinationOverhangs,
  type EnzymePairSuggestions,
  type Feature,
  type GoldenGatePartContext,
  type GoldenGatePartDesign,
  type Range,
  type SeqDocument,
  type Strand,
  type StrandEnd,
  type VectorRegion,
  cutLabel,
  designCloningResults,
  designGoldenGatePart,
  destinationOverhangs,
  featureExtent,
  formatSpan,
  getEnzyme,
  goldenGateFragments,
  goldenGatePartEnzymes,
  insertSequence,
  isEmptyRange,
  resolveVectorRegion,
  scanForCloning,
  suggestEnzymePairs,
  typeIISLayout,
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

/**
 * The Golden Gate option of cloning mode (#310, item 113): one Type IIS
 * enzyme and two overhangs instead of a pair of restriction sites. Kept per
 * vector document, like the rest of the page's memory.
 */
export interface GoldenGateMemory {
  /** Whether the ends are Golden Gate's rather than two restriction sites'. */
  readonly on: boolean;
  readonly enzyme: string;
  /** A second Type IIS enzyme in the same tube; empty for none. */
  readonly second: string;
  readonly left: string;
  readonly right: string;
  /** Where the overhangs came from: a standard's position, `destination`, or `custom`. */
  readonly choice: string;
  readonly includeStart: boolean;
  readonly includeStop: boolean;
}

export const GOLDEN_GATE_MEMORY: GoldenGateMemory = {
  on: false,
  enzyme: 'BsaI',
  second: '',
  left: '',
  right: '',
  choice: '',
  includeStart: true,
  includeStop: false,
};

/** The overhang picker's own value for two bases typed by hand. */
export const CUSTOM_OVERHANGS = 'custom';
/** The overhang picker's own value for the pair read off the destination. */
export const FROM_DESTINATION = 'destination';

/** What a design was made of, so Results can tell when any of it changed. */
interface DesignKey {
  readonly template: string;
  readonly insert: string;
  readonly region: string;
  readonly flipped: boolean;
  /** Null for a Golden Gate design, which picks no pair of enzymes. */
  readonly picked: EnzymePick | null;
  /** The Golden Gate settings the design was made with; null in the other mode. */
  readonly goldenGate: GoldenGateMemory | null;
}

export interface CloningDesignRecord {
  /** The restriction-ends design, or null when the record is a Golden Gate part. */
  readonly results: CloningResults | null;
  /** The Golden Gate part, or null when the record is a pair of restriction ends. */
  readonly goldenGate: GoldenGatePartDesign | null;
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
  /** The Golden Gate option: its settings, what the destination offers, and the tube. */
  readonly goldenGate: GoldenGateMemory;
  readonly setGoldenGate: (next: GoldenGateMemory) => void;
  /** The two overhangs the vector in front asks of a part; null when the enzyme opens nothing in it. */
  readonly destinationOverhangs: DestinationOverhangs | null;
  /** The other open tabs the enzyme releases a part from, which Simulate puts in the tube. */
  readonly tube: readonly SeqDocument[];
  /** Why Design is off, or null when it can run. */
  readonly blocked: string | null;
  /** Makes the design the mode asks for and keeps it; false when it could not run. */
  readonly design: () => boolean;
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
export function designRows(results: CloningResults | null): readonly CloningDesign[] {
  return results === null ? [] : [results.picked, ...results.alternatives];
}

function sameGoldenGate(a: GoldenGateMemory | null, b: GoldenGateMemory | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.enzyme === b.enzyme &&
    a.second === b.second &&
    a.left === b.left &&
    a.right === b.right &&
    a.includeStart === b.includeStart &&
    a.includeStop === b.includeStop
  );
}

/** Whether the two overhangs are the bases the enzyme's cut asks for. */
export function overhangsReady(memory: GoldenGateMemory): boolean {
  const enzyme = getEnzyme(memory.enzyme);
  const layout = enzyme === undefined ? null : typeIISLayout(enzyme);
  if (layout === null) return false;
  const ok = (o: string): boolean =>
    o.length === layout.overhang && !/[^ACGT]/.test(o.toUpperCase());
  return ok(memory.left.trim()) && ok(memory.right.trim());
}

/** How many bases each overhang must have, for the fields' labels; 0 without an enzyme. */
export function overhangWidth(enzymeName: string): number {
  const enzyme = getEnzyme(enzymeName);
  const layout = enzyme === undefined ? null : typeIISLayout(enzyme);
  return layout?.overhang ?? 0;
}

/**
 * What else goes in the tube when Simulate runs the assembly: every other
 * open DNA tab the enzyme releases a part from, which leaves out the
 * insert's own record (a gene has no Type IIS site) and the vector itself.
 */
export function tubeDocuments(
  documents: readonly DocumentState[],
  vectorId: string | null,
  insertId: string | null,
  enzymeName: string,
  secondName: string,
): SeqDocument[] {
  const enzyme = getEnzyme(enzymeName);
  if (enzyme === undefined) return [];
  const second = secondName === '' ? undefined : getEnzyme(secondName);
  const options = second === undefined ? { enzyme } : { enzyme, secondEnzyme: second };
  return cloningDocuments(documents)
    .filter((d) => d.documentId !== vectorId && d.documentId !== insertId)
    .map((d) => d.history.present)
    .filter((doc) => goldenGateFragments(doc, options).length > 0);
}

/** The enzymes the Golden Gate picker offers, the usual four first. */
export function goldenGateEnzymeNames(): string[] {
  return goldenGatePartEnzymes().map((e) => e.name);
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
  const [goldenGate, setGoldenGate] = useRemembered<GoldenGateMemory>(
    'primers.cloning.goldenGate',
    documentId,
    GOLDEN_GATE_MEMORY,
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

  // The Golden Gate option (#310): the destination is the vector in front,
  // and the tube is whatever else the enzyme opens a part out of.
  const destination = useMemo(() => {
    const enzyme = getEnzyme(goldenGate.enzyme);
    if (!goldenGate.on || enzyme === undefined) return null;
    const second = goldenGate.second === '' ? undefined : getEnzyme(goldenGate.second);
    return destinationOverhangs(doc, enzyme, second);
  }, [doc, goldenGate.on, goldenGate.enzyme, goldenGate.second]);
  const tube = useMemo(
    () =>
      goldenGate.on
        ? tubeDocuments(
            documents,
            documentId,
            insertRef?.documentId ?? null,
            goldenGate.enzyme,
            goldenGate.second,
          )
        : [],
    [documents, documentId, insertRef, goldenGate.on, goldenGate.enzyme, goldenGate.second],
  );
  const ggContext = useMemo<GoldenGatePartContext | null>(
    () => (insert === null ? null : { insert, destination: doc, otherParts: tube }),
    [insert, doc, tube],
  );

  const blocked = goldenGate.on
    ? insertRef !== null && insert === null
      ? "The insert's tab was closed — choose an insert again"
      : insert === null
        ? 'Choose an insert'
        : !overhangsReady(goldenGate)
          ? `Choose the two overhangs — ${overhangWidth(goldenGate.enzyme).toString()} bases each`
          : null
    : insertRef !== null && insert === null
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

  const key = useMemo<DesignKey | null>(() => {
    const common = { template, insert: insertKey, region: keyOfRegion(region), flipped };
    if (goldenGate.on) return { ...common, picked: null, goldenGate };
    return picked === null ? null : { ...common, picked, goldenGate: null };
  }, [template, insertKey, region, flipped, picked, goldenGate]);

  const design = (): boolean => {
    if (key === null || insert === null || insertRef === null) return false;
    const designedFor = `${insert.name} (${insert.document.name}) into ${doc.name}${goldenGate.on ? '' : ` ${formatSpan(region.range, doc.length)}`}`;
    const keep = (results: CloningResults | null, part: GoldenGatePartDesign | null): boolean => {
      setRecord({
        results,
        goldenGate: part,
        key,
        designedFor,
        insert,
        insertDocumentId: insertRef.documentId,
        vector: doc,
        vectorName: doc.name,
        padding: settings.padding,
      });
      setSelected(0);
      return true;
    };
    if (goldenGate.on) {
      if (ggContext === null || !overhangsReady(goldenGate)) return false;
      analytics.track('primers', 'design-golden-gate');
      return keep(
        null,
        designGoldenGatePart(ggContext, {
          enzyme: goldenGate.enzyme,
          secondEnzyme: goldenGate.second,
          left: goldenGate.left.trim().toUpperCase(),
          right: goldenGate.right.trim().toUpperCase(),
          includeStart: goldenGate.includeStart,
          includeStop: goldenGate.includeStop,
          padding: settings.padding,
          avoidJunctionSites: settings.avoidJunctionSites,
          criteria: primerCriteria,
        }),
      );
    }
    if (context === null || picked === null) return false;
    analytics.track('primers', 'design-cloning');
    return keep(
      designCloningResults(context, picked, {
        padding: settings.padding,
        avoidJunctionSites: settings.avoidJunctionSites,
        criteria: primerCriteria,
      }),
      null,
    );
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
      samePick(liveRecord.key.picked, picked) &&
      sameGoldenGate(liveRecord.key.goldenGate, goldenGate.on ? goldenGate : null));

  const preview = useMemo<OverlaySpan[]>(() => {
    // A Golden Gate part has no sites of its own on the vector: the
    // destination's own are what the reaction uses, and the Enzymes tab
    // draws those.
    if (goldenGate.on) return [];
    const report = suggestions?.picked ?? null;
    return cloningPreview(
      doc,
      region,
      report === null ? [] : [report.forward.site, report.reverse.site],
    );
  }, [doc, region, suggestions, goldenGate.on]);

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
    goldenGate,
    setGoldenGate,
    destinationOverhangs: destination,
    tube,
    blocked,
    design,
    record: liveRecord,
    designUnchanged,
    selected,
    select: setSelected,
    preview,
  };
}
