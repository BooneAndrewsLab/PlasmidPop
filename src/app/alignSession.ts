import type { AlignmentMode, Assembly } from '@/core';

import type { SampleFeatures } from './alignmentSampleTrack';
import { EMPTY_RECORD_BOX, type RecordBoxState } from './components/useRecordBox';
import { createDocumentSession } from './state/documentSession';
import type { ReadAlignment, ReferenceInput } from './readAlignment';
import type { BatchRow } from './readBatch';

/*
 * What the Align tab holds, per document (item 129): the box, the options
 * and the results, shared by the slim panel and the Align workspace, which
 * are never mounted at once. Outside React and outside the panel memory
 * (`panelMemory.ts`) on purpose: an alignment runs in the worker and ends
 * while the panel that started it may have given way to the workspace, or
 * neither may be on screen, and its result has to land somewhere a React
 * setter of an unmounted component cannot put it. The store below is that
 * place; the hooks read it with `useSyncExternalStore`.
 */

/** Every record aligned at once (#59): the rows so far, and how many were asked for. */
export interface AlignBatch {
  readonly rows: readonly BatchRow[];
  readonly total: number;
  readonly cancelled: boolean;
  readonly reference: ReferenceInput;
  /** Each record's own features, by its index, for the large view's rows (#128). */
  readonly features: readonly { readonly features?: SampleFeatures }[];
}

/** An alignment on screen, and which of the two the document was. */
export interface ShownAlignment extends ReadAlignment {
  /**
   * Set when the document was the read and the box's record the reference
   * (#57): the record's name, for the positions named beside the read's.
   */
  readonly docIsRead: { readonly referenceName: string } | null;
  /** What it was aligned to, for the large view (#103). */
  readonly reference: ReferenceInput;
  /** The sample's own features for its row in the large view (#128): the record's, or the document's when it is the read. */
  readonly sampleFeatures: { readonly features?: SampleFeatures };
}

/** Records assembled into contigs (#208), with the names of the reads it was made from. */
export interface ShownAssembly {
  readonly assembly: Assembly;
  readonly names: readonly string[];
}

export interface AlignSession {
  readonly box: RecordBoxState;
  /** The record picked in the box, or -1 for all of them (#59). */
  readonly picked: number;
  readonly trim: boolean;
  /** The insert size typed for the Assemble page's read pairs (#347), as typed; blank when not known. */
  readonly insertSize: string;
  /**
   * The mode picked by hand, kept whatever the box then holds; null until
   * then, for the one `suggestAlignMode` gives (#86).
   */
  readonly pickedMode: AlignmentMode | null;
  readonly useSelection: boolean;
  /** Whether a document that is itself a read is aligned as the read (#57). */
  readonly docAsRead: boolean;
  readonly busy: boolean;
  /** Fraction of the running alignment done; null until it first reports. */
  readonly progress: number | null;
  readonly error: string | null;
  readonly result: ShownAlignment | null;
  /** Counts results, so each new one is drawn afresh (no focus, the trace shown). */
  readonly resultKey: number;
  /** The options the result on screen was aligned with; a change of either marks it stale (#117). */
  readonly alignedWith: string | null;
  readonly batch: AlignBatch | null;
  /** The file index of the batch row whose alignment is shown. */
  readonly batchPicked: number | null;
  readonly assembly: ShownAssembly | null;
}

export const INITIAL_SESSION: AlignSession = {
  box: EMPTY_RECORD_BOX,
  picked: 0,
  trim: true,
  insertSize: '',
  pickedMode: null,
  useSelection: false,
  docAsRead: true,
  busy: false,
  progress: null,
  error: null,
  result: null,
  resultKey: 0,
  alignedWith: null,
  batch: null,
  batchPicked: null,
  assembly: null,
};

const session = createDocumentSession<AlignSession>(INITIAL_SESSION);
/** The alignment running for a document, so a Cancel or a leave can stop it. */
const running = new Map<string, AbortController>();

function keyOf(documentId: string | null): string {
  return documentId ?? '';
}

export const readAlignSession = session.read;
export const updateAlignSession = session.update;
/** The session of the document in front, live. */
export const useAlignSession = session.use;

/** Starts a run for the document, stopping any earlier one; the controller is the run's. */
export function beginAlignRun(documentId: string | null): AbortController {
  const key = keyOf(documentId);
  running.get(key)?.abort();
  const controller = new AbortController();
  running.set(key, controller);
  return controller;
}

/** Forgets the run when it is the one that ended. */
export function endAlignRun(documentId: string | null, controller: AbortController): void {
  const key = keyOf(documentId);
  if (running.get(key) === controller) running.delete(key);
}

export function cancelAlignRun(documentId: string | null): void {
  running.get(keyOf(documentId))?.abort();
}

export function alignRunActive(documentId: string | null): boolean {
  return running.has(keyOf(documentId));
}

/** Forgets every session and stops every run, for tests. */
export function forgetAlignSessions(): void {
  for (const c of running.values()) c.abort();
  running.clear();
  session.forget();
}
