/**
 * File ▸ Open from NCBI… (#65, item 58): GenBank records fetched by
 * accession and opened in tabs, as if each had been downloaded from NCBI and
 * opened as a file. Nothing is sent until the user asks, and then only the
 * accessions, to NCBI (`src/io/ncbi/`).
 */

import {
  type FetchRecordsOptions,
  MAX_ACCESSIONS,
  NcbiError,
  type ParseWarning,
  fetchNucleotideRecords,
  parseAccessions,
  parseGenBank,
} from '@/io';

import { analytics } from './analytics';
import { editorStore } from './state/editorStore';

export type AccessionCheck =
  | { readonly ok: true; readonly accessions: readonly string[] }
  | { readonly ok: false; readonly message: string };

/** What was typed, checked before anything is sent: the accessions, or why not. */
export function checkAccessionInput(input: string): AccessionCheck {
  const { nucleotide, protein, invalid } = parseAccessions(input);
  const [bad] = invalid;
  if (bad !== undefined) {
    return {
      ok: false,
      message: `“${bad.length > 40 ? `${bad.slice(0, 40)}…` : bad}” is not an accession number. They look like L09137, NC_001422 or NM_000581.2.`,
    };
  }
  const [aa] = protein;
  if (aa !== undefined) {
    return {
      ok: false,
      message: `${aa} is a protein accession. PlasmidPop opens nucleotide records only.`,
    };
  }
  if (nucleotide.length === 0) return { ok: false, message: 'Type an accession number.' };
  if (nucleotide.length > MAX_ACCESSIONS) {
    return {
      ok: false,
      message: `At most ${MAX_ACCESSIONS.toString()} accessions at a time.`,
    };
  }
  return { ok: true, accessions: nucleotide };
}

/** The first accession on a record's ACCESSION line, for its file name. */
function primaryAccession(accession: string): string | null {
  const [first] = accession.trim().split(/\s+/);
  return first === undefined || first === '' ? null : first;
}

/**
 * Fetches the records and opens each in a tab of its own, the last in front,
 * returning their ids. Accessions NCBI had no record for are named in a
 * warning on the one in front. Throws `NcbiError` when there is nothing to
 * open, and passes a cancel through as the AbortError `fetch` gives.
 */
export async function openFromNcbi(
  accessions: readonly string[],
  options: FetchRecordsOptions = {},
): Promise<readonly string[]> {
  let text: string;
  let missing: readonly string[];
  try {
    ({ text, missing } = await fetchNucleotideRecords(accessions, options));
  } catch (e) {
    if (e instanceof NcbiError) analytics.track('file', 'open-ncbi-failed', e.kind);
    throw e;
  }
  let documents;
  let warnings: readonly ParseWarning[];
  try {
    ({ documents, warnings } = parseGenBank(text));
  } catch (e) {
    analytics.track('file', 'open-ncbi-failed', 'not-genbank');
    throw new NcbiError(
      'not-genbank',
      `NCBI's record could not be read: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  analytics.track('file', 'open-ncbi');
  const notFound: ParseWarning[] =
    missing.length === 0
      ? []
      : [{ message: `NCBI has no nucleotide record ${missing.join(', ')}.` }];
  const ids: string[] = [];
  documents.forEach((doc, i) => {
    const last = i === documents.length - 1;
    // No file on the user's disk stands behind it, so there is no origin to
    // protect (like the bundled example); the name is what a download offers
    // and what opening the same accession again finds its tab by.
    const id = editorStore.openParsed(
      { format: 'genbank', documents: [doc], warnings: last ? [...warnings, ...notFound] : [] },
      `${primaryAccession(doc.metadata.accession) ?? doc.name}.gb`,
      { origin: null },
    );
    if (id !== null) ids.push(id);
  });
  return ids;
}
