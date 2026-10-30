import { reverseComplement } from '@/core/sequence/alphabet';

/**
 * Simulated Sanger reads for the assembly oracle (item 123, issue #335).
 * A read is cut from a known construct and given base calls with errors at
 * the rate its own Phred qualities state, so the truth is known exactly. The
 * qualities come either from a parametric profile (committed, generic) or
 * from real reads supplied by the caller (local files only). Simulated reads
 * are LESS REALISTIC than real chromatograms: no peak overlap, no dye
 * blobs, no compression or context-dependent errors, and errors are
 * independent given the quality.
 */

export type Rng = () => number;

/** Seeded xorshift32 returning [0, 1), the same on every platform. */
export function rng(seed: number): Rng {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

export function randomBases(n: number, r: Rng, gc = 0.5): string {
  let out = '';
  for (let i = 0; i < n; i++) {
    const g = r() < gc;
    out += g ? (r() < 0.5 ? 'G' : 'C') : r() < 0.5 ? 'A' : 'T';
  }
  return out;
}

/** Random bases with a homopolymer of 5-9 bases every ~60 bases. */
export function homopolymerRich(n: number, r: Rng): string {
  let out = '';
  while (out.length < n) {
    out += randomBases(40 + Math.floor(r() * 40), r);
    out += 'ACGT'.charAt(Math.floor(r() * 4)).repeat(5 + Math.floor(r() * 5));
  }
  return out.slice(0, n);
}

/** How noisy the generic profile is. */
export interface ProfileShape {
  /** Typical Phred of the clean middle of the read. */
  readonly plateau: number;
  /** Chance per base of starting a dip of 5-15 bases at Q6-14. */
  readonly dipRate: number;
  /** Bases at the start with a ramp up from about Q5 (Sanger's poor first bases). */
  readonly head: number;
  /** Bases at the end that decay to about Q8. */
  readonly tail: number;
}

export const CLEAN: ProfileShape = { plateau: 45, dipRate: 0.004, head: 35, tail: 150 };
export const NOISY: ProfileShape = { plateau: 32, dipRate: 0.02, head: 50, tail: 250 };

export function genericQualities(length: number, shape: ProfileShape, r: Rng): number[] {
  const q: number[] = [];
  let dip = 0;
  for (let i = 0; i < length; i++) {
    let v = shape.plateau + (r() - 0.5) * 14;
    if (i < shape.head) v = 6 + ((v - 6) * i) / shape.head;
    const fromEnd = length - i;
    if (fromEnd < shape.tail) v = 8 + ((v - 8) * fromEnd) / shape.tail;
    if (dip === 0 && r() < shape.dipRate) dip = 5 + Math.floor(r() * 10);
    if (dip > 0) {
      v = 6 + r() * 8;
      dip--;
    }
    q.push(Math.max(2, Math.min(60, Math.round(v))));
  }
  return q;
}

export interface SimRead {
  readonly name: string;
  readonly sequence: string;
  readonly qualities: number[];
  /** Where it was cut from: truth coordinates, half-open. */
  readonly truthStart: number;
  readonly truthEnd: number;
  readonly reverse: boolean;
}

export interface ErrorModel {
  /** Share of errors that are a deleted base; insertions get the same share. Default 0.08. */
  readonly indel?: number;
}

/**
 * Reads `qualities.length` bases of the truth from `start` (towards the
 * start when `reverse`: the read is the reverse complement of the stretch
 * ending at `start`), calling each base wrongly with probability 10^(-Q/10)
 * (at most 0.75). Errors are mostly substitutions; deletions and insertions
 * share `indel` each. A base with Q below 2 is called N a third of the time.
 */
export function simulateRead(
  name: string,
  truth: string,
  start: number,
  qualities: readonly number[],
  reverse: boolean,
  r: Rng,
  model: ErrorModel = {},
): SimRead {
  const indel = model.indel ?? 0.08;
  const n = Math.min(qualities.length, reverse ? start : truth.length - start);
  const lo = reverse ? start - n : start;
  const template = reverse ? reverseComplement(truth.slice(lo, start)) : truth.slice(lo, lo + n);
  let bases = '';
  const quals: number[] = [];
  for (let i = 0; i < n; i++) {
    const q = qualities[i] ?? 20;
    const base = template.charAt(i);
    if (r() >= Math.min(0.75, 10 ** (-q / 10))) {
      bases += base;
      quals.push(q);
      continue;
    }
    const kind = r();
    if (kind < indel) continue; // deleted
    if (kind < 2 * indel) {
      bases += base + 'ACGT'.charAt(Math.floor(r() * 4));
      quals.push(q, q);
      continue;
    }
    const others = 'ACGT'.replace(base, '');
    bases += q < 2 && r() < 0.34 ? 'N' : others.charAt(Math.floor(r() * 3));
    quals.push(q);
  }
  return {
    name,
    sequence: bases,
    qualities: quals,
    truthStart: lo,
    truthEnd: lo + n,
    reverse,
  };
}
