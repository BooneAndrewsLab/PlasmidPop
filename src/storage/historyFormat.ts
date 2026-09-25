import {
  type DocumentEnds,
  type DocumentMetadata,
  type Feature,
  type HostMethylationState,
  type Segment,
  type SequencingRead,
  type StrandEnd,
  type Topology,
} from '@/core';

/**
 * How a document's undo history is kept in IndexedDB (item 51,
 * `docs/design/51-persistent-history.md`): the oldest kept state in full,
 * then each later state as what changed from the one before it.
 *
 * Everything here is plain data IndexedDB can clone — strings, numbers,
 * plain objects and a read's typed arrays — written by `historyCodec.ts`
 * through explicit copies and checked field by field on the way back in by
 * `isStoredHistory`, since a row may have been written by another build or
 * have gone bad. A row that fails the check is dropped, never trusted.
 */

/** Bumped whenever the row changes shape; a row of another format is dropped. */
export const HISTORY_FORMAT = 1;

/**
 * How the bases changed between two states.
 *
 * - `splice`: `deleted` bases at `start` gave way to `text` — typing, a
 *   paste, a delete, a replace: whatever the common prefix and suffix of the
 *   two sequences leave between them.
 * - `reverseComplement`: the whole sequence turned over, which as a splice
 *   would be the whole sequence again.
 * - `rotate`: base `origin` became base 0 (Set origin), likewise.
 */
export type StoredSequenceDelta =
  | {
      readonly kind: 'splice';
      readonly start: number;
      readonly deleted: number;
      readonly text: string;
    }
  | { readonly kind: 'reverseComplement' }
  | { readonly kind: 'rotate'; readonly origin: number };

/**
 * How the features changed.
 *
 * - `patch`: start from the previous state's features — moved as the
 *   sequence change moves them, when `replay` is set — drop `removed`,
 *   swap in the `upserted` ones that share an id with a feature there and
 *   append the rest, in order. An edit of the bases shifts every feature
 *   after it; replaying the edit is what keeps that from being a copy of
 *   the whole list.
 * - `list`: the whole list, when a patch would not be smaller.
 */
export type StoredFeaturesDelta =
  | {
      readonly kind: 'patch';
      readonly replay: boolean;
      readonly removed: readonly string[];
      readonly upserted: readonly Feature[];
    }
  | { readonly kind: 'list'; readonly features: readonly Feature[] };

/** What differs from the state before; a field left out is as it was. */
export interface StoredDelta {
  readonly sequence?: StoredSequenceDelta;
  readonly features?: StoredFeaturesDelta;
  readonly name?: string;
  readonly topology?: Topology;
  readonly metadata?: DocumentMetadata;
  readonly ends?: DocumentEnds | null;
  readonly methylation?: HostMethylationState;
  readonly read?: SequencingRead | null;
}

/** A whole document state, for the oldest kept one and for a baseline outside the steps. */
export interface StoredState {
  readonly name: string;
  readonly sequence: string;
  readonly topology: Topology;
  readonly features: readonly Feature[];
  readonly metadata: DocumentMetadata;
  readonly ends: DocumentEnds | null;
  readonly methylation: HostMethylationState;
  readonly read: SequencingRead | null;
}

export interface StoredStep {
  readonly label: string;
  readonly at: number;
  readonly merged?: number;
  /** From the state before this step to the one it leads to. */
  readonly delta: StoredDelta;
}

/**
 * Where a baseline of the Edits menu is: none, one of the kept states, the
 * file a working copy came from (stored beside the document already), or a
 * state of its own when it is none of those.
 */
export type StoredLandmark =
  | { readonly kind: 'none' }
  | { readonly kind: 'step'; readonly position: number }
  | { readonly kind: 'origin' }
  | { readonly kind: 'state'; readonly state: StoredState };

/** One row of the `histories` table, keyed by the document's id. */
export interface StoredHistory {
  readonly id: string;
  readonly format: typeof HISTORY_FORMAT;
  readonly limit: number;
  readonly startedAt: number;
  readonly truncated: boolean;
  /** How many steps are applied; the rest are undone and can be redone. */
  readonly position: number;
  /** The oldest kept state, step 0. */
  readonly base: StoredState;
  readonly steps: readonly StoredStep[];
  /** What **Since opened** measures from. */
  readonly opened: StoredLandmark;
  /** The version last downloaded (or read from a file), for the dot and **Since last download**. */
  readonly saved: StoredLandmark;
  readonly updatedAt: number;
}

// ---------------------------------------------------------------- checking

type Fields = Record<string, unknown>;

function isObject(v: unknown): v is Fields {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function isTime(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isArrayOf<T>(v: unknown, item: (x: unknown) => x is T): v is readonly T[] {
  return Array.isArray(v) && v.every(item);
}

function isTopology(v: unknown): v is Topology {
  return v === 'linear' || v === 'circular';
}

function isSegment(v: unknown): v is Segment {
  if (!isObject(v)) return false;
  if (v['kind'] === 'site') return isCount(v['position']);
  return (
    v['kind'] === 'range' &&
    isCount(v['start']) &&
    isCount(v['end']) &&
    typeof v['partialStart'] === 'boolean' &&
    typeof v['partialEnd'] === 'boolean'
  );
}

function isQualifier(v: unknown): boolean {
  return isObject(v) && isString(v['name']) && (v['value'] === null || isString(v['value']));
}

export function isStoredFeature(v: unknown): v is Feature {
  return (
    isObject(v) &&
    isString(v['id']) &&
    isString(v['type']) &&
    isString(v['name']) &&
    (v['strand'] === 'forward' || v['strand'] === 'reverse') &&
    Array.isArray(v['segments']) &&
    v['segments'].length > 0 &&
    v['segments'].every(isSegment) &&
    Array.isArray(v['qualifiers']) &&
    v['qualifiers'].every(isQualifier)
  );
}

const METADATA_STRINGS = [
  'description',
  'accession',
  'version',
  'keywords',
  'source',
  'organism',
  'taxonomy',
  'moleculeType',
  'division',
  'date',
] as const;

const REFERENCE_STRINGS = [
  'location',
  'authors',
  'consortium',
  'title',
  'journal',
  'pubmed',
  'remark',
] as const;

function isReference(v: unknown): boolean {
  return (
    isObject(v) && typeof v['number'] === 'number' && REFERENCE_STRINGS.every((k) => isString(v[k]))
  );
}

function isHeaderEntry(v: unknown): boolean {
  return isObject(v) && isString(v['keyword']) && isString(v['value']);
}

function isMetadata(v: unknown): v is DocumentMetadata {
  if (!isObject(v)) return false;
  const derived = v['derivedFrom'];
  return (
    METADATA_STRINGS.every((k) => isString(v[k])) &&
    isArrayOf(v['dbLinks'], isString) &&
    Array.isArray(v['references']) &&
    v['references'].every(isReference) &&
    isArrayOf(v['comments'], isString) &&
    Array.isArray(v['extraHeaders']) &&
    v['extraHeaders'].every(isHeaderEntry) &&
    (derived === null ||
      (isObject(derived) && isString(derived['checksum']) && isString(derived['fileName'])))
  );
}

function isStrandEnd(v: unknown): v is StrandEnd {
  return (
    isObject(v) &&
    (v['kind'] === 'blunt' || v['kind'] === "5'" || v['kind'] === "3'") &&
    isString(v['overhang']) &&
    (v['enzyme'] === null || isString(v['enzyme']))
  );
}

function isEnds(v: unknown): v is DocumentEnds | null {
  return v === null || (isObject(v) && isStrandEnd(v['left']) && isStrandEnd(v['right']));
}

function isMethylation(v: unknown): v is HostMethylationState {
  return isObject(v) && typeof v['dam'] === 'boolean' && typeof v['dcm'] === 'boolean';
}

/** The shape of a read; whether it fits the bases is `SeqDocument.create`'s check. */
function isRead(v: unknown): v is SequencingRead | null {
  if (v === null) return true;
  if (!isObject(v) || !(v['qualities'] instanceof Uint8Array)) return false;
  const trace = v['trace'];
  if (trace === null) return true;
  if (!isObject(trace) || !(trace['peaks'] instanceof Int32Array)) return false;
  const channels = trace['channels'];
  return (
    isObject(channels) && ['A', 'C', 'G', 'T'].every((base) => channels[base] instanceof Int16Array)
  );
}

function isSequenceDelta(v: unknown): v is StoredSequenceDelta {
  if (!isObject(v)) return false;
  switch (v['kind']) {
    case 'splice':
      return isCount(v['start']) && isCount(v['deleted']) && isString(v['text']);
    case 'reverseComplement':
      return true;
    case 'rotate':
      return isCount(v['origin']);
    default:
      return false;
  }
}

function isFeaturesDelta(v: unknown): v is StoredFeaturesDelta {
  if (!isObject(v)) return false;
  if (v['kind'] === 'list') return isArrayOf(v['features'], isStoredFeature);
  return (
    v['kind'] === 'patch' &&
    typeof v['replay'] === 'boolean' &&
    isArrayOf(v['removed'], isString) &&
    isArrayOf(v['upserted'], isStoredFeature)
  );
}

/** Each field optional, and of its type when present. */
function isDelta(v: unknown): v is StoredDelta {
  if (!isObject(v)) return false;
  const has = (k: string): boolean => k in v;
  return (
    (!has('sequence') || isSequenceDelta(v['sequence'])) &&
    (!has('features') || isFeaturesDelta(v['features'])) &&
    (!has('name') || isString(v['name'])) &&
    (!has('topology') || isTopology(v['topology'])) &&
    (!has('metadata') || isMetadata(v['metadata'])) &&
    (!has('ends') || isEnds(v['ends'])) &&
    (!has('methylation') || isMethylation(v['methylation'])) &&
    (!has('read') || isRead(v['read']))
  );
}

function isState(v: unknown): v is StoredState {
  return (
    isObject(v) &&
    isString(v['name']) &&
    isString(v['sequence']) &&
    isTopology(v['topology']) &&
    isArrayOf(v['features'], isStoredFeature) &&
    isMetadata(v['metadata']) &&
    isEnds(v['ends']) &&
    isMethylation(v['methylation']) &&
    isRead(v['read'])
  );
}

function isStep(v: unknown): v is StoredStep {
  return (
    isObject(v) &&
    isString(v['label']) &&
    isTime(v['at']) &&
    (v['merged'] === undefined || (isCount(v['merged']) && v['merged'] >= 1)) &&
    isDelta(v['delta'])
  );
}

function isLandmark(v: unknown): v is StoredLandmark {
  if (!isObject(v)) return false;
  switch (v['kind']) {
    case 'none':
    case 'origin':
      return true;
    case 'step':
      return isCount(v['position']);
    case 'state':
      return isState(v['state']);
    default:
      return false;
  }
}

/** Whether `v` is a history row of this format, down to the last field. */
export function isStoredHistory(v: unknown): v is StoredHistory {
  return (
    isObject(v) &&
    isString(v['id']) &&
    v['format'] === HISTORY_FORMAT &&
    isCount(v['limit']) &&
    isTime(v['startedAt']) &&
    typeof v['truncated'] === 'boolean' &&
    isCount(v['position']) &&
    isState(v['base']) &&
    isArrayOf(v['steps'], isStep) &&
    isLandmark(v['opened']) &&
    isLandmark(v['saved']) &&
    isTime(v['updatedAt'])
  );
}
