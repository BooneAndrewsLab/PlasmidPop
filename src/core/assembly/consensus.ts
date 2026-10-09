/**
 * Calling one column of an assembly (#208): the bases the reads put in it,
 * each with the quality it was called at, and what the consensus makes of
 * them. A read's base is right with probability 1 − 10^(−q/10) and otherwise
 * one of the four other symbols (three bases and a gap) equally; the
 * posterior over the symbols, under a flat prior, is what is called. One
 * high-quality read outweighs several poor ones, two confident reads that
 * disagree give an IUPAC code, and a column the reads mostly leave empty is
 * dropped from the consensus.
 */

/** A symbol a read can put in a column: a base, or a gap for a base it lacks. */
export type ColumnSymbol = 'A' | 'C' | 'G' | 'T' | '-';

const SYMBOLS: readonly ColumnSymbol[] = ['A', 'C', 'G', 'T', '-'];

export interface ColumnVote {
  /** An upper-case base, or '-'. Any other letter (N, R, …) carries no information and is ignored. */
  readonly base: string;
  /** Phred quality, 0 and over; clamped to 1–60 so one vote never rules a base out. */
  readonly quality: number;
}

export interface ColumnCall {
  /**
   * The consensus base or IUPAC code; '' when the reads mostly have a gap
   * here, so the column is left out; 'N' when no read says anything.
   */
  readonly symbol: string;
  /** Phred quality of the call, 0–60 (the posterior probability it is right). */
  readonly quality: number;
  /** Whether the call is an ambiguity code because the reads could not settle on a base. */
  readonly ambiguous: boolean;
}

/**
 * The posterior mass the called bases must reach: one Q10 read alone (0.9)
 * and one Q20 read against a Q10 dissenter (about 0.92) settle a base; two
 * equally poor reads that disagree do not.
 */
export const CALL_POSTERIOR = 0.8;

export const MAX_CALL_QUALITY = 60;

const CODE_OF_SET: Readonly<Record<string, string>> = {
  A: 'A',
  C: 'C',
  G: 'G',
  T: 'T',
  AG: 'R',
  CT: 'Y',
  CG: 'S',
  AT: 'W',
  GT: 'K',
  AC: 'M',
  CGT: 'B',
  AGT: 'D',
  ACT: 'H',
  ACG: 'V',
  ACGT: 'N',
};

/** The IUPAC code for a set of bases, given in any order. */
export function iupacOf(bases: readonly string[]): string {
  const key = [...new Set(bases)].sort().join('');
  return CODE_OF_SET[key] ?? 'N';
}

function symbolIndex(base: string): number {
  return SYMBOLS.indexOf(base as ColumnSymbol);
}

/** The posterior of each of A, C, G, T and '-' given the votes, summing to 1. */
export function columnPosterior(votes: readonly ColumnVote[]): number[] | null {
  const log = [0, 0, 0, 0, 0];
  let used = 0;
  for (const v of votes) {
    const s = symbolIndex(v.base);
    if (s < 0) continue;
    used++;
    const q = Math.min(60, Math.max(1, v.quality));
    const p = 10 ** (-q / 10);
    for (let k = 0; k < 5; k++) log[k] = (log[k] ?? 0) + Math.log(k === s ? 1 - p : p / 4);
  }
  if (used === 0) return null;
  const top = Math.max(...log);
  const w = log.map((l) => Math.exp(l - top));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / sum);
}

export function callColumn(votes: readonly ColumnVote[]): ColumnCall {
  const post = columnPosterior(votes);
  if (post === null) return { symbol: 'N', quality: 0, ambiguous: false };
  const order = [0, 1, 2, 3, 4].sort((a, b) => (post[b] ?? 0) - (post[a] ?? 0) || a - b);
  const quality = (p: number): number =>
    Math.min(MAX_CALL_QUALITY, Math.max(0, Math.round(-10 * Math.log10(Math.max(1e-6, 1 - p)))));
  const best = order[0] ?? 0;
  if (best === 4) return { symbol: '', quality: quality(post[4] ?? 0), ambiguous: false };
  let mass = 0;
  const chosen: string[] = [];
  for (const k of order) {
    mass += post[k] ?? 0;
    // A gap among the runners-up does not make a base ambiguous; it is
    // reported by the column's disagreement.
    if (k !== 4) chosen.push(SYMBOLS[k] ?? 'N');
    if (mass >= CALL_POSTERIOR) break;
  }
  const covered = chosen.reduce((a, b) => a + (post[symbolIndex(b)] ?? 0), 0);
  return {
    symbol: iupacOf(chosen),
    quality: quality(covered),
    ambiguous: chosen.length > 1,
  };
}
