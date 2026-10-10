import { reverseComplement } from '../sequence';
import type { SeqDocument } from '../document';
import {
  type GoldenGateAssembly,
  type GoldenGateOptions,
  type GoldenGateResult,
  goldenGate,
  goldenGateFragments,
} from './goldenGate';
import { flipFragment } from './ligate';

/**
 * Modular cloning standards (#214): MoClo, the Yeast Toolkit and their kin
 * think in named positions, each with the two overhangs its part is cut
 * with. A standard is data here, a list of positions; a part document is
 * tagged with one, by reading the overhangs its digest leaves or by hand;
 * and a combinatorial plan runs the Golden Gate for every way of choosing
 * one part per position.
 *
 * Only overhang sequences are bundled, which are facts of the published
 * standards and carry no one's data or sequence. Others are imported.
 */

export interface StandardPosition {
  /** What the position is called: "Promoter", "Type 3". */
  readonly name: string;
  /** The overhang the part joins its left neighbour on, top-strand, as the digest reports it. */
  readonly left: string;
  readonly right: string;
}

export interface OverhangStandard {
  readonly id: string;
  readonly name: string;
  /** Where the overhangs were published; empty for an imported standard. */
  readonly citation: string;
  /** The enzyme the parts are cut with, to start the picker on; empty for no preference. */
  readonly enzyme: string;
  readonly positions: readonly StandardPosition[];
  readonly bundled: boolean;
}

const pos = (name: string, left: string, right: string): StandardPosition => ({
  name,
  left,
  right,
});

/**
 * The standards that ship. Each is cut with BsaI to release a part; the
 * overhangs are those of the published syntax. GoldenBraid, CIDAR and Loop
 * are left to the importer, because their tables were not at hand to check.
 */
export const BUNDLED_STANDARDS: readonly OverhangStandard[] = [
  {
    id: 'moclo-plant',
    name: 'MoClo plant common syntax',
    citation:
      'Weber et al. 2011, PLoS ONE 6:e16765; Patron et al. 2015, New Phytol 208:13 (fusion sites A to F)',
    enzyme: 'BsaI',
    bundled: true,
    positions: [
      pos('Promoter + 5′UTR', 'GGAG', 'AATG'),
      pos('Promoter', 'GGAG', 'TACT'),
      pos('5′UTR', 'TACT', 'AATG'),
      pos('CDS', 'AATG', 'GCTT'),
      pos('CDS N-terminal part', 'AATG', 'AGGT'),
      pos('CDS C-terminal part', 'AGGT', 'GCTT'),
      pos('3′UTR + terminator', 'GCTT', 'CGCT'),
    ],
  },
  {
    id: 'ytk',
    name: 'Yeast Toolkit (YTK)',
    citation: 'Lee et al. 2015, ACS Synth Biol 4:975',
    enzyme: 'BsaI',
    bundled: true,
    positions: [
      pos('Type 1', 'CCCT', 'AACG'),
      pos('Type 2', 'AACG', 'TATG'),
      pos('Type 3', 'TATG', 'ATCC'),
      pos('Type 3a', 'TATG', 'TTCT'),
      pos('Type 3b', 'TTCT', 'ATCC'),
      pos('Type 4', 'ATCC', 'GCTG'),
      pos('Type 4a', 'ATCC', 'TGGC'),
      pos('Type 4b', 'TGGC', 'GCTG'),
      pos('Type 234', 'AACG', 'GCTG'),
      pos('Type 5', 'GCTG', 'TACA'),
      pos('Type 6', 'TACA', 'GAGT'),
      pos('Type 7', 'GAGT', 'CCGA'),
      pos('Type 8', 'CCGA', 'CCCT'),
      pos('Type 8a', 'CCGA', 'CAAT'),
      pos('Type 8b', 'CAAT', 'CCCT'),
      pos('Type 678', 'TACA', 'CCCT'),
    ],
  },
];

const OVERHANG = /^[ACGT]{2,6}$/;

export type StandardParse =
  | { readonly ok: true; readonly standard: OverhangStandard }
  | { readonly ok: false; readonly error: string };

/** Lowercase letters and digits, for an id that survives a rename of the file. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Reads a standard from text: a line per position, `position,left,right`
 * (comma, semicolon or tab), with an optional first line `# name` or
 * `# name, enzyme`. A header row naming the columns is skipped.
 */
export function parseStandardText(text: string, fileName: string | null): StandardParse {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  let name = (fileName ?? '').replace(/\.[^.]+$/, '').trim();
  let enzyme = '';
  const positions: StandardPosition[] = [];
  for (const [i, line] of lines.entries()) {
    if (line.startsWith('#')) {
      const [first, second] = line.slice(1).split(/[,;\t]/);
      if (i === 0 && first !== undefined && first.trim() !== '') name = first.trim();
      if (i === 0 && second !== undefined) enzyme = second.trim();
      continue;
    }
    const cells = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));
    const [position = '', left = '', right = ''] = cells;
    const l = left.toUpperCase();
    const r = right.toUpperCase();
    if (positions.length === 0 && !OVERHANG.test(l) && cells.length >= 3 && i <= 1) continue;
    if (position === '') return { ok: false, error: `Line ${i + 1} has no position name.` };
    if (!OVERHANG.test(l) || !OVERHANG.test(r)) {
      return {
        ok: false,
        error: `Line ${i + 1} (${position}): the left and right overhangs should be 2 to 6 bases of A, C, G and T.`,
      };
    }
    if (positions.some((p) => p.name === position)) {
      return { ok: false, error: `The position ${position} is listed twice.` };
    }
    positions.push({ name: position, left: l, right: r });
  }
  if (positions.length === 0) {
    return {
      ok: false,
      error: 'No positions found. Write one per line as: position, left overhang, right overhang.',
    };
  }
  if (name === '') name = 'Imported standard';
  return {
    ok: true,
    standard: {
      id: `custom:${slug(name) || 'standard'}`,
      name,
      citation: '',
      enzyme,
      positions,
      bundled: false,
    },
  };
}

/** What a part document is in a standard. */
export type Placement =
  | { readonly kind: 'position'; readonly position: string; readonly flipped: boolean }
  | {
      /** A vector whose backbone takes the parts: its ends, as the digest leaves them. */
      readonly kind: 'destination';
      readonly left: string;
      readonly right: string;
    };

/** The ends a placement has, in the standard. */
export function placementEnds(
  standard: OverhangStandard,
  placement: Placement,
): { readonly left: string; readonly right: string } | null {
  if (placement.kind === 'destination') return { left: placement.left, right: placement.right };
  const found = standard.positions.find((p) => p.name === placement.position);
  return found === undefined ? null : { left: found.left, right: found.right };
}

/**
 * Reads what a document is from the overhangs its digest leaves: a piece
 * whose two ends are one position's (read either way round) is a part for
 * that position; a piece whose ends are one position's right end and
 * another's left end is a destination's backbone. A document with neither,
 * or no usable piece, is null.
 */
export function detectPlacement(
  doc: SeqDocument,
  standard: OverhangStandard,
  options: GoldenGateOptions,
): Placement | null {
  const fragments = goldenGateFragments(doc, options);
  for (const fragment of fragments) {
    const turned = flipFragment(fragment);
    for (const p of standard.positions) {
      if (
        fragment.left.overhang.toUpperCase() === p.left &&
        fragment.right.overhang.toUpperCase() === p.right
      )
        return { kind: 'position', position: p.name, flipped: false };
      if (
        turned.left.overhang.toUpperCase() === p.left &&
        turned.right.overhang.toUpperCase() === p.right
      )
        return { kind: 'position', position: p.name, flipped: true };
    }
  }
  const rights = new Set(standard.positions.map((p) => p.right));
  const lefts = new Set(standard.positions.map((p) => p.left));
  for (const fragment of fragments) {
    const l = fragment.left.overhang.toUpperCase();
    const r = fragment.right.overhang.toUpperCase();
    if (rights.has(l) && lefts.has(r)) return { kind: 'destination', left: l, right: r };
    const tl = reverseComplement(r);
    const tr = reverseComplement(l);
    if (rights.has(tl) && lefts.has(tr)) return { kind: 'destination', left: tl, right: tr };
  }
  return null;
}

/** A part in a plan: an id the caller knows it by, and the document. */
export interface PlanPart {
  readonly id: string;
  readonly document: SeqDocument;
}

/** One position of a plan with the parts that could fill it, or the destination. */
export interface PlanSlot {
  readonly label: string;
  /** Where its parts join: the position's overhangs, or the destination's. */
  readonly left: string;
  readonly right: string;
  readonly parts: readonly PlanPart[];
}

/** One way of choosing a part for every slot, and what the reaction does with it. */
export interface PlanProduct {
  readonly parts: readonly PlanPart[];
  readonly name: string;
  readonly assembly: GoldenGateAssembly | null;
  /** Why it cannot form; null when it does. */
  readonly problem: string | null;
  readonly result: GoldenGateResult;
}

export interface AssemblyPlan {
  /** Number of combinations the slots allow. */
  readonly total: number;
  /** One product per combination, empty when there are too many to run. */
  readonly products: readonly PlanProduct[];
  readonly tooMany: boolean;
  /** Slot ends that no other slot's end meets, in a sentence each. */
  readonly gaps: readonly string[];
}

/** Most combinations a plan runs; each is a full digest of every part. */
export const MAX_PLAN_COMBINATIONS = 500;

/** Slot ends that nothing in the plan joins to: a ring needs every end met. */
export function planGaps(slots: readonly PlanSlot[]): string[] {
  const out: string[] = [];
  for (const [i, s] of slots.entries()) {
    const others = slots.filter((_, j) => j !== i);
    if (slots.length > 1 && !others.some((o) => o.left === s.right)) {
      out.push(`Nothing follows ${s.label}: no slot starts with ${s.right}.`);
    }
    if (slots.length > 1 && !others.some((o) => o.right === s.left)) {
      out.push(`Nothing precedes ${s.label}: no slot ends with ${s.left}.`);
    }
  }
  return out;
}

/**
 * Every assembly that choosing one part per slot makes, run as the Golden
 * Gate it is, so that the ones that cannot form say why (#214). A slot with
 * no part gives no product at all; the caller shows that as a gap.
 */
export function planAssemblies(
  slots: readonly PlanSlot[],
  options: GoldenGateOptions,
): AssemblyPlan {
  const gaps = planGaps(slots);
  const total = slots.length === 0 ? 0 : slots.reduce((n, s) => n * s.parts.length, 1);
  if (total === 0) return { total: 0, products: [], tooMany: false, gaps };
  if (total > MAX_PLAN_COMBINATIONS) return { total, products: [], tooMany: true, gaps };
  const products: PlanProduct[] = [];
  const choose = (i: number, chosen: readonly PlanPart[]): void => {
    const slot = slots[i];
    if (slot === undefined) {
      const result = goldenGate(
        chosen.map((p) => p.document),
        options,
      );
      products.push({
        parts: chosen,
        name: chosen.map((p) => p.document.name).join(' + '),
        assembly: result.assembly,
        problem: result.problem,
        result,
      });
      return;
    }
    for (const part of slot.parts) choose(i + 1, [...chosen, part]);
  };
  choose(0, []);
  return { total, products, tooMany: false, gaps };
}
