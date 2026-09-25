import {
  type DocumentEnds,
  type DocumentMetadata,
  type Feature,
  type HistoryRecordStep,
  type NamedState,
  type Segment,
  type SequenceText,
  type SequencingRead,
  type Topology,
  FeatureSet,
  History,
  Rope,
  SeqDocument,
  endsEqual,
  isValidSequence,
  methylationEqual,
  reverseComplement,
} from '@/core';

import {
  type StoredDelta,
  type StoredFeaturesDelta,
  type StoredHistory,
  type StoredLandmark,
  type StoredNamedState,
  type StoredSequenceDelta,
  type StoredState,
  type StoredStep,
  HISTORY_FORMAT,
  isStoredHistory,
} from './historyFormat';

/**
 * Turns a document's undo history into a `histories` row and back (item 51).
 *
 * The oldest kept state is written whole; every later one as a `StoredDelta`
 * from the state before it, which for typing is a few bases and a position.
 * Every delta is verified as it is made — the features it would rebuild are
 * compared with the real ones and a smaller description that does not
 * reproduce them exactly is never used — so what comes back is the history
 * that went in, not an approximation of it.
 *
 * States never change once made, so a delta is worked out once per pair of
 * states and remembered (`deltaCache`): an autosave after a keystroke works
 * out one new delta, not two hundred. A row read back seeds the same cache,
 * so the first save after a reload works out none.
 */

/**
 * Most a document's stored history may take, in estimated bytes (one per
 * base or character, see `deltaSize`). Past it the oldest steps are left out
 * of the stored copy and it is marked truncated; the history in memory keeps
 * them until the page is left.
 */
export const HISTORY_BUDGET = 4 * 1024 * 1024;

/** What `encodeHistory` stores: the history and the two baselines that point into it. */
export interface HistoryToStore {
  readonly history: History<SeqDocument>;
  /** The document as opened: what **Since opened** measures from. */
  readonly opened: SeqDocument;
  /** The version last downloaded, or null. */
  readonly saved: SeqDocument | null;
  /** The file a working copy came from, which is stored beside the document already. */
  readonly origin: SeqDocument | null;
}

/** A history read back, with its baselines as the same objects as its states where they are one. */
export interface RestoredHistory {
  readonly history: History<SeqDocument>;
  readonly opened: SeqDocument;
  readonly saved: SeqDocument | null;
}

// ---------------------------------------------------------------- sizes

/** Per-step and per-state overhead in the estimate: keys, numbers, the label's container. */
const STEP_OVERHEAD = 48;
const SEGMENT_SIZE = 48;
const QUALIFIER_OVERHEAD = 16;
const FEATURE_OVERHEAD = 64;

const featureSizes = new WeakMap<Feature, number>();

function featureSize(f: Feature): number {
  let size = featureSizes.get(f);
  if (size !== undefined) return size;
  size = FEATURE_OVERHEAD + f.id.length + f.type.length + f.name.length;
  size += f.segments.length * SEGMENT_SIZE;
  for (const q of f.qualifiers) size += QUALIFIER_OVERHEAD + q.name.length + (q.value?.length ?? 0);
  featureSizes.set(f, size);
  return size;
}

function featuresSize(features: readonly Feature[]): number {
  let size = 0;
  for (const f of features) size += featureSize(f);
  return size;
}

const metadataSizes = new WeakMap<DocumentMetadata, number>();

function metadataSize(m: DocumentMetadata): number {
  let size = metadataSizes.get(m);
  if (size === undefined) {
    size = JSON.stringify(m).length;
    metadataSizes.set(m, size);
  }
  return size;
}

function readSize(read: SequencingRead | null): number {
  if (read === null) return 0;
  const trace = read.trace;
  if (trace === null) return read.qualities.byteLength;
  return read.qualities.byteLength + trace.peaks.byteLength + 4 * trace.channels.A.byteLength;
}

function sequenceDeltaSize(d: StoredSequenceDelta | undefined): number {
  if (d === undefined) return 0;
  return d.kind === 'splice' ? 24 + d.text.length : 16;
}

function featuresDeltaSize(d: StoredFeaturesDelta | undefined): number {
  if (d === undefined) return 0;
  if (d.kind === 'list') return 16 + featuresSize(d.features);
  let size = 24 + featuresSize(d.upserted);
  for (const id of d.removed) size += 4 + id.length;
  return size;
}

/** Estimated stored size of a delta, in bytes; a pure function of it, so a row read back sizes the same. */
export function deltaSize(d: StoredDelta): number {
  return (
    STEP_OVERHEAD +
    sequenceDeltaSize(d.sequence) +
    featuresDeltaSize(d.features) +
    (d.name?.length ?? 0) +
    (d.metadata === undefined ? 0 : metadataSize(d.metadata)) +
    (d.ends === undefined ? 0 : 64) +
    (d.read === undefined ? 0 : readSize(d.read))
  );
}

/**
 * Estimated stored size of a row: what `encodeHistory` counted against the
 * budget when it made it. Zero for no row.
 */
export function storedSize(row: StoredHistory | null): number {
  if (row === null) return 0;
  const landmark = (l: StoredLandmark): number =>
    l.kind === 'state' ? storedStateSize(l.state) : 0;
  let size = storedStateSize(row.base) + landmark(row.opened) + landmark(row.saved);
  for (const step of row.steps) {
    size += deltaSize(step.delta) + step.label.length + (step.name?.length ?? 0);
  }
  for (const n of row.named ?? []) size += n.name.length + n.label.length + landmark(n.state);
  return size;
}

function storedStateSize(s: StoredState): number {
  return (
    STEP_OVERHEAD +
    s.sequence.length +
    s.name.length +
    featuresSize(s.features) +
    metadataSize(s.metadata) +
    readSize(s.read)
  );
}

/** Estimated stored size of a whole state, without writing it out; as `storedStateSize`. */
function stateSize(doc: SeqDocument): number {
  return (
    STEP_OVERHEAD +
    doc.length +
    doc.name.length +
    featuresSize(doc.features.all()) +
    metadataSize(doc.metadata) +
    readSize(doc.read)
  );
}

// ---------------------------------------------------------------- copies and comparisons

function copySegment(s: Segment): Segment {
  return s.kind === 'site'
    ? { kind: 'site', position: s.position }
    : {
        kind: 'range',
        start: s.start,
        end: s.end,
        partialStart: s.partialStart,
        partialEnd: s.partialEnd,
      };
}

/** A feature as plain data with only the fields `Feature` has. */
function copyFeature(f: Feature): Feature {
  return {
    id: f.id,
    type: f.type,
    name: f.name,
    strand: f.strand,
    segments: f.segments.map(copySegment),
    qualifiers: f.qualifiers.map((q) => ({ name: q.name, value: q.value })),
  };
}

function copyMetadata(m: DocumentMetadata): DocumentMetadata {
  return {
    description: m.description,
    accession: m.accession,
    version: m.version,
    keywords: m.keywords,
    source: m.source,
    organism: m.organism,
    taxonomy: m.taxonomy,
    moleculeType: m.moleculeType,
    division: m.division,
    date: m.date,
    dbLinks: [...m.dbLinks],
    references: m.references.map((r) => ({
      number: r.number,
      location: r.location,
      authors: r.authors,
      consortium: r.consortium,
      title: r.title,
      journal: r.journal,
      pubmed: r.pubmed,
      remark: r.remark,
    })),
    comments: [...m.comments],
    extraHeaders: m.extraHeaders.map((h) => ({ keyword: h.keyword, value: h.value })),
    derivedFrom:
      m.derivedFrom === null
        ? null
        : { checksum: m.derivedFrom.checksum, fileName: m.derivedFrom.fileName },
    // Plain, immutable data: shared rather than copied, as the sequence text is.
    lineage: m.lineage,
  };
}

function copyEnds(e: DocumentEnds | null): DocumentEnds | null {
  if (e === null) return null;
  return {
    left: { kind: e.left.kind, overhang: e.left.overhang, enzyme: e.left.enzyme },
    right: { kind: e.right.kind, overhang: e.right.overhang, enzyme: e.right.enzyme },
  };
}

function segmentEqual(a: Segment, b: Segment): boolean {
  if (a.kind === 'site' || b.kind === 'site') {
    return a.kind === 'site' && b.kind === 'site' && a.position === b.position;
  }
  return (
    a.start === b.start &&
    a.end === b.end &&
    a.partialStart === b.partialStart &&
    a.partialEnd === b.partialEnd
  );
}

function featureEqual(a: Feature, b: Feature): boolean {
  if (a === b) return true;
  return (
    a.id === b.id &&
    a.type === b.type &&
    a.name === b.name &&
    a.strand === b.strand &&
    a.segments.length === b.segments.length &&
    a.segments.every((s, i) => {
      const t = b.segments[i];
      return t !== undefined && segmentEqual(s, t);
    }) &&
    a.qualifiers.length === b.qualifiers.length &&
    a.qualifiers.every((q, i) => {
      const r = b.qualifiers[i];
      return q.name === r?.name && q.value === r.value;
    })
  );
}

function featureListsEqual(a: readonly Feature[], b: readonly Feature[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((f, i) => {
    const g = b[i];
    return g !== undefined && featureEqual(f, g);
  });
}

function metadataEqual(a: DocumentMetadata, b: DocumentMetadata): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------- sequence deltas

/** Below this many changed bases a splice is left as it is; above it a turn or a rotation is looked for. */
const LARGE_CHANGE = 64;

/** How many places the start of a rotated sequence is looked for before giving up on a rotation. */
const ROTATION_TRIES = 8;

/**
 * Every way of describing the change from `a` to `b` worth trying, smallest
 * first; empty when the bases are the same. A run of one base lets an
 * insertion or deletion sit anywhere along it, and where it sits decides
 * where the features move to, so both ends of the run are offered.
 */
function sequenceDeltas(a: SequenceText, b: SequenceText): StoredSequenceDelta[] {
  if (a === b) return [];
  const x = a.toString();
  const y = b.toString();
  if (x === y) return [];
  const min = Math.min(x.length, y.length);
  const prefix = commonPrefix(x, y, min);
  const suffix = commonSuffix(x, y, min - prefix);
  const splice = (start: number, end: number): StoredSequenceDelta => ({
    kind: 'splice',
    start,
    deleted: x.length - start - end,
    text: y.slice(start, y.length - end),
  });
  const out: StoredSequenceDelta[] = [splice(prefix, suffix)];
  // The same change pushed as far left as it will go.
  const fullSuffix = suffix < min - prefix ? suffix : commonSuffix(x, y, min);
  if (fullSuffix > suffix) out.push(splice(min - fullSuffix, fullSuffix));
  if (x.length === y.length && x.length - prefix - suffix > LARGE_CHANGE) {
    if (couldBeTurned(x, y) && reverseComplement(x) === y)
      out.unshift({ kind: 'reverseComplement' });
    else {
      const origin = rotationOf(x, y);
      if (origin !== null) out.unshift({ kind: 'rotate', origin });
    }
  }
  return out;
}

/**
 * Strings are compared a block at a time first: `===` on two slices is a
 * memory compare, where a loop over `charCodeAt` is ten times slower on a
 * megabase (`docs/perf-notes.md`).
 */
const BLOCK = 4096;

/** Length of the longest common prefix of `x` and `y`, at most `max`. */
function commonPrefix(x: string, y: string, max: number): number {
  let p = 0;
  while (p + BLOCK <= max && x.slice(p, p + BLOCK) === y.slice(p, p + BLOCK)) p += BLOCK;
  while (p < max && x.charCodeAt(p) === y.charCodeAt(p)) p++;
  return p;
}

/** Length of the longest common suffix of `x` and `y`, at most `max`. */
function commonSuffix(x: string, y: string, max: number): number {
  let s = 0;
  const xe = x.length;
  const ye = y.length;
  while (s + BLOCK <= max && x.slice(xe - s - BLOCK, xe - s) === y.slice(ye - s - BLOCK, ye - s)) {
    s += BLOCK;
  }
  while (s < max && x.charCodeAt(xe - 1 - s) === y.charCodeAt(ye - 1 - s)) s++;
  return s;
}

/** Whether `y` starts as `x` turned over would, before turning all of `x` over to be sure. */
function couldBeTurned(x: string, y: string): boolean {
  const n = Math.min(32, x.length);
  return reverseComplement(x.slice(x.length - n)) === y.slice(0, n);
}

/** The `k` for which `y` is `x` read from base `k` round to base `k − 1`, or null. */
function rotationOf(x: string, y: string): number | null {
  const n = x.length;
  const probe = y.slice(0, Math.min(32, n));
  const doubled = x + x;
  let from = 1;
  for (let tries = 0; tries < ROTATION_TRIES; tries++) {
    const k = doubled.indexOf(probe, from);
    if (k === -1 || k >= n) return null;
    if (x.slice(k) === y.slice(0, n - k) && x.slice(0, k) === y.slice(n - k)) return k;
    from = k + 1;
  }
  return null;
}

function applySequence(seq: SequenceText, d: StoredSequenceDelta): SequenceText {
  switch (d.kind) {
    case 'splice':
      if (d.start + d.deleted > seq.length) throw new RangeError('Splice past the end');
      if (!isValidSequence(d.text)) throw new RangeError('Splice text is not a sequence');
      return seq.remove(d.start, d.start + d.deleted).insert(d.start, d.text);
    case 'reverseComplement':
      return Rope.from(reverseComplement(seq.toString()));
    case 'rotate': {
      if (d.origin <= 0 || d.origin >= seq.length) throw new RangeError('Rotation out of range');
      const text = seq.toString();
      return Rope.from(text.slice(d.origin) + text.slice(0, d.origin));
    }
  }
}

// ---------------------------------------------------------------- feature deltas

/**
 * The features of `prev` moved as the edit a sequence delta describes would
 * move them, then through a change of topology. Encoder and decoder both
 * call it on the same state, so it rebuilds exactly what the encoder saw.
 */
function replayFeatures(
  prev: SeqDocument,
  seq: StoredSequenceDelta | undefined,
  topology: Topology,
): readonly Feature[] {
  let doc = prev;
  if (seq !== undefined) {
    switch (seq.kind) {
      case 'splice': {
        const range = { start: seq.start, end: seq.start + seq.deleted };
        if (seq.deleted === 0) doc = prev.insert(seq.start, seq.text);
        else if (seq.text.length === 0) doc = prev.delete(range);
        else doc = prev.replace(range, seq.text);
        break;
      }
      case 'reverseComplement':
        doc = prev.reverseComplement();
        break;
      case 'rotate':
        doc = prev.setOrigin(seq.origin);
        break;
    }
  }
  if (doc.topology !== topology) doc = doc.setTopology(topology);
  return doc.features.all();
}

/**
 * `next` as `base` with some features removed, some replaced in place and
 * some appended — the shapes adding, editing and removing features leave —
 * or null when the order says it is something else.
 */
function patchBetween(
  base: readonly Feature[],
  next: readonly Feature[],
): { removed: string[]; upserted: Feature[] } | null {
  const nextIds = new Set(next.map((f) => f.id));
  const baseIds = new Set(base.map((f) => f.id));
  const removed = base.filter((f) => !nextIds.has(f.id)).map((f) => f.id);
  const kept = base.filter((f) => nextIds.has(f.id));
  if (next.length < kept.length) return null;
  const upserted: Feature[] = [];
  for (let i = 0; i < next.length; i++) {
    const f = next[i];
    if (f === undefined) return null;
    const old = kept[i];
    if (old !== undefined) {
      if (old.id !== f.id) return null;
      if (!featureEqual(old, f)) upserted.push(f);
    } else {
      if (baseIds.has(f.id)) return null;
      upserted.push(f);
    }
  }
  return { removed, upserted };
}

function applyPatch(
  base: readonly Feature[],
  removed: readonly string[],
  upserted: readonly Feature[],
): Feature[] {
  const gone = new Set(removed);
  const byId = new Map(upserted.map((f) => [f.id, f]));
  const out = base.filter((f) => !gone.has(f.id)).map((f) => byId.get(f.id) ?? f);
  const present = new Set(out.map((f) => f.id));
  for (const f of upserted) if (!present.has(f.id)) out.push(f);
  return out;
}

/**
 * The smallest description of how the features went from `prev` to `next`
 * given this sequence delta, or undefined when they did not change. Every
 * patch is checked by applying it before it is offered.
 */
function featuresDelta(
  prev: SeqDocument,
  next: SeqDocument,
  seq: StoredSequenceDelta | undefined,
): StoredFeaturesDelta | undefined {
  const target = next.features.all();
  const before = prev.features.all();
  if (next.features === prev.features || featureListsEqual(before, target)) return undefined;
  interface Patch {
    readonly replay: boolean;
    readonly removed: string[];
    readonly upserted: Feature[];
  }
  const patchFrom = (replay: boolean, base: readonly Feature[]): Patch | null => {
    const patch = patchBetween(base, target);
    if (patch === null) return null;
    if (!featureListsEqual(applyPatch(base, patch.removed, patch.upserted), target)) return null;
    return { replay, ...patch };
  };
  const patches = [patchFrom(false, before)];
  try {
    patches.push(patchFrom(true, replayFeatures(prev, seq, next.topology)));
  } catch {
    // The edit does not replay on this state (a rotation of a linear one): no patch from it.
  }
  let best: Patch | null = null;
  let bestSize = 16 + featuresSize(target);
  for (const patch of patches) {
    if (patch === null) continue;
    const size = featuresDeltaSize({ kind: 'patch', ...patch });
    if (size < bestSize) {
      best = patch;
      bestSize = size;
    }
  }
  return best === null
    ? { kind: 'list', features: target.map(copyFeature) }
    : {
        kind: 'patch',
        replay: best.replay,
        removed: best.removed,
        upserted: best.upserted.map(copyFeature),
      };
}

// ---------------------------------------------------------------- deltas between states

interface CachedDelta {
  readonly prev: SeqDocument;
  readonly delta: StoredDelta;
  readonly size: number;
}

/** The delta that leads to a state, by the state it leads from; states never change. */
const deltaCache = new WeakMap<SeqDocument, CachedDelta>();

function computeDelta(prev: SeqDocument, next: SeqDocument): StoredDelta {
  const rest: {
    name?: string;
    topology?: Topology;
    metadata?: DocumentMetadata;
    ends?: DocumentEnds | null;
    methylation?: { dam: boolean; dcm: boolean };
    read?: SequencingRead | null;
  } = {};
  if (next.name !== prev.name) rest.name = next.name;
  if (next.topology !== prev.topology) rest.topology = next.topology;
  if (!metadataEqual(prev.metadata, next.metadata)) rest.metadata = copyMetadata(next.metadata);
  if (!endsEqual(prev.ends, next.ends)) rest.ends = copyEnds(next.ends);
  if (!methylationEqual(prev.methylation, next.methylation)) {
    rest.methylation = { dam: next.methylation.dam, dcm: next.methylation.dcm };
  }
  if (next.read !== prev.read) rest.read = next.read;
  const seqs = sequenceDeltas(prev.sequence, next.sequence);
  let best: StoredDelta | null = null;
  let bestSize = Infinity;
  for (const seq of seqs.length === 0 ? [undefined] : seqs) {
    const features = featuresDelta(prev, next, seq);
    const delta: StoredDelta = {
      ...rest,
      ...(seq === undefined ? {} : { sequence: seq }),
      ...(features === undefined ? {} : { features }),
    };
    const size = deltaSize(delta);
    if (size < bestSize) {
      best = delta;
      bestSize = size;
    }
  }
  return best ?? rest;
}

function deltaBetween(prev: SeqDocument, next: SeqDocument): CachedDelta {
  const cached = deltaCache.get(next);
  if (cached?.prev === prev) return cached;
  const delta = computeDelta(prev, next);
  const entry = { prev, delta, size: deltaSize(delta) };
  deltaCache.set(next, entry);
  return entry;
}

function applyDelta(prev: SeqDocument, d: StoredDelta): SeqDocument {
  const topology = d.topology ?? prev.topology;
  const sequence =
    d.sequence === undefined ? prev.sequence : applySequence(prev.sequence, d.sequence);
  let features: FeatureSet;
  const fd = d.features;
  if (fd === undefined) features = prev.features;
  else if (fd.kind === 'list') features = FeatureSet.from(fd.features);
  else {
    const base = fd.replay ? replayFeatures(prev, d.sequence, topology) : prev.features.all();
    features = FeatureSet.from(applyPatch(base, fd.removed, fd.upserted));
  }
  return SeqDocument.create({
    name: d.name ?? prev.name,
    sequence,
    topology,
    features,
    metadata: d.metadata ?? prev.metadata,
    ends: d.ends === undefined ? prev.ends : d.ends,
    read: d.read === undefined ? prev.read : d.read,
    methylation: d.methylation ?? prev.methylation,
  });
}

// ---------------------------------------------------------------- whole states

const stateCache = new WeakMap<SeqDocument, StoredState>();

function storedState(doc: SeqDocument): StoredState {
  const cached = stateCache.get(doc);
  if (cached !== undefined) return cached;
  const state: StoredState = {
    name: doc.name,
    sequence: doc.sequence.toString(),
    topology: doc.topology,
    features: doc.features.all().map(copyFeature),
    metadata: copyMetadata(doc.metadata),
    ends: copyEnds(doc.ends),
    methylation: { dam: doc.methylation.dam, dcm: doc.methylation.dcm },
    read: doc.read,
  };
  stateCache.set(doc, state);
  return state;
}

function stateFrom(s: StoredState): SeqDocument {
  const doc = SeqDocument.create({
    name: s.name,
    sequence: s.sequence,
    topology: s.topology,
    features: s.features,
    metadata: s.metadata,
    ends: s.ends,
    read: s.read,
    methylation: s.methylation,
  });
  stateCache.set(doc, s);
  return doc;
}

// ---------------------------------------------------------------- rows

/**
 * The row for a history, or null when not even the present fits the
 * budget (a genome-sized document), and it is better to keep none.
 *
 * What is kept is the longest window of states that fits: the oldest steps
 * go first, as the History's own limit drops them, which marks the stored
 * copy truncated. Only when every step before the present has gone and it
 * still does not fit are redo steps dropped from the far end. A baseline
 * outside the window (a download older than the oldest kept step) is stored
 * whole and counts against the budget; when that leaves no room even for the
 * present, the baseline is what is left out.
 */
export function encodeHistory(
  id: string,
  input: HistoryToStore,
  budget: number = HISTORY_BUDGET,
  now: number = Date.now(),
): StoredHistory | null {
  // A document too large to keep even as it stands costs nothing more here.
  if (stateSize(input.history.present) > budget) return null;
  const record = input.history.toRecord();
  const { states, steps, position } = record;
  const n = steps.length;
  const deltas: CachedDelta[] = [];
  for (let i = 1; i <= n; i++) {
    const prev = states[i - 1];
    const next = states[i];
    if (prev === undefined || next === undefined) return null;
    deltas.push(deltaBetween(prev, next));
  }
  // prefix[i]: the size of the deltas that lead to states 1..i, with their labels and names.
  const prefix = [0];
  deltas.forEach((d, i) => {
    const step = steps[i];
    prefix.push((prefix[i] ?? 0) + d.size + (step?.label.length ?? 0) + (step?.name?.length ?? 0));
  });
  const within = (doc: SeqDocument, lo: number, hi: number): number => {
    for (let i = lo; i <= hi; i++) if (states[i] === doc) return i;
    return -1;
  };
  /**
   * Every named state, oldest first: those the History already keeps
   * outside its steps, then the named steps. A named step inside the window
   * keeps its name on the step; any other named state goes in `named`, as a
   * reference when it is one of the kept states and whole when it is not.
   */
  const candidates: (NamedState<SeqDocument> & { readonly step: number | null })[] = [
    ...(record.kept ?? []).map((k) => ({ ...k, step: null })),
    ...steps.flatMap((step, i) => {
      const state = states[i + 1];
      return step.name === undefined || state === undefined
        ? []
        : [{ name: step.name, label: step.label, at: step.at, state, step: i + 1 }];
    }),
  ];
  const onStep = (c: { readonly step: number | null }, lo: number, hi: number): boolean =>
    c.step !== null && c.step > lo && c.step <= hi;
  /** What the named states from `drop` on cost outside the steps; the older ones are left out. */
  const namedCost = (lo: number, hi: number, drop: number): number => {
    let size = 0;
    for (let i = drop; i < candidates.length; i++) {
      const c = candidates[i];
      if (c === undefined || onStep(c, lo, hi)) continue;
      size += c.name.length + c.label.length;
      if (within(c.state, lo, hi) === -1) size += stateSize(c.state);
    }
    return size;
  };
  // A baseline outside the window is stored whole when `whole` is set;
  // without it, it is left out (see `landmark`).
  const landmarkCost = (doc: SeqDocument | null, lo: number, hi: number): number =>
    doc === null || doc === input.origin || within(doc, lo, hi) !== -1 ? 0 : stateSize(doc);
  const cost = (lo: number, hi: number, whole: boolean, drop: number): number => {
    const base = states[lo];
    if (base === undefined) return Infinity;
    return (
      stateSize(base) +
      (prefix[hi] ?? 0) -
      (prefix[lo] ?? 0) +
      (whole ? landmarkCost(input.opened, lo, hi) + landmarkCost(input.saved, lo, hi) : 0) +
      namedCost(lo, hi, drop)
    );
  };
  /** The longest window that fits: oldest steps dropped first, then redo steps from the far end. */
  const window = (whole: boolean, drop: number): { lo: number; hi: number } | null => {
    for (let k = 0; k <= position; k++) {
      if (cost(k, n, whole, drop) <= budget) return { lo: k, hi: n };
    }
    for (let m = n; m >= position; m--) {
      if (cost(position, m, whole, drop) <= budget) return { lo: position, hi: m };
    }
    return null;
  };
  // Named states are what a user most wants kept (#4), so they give way
  // last, the oldest first: the baselines are kept whole if that leaves room
  // for the present and every named state, then left out, and only then do
  // named states outside the window go.
  let chosen: { lo: number; hi: number } | null = null;
  let drop = 0;
  for (; drop <= candidates.length && chosen === null; drop++) {
    chosen = window(true, drop) ?? window(false, drop);
  }
  drop -= 1;
  if (chosen === null) return null;
  const { lo, hi } = chosen;
  const whole = cost(lo, hi, true, drop) <= budget;
  /**
   * Where a baseline is. One left out for lack of room comes back as
   * `fallback`: the opened state as the oldest kept one, a download as none.
   */
  const landmark = (doc: SeqDocument | null, fallback: StoredLandmark): StoredLandmark => {
    if (doc === null) return { kind: 'none' };
    const at = within(doc, lo, hi);
    if (at !== -1) return { kind: 'step', position: at - lo };
    if (doc === input.origin) return { kind: 'origin' };
    return whole ? { kind: 'state', state: storedState(doc) } : fallback;
  };
  const base = states[lo];
  if (base === undefined) return null;
  const kept: StoredStep[] = [];
  for (let i = lo; i < hi; i++) {
    const step = steps[i];
    const delta = deltas[i];
    if (step === undefined || delta === undefined) return null;
    kept.push({
      label: step.label,
      at: step.at,
      ...(step.merged === undefined ? {} : { merged: step.merged }),
      ...(step.name === undefined ? {} : { name: step.name }),
      delta: delta.delta,
    });
  }
  const named: StoredNamedState[] = [];
  candidates.forEach((c, i) => {
    if (i < drop || onStep(c, lo, hi)) return;
    const at = within(c.state, lo, hi);
    named.push({
      name: c.name,
      label: c.label,
      at: c.at,
      state:
        at === -1
          ? { kind: 'state', state: storedState(c.state) }
          : { kind: 'step', position: at - lo },
    });
  });
  return {
    id,
    format: HISTORY_FORMAT,
    limit: record.limit,
    // Dropping the oldest steps makes the oldest kept state the start, dated
    // by the change that made it — what `History.push` does past its limit.
    startedAt: lo === 0 ? record.startedAt : (steps[lo - 1]?.at ?? record.startedAt),
    truncated: record.truncated || lo > 0,
    position: position - lo,
    base: storedState(base),
    steps: kept,
    opened: landmark(input.opened, { kind: 'step', position: 0 }),
    saved: landmark(input.saved, { kind: 'none' }),
    ...(named.length === 0 ? {} : { named }),
    updatedAt: now,
  };
}

/**
 * The history a row holds, or null when it is not one this build can read:
 * the wrong shape, a delta that does not apply, a state that does not make a
 * valid document. Never throws. `origin` is the working copy's original as
 * read back beside it, for a baseline that points at it.
 */
export function decodeHistory(row: unknown, origin: SeqDocument | null): RestoredHistory | null {
  if (!isStoredHistory(row)) return null;
  try {
    let prev = stateFrom(row.base);
    const states = [prev];
    const steps: HistoryRecordStep[] = [];
    for (const step of row.steps) {
      const next = applyDelta(prev, step.delta);
      deltaCache.set(next, { prev, delta: step.delta, size: deltaSize(step.delta) });
      states.push(next);
      steps.push({
        label: step.label,
        at: step.at,
        ...(step.merged === undefined ? {} : { merged: step.merged }),
        ...(step.name === undefined ? {} : { name: step.name }),
      });
      prev = next;
    }
    const kept = (row.named ?? []).map((k): NamedState<SeqDocument> => {
      const state = k.state.kind === 'state' ? stateFrom(k.state.state) : states[k.state.position];
      if (state === undefined) throw new RangeError('No such state to name');
      return { name: k.name, label: k.label, at: k.at, state };
    });
    const history = History.fromRecord({
      states,
      steps,
      position: row.position,
      limit: row.limit,
      startedAt: row.startedAt,
      truncated: row.truncated,
      ...(kept.length === 0 ? {} : { kept }),
    });
    const resolve = (l: StoredLandmark): SeqDocument | null | undefined => {
      switch (l.kind) {
        case 'none':
          return null;
        case 'step':
          return history.stateAt(l.position);
        case 'origin':
          return origin ?? undefined;
        case 'state':
          return stateFrom(l.state);
      }
    };
    const opened = resolve(row.opened);
    const saved = resolve(row.saved);
    // A position past the steps, or a baseline on an original that did not
    // come back: the one falls back to where the history starts, the other
    // to "never downloaded", rather than losing the history over it.
    return {
      history,
      opened: opened ?? history.stateAt(0) ?? history.present,
      saved: saved === undefined ? null : saved,
    };
  } catch {
    return null;
  }
}
