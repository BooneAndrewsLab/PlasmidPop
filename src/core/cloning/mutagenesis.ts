import { translateCds } from '../analysis/cdsTranslation';
import { type EditOp, type SeqDocument } from '../document';
import { type Feature } from '../features';
import { meltingTemperature } from '../primers/thermo';
import { type Range } from '../range';
import { reverseComplement } from '../sequence';

/**
 * Site-directed mutagenesis: primers that carry a change, and the plasmid
 * they make (#61).
 *
 * A PCR already writes its primers' bases into the product (item 36), so a
 * mutation needs no reaction of its own, only primers designed around it.
 * Two designs are in common use:
 *
 * - **Back to back** (NEB Q5 site-directed mutagenesis): two primers that
 *   point away from each other and meet at the change, the forward one
 *   carrying the new bases as its 5′ end. The whole plasmid is amplified as
 *   one linear piece, then phosphorylated, ligated and the template digested
 *   (KLD). The primers do not overlap, so the product grows exponentially.
 * - **Overlapping** (Agilent QuikChange): two primers that are each other's
 *   reverse complement, the change in the middle with template on both
 *   sides. The plasmid is copied round, linearly, into a nicked circle.
 *
 * Either way the plasmid that comes out is the template with the change in
 * it, which is what `mutant` is.
 */

export type MutagenesisMethod = 'back-to-back' | 'overlapping';

export interface MutagenesisPrimer {
  /** 5′→3′, as it would be ordered. New bases in upper case, template in lower. */
  readonly sequence: string;
  /** Bases at the 3′ end that pair with the template. */
  readonly annealLength: number;
  /**
   * The design's melting temperature: of the annealing part for back to
   * back (nearest neighbour), of the whole primer by Agilent's formula for
   * overlapping primers, which is the one QuikChange is designed to.
   */
  readonly tm: number;
}

export interface MutagenesisDesign {
  readonly method: MutagenesisMethod;
  readonly forward: MutagenesisPrimer;
  readonly reverse: MutagenesisPrimer;
  /** The template with the change made, as an undoable edit would make it. */
  readonly edit: EditOp;
  readonly mutant: SeqDocument;
  /** The change in a few characters: `A123G`, `Δ123–125`, `+GGC after 122`. */
  readonly label: string;
  /** What it does to each coding feature it falls in, e.g. `lacZ K12R`. */
  readonly proteinChanges: readonly string[];
  /** Why the design falls short, in a sentence; null when it meets its rules. */
  readonly problem: string | null;
}

export interface MutagenesisOptions {
  /** Tm the annealing part of a back-to-back primer grows to (°C). */
  readonly targetTm?: number;
  /** QuikChange's rule: Tm of 78 °C or more by Agilent's formula. */
  readonly overlapTm?: number;
  readonly minAnneal?: number;
  readonly maxPrimer?: number;
}

export const MUTAGENESIS_DEFAULTS: Required<MutagenesisOptions> = {
  targetTm: 60,
  overlapTm: 78,
  minAnneal: 15,
  maxPrimer: 60,
};

/** More new bases than this are split between the two back-to-back primers. */
const SPLIT_INSERT = 20;

/**
 * Agilent's QuikChange formula: Tm = 81.5 + 0.41·%GC − 675/N − %mismatch,
 * with N the primer's length. For an insertion or a deletion N leaves out
 * the inserted bases, and %mismatch is not subtracted.
 */
export function quikChangeTm(primer: string, mismatched: number, indelBases: number): number {
  const n = primer.length - indelBases;
  if (n <= 0) return NaN;
  const gc = (primer.toUpperCase().match(/[GC]/g)?.length ?? 0) / primer.length;
  const mismatch = indelBases > 0 ? 0 : (mismatched / primer.length) * 100;
  return 81.5 + 0.41 * gc * 100 - 675 / n - mismatch;
}

/**
 * Designs the primers for replacing `range` of `doc` with `replacement`: an
 * empty range inserts at its start, an empty replacement deletes. Positions
 * wrap on a circular template.
 */
export function designMutagenesis(
  doc: SeqDocument,
  range: Range,
  replacement: string,
  method: MutagenesisMethod,
  options: MutagenesisOptions = {},
): MutagenesisDesign {
  const opts = { ...MUTAGENESIS_DEFAULTS, ...options };
  const L = doc.length;
  const text = doc.sequence.toString();
  const circular = doc.isCircular;
  const at = (i: number): string =>
    circular ? text.charAt(((i % L) + L) % L) : i < 0 || i >= L ? '' : text.charAt(i);
  /** Template bases [from, to), wrapping on a circle, '' past a linear end. */
  const stretch = (from: number, to: number): string => {
    let out = '';
    for (let i = from; i < to; i++) out += at(i);
    return out;
  };
  const inserted = replacement.toUpperCase();
  const removed = range.end - range.start;

  const edit: EditOp =
    removed === 0
      ? { type: 'insert', position: range.start, text: inserted }
      : inserted === ''
        ? { type: 'delete', range }
        : { type: 'replace', range, text: inserted };
  const mutant = doc.apply(edit);
  const label = describeChange(text, range, inserted);
  const frameshift = (inserted.length - removed) % 3 !== 0;
  const proteinChanges = proteinEffects(doc, mutant, range, frameshift);

  let problem: string | null = null;
  let forward: MutagenesisPrimer;
  let reverse: MutagenesisPrimer;

  if (method === 'back-to-back') {
    // The new bases ride on the forward primer's 5′ end; a long insert is
    // split, its first half on the reverse primer's, so neither is too long.
    const split = inserted.length > SPLIT_INSERT ? Math.floor(inserted.length / 2) : 0;
    const forwardTail = inserted.slice(split);
    const reverseTail = reverseComplement(inserted.slice(0, split));
    const grow = (read: (n: number) => string): string => {
      let n = opts.minAnneal;
      while (n < opts.maxPrimer && meltingTemperature(read(n)) < opts.targetTm) n++;
      return read(n);
    };
    const fAnneal = grow((n) => stretch(range.end, range.end + n).toLowerCase());
    const rAnneal = grow((n) =>
      reverseComplement(stretch(range.start - n, range.start)).toLowerCase(),
    );
    forward = {
      sequence: forwardTail + fAnneal,
      annealLength: fAnneal.length,
      tm: meltingTemperature(fAnneal),
    };
    reverse = {
      sequence: reverseTail + rAnneal,
      annealLength: rAnneal.length,
      tm: meltingTemperature(rAnneal),
    };
    if (forward.tm < opts.targetTm || reverse.tm < opts.targetTm) {
      problem = `The template next to the change is too AT-rich to reach ${opts.targetTm} °C within ${opts.maxPrimer} bases.`;
    }
  } else {
    // The change in the middle, template growing on both sides until the
    // primer reaches QuikChange's temperature.
    const mismatched =
      removed === inserted.length ? countDifferences(stretch(range.start, range.end), inserted) : 0;
    const indel = removed === inserted.length ? 0 : Math.max(inserted.length, removed);
    let left = 10;
    let right = 10;
    const build = (): string =>
      stretch(range.start - left, range.start).toLowerCase() +
      inserted +
      stretch(range.end, range.end + right).toLowerCase();
    let primer = build();
    while (
      quikChangeTm(primer, mismatched, indel) < opts.overlapTm &&
      primer.length < opts.maxPrimer
    ) {
      if (left <= right) left++;
      else right++;
      primer = build();
    }
    const tm = quikChangeTm(primer, mismatched, indel);
    forward = { sequence: primer, annealLength: right, tm };
    reverse = { sequence: reverseComplement(primer), annealLength: left, tm };
    if (tm < opts.overlapTm) {
      problem = `The primers reach only ${tm.toFixed(0)} °C at ${opts.maxPrimer} bases, short of the ${opts.overlapTm} °C QuikChange asks for.`;
    }
  }
  return { method, forward, reverse, edit, mutant, label, proteinChanges, problem };
}

function countDifferences(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a.charAt(i).toUpperCase() !== b.charAt(i)) n++;
  return n;
}

/** `A123G`, `AAG123–125CGT`, `Δ123–125`, `+GGC after 122`, 1-based. */
export function describeChange(template: string, range: Range, inserted: string): string {
  const from = range.start + 1;
  const removed = range.end - range.start;
  const old = template.slice(range.start, range.end).toUpperCase();
  if (removed === 0) return `+${inserted} after ${range.start.toLocaleString()}`;
  const span =
    removed === 1
      ? from.toLocaleString()
      : `${from.toLocaleString()}–${range.end.toLocaleString()}`;
  if (inserted === '') return `Δ${span}`;
  return `${old}${span}${inserted}`;
}

/**
 * What the change does to every coding feature it lies inside: the amino
 * acids that differ, a frameshift, or an in-frame gain or loss, read by
 * translating the feature before and after (`translateCds`), so the
 * feature's own genetic code, strand and `/codon_start` all apply.
 */
function proteinEffects(
  doc: SeqDocument,
  mutant: SeqDocument,
  range: Range,
  frameshift: boolean,
): string[] {
  const out: string[] = [];
  const after = new Map(mutant.features.all().map((f) => [f.id, f]));
  for (const feature of doc.features.all()) {
    if (feature.type !== 'CDS' || !contains(feature, range)) continue;
    const moved = after.get(feature.id);
    if (moved === undefined) continue;
    const before = translateCds(doc, feature).protein;
    const now = translateCds(mutant, moved).protein;
    const name = feature.name === '' ? 'CDS' : feature.name;
    out.push(`${name} ${compareProteins(before, now, frameshift)}`);
  }
  return out;
}

function contains(feature: Feature, r: Range): boolean {
  return feature.segments.some(
    (s) => s.kind === 'range' && s.start <= r.start && r.end <= s.end && s.start < s.end,
  );
}

/** `K12R`, `K12R, E13*`, `frameshift from K12`, `12–13 KE → R`, or `no change`. */
export function compareProteins(before: string, after: string, frameshift = false): string {
  if (before === after) return 'no change (silent)';
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++;
  if (frameshift) return `frameshift from ${before[head] ?? ''}${head + 1}`;
  const was = before.slice(head, before.length - tail);
  const now = after.slice(head, after.length - tail);
  if (was.length === now.length && was.length <= 3) {
    const changes: string[] = [];
    for (let i = 0; i < was.length; i++) {
      if (was[i] !== now[i]) changes.push(`${was[i] ?? ''}${head + i + 1}${now[i] ?? ''}`);
    }
    return changes.join(', ');
  }
  const where = was.length <= 1 ? `${head + 1}` : `${head + 1}–${head + was.length}`;
  return `${where} ${was === '' ? '(none)' : was} → ${now === '' ? '(none)' : now}`;
}
