import { SeqDocument } from '../document';
import { type DigestFragment } from './digest';
import {
  assemblyJunctions,
  defaultFragmentName,
  emptyVector,
  flipFragment,
  ligate,
} from './ligate';

/**
 * The wrong clones a cloning may give beside the right one (item 132,
 * #361): the molecules a miniprep check digest has to tell the product
 * from. The empty vector was the only one (item 49); a restriction
 * ligation has more, and the Bench's expected gel shows each as a lane.
 *
 * Which are plausible is decided by the ends, not by a table of methods: a
 * candidate is an order of the same fragments, and it is a wrong clone when
 * every junction of that order is one a ligase would make
 * (`assemblyJunctions`). So a directional insert (two different sticky
 * ends) has no reversed and no tandem clone, a dephosphorylated vector has
 * no empty one and no dimer, and a one-enzyme ligation has them all. The
 * product itself is built by `ligate`, as the right product is.
 */
export type WrongCloneKind =
  'empty' | 'reversed' | 'tandem' | 'dimer' | 'head-to-head' | 'tail-to-tail';

export interface WrongClone {
  readonly kind: WrongCloneKind;
  /** Heading under the lane, seven characters or fewer. */
  readonly label: string;
  /** What it is, in full: "Insert reversed". */
  readonly name: string;
  /** What happened in the tube, one sentence. */
  readonly why: string;
  readonly molecule: SeqDocument;
}

/**
 * How many wrong lanes the gel draws beside the product's. Five lanes and a
 * ladder is what the Bench's column keeps legible; the rest are named under
 * it. The kinds are tried in the order of `WRONG_CLONE_KINDS`, which is how
 * often each turns up in practice, so a cap drops the rarest.
 */
export const MAX_WRONG_LANES = 4;

/**
 * Most to least common in a restriction ligation. The empty vector and the
 * turned insert are the everyday ones; a tandem insert comes with a high
 * insert-to-vector ratio; a vector dimer with a single-cut vector that was
 * not dephosphorylated; the two inverted doubles make a long perfect
 * palindrome, which E. coli keeps badly, so they are the rarest.
 */
export const WRONG_CLONE_KINDS: readonly WrongCloneKind[] = [
  'empty',
  'reversed',
  'tandem',
  'dimer',
  'head-to-head',
  'tail-to-tail',
];

const LABELS: Readonly<Record<WrongCloneKind, string>> = {
  empty: 'Empty',
  reversed: 'Reverse',
  tandem: 'Tandem',
  dimer: 'Dimer',
  'head-to-head': 'H-to-H',
  'tail-to-tail': 'T-to-T',
};

/** The empty vector as a wrong clone: the lane the check always had (item 49), or none. */
export function emptyVectorClone(vector: SeqDocument | DigestFragment): WrongClone[] {
  const molecule = emptyVector(vector);
  if (molecule === null) return [];
  return [
    {
      kind: 'empty',
      label: LABELS.empty,
      name: 'Empty vector',
      why:
        vector instanceof SeqDocument && vector.isCircular
          ? 'The vector went through uncut, with no insert.'
          : 'The vector closed on itself, with no insert.',
      molecule,
    },
  ];
}

interface Candidate {
  readonly kind: WrongCloneKind;
  readonly name: string;
  readonly why: string;
  readonly order: readonly DigestFragment[];
}

/** The name of the insert as the shelf shows it, when there is more than one to tell apart. */
function insertName(parts: readonly DigestFragment[], vectorIndex: number, i: number): string {
  const inserts = parts.filter((_, k) => k !== vectorIndex);
  const part = parts[i];
  return inserts.length > 1 && part !== undefined ? ` (${defaultFragmentName(part)})` : '';
}

function candidates(parts: readonly DigestFragment[], vectorIndex: number): Candidate[] {
  const vector = parts[vectorIndex];
  if (vector === undefined) return [];
  const out: Candidate[] = [];
  const inserts = parts.map((_, i) => i).filter((i) => i !== vectorIndex);
  const withInsert = (
    i: number,
    replacement: readonly DigestFragment[],
  ): readonly DigestFragment[] => parts.flatMap((p, k) => (k === i ? replacement : [p]));
  for (const kind of WRONG_CLONE_KINDS) {
    switch (kind) {
      case 'empty':
        // `emptyVectorClone` makes this one, by the same rule a ligation uses.
        break;
      case 'dimer':
        out.push({
          kind,
          name: 'Vector dimer',
          why: 'Two copies of the vector joined into one circle, with no insert.',
          order: [vector, vector],
        });
        break;
      case 'reversed':
        for (const i of inserts) {
          const p = parts[i];
          if (p === undefined) continue;
          out.push({
            kind,
            name: `Insert reversed${insertName(parts, vectorIndex, i)}`,
            why: 'The insert went in the other way round.',
            order: withInsert(i, [flipFragment(p)]),
          });
        }
        break;
      case 'tandem':
        for (const i of inserts) {
          const p = parts[i];
          if (p === undefined) continue;
          out.push({
            kind,
            name: `Two inserts, head to tail${insertName(parts, vectorIndex, i)}`,
            why: 'Two copies of the insert went in one after the other, the same way round.',
            order: withInsert(i, [p, p]),
          });
        }
        break;
      case 'head-to-head':
        for (const i of inserts) {
          const p = parts[i];
          if (p === undefined) continue;
          out.push({
            kind,
            name: `Two inserts, head to head${insertName(parts, vectorIndex, i)}`,
            why: 'Two copies of the insert went in, the second turned round, so they meet head to head.',
            order: withInsert(i, [p, flipFragment(p)]),
          });
        }
        break;
      case 'tail-to-tail':
        for (const i of inserts) {
          const p = parts[i];
          if (p === undefined) continue;
          out.push({
            kind,
            name: `Two inserts, tail to tail${insertName(parts, vectorIndex, i)}`,
            why: 'Two copies of the insert went in, the first turned round, so they meet tail to tail.',
            order: withInsert(i, [flipFragment(p), p]),
          });
        }
        break;
    }
  }
  return out;
}

/**
 * The wrong clones a circular restriction ligation of `parts` may give, most
 * common first: the empty vector, each insert reversed, each insert twice
 * (head to tail, head to head, tail to tail) and the vector as a dimer —
 * each only where its ends join, and each built by `ligate` from the same
 * fragments as `product`. A candidate whose bases are the product's (a
 * palindromic insert turned round) or another candidate's is left out. A
 * linear product has no colonies, so no wrong clones.
 */
export function ligationWrongClones(
  parts: readonly DigestFragment[],
  vectorIndex: number,
  product: SeqDocument,
): WrongClone[] {
  const vector = parts[vectorIndex];
  if (!product.isCircular || vector === undefined) return [];
  const out: WrongClone[] = [...emptyVectorClone(vector)];
  const seen = new Set<string>([product.sequence.toString()]);
  for (const c of out) seen.add(c.molecule.sequence.toString());
  for (const c of candidates(parts, vectorIndex)) {
    if (!assemblyJunctions(c.order, true).every((j) => j.compatible)) continue;
    const molecule = ligate(c.order, {
      name: `${product.name}: ${c.name.toLowerCase()}`,
      circular: true,
    });
    const text = molecule.sequence.toString();
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({ kind: c.kind, label: LABELS[c.kind], name: c.name, why: c.why, molecule });
  }
  return out;
}

/** The wrong clones the gel draws, and the names of those past its cap. */
export function wrongLanes(all: readonly WrongClone[]): {
  readonly shown: readonly WrongClone[];
  readonly omitted: readonly string[];
} {
  return {
    shown: all.slice(0, MAX_WRONG_LANES),
    omitted: all.slice(MAX_WRONG_LANES).map((c) => c.name),
  };
}
