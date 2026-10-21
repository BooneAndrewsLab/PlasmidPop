import { useEffect, useState } from 'react';

import {
  type SeqDocument,
  type Seguid,
  describeMolecule,
  documentChecksum,
  knownChecksum,
  rememberChecksum,
} from '@/core';
import { analysisClient } from '@/workers/analysisClient';

/**
 * From this many residues on, the checksum is taken in the analysis worker
 * rather than inline (#270). Below it the digest is under 6 ms on the main
 * thread and the status bar shows it in the document's first paint; the
 * worker's round trip costs the main thread well under a millisecond at any
 * size, but it puts the checksum a frame or more behind the paint and costs
 * a render of its own when it lands, which is more than the digest of a
 * plasmid. The measurements are in `docs/perf-notes.md`.
 */
export const WORKER_CHECKSUM_FROM = 50_000;

/**
 * How long a document that follows another within this time has to stay in
 * front before the worker is asked for its checksum. Every keystroke in a
 * large document is a new document, and a request the worker has taken
 * cannot be called back; this is the beat the restriction scan waits
 * (`useAnalysis`). A document opened into a quiet status bar is asked for
 * at once.
 */
export const CHECKSUM_DEBOUNCE_MS = 150;

const pending = new WeakMap<SeqDocument, Promise<Seguid | null>>();

/** True for a beat after a request was sent, so the next waits its own. */
let askedLately = false;

/**
 * `documentChecksum`, off the main thread for a large document (#270). The
 * answer is kept with the document (`rememberChecksum`), so the autosave,
 * the lineage and `Compare with…`, which take the checksum synchronously,
 * find it there. One request per document object, however often it is asked.
 */
export function documentChecksumLater(doc: SeqDocument): Promise<Seguid | null> {
  const known = knownChecksum(doc);
  if (known !== undefined) return Promise.resolve(known);
  if (doc.length < WORKER_CHECKSUM_FROM) return Promise.resolve(documentChecksum(doc));
  const inFlight = pending.get(doc);
  if (inFlight !== undefined) return inFlight;
  const request = analysisClient
    .checksum(describeMolecule(doc))
    .then((checksum) => {
      rememberChecksum(doc, checksum);
      return documentChecksum(doc);
    })
    .catch(() => documentChecksum(doc))
    .finally(() => {
      pending.delete(doc);
    });
  pending.set(doc, request);
  return request;
}

/**
 * The checksum of `doc` for a component to show: the value when it is
 * known, null for no document or an empty one, and undefined while the
 * worker is still at it. A small document's is taken inline in the render,
 * so it is never undefined; a large document's arrives a round trip later
 * (a beat more when it followed another large one within the beat), and an
 * answer for a document that has been replaced in the meantime is dropped
 * rather than shown against the new one.
 */
export function useDocumentChecksum(doc: SeqDocument | null): Seguid | null | undefined {
  const now = doc === null ? null : (knownChecksum(doc) ?? inlineChecksum(doc));
  const [later, setLater] = useState<{ doc: SeqDocument; checksum: Seguid | null } | null>(null);
  useEffect(() => {
    if (doc === null || now !== undefined) return;
    let current = true;
    const timer = setTimeout(
      () => {
        askedLately = true;
        setTimeout(() => {
          askedLately = false;
        }, CHECKSUM_DEBOUNCE_MS);
        void documentChecksumLater(doc).then((checksum) => {
          if (current) setLater({ doc, checksum });
        });
      },
      askedLately ? CHECKSUM_DEBOUNCE_MS : 0,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [doc, now]);
  if (now !== undefined) return now;
  return later?.doc === doc ? later.checksum : undefined;
}

/** The checksum inline when the document is small enough to take it in a render. */
function inlineChecksum(doc: SeqDocument): Seguid | null | undefined {
  return doc.length < WORKER_CHECKSUM_FROM ? documentChecksum(doc) : undefined;
}
