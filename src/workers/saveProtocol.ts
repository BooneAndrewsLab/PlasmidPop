import {
  type Alphabet,
  type DocumentEnds,
  type DocumentMetadata,
  type Feature,
  type HostMethylationState,
  type StyleRun,
  type Topology,
  SeqDocument,
} from '@/core';

/**
 * What the save worker (#272) is asked and answers. It writes the GenBank
 * text the autosave stores, which at a megabase is 30 ms of the main
 * thread and at a genome over 100 ms. Everything else of a save stays where
 * it was: the history row is worked out on the main thread, which has its
 * states and remembers their deltas, and the IndexedDB write is Dexie's
 * there (design note 103).
 */

/**
 * A document as it crosses to the worker: everything `writeGenBank` reads,
 * and nothing it does not (the sequencing read stays behind). The bases are
 * one string, which the structured clone copies as a block; the rest is one
 * JSON string, because a clone of the feature objects themselves costs the
 * main thread four times what `JSON.stringify` does (1,000 features with
 * two qualifiers each: 7.8 ms against 1.7 ms, `docs/perf-notes.md`).
 */
export interface DocumentSnapshot {
  readonly sequence: string;
  /** `SnapshotRest` as JSON. */
  readonly rest: string;
}

interface SnapshotRest {
  readonly name: string;
  readonly topology: Topology;
  readonly alphabet: Alphabet;
  readonly features: readonly Feature[];
  readonly metadata: DocumentMetadata;
  readonly ends: DocumentEnds | null;
  readonly methylation: HostMethylationState;
  readonly styles: readonly StyleRun[];
}

export function snapshotOf(doc: SeqDocument): DocumentSnapshot {
  const rest: SnapshotRest = {
    name: doc.name,
    topology: doc.topology,
    alphabet: doc.alphabet,
    features: doc.features.all(),
    metadata: doc.metadata,
    ends: doc.ends,
    methylation: doc.methylation,
    styles: doc.styles.runs,
  };
  return { sequence: doc.sequence.toString(), rest: JSON.stringify(rest) };
}

/** The document a snapshot was taken of, as far as `writeGenBank` can tell. */
export function documentOf(snapshot: DocumentSnapshot): SeqDocument {
  const rest = JSON.parse(snapshot.rest) as SnapshotRest;
  return SeqDocument.create({ ...rest, sequence: snapshot.sequence });
}

export interface SaveRequest {
  readonly id: number;
  readonly kind: 'genbank';
  readonly docs: readonly DocumentSnapshot[];
}

export type SaveResponse =
  | { readonly id: number; readonly kind: 'genbank'; readonly texts: readonly string[] }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };
