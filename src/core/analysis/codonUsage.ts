import { type TranslationTable, DEFAULT_TABLE, IUPAC_SETS, translateCodon } from './codons';
import { type CodonUsageTable, CODON_USAGE_TABLES } from './codonUsageTables';

/**
 * Choosing codons for a site-directed change (#69): the codon a host uses
 * most for an amino acid, and what a degenerate codon library covers.
 */

const BASES: readonly string[] = ['T', 'C', 'A', 'G'];

/** Every codon, in the TCAG order the usage tables count them in. */
export const ALL_CODONS: readonly string[] = BASES.flatMap((a) =>
  BASES.flatMap((b) => BASES.map((c) => a + b + c)),
);

/** The named table, or the first (E. coli) for an id we do not know. */
export function codonUsageTable(id: string): CodonUsageTable {
  const table = CODON_USAGE_TABLES.find((t) => t.id === id) ?? CODON_USAGE_TABLES[0];
  if (table === undefined) throw new Error('No codon usage tables');
  return table;
}

export interface CodonChoice {
  readonly codon: string;
  /** Share of the amino acid's codons in the host's genes, 0–1. */
  readonly fraction: number;
  /** Bases that differ from the codon it replaces. */
  readonly changes: number;
}

function differences(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < 3; i++) if (a.charAt(i).toUpperCase() !== b.charAt(i).toUpperCase()) n++;
  return n;
}

/**
 * The codons for `aminoAcid` under the genetic code `table`, the host's
 * favourite first: by its share of the amino acid in the host's genes, then
 * by fewest bases changed from `current`. The shares are the host's as it
 * reads the standard code; under another code a codon the standard code
 * gives to something else keeps its count, which is as near as the tables
 * go.
 */
export function codonChoices(
  aminoAcid: string,
  host: CodonUsageTable,
  current = '',
  table: TranslationTable = DEFAULT_TABLE,
): CodonChoice[] {
  const synonyms = ALL_CODONS.map((codon, i) => ({ codon, count: host.counts[i] ?? 0 })).filter(
    ({ codon }) => translateCodon(codon, table) === aminoAcid,
  );
  const total = synonyms.reduce((n, s) => n + s.count, 0);
  return synonyms
    .map(({ codon, count }) => ({
      codon,
      fraction: total === 0 ? 1 / synonyms.length : count / total,
      changes: current.length === 3 ? differences(codon, current) : 0,
    }))
    .sort(
      (a, b) => b.fraction - a.fraction || a.changes - b.changes || a.codon.localeCompare(b.codon),
    );
}

/** The degenerate codons a saturation library is usually made with. */
export const DEGENERATE_CODONS = ['NNK', 'NNS', 'NNN', 'NDT'] as const;
export type DegenerateCodon = (typeof DEGENERATE_CODONS)[number];

export interface LibraryCoverage {
  /** Distinct codons the degenerate codon stands for. */
  readonly codons: number;
  /** Amino acids it encodes, with how many of its codons give each, stops left out. */
  readonly aminoAcids: ReadonlyMap<string, number>;
  /** Of its codons, how many are stops. */
  readonly stops: number;
  /**
   * Colonies to screen for a 95 % chance of meeting any one codon: the T
   * with 1 − (1 − 1/n)^T ≥ 0.95, about 3n, the usual threefold
   * oversampling. The
   * whole library then is 95 % covered on average.
   */
  readonly screen95: number;
}

/** What one degenerate codon of a library gives, read with `table`. */
export function libraryCoverage(
  degenerate: string,
  table: TranslationTable = DEFAULT_TABLE,
): LibraryCoverage {
  const upper = degenerate.toUpperCase();
  const sets = [0, 1, 2].map((i) => IUPAC_SETS[upper.charAt(i)] ?? []);
  const codons: string[] = [];
  for (const a of sets[0] ?? [])
    for (const b of sets[1] ?? []) for (const c of sets[2] ?? []) codons.push(a + b + c);
  const aminoAcids = new Map<string, number>();
  let stops = 0;
  for (const codon of codons) {
    const aa = translateCodon(codon, table);
    if (aa === '*') stops++;
    else aminoAcids.set(aa, (aminoAcids.get(aa) ?? 0) + 1);
  }
  const n = codons.length;
  const screen95 = n <= 1 ? 1 : Math.ceil(Math.log(0.05) / Math.log(1 - 1 / n));
  return { codons: n, aminoAcids, stops, screen95 };
}

export type CodonUsageParse =
  | { readonly ok: true; readonly table: CodonUsageTable }
  | { readonly ok: false; readonly error: string };

/** Lowercase letters and digits, for an id that survives a rename of the file. */
function slugOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Reads a codon usage table the user brings (#209): the Codon Usage
 * Database's own layout (`UUU 17.6(714298)`, four to a line) or one codon
 * to a line, the count (or frequency) last (`TTT,F,17.6,714298` or `TTT 714298`).
 * U is read as T. A first line `# name` names the table. Codons the text
 * leaves out count as zero, so at least 61 must be there; a codon given twice
 * is refused.
 */
export function parseCodonUsageText(text: string, fileName: string | null): CodonUsageParse {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  let name = (fileName ?? '').replace(/\.[^.]+$/, '').trim();
  const counts = new Map<string, number>();
  let duplicate = '';
  const add = (raw: string, count: number): void => {
    const codon = raw.toUpperCase().replace(/U/g, 'T');
    if (!/^[ACGT]{3}$/.test(codon) || !Number.isFinite(count) || count < 0) return;
    if (counts.has(codon)) duplicate = codon;
    counts.set(codon, count);
  };
  for (const [i, line] of lines.entries()) {
    if (line.startsWith('#')) {
      const first = line.slice(1).trim();
      if (i === 0 && first !== '') name = first;
      continue;
    }
    const kazusa = [...line.matchAll(/\b([ACGTU]{3})\s+[\d.]+\s*\(\s*(\d+)\s*\)/gi)];
    if (kazusa.length > 0) {
      for (const m of kazusa) add(m[1] ?? '', Number(m[2]));
      continue;
    }
    const cells = line.split(/[\s,;]+/).filter((c) => c !== '');
    const [codon = '', ...rest] = cells;
    const last = rest[rest.length - 1];
    if (last !== undefined && /^\d+(\.\d+)?$/.test(last)) add(codon, Number(last));
  }
  if (duplicate !== '') return { ok: false, error: `${duplicate} is given more than once.` };
  if (counts.size < 61) {
    return {
      ok: false,
      error: `Found ${counts.size} codons with counts; a table needs all 64 (at least 61).`,
    };
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return { ok: false, error: 'Every count is zero.' };
  if (name === '') name = 'Imported table';
  return {
    ok: true,
    table: {
      id: `custom-${slugOf(name) || 'table'}`,
      name,
      organism: name,
      taxon: 0,
      cds: 0,
      counts: ALL_CODONS.map((c) => counts.get(c) ?? 0),
    },
  };
}
