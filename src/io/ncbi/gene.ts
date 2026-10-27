/**
 * A gene looked up by name and organism at NCBI (#299, item 58): the
 * Entrez Gene database through `esearch` and `esummary`, its RefSeqGene
 * record through `elink`, and the stretch of chromosome or RefSeqGene
 * record it occupies, with flanks, through `efetch` (`efetch.ts`).
 *
 * What leaves the browser is what the user typed in the gene box, and the
 * organism chosen, as they type (debounced in the component); the privacy
 * hint says so before the first character goes. All four E-utilities
 * answer a browser directly with `Access-Control-Allow-Origin: *` (checked
 * 2026-10-27 with an `Origin` header), and all go through `ncbiRequest`,
 * so the gap between requests and the one retry apply to a keystroke as
 * to anything else.
 *
 * Coordinates: `esummary`'s `chrstart`/`chrstop` are **0-based and
 * inclusive** on the forward strand, `chrstart > chrstop` meaning the
 * reverse strand (TP53, which GenBank places at `complement(7668421..
 * 7687490)` of NC_000017.11, comes as `chrstart: 7687489, chrstop:
 * 7668420`). `GeneLocation` holds the internal 0-based half-open form;
 * `geneWindow` turns it into efetch's 1-based inclusive `Region`.
 */

import {
  type FetchRecordsOptions,
  MAX_RECORD_BP,
  NCBI_TOOL,
  NcbiError,
  ncbiRequest,
} from './efetch';
import type { Region } from './efetch';

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
export const ESEARCH_URL = `${EUTILS}/esearch.fcgi`;
export const ESUMMARY_URL = `${EUTILS}/esummary.fcgi`;
export const ELINK_URL = `${EUTILS}/elink.fcgi`;

/** At most this many genes are listed for what was typed. */
export const MAX_GENE_HITS = 10;

/** A gene name needs this many characters before anything is sent. */
export const MIN_GENE_QUERY = 2;

/** How long typing must pause before a lookup goes (ms). */
export const GENE_QUERY_DEBOUNCE_MS = 400;

/** The flank preset offered beside the flank boxes. */
export const FLANK_PRESET_BP = 1000;

/**
 * An organism as the picker offers it: the Entrez term is a taxonomy id
 * (`txid9606[orgn]`), which explodes to subspecies and strains — yeast
 * genes sit under S288C (559292), E. coli K-12's under MG1655 (511145) —
 * and cannot be misread the way a common name can.
 */
export interface Organism {
  readonly label: string;
  readonly taxId: number;
}

/** Common model organisms, in the order the picker shows them. */
export const ORGANISMS: readonly Organism[] = [
  { label: 'Human (Homo sapiens)', taxId: 9606 },
  { label: 'Mouse (Mus musculus)', taxId: 10090 },
  { label: 'Rat (Rattus norvegicus)', taxId: 10116 },
  { label: 'Zebrafish (Danio rerio)', taxId: 7955 },
  { label: 'Fruit fly (Drosophila melanogaster)', taxId: 7227 },
  { label: 'Worm (Caenorhabditis elegans)', taxId: 6239 },
  { label: 'Budding yeast (Saccharomyces cerevisiae)', taxId: 4932 },
  { label: 'Fission yeast (Schizosaccharomyces pombe)', taxId: 4896 },
  { label: 'Thale cress (Arabidopsis thaliana)', taxId: 3702 },
  { label: 'E. coli K-12', taxId: 83333 },
];

/**
 * The Entrez term for an organism typed freely: a number is a taxonomy id,
 * anything else a name, quoted so a two-word name stays one term. Entrez's
 * own syntax characters are dropped so the text cannot become a query of
 * its own; an empty term means any organism.
 */
export function organismTerm(input: string): string {
  const text = cleanTerm(input);
  if (text === '') return '';
  if (/^\d+$/.test(text)) return `txid${text}[orgn]`;
  return `"${text}"[orgn]`;
}

/** Characters with a meaning to Entrez taken out, and the rest trimmed. */
function cleanTerm(input: string): string {
  return input
    .replace(/[[\]"()*:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The esearch term for what was typed: the gene symbol or alias, matched as
 * a prefix (`TP5*[sym]` finds TP53, TP53BP1…; `P53[sym]` finds TP53 by its
 * alias), limited to the organism and to current records (`alive[prop]`:
 * discontinued genes have no location to fetch). Null when the text is too
 * short to send.
 */
export function geneSearchTerm(query: string, organism: string): string | null {
  const text = cleanTerm(query);
  if (text.length < MIN_GENE_QUERY) return null;
  const sym = text.includes(' ') ? `"${text}"[sym]` : `${text}*[sym]`;
  const parts = [sym, organismTerm(organism), 'alive[prop]'].filter((p) => p !== '');
  return parts.join(' AND ');
}

export function esearchUrl(term: string): string {
  const params = new URLSearchParams({
    db: 'gene',
    term,
    retmax: MAX_GENE_HITS.toString(),
    retmode: 'json',
    tool: NCBI_TOOL,
  });
  return `${ESEARCH_URL}?${params.toString()}`;
}

export function esummaryUrl(ids: readonly string[]): string {
  const params = new URLSearchParams({
    db: 'gene',
    id: ids.join(','),
    retmode: 'json',
    tool: NCBI_TOOL,
  });
  return `${ESUMMARY_URL}?${params.toString()}`;
}

/** The RefSeqGene (`NG_`) records of a gene, where it has any. */
export function elinkRefSeqGeneUrl(geneId: string): string {
  const params = new URLSearchParams({
    dbfrom: 'gene',
    db: 'nuccore',
    id: geneId,
    linkname: 'gene_nuccore_refseqgene',
    retmode: 'json',
    tool: NCBI_TOOL,
  });
  return `${ELINK_URL}?${params.toString()}`;
}

/** Where a gene lies: the internal 0-based half-open `[start, end)` on the forward strand. */
export interface GeneLocation {
  /** The chromosome (or scaffold) record, with version: `NC_000017.11`. */
  readonly accession: string;
  readonly start: number;
  readonly end: number;
  readonly strand: 'forward' | 'reverse';
}

/** One gene as NCBI summarises it, what the pick list shows and what a fetch needs. */
export interface GeneHit {
  /** The Entrez Gene id. */
  readonly id: string;
  readonly symbol: string;
  readonly fullName: string;
  readonly organism: string;
  readonly taxId: number;
  readonly aliases: readonly string[];
  readonly chromosome: string;
  /** Null for a gene with no genomic placement (nothing to fetch). */
  readonly location: GeneLocation | null;
}

export interface GeneSearch {
  readonly hits: readonly GeneHit[];
  /** How many matches there were in all; more than `hits` when the list was cut. */
  readonly count: number;
}

/**
 * The genes matching what was typed, up to `MAX_GENE_HITS`, exact symbol
 * matches first. Two requests: esearch for the ids, esummary for the rows.
 * An empty answer is a search with no hits, not an error.
 */
export async function searchGenes(
  query: string,
  organism: string,
  options: FetchRecordsOptions = {},
): Promise<GeneSearch> {
  const term = geneSearchTerm(query, organism);
  if (term === null) return { hits: [], count: 0 };
  const result = rec(await readJson(esearchUrl(term), options), 'esearchresult');
  const ids = arr(result, 'idlist').filter((id): id is string => typeof id === 'string');
  const count = Number(field(result, 'count'));
  if (ids.length === 0) return { hits: [], count: 0 };
  const summary = await readJson(esummaryUrl(ids), options);
  const rows = rec(summary, 'result');
  const hits = ids.map((id) => geneHit(id, rec(rows, id))).filter((h) => h !== null);
  return { hits: rankHits(hits, query), count: Number.isFinite(count) ? count : hits.length };
}

/** Exact symbol matches first, then the rest in NCBI's order. */
export function rankHits(hits: readonly GeneHit[], query: string): readonly GeneHit[] {
  const q = cleanTerm(query).toUpperCase();
  const exact = hits.filter((h) => h.symbol.toUpperCase() === q);
  const rest = hits.filter((h) => h.symbol.toUpperCase() !== q);
  return [...exact, ...rest];
}

/** One esummary row as a `GeneHit`; null for a row esummary reports an error on. */
export function geneHit(id: string, row: unknown): GeneHit | null {
  const symbol = str(row, 'name');
  if (symbol === '') return null;
  const organism = rec(row, 'organism');
  const [placement] = arr(row, 'genomicinfo');
  const accession = str(placement, 'chraccver');
  const chrstart = Number(field(placement, 'chrstart'));
  const chrstop = Number(field(placement, 'chrstop'));
  const placed = accession !== '' && Number.isInteger(chrstart) && Number.isInteger(chrstop);
  const aliases = str(row, 'otheraliases');
  return {
    id,
    symbol,
    fullName: str(row, 'description'),
    organism: str(organism, 'scientificname'),
    taxId: Number(field(organism, 'taxid')) || 0,
    aliases: aliases === '' ? [] : aliases.split(/,\s*/),
    chromosome: str(row, 'chromosome'),
    location: placed
      ? {
          accession,
          // 0-based inclusive both ends → 0-based half-open: the end is one past the larger.
          start: Math.min(chrstart, chrstop),
          end: Math.max(chrstart, chrstop) + 1,
          strand: chrstart <= chrstop ? 'forward' : 'reverse',
        }
      : null,
  };
}

/**
 * The RefSeqGene record of a gene — the nuccore uid of its `NG_` record,
 * when NCBI has curated one (human genes mostly), else null.
 */
export async function refSeqGeneUid(
  geneId: string,
  options: FetchRecordsOptions = {},
): Promise<string | null> {
  const answer = await readJson(elinkRefSeqGeneUrl(geneId), options);
  for (const linkset of arr(answer, 'linksets')) {
    for (const db of arr(linkset, 'linksetdbs')) {
      const [first] = arr(db, 'links');
      if (typeof first === 'string') return first;
      if (typeof first === 'number') return first.toString();
    }
  }
  return null;
}

/** Flank lengths in bp, measured along the gene: upstream of its 5′ end, downstream of its 3′. */
export interface Flanks {
  readonly upstream: number;
  readonly downstream: number;
}

export interface GeneWindow {
  /** The stretch to fetch: 1-based inclusive, forward-strand coordinates. */
  readonly region: Region;
  /** The gene within the window, 0-based half-open, on the window's own strand. */
  readonly gene: { readonly start: number; readonly end: number };
  /** Flank bases that could not be had because the record starts at 1 (the far end is NCBI's to clip). */
  readonly cut: Flanks;
}

/**
 * The window around a gene: the gene plus its flanks, upstream and
 * downstream in the gene's own reading direction, clamped at the start of
 * the record. On the reverse strand with `reverseComplement`, the window
 * is fetched as the minus strand, so the gene reads 5′ to 3′ and
 * "upstream" is the start of the document. The far end is not known here;
 * `fetchRegion` reports what NCBI clipped there. Throws `too-large` when
 * the window would pass the record cap, before anything is sent.
 */
export function geneWindow(
  location: GeneLocation,
  flanks: Flanks,
  reverseComplement: boolean,
  recordLength = Number.POSITIVE_INFINITY,
): GeneWindow {
  const reverse = location.strand === 'reverse';
  // Upstream of a reverse-strand gene is the higher coordinates.
  const before = reverse ? flanks.downstream : flanks.upstream;
  const after = reverse ? flanks.upstream : flanks.downstream;
  const start = Math.max(0, location.start - before);
  const end = Math.min(recordLength, location.end + after);
  const cutBefore = before - (location.start - start);
  const cutAfter = after - (end - location.end);
  const strand = reverse && reverseComplement ? 'reverse' : 'forward';
  const length = end - start;
  if (length > MAX_RECORD_BP) {
    throw new NcbiError(
      'too-large',
      `The gene with its flanks is ${length.toLocaleString('en-US')} bp. PlasmidPop opens sequences up to ${(MAX_RECORD_BP / 1_000_000).toString()} Mb; ask for less flank.`,
    );
  }
  const geneStart = strand === 'reverse' ? end - location.end : location.start - start;
  return {
    region: { accession: location.accession, start: start + 1, stop: end, strand },
    gene: { start: geneStart, end: geneStart + (location.end - location.start) },
    cut: reverse
      ? { upstream: cutAfter, downstream: cutBefore }
      : { upstream: cutBefore, downstream: cutAfter },
  };
}

async function readJson(url: string, options: FetchRecordsOptions): Promise<unknown> {
  const response = await ncbiRequest(url, options);
  if (!response.ok) {
    throw new NcbiError(
      'server',
      `NCBI answered with an error (HTTP ${response.status.toString()}). Try again later.`,
    );
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new NcbiError('not-genbank', 'NCBI sent an answer that could not be read.');
  }
}

/* NCBI's JSON, read without trusting its shape: a missing or odd field is
   an empty string, an empty object or an empty list, never a throw. */

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function rec(value: unknown, key: string): unknown {
  const inner = field(value, key);
  return typeof inner === 'object' && inner !== null && !Array.isArray(inner) ? inner : {};
}

function arr(value: unknown, key: string): readonly unknown[] {
  const inner = field(value, key);
  return Array.isArray(inner) ? (inner as unknown[]) : [];
}

function str(value: unknown, key: string): string {
  const inner = field(value, key);
  return typeof inner === 'string' ? inner : '';
}
