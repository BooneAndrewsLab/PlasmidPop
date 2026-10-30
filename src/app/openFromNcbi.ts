/**
 * File ▸ Open from NCBI… (#65, #92, item 58; #299 for genes and ranges):
 * GenBank and GenPept records fetched by accession, a stretch of one record
 * by range, or a gene by name and organism with flanks, opened in tabs as
 * if each had been downloaded from NCBI and opened as a file. Nothing is
 * sent until the user asks, and then only the accessions — or, for a gene,
 * the name and organism typed — to NCBI (`src/io/ncbi/`).
 *
 * Fetching (`fetchAccessions`, `fetchRegionFromNcbi`, `fetchGeneFromNcbi`)
 * gives an `NcbiFetched`; `openFetched` puts it in tabs. The two are apart
 * so a host that wants the record for something else — the primer
 * workspace's design target (item 107) — takes the first without the
 * second.
 */

import {
  type Feature,
  type SeqDocument,
  extractRange,
  featureExtent,
  firstQualifier,
  range,
} from '@/core';
import {
  type AccessionKind,
  type AccessionList,
  type FetchRecordsOptions,
  type FetchedRecords,
  type Flanks,
  type GeneHit,
  MAX_ACCESSIONS,
  NcbiError,
  type ParseWarning,
  type Region,
  accessionKind,
  fetchRecords,
  fetchRegion,
  geneWindow,
  parseAccessions,
  parseGenBank,
  refSeqGeneUid,
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

/**
 * A range typed into the accession box, `NC_000017.11:7668421-7687490`
 * (1-based, inclusive, as NCBI shows positions; `..` works too), or null
 * when the text is not one. Only a nucleotide accession can have a range.
 */
export function parseRegionInput(input: string): Omit<Region, 'strand'> | null {
  const m = /^\s*([A-Za-z0-9_.]+)\s*:\s*(\d+)\s*(?:-|–|\.\.)\s*(\d+)\s*$/.exec(input);
  if (m === null) return null;
  const accession = (m[1] ?? '').toUpperCase();
  if (accessionKind(accession) !== 'nucleotide') return null;
  const a = Number(m[2]);
  const b = Number(m[3]);
  return { accession, start: Math.min(a, b), stop: Math.max(a, b) };
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

/** Where a fetch came from, for the host and for the file names. */
export type NcbiSource =
  | { readonly kind: 'accession' }
  | { readonly kind: 'region'; readonly region: Region }
  | { readonly kind: 'gene'; readonly gene: GeneHit; readonly region: Region };

/**
 * Which record a gene is cut from: its RefSeqGene record where NCBI has one
 * (else the chromosome), or the chromosome always (#326).
 */
export type GeneRecord = 'refseqgene' | 'chromosome';

/** What a fetch gave: the documents to open, with the warnings to show on the last. */
export interface NcbiFetched {
  readonly documents: readonly SeqDocument[];
  readonly warnings: readonly ParseWarning[];
  readonly source: NcbiSource;
  /** The file name each document opens under; what Recent files shows. */
  readonly fileName: (doc: SeqDocument) => string;
}

/**
 * Fetches the records: one request for each kind typed, nucleotide records
 * first and then proteins. Accessions NCBI had no record for, and a kind
 * whose request failed while the other's came back, are named in a warning.
 * Throws `NcbiError` when there is nothing to open, and passes a cancel
 * through as the AbortError `fetch` gives.
 */
export async function fetchAccessions(
  accessions: NcbiAccessions,
  options: FetchRecordsOptions = {},
): Promise<NcbiFetched> {
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
    const parsed = parseRecord(got.text);
    documents.push(...parsed.documents);
    warnings.push(...parsed.warnings);
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
  return {
    documents,
    warnings,
    source: { kind: 'accession' },
    fileName: (doc) =>
      `${primaryAccession(doc.metadata.accession) ?? doc.name}.${doc.alphabet === 'protein' ? 'gp' : 'gb'}`,
  };
}

/** NCBI's text through `parseGenBank`, an unreadable answer counted and reported as such. */
function parseRecord(text: string): { documents: SeqDocument[]; warnings: ParseWarning[] } {
  try {
    const parsed = parseGenBank(text);
    return { documents: [...parsed.documents], warnings: [...parsed.warnings] };
  } catch (e) {
    analytics.track('file', 'open-ncbi-failed', 'not-genbank');
    throw new NcbiError(
      'not-genbank',
      `NCBI's record could not be read: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** A failure of one request, counted by its kind and rethrown. */
function counted(e: unknown): never {
  if (e instanceof NcbiError) analytics.track('file', 'open-ncbi-failed', e.kind);
  throw e;
}

/** "NC_000017.11:7668421-7687490", the name a stretch of a record goes by. */
export function regionName(region: Pick<Region, 'accession' | 'start' | 'stop'>): string {
  return `${region.accession}:${region.start.toString()}-${region.stop.toString()}`;
}

/** The warning when a flank was cut short at an end of the record, or null when neither was. */
function cutShortWarning(asked: Flanks, cut: Flanks, accession: string): ParseWarning | null {
  const parts: string[] = [];
  for (const side of ['upstream', 'downstream'] as const) {
    if (cut[side] > 0) {
      parts.push(
        `the ${side} flank is ${(asked[side] - cut[side]).toLocaleString('en-US')} bp, not ${asked[side].toLocaleString('en-US')}`,
      );
    }
  }
  if (parts.length === 0) return null;
  return { message: `${accession} ends there: ${parts.join('; ')}.` };
}

/**
 * How much of the asked flanks NCBI's answer lacks at the far end, where
 * it clips without a word: the window was `region`, the answer `sent`.
 */
function clippedAtEnd(region: Region, sent: { start: number; stop: number }): Flanks {
  const lost = Math.max(0, region.stop - sent.stop);
  // The far (high-coordinate) end is downstream of a forward gene, upstream of a reverse one.
  return region.strand === 'reverse'
    ? { upstream: lost, downstream: 0 }
    : { upstream: 0, downstream: lost };
}

function addFlanks(a: Flanks, b: Flanks): Flanks {
  return { upstream: a.upstream + b.upstream, downstream: a.downstream + b.downstream };
}

/**
 * A stretch of a nucleotide record, plus flanks: the flanks are added on
 * either side along the forward strand (upstream is the lower
 * coordinates), and the stretch is fetched reverse-complemented when
 * `reverseComplement`. The document is named `NC_000017.11:7668421-7687490`
 * after what NCBI actually sent, which its ACCESSION line also carries.
 */
export async function fetchRegionFromNcbi(
  asked: Omit<Region, 'strand'>,
  flanks: Flanks,
  reverseComplement: boolean,
  options: FetchRecordsOptions = {},
): Promise<NcbiFetched> {
  const start = Math.max(1, asked.start - flanks.upstream);
  const cutStart = flanks.upstream - (asked.start - start);
  const region: Region = {
    accession: asked.accession,
    start,
    stop: asked.stop + flanks.downstream,
    strand: reverseComplement ? 'reverse' : 'forward',
  };
  const got = await fetchRegion(region, options).catch(counted);
  const parsed = parseRecord(got.text);
  const [doc] = parsed.documents;
  if (doc === undefined) throw new NcbiError('not-genbank', 'NCBI sent an empty record.');
  const sentRegion = { ...region, ...got.sent };
  const name = regionName(sentRegion);
  const cut = { upstream: cutStart, downstream: Math.max(0, region.stop - got.sent.stop) };
  const warning = cutShortWarning(flanks, cut, asked.accession);
  analytics.track('file', 'open-ncbi', 'region');
  return {
    documents: [doc.rename(name)],
    warnings: warning === null ? parsed.warnings : [...parsed.warnings, warning],
    source: { kind: 'region', region: sentRegion },
    fileName: () => `${name}.gb`,
  };
}

/** The gene feature of `symbol` in a record, else its only gene feature, else null. */
/** The `gene` feature named `symbol`, or the record's only one. */
function geneFeature(doc: SeqDocument, symbol: string): Feature | null {
  const genes = doc.features.all().filter((f) => f.type === 'gene');
  const named = genes.find(
    (f) => (firstQualifier(f, 'gene') ?? f.name).toUpperCase() === symbol.toUpperCase(),
  );
  if (named !== undefined) return named;
  return genes.length === 1 ? (genes[0] ?? null) : null;
}

/**
 * A gene with its flanks (#299). Where NCBI has a RefSeqGene (`NG_`) record
 * for it — curated, gene-sized and already on the gene's strand — that
 * record is fetched whole and the window cut from it here (`extractRange`
 * marks the features it cuts partial). Otherwise the window is fetched as a
 * stretch of the chromosome, reverse-complemented by NCBI when the gene is
 * on the reverse strand and `reverseComplement` asks for it; NCBI marks the
 * features it clips at the window's edges partial itself. Either way the
 * document is named after the gene and its ACCESSION line carries the
 * record and the range (`NC_000017 REGION: complement(7667421..7688490)`),
 * so the fetch can be repeated.
 *
 * `record` 'chromosome' (#326) skips the RefSeqGene record, and the request
 * that looks for one, and fetches the window from the chromosome: a
 * RefSeqGene record carries only the gene's reference transcript, the
 * chromosome every annotated variant, for the transcript picker to choose
 * between. Either way `source.region` names the record the window was cut
 * from, so the same fetch can be made again from it.
 */
export async function fetchGeneFromNcbi(
  gene: GeneHit,
  flanks: Flanks,
  reverseComplement: boolean,
  record: GeneRecord = 'refseqgene',
  options: FetchRecordsOptions = {},
): Promise<NcbiFetched> {
  const { location } = gene;
  if (location === null) {
    throw new NcbiError(
      'not-found',
      `NCBI has no genomic location for ${gene.symbol} (${gene.organism}), so there is no sequence to fetch.`,
    );
  }
  // Checked before anything is sent, with the chromosome's window; a
  // RefSeqGene record is smaller than its chromosome's stretch anyway.
  const chromosomal = geneWindow(location, flanks, reverseComplement);
  const refSeqGene =
    record === 'chromosome' ? null : await refSeqGeneUid(gene.id, options).catch(counted);
  if (refSeqGene !== null) {
    const fromRefSeqGene = await fetchFromRefSeqGene(
      gene,
      refSeqGene,
      flanks,
      reverseComplement,
      options,
    );
    if (fromRefSeqGene !== null) return fromRefSeqGene;
  }
  const got = await fetchRegion(chromosomal.region, options).catch(counted);
  const parsed = parseRecord(got.text);
  const [doc] = parsed.documents;
  if (doc === undefined) throw new NcbiError('not-genbank', 'NCBI sent an empty record.');
  const region = { ...chromosomal.region, ...got.sent };
  const cut = addFlanks(chromosomal.cut, clippedAtEnd(chromosomal.region, got.sent));
  const warning = cutShortWarning(flanks, cut, location.accession);
  analytics.track('file', 'open-ncbi', 'gene');
  return {
    documents: [doc.rename(gene.symbol)],
    warnings: warning === null ? parsed.warnings : [...parsed.warnings, warning],
    source: { kind: 'gene', gene, region },
    fileName: () => `${gene.symbol}_${regionName(region)}.gb`,
  };
}

/**
 * The gene's window cut from its RefSeqGene record, or null when the
 * record does not place the gene (then the chromosome is used instead).
 */
async function fetchFromRefSeqGene(
  gene: GeneHit,
  uid: string,
  flanks: Flanks,
  reverseComplement: boolean,
  options: FetchRecordsOptions,
): Promise<NcbiFetched | null> {
  const got = await fetchRecords('nucleotide', [uid], options).catch(counted);
  const parsed = parseRecord(got.text);
  const [whole] = parsed.documents;
  if (whole === undefined) return null;
  const feature = geneFeature(whole, gene.symbol);
  const extent = feature === null ? null : featureExtent(feature);
  if (feature === null || extent === null) return null;
  const window = geneWindow(
    {
      accession: whole.metadata.version || whole.metadata.accession,
      ...extent,
      strand: feature.strand === 'reverse' ? 'reverse' : 'forward',
    },
    flanks,
    reverseComplement,
    whole.length,
  );
  const { region } = window;
  // The window in the record's own coordinates, whichever strand it will read on.
  let doc = extractRange(whole, range(region.start - 1, region.stop), gene.symbol);
  if (region.strand === 'reverse') doc = doc.reverseComplement();
  const accession = primaryAccession(whole.metadata.accession) ?? region.accession;
  const span = `${region.start.toString()}..${region.stop.toString()}`;
  doc = doc.setMetadata({
    description: whole.metadata.description,
    // As NCBI itself writes a stretch of a record, so a download says where it is from.
    accession: `${accession} REGION: ${region.strand === 'reverse' ? `complement(${span})` : span}`,
    version: whole.metadata.version,
  });
  const warning = cutShortWarning(flanks, window.cut, region.accession);
  analytics.track('file', 'open-ncbi', 'gene');
  return {
    documents: [doc],
    warnings: warning === null ? parsed.warnings : [...parsed.warnings, warning],
    source: { kind: 'gene', gene, region },
    fileName: () => `${gene.symbol}_${regionName(region)}.gb`,
  };
}

/**
 * Opens each fetched document in a tab of its own, the last in front with
 * the warnings, returning their ids. A host that fetches a record for its
 * own purpose (the primer workspace's template, item 110) opens it as
 * `scratch`: the user did not ask for the document, so it is not kept
 * until they use it. File ▸ Open from NCBI keeps what it fetches.
 */
export function openFetched(
  fetched: NcbiFetched,
  options: { readonly scratch?: boolean } = {},
): readonly string[] {
  const ids: string[] = [];
  const { documents, warnings } = fetched;
  documents.forEach((doc, i) => {
    const last = i === documents.length - 1;
    // No file on the user's disk stands behind it, so there is no origin to
    // protect (like the bundled example); the name is what a download offers
    // and what opening the same accession again finds its tab by.
    const id = editorStore.openParsed(
      { format: 'genbank', documents: [doc], warnings: last ? warnings : [] },
      fetched.fileName(doc),
      { origin: null, scratch: options.scratch === true },
    );
    if (id !== null) ids.push(id);
  });
  return ids;
}

/** Fetches the records of the accessions typed and opens each in a tab (`fetchAccessions`, `openFetched`). */
export async function openFromNcbi(
  accessions: NcbiAccessions,
  options: FetchRecordsOptions = {},
): Promise<readonly string[]> {
  return openFetched(await fetchAccessions(accessions, options));
}
