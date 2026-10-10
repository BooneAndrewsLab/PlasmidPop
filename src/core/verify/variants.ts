import { type Alignment } from '../alignment';
import { type Feature } from '../features';
import { type Range, rangeContains, rangesOverlap } from '../range';

/**
 * The differences of a clone's consensus from the construct it was meant to
 * be (#218): an alignment's mismatch and gap columns grouped into events, and
 * each event placed on the construct's features. Positions are the
 * construct's, 0-based half-open as everywhere in the model.
 */

export type VariantKind =
  /** One base changed. */
  | 'snv'
  /** Several adjacent bases changed. */
  | 'substitution'
  /** A few bases the clone has and the construct does not. */
  | 'insertion'
  /** A few construct bases the clone lacks. */
  | 'deletion'
  /** A stretch of `EXTRA_FROM` bases or more the clone has and the construct does not. */
  | 'extra'
  /** A stretch of `EXTRA_FROM` bases or more of the construct the clone lacks. */
  | 'missing';

/** An insertion or deletion this long or longer is a region, not an indel. */
export const EXTRA_FROM = 20;

/** What a variant does to one feature, said as a phrase: "frameshift in CDS bla". */
export interface FeatureEffect {
  readonly featureId: string;
  readonly type: string;
  readonly name: string;
  readonly text: string;
}

export interface Variant {
  readonly kind: VariantKind;
  /** The construct's bases `[start, end)` involved; an insertion is a point, `start === end`. */
  readonly start: number;
  readonly end: number;
  /** Bases changed, inserted or missing. */
  readonly size: number;
  /** The construct's bases there (substitutions and deletions, up to 20 shown). */
  readonly expected: string;
  /** The clone's bases there (substitutions and insertions, up to 20 shown). */
  readonly observed: string;
  /** Features of the construct the variant falls in, the whole-molecule `source` aside. */
  readonly features: readonly FeatureEffect[];
}

const SHOWN = 20;

function shown(text: string): string {
  return text.length > SHOWN ? `${text.slice(0, SHOWN)}…` : text;
}

/** Variants in `alignment`, without their features (`placeVariants` adds those). */
export function variantsOf(alignment: Alignment): Variant[] {
  const out: Variant[] = [];
  const { alignedA, alignedB, matchLine, columns } = alignment;
  let a = alignment.startA;
  let c = 0;
  while (c < columns) {
    const x = alignedA.charAt(c);
    const y = alignedB.charAt(c);
    if (x === '-') {
      let end = c;
      while (end < columns && alignedA.charAt(end) === '-') end++;
      const inserted = alignedB.slice(c, end);
      out.push(variant(inserted.length >= EXTRA_FROM ? 'extra' : 'insertion', a, a, '', inserted));
      c = end;
    } else if (y === '-') {
      let end = c;
      while (end < columns && alignedB.charAt(end) === '-') end++;
      const removed = alignedA.slice(c, end);
      out.push(
        variant(
          removed.length >= EXTRA_FROM ? 'missing' : 'deletion',
          a,
          a + removed.length,
          removed,
          '',
        ),
      );
      a += removed.length;
      c = end;
    } else if (matchLine.charAt(c) === '.') {
      let end = c;
      while (
        end < columns &&
        matchLine.charAt(end) === '.' &&
        alignedA.charAt(end) !== '-' &&
        alignedB.charAt(end) !== '-'
      ) {
        end++;
      }
      const was = alignedA.slice(c, end);
      out.push(
        variant(
          end - c === 1 ? 'snv' : 'substitution',
          a,
          a + (end - c),
          was,
          alignedB.slice(c, end),
        ),
      );
      a += end - c;
      c = end;
    } else {
      a++;
      c++;
    }
  }
  return out;
}

function variant(
  kind: VariantKind,
  start: number,
  end: number,
  expected: string,
  observed: string,
): Variant {
  return {
    kind,
    start,
    end,
    size: Math.max(expected.length, observed.length),
    expected: shown(expected),
    observed: shown(observed),
    features: [],
  };
}

function label(f: Feature): string {
  return f.name.trim() === '' ? f.type : `${f.type} ${f.name}`;
}

/** The feature's located stretches, as ranges. */
function rangesOfFeature(f: Feature): Range[] {
  const out: Range[] = [];
  for (const s of f.segments) if (s.kind === 'range') out.push({ start: s.start, end: s.end });
  return out;
}

/**
 * Whether the variant touches the feature, and whether it takes the whole of
 * it. An insertion touches it only strictly inside a stretch: at an edge it
 * is in the sequence beside the feature, not in it.
 */
function touches(v: Variant, ranges: readonly Range[], length: number): 'no' | 'inside' | 'whole' {
  if (v.end === v.start) {
    const before = (v.start - 1 + length) % length;
    const after = v.start % length;
    return ranges.some((r) => rangeContains(r, before, length) && rangeContains(r, after, length))
      ? 'inside'
      : 'no';
  }
  const hit = { start: v.start, end: v.end };
  if (!ranges.some((r) => rangesOverlap(r, hit, length))) return 'no';
  const kept = ranges.every((r) => v.start <= r.start && r.end <= v.end);
  return v.kind === 'deletion' || v.kind === 'missing' ? (kept ? 'whole' : 'inside') : 'inside';
}

function effectOf(v: Variant, f: Feature, how: 'inside' | 'whole'): string {
  const what = label(f);
  if (how === 'whole') return `${what} deleted`;
  const indel =
    v.kind === 'insertion' || v.kind === 'deletion' || v.kind === 'extra' || v.kind === 'missing';
  if (f.type === 'CDS' && indel) {
    const verb = v.kind === 'insertion' || v.kind === 'extra' ? 'insertion' : 'deletion';
    return v.size % 3 === 0
      ? `in-frame ${verb} of ${v.size.toLocaleString()} bp in ${what}`
      : `frameshift in ${what}`;
  }
  if (f.type === 'CDS') return `${v.kind === 'snv' ? 'base change' : 'substitution'} in ${what}`;
  return `${what} changed`;
}

/** `variants` with the features of `features` each one falls in. `length` is the construct's. */
export function placeVariants(
  variants: readonly Variant[],
  features: Iterable<Feature>,
  length: number,
): Variant[] {
  const list = [...features]
    .filter((f) => f.type !== 'source')
    .map((f) => ({ f, ranges: rangesOfFeature(f) }))
    .filter((x) => x.ranges.length > 0);
  return variants.map((v) => {
    const hits: FeatureEffect[] = [];
    for (const { f, ranges } of list) {
      const how = touches(v, ranges, length);
      if (how === 'no') continue;
      hits.push({ featureId: f.id, type: f.type, name: f.name, text: effectOf(v, f, how) });
    }
    return { ...v, features: hits };
  });
}

/** Where a variant is, 1-based as the views number it: `1,234`, `1,234..1,240`, or `after 1,234`. */
export function whereVariant(v: Variant): string {
  if (v.end === v.start) return v.start === 0 ? 'before 1' : `after ${v.start.toLocaleString()}`;
  return v.end - v.start === 1
    ? (v.start + 1).toLocaleString()
    : `${(v.start + 1).toLocaleString()}..${v.end.toLocaleString()}`;
}

const KIND_NAMES: Readonly<Record<VariantKind, string>> = {
  snv: 'SNV',
  substitution: 'substitution',
  insertion: 'insertion',
  deletion: 'deletion',
  extra: 'extra region',
  missing: 'missing region',
};

/** A variant in a phrase: `SNV at 1,234 (A to G)`, `deletion of 3 bp at 2,000..2,002`. */
export function describeVariant(v: Variant): string {
  const name = KIND_NAMES[v.kind];
  const where = whereVariant(v);
  if (v.kind === 'snv') return `${name} at ${where} (${v.expected} to ${v.observed})`;
  if (v.kind === 'substitution') return `${v.size.toLocaleString()}-base ${name} at ${where}`;
  return `${name} of ${v.size.toLocaleString()} bp ${where.startsWith('after') || where.startsWith('before') ? where : `at ${where}`}`;
}
