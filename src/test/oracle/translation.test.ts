import {
  type TranslationTable,
  GENETIC_CODES,
  IUPAC_SETS,
  isStartCodon,
  isStopCodon,
  translate,
  translateCodon,
  translateReverse,
} from '@/core';

import oracle from './translation.json';

/**
 * Translation against Biopython (scripts/oracle/generate.py), exhaustively:
 * every codon over the full IUPAC alphabet (15³ = 3,375) under every NCBI
 * genetic code, plus start and stop codons and whole-sequence translations.
 */

const BASES = ['A', 'C', 'G', 'T'];
const alphabet = oracle.alphabet;
const codons: string[] = [];
for (const a of alphabet)
  for (const b of alphabet) for (const c of alphabet) codons.push(a + b + c);

const TWO_WAY: Record<string, string> = { B: 'DN', Z: 'EQ', J: 'IL' };

/** Every amino acid a (possibly ambiguous) codon can stand for. */
function readings(codon: string, table: TranslationTable): string[] {
  const out = new Set<string>();
  const sets = Array.from(codon).map((b) => IUPAC_SETS[b] ?? []);
  for (const a of sets[0] ?? [])
    for (const b of sets[1] ?? [])
      for (const c of sets[2] ?? []) out.add(translateCodon(a + b + c, table));
  return [...out];
}

const tables = oracle.tables as Record<
  string,
  { name: string; aminoAcids: string; starts: string[]; stops: string[] }
>;

describe('translation against Biopython', () => {
  it('knows the same genetic codes', () => {
    expect(GENETIC_CODES.map((c) => String(c.id)).sort()).toEqual(Object.keys(tables).sort());
  });

  it('translates every codon, ambiguous or not, under every code', () => {
    const problems: string[] = [];
    for (const [id, table] of Object.entries(tables)) {
      const t = Number(id) as TranslationTable;
      codons.forEach((codon, i) => {
        const ours = translateCodon(codon, t);
        const theirs = table.aminoAcids.charAt(i);
        if (ours === theirs) return;
        // KNOWN DIFFERENCE (convention): where an ambiguous codon can only be
        // one of two amino acids, Biopython writes B (D/N), Z (E/Q) or J
        // (I/L) and we write X. Tolerated only if every reading of the codon
        // really is one of that pair.
        const pair = TWO_WAY[theirs];
        if (
          ours === 'X' &&
          pair !== undefined &&
          readings(codon, t).every((aa) => pair.includes(aa))
        )
          return;
        problems.push(`table ${id} ${codon}: ours ${ours}, Biopython ${theirs}`);
      });
    }
    expect(problems).toEqual([]);
  });

  it('agrees on start and stop codons', () => {
    const problems: string[] = [];
    for (const [id, table] of Object.entries(tables)) {
      const t = Number(id) as TranslationTable;
      for (const a of BASES)
        for (const b of BASES)
          for (const c of BASES) {
            const codon = a + b + c;
            if (isStartCodon(codon, t) !== table.starts.includes(codon))
              problems.push(`table ${id} start ${codon}`);
            // KNOWN DIFFERENCE: in codes 27, 28 and 31 some codons are a stop
            // or an amino acid depending on context. Biopython lists them as
            // stops; we translate them. Tolerated for exactly those codons.
            const dual =
              table.stops.includes(codon) && table.aminoAcids.charAt(codons.indexOf(codon)) !== '*';
            if (!dual && isStopCodon(codon, t) !== table.stops.includes(codon)) {
              problems.push(`table ${id} stop ${codon}`);
            }
          }
    }
    expect(problems).toEqual([]);
  });

  it('translates whole sequences, forward, reverse and up to the first stop', () => {
    for (const s of oracle.samples) {
      const table = s.table as TranslationTable;
      expect(translate(s.sequence, { table })).toBe(s.protein);
      expect(translateReverse(s.sequence, { table })).toBe(s.reverse);
      if (s.toStop !== null) expect(translate(s.sequence, { table, toStop: true })).toBe(s.toStop);
    }
  });
});
