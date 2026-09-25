/**
 * File ▸ Open from NCBI… (#65, #92, item 58): GenBank and GenPept records
 * fetched by accession and opened in tabs, as if each had been downloaded
 * from NCBI and opened as a file. Nothing is sent until the user asks, and
 * then only the accessions, to NCBI (`src/io/ncbi/`).
 */

import type { SeqDocument } from '@/core';
import {
  type AccessionKind,
  type AccessionList,
  type FetchRecordsOptions,
  type FetchedRecords,
  MAX_ACCESSIONS,
  NcbiError,
  type ParseWarning,
  fetchRecords,
  parseAccessions,
  parseGenBank,
} from '@/io';

import { analytics } from './analytics';
import { editorStore } from './state/editorStore';

/** Accessions to fetch, each kind from its own database. */
export type NcbiAccessions = Pick<AccessionList, 'nucleotide' | 'protein'>;

export type AccessionCheck =
  | { readonly ok: true; readonly accessions: NcbiAccessions }
  | { readonly ok: false; readonly message: string };

/** What was typed, checked before anything is sent: the accessions, or why not. */
export function checkAccessionInput(input: string): AccessionCheck {
  const { nucleotide, protein, invalid } = parseAccessions(input);
  const [bad] = invalid;
  if (bad !== undefined) {
    return {
      ok: false,
      message: `“${bad.length > 40 ? `${bad.slice(0, 40)}…` : bad}” is not an accession number. They look like L09137, NC_001422, NM_000581.2 or NP_000509.`,
    };
  }
  const count = nucleotide.length + protein.length;
  if (count === 0) return { ok: false, message: 'Type an accession number.' };
  if (count > MAX_ACCESSIONS) {
    return {
      ok: false,
      message: `At most ${MAX_ACCESSIONS.toString()} accessions at a time.`,
    };
  }
  return { ok: true, accessions: { nucleotide, protein } };
}

/** The first accession on a record's ACCESSION line, for its file name. */
function primaryAccession(accession: string): string | null {
  const [first] = accession.trim().split(/\s+/);
  return first === undefined || first === '' ? null : first;
}

type Missing = readonly (readonly [AccessionKind, readonly string[]])[];

/** "NCBI has no nucleotide record A and no protein record B, C." */
function missingMessage(missing: Missing): string {
  const parts = missing
    .filter(([, list]) => list.length > 0)
    .map(([kind, list]) => `${kind} record ${list.join(', ')}`);
  return `NCBI has no ${parts.join(' and no ')}.`;
}

interface Fetched {
  readonly kind: AccessionKind;
  readonly got: FetchedRecords;
}

interface Failed {
  readonly kind: AccessionKind;
  readonly accessions: readonly string[];
  readonly error: NcbiError;
}

/**
 * Fetches the records and opens each in a tab of its own, the last in front,
 * returning their ids: one request for each kind typed, nucleotide records
 * first and then proteins. Accessions NCBI had no record for, and a kind
 * whose request failed while the other's came back, are named in a warning
 * on the tab in front. Throws `NcbiError` when there is nothing to open, and
 * passes a cancel through as the AbortError `fetch` gives, opening nothing.
 */
export async function openFromNcbi(
  accessions: NcbiAccessions,
  options: FetchRecordsOptions = {},
): Promise<readonly string[]> {
  const fetched: Fetched[] = [];
  const failed: Failed[] = [];
  const { onProgress } = options;
  let before = 0;
  for (const kind of ['nucleotide', 'protein'] as const) {
    const list = accessions[kind];
    if (list.length === 0) continue;
    let received = 0;
    const offset = before;
    try {
      const got = await fetchRecords(kind, list, {
        ...options,
        // Bytes across both requests, rather than starting again at the second.
        onProgress: (bytes) => {
          received = bytes;
          onProgress?.(offset + bytes);
        },
      });
      fetched.push({ kind, got });
    } catch (e) {
      if (!(e instanceof NcbiError)) throw e;
      analytics.track('file', 'open-ncbi-failed', e.kind);
      failed.push({ kind, accessions: list, error: e });
    }
    before = offset + received;
  }

  if (fetched.length === 0) {
    const [first] = failed;
    if (first === undefined) throw new NcbiError('not-found', 'Type an accession number.');
    // Neither kind was found: say so of both. Otherwise the error that is not "none found".
    if (failed.every((f) => f.error.kind === 'not-found') && failed.length > 1) {
      throw new NcbiError('not-found', missingMessage(failed.map((f) => [f.kind, f.accessions])));
    }
    throw (failed.find((f) => f.error.kind !== 'not-found') ?? first).error;
  }

  const documents: SeqDocument[] = [];
  const warnings: ParseWarning[] = [];
  for (const { got } of fetched) {
    try {
      const parsed = parseGenBank(got.text);
      documents.push(...parsed.documents);
      warnings.push(...parsed.warnings);
    } catch (e) {
      analytics.track('file', 'open-ncbi-failed', 'not-genbank');
      throw new NcbiError(
        'not-genbank',
        `NCBI's record could not be read: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  analytics.track('file', 'open-ncbi');

  const missing: Missing = [
    ...fetched.map((f) => [f.kind, f.got.missing] as const),
    ...failed
      .filter((f) => f.error.kind === 'not-found')
      .map((f) => [f.kind, f.accessions] as const),
  ].filter(([, list]) => list.length > 0);
  if (missing.length > 0) warnings.push({ message: missingMessage(missing) });
  for (const f of failed) {
    if (f.error.kind !== 'not-found') {
      warnings.push({ message: `${f.accessions.join(', ')} not opened: ${f.error.message}` });
    }
  }

  const ids: string[] = [];
  documents.forEach((doc, i) => {
    const last = i === documents.length - 1;
    // No file on the user's disk stands behind it, so there is no origin to
    // protect (like the bundled example); the name is what a download offers
    // and what opening the same accession again finds its tab by.
    const extension = doc.alphabet === 'protein' ? 'gp' : 'gb';
    const id = editorStore.openParsed(
      { format: 'genbank', documents: [doc], warnings: last ? warnings : [] },
      `${primaryAccession(doc.metadata.accession) ?? doc.name}.${extension}`,
      { origin: null },
    );
    if (id !== null) ids.push(id);
  });
  return ids;
}
