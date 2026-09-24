import { type Feature, shiftFeature } from '../features';
import { newId } from '../ids';
import {
  type DocumentMetadata,
  SeqDocument,
  createMetadata,
  describeEnd,
  extractRange,
  flipEnd,
  flipWindow,
} from '../document';
import { type DigestFragment, type FragmentEnd } from './digest';

/**
 * A digest fragment set aside for ligation, in the orientation it will be
 * joined in. The shelf of these is the user's bench: pieces gathered from
 * several documents in turn, kept until they are assembled.
 */
export interface AssemblyPart {
  readonly id: string;
  readonly fragment: DigestFragment;
  /** Whether the fragment was turned around since it was added. */
  readonly flipped: boolean;
}

/**
 * The same piece of DNA turned around: the bottom strand becomes the top
 * strand, so the ends swap and each overhang is read from the other strand.
 *
 * The two strands of a sticky-ended piece do not cover the same bases, and
 * `sequence` is the top strand alone (see `DigestFragment`). Turning the
 * piece over therefore does not simply reverse-complement `sequence`: the
 * window moves by an overhang at each end. An overhang the old top strand
 * carried (a 5' left end, a 3' right end) drops out of the new one, and an
 * overhang the old bottom strand carried joins it. Those bases are not in
 * `sequence` at all, but the ends describe them, which is enough to write
 * the new top strand out.
 *
 * Features are trimmed to the window that survives, and get fresh ids: what
 * comes back is a new piece of annotation, not a move of the old one.
 */
export function flipFragment(fragment: DigestFragment): DigestFragment {
  const { left, right, sequence } = fragment;
  // `head`/`tail` are the bottom strand's own overhangs, written as
  // top-strand bases: they sit just outside `sequence` and come into it on
  // the flip. `trimStart`/`trimEnd` are the bases of `sequence` that are this
  // fragment's own single-stranded ends and go the other way.
  const { head, tail, trimStart, trimEnd } = flipWindow({ left, right });
  const whole = SeqDocument.create({
    sequence: head + sequence + tail,
    features: fragment.features.map((f) =>
      shiftFeature(
        f,
        head.length,
        { length: sequence.length, topology: 'linear' },
        { length: head.length + sequence.length + tail.length, topology: 'linear' },
      ),
    ),
    topology: 'linear',
  });
  // What the bottom strand covers, which is what the new top strand reads.
  // `head` and `trimStart` are never both set, so the start is just the one
  // that applies; the same holds for `tail` and `trimEnd` at the end.
  const flipped = extractRange(whole, {
    start: trimStart,
    end: head.length + sequence.length - trimEnd + tail.length,
  }).reverseComplement();
  return {
    ...fragment,
    sequence: flipped.sequence.toString(),
    features: flipped.features.all(),
    left: flipEnd(right),
    right: flipEnd(left),
  };
}

/**
 * Whether the right end of one fragment can be ligated to the left end of
 * the next: both blunt, or overhangs of the same kind whose single strands
 * pair up. With the `FragmentEnd` convention that is plain equality; IUPAC
 * codes in the sequence are not resolved, so an N never pairs.
 */
export function endsCompatible(right: FragmentEnd, left: FragmentEnd): boolean {
  return right.kind === left.kind && right.overhang.toUpperCase() === left.overhang.toUpperCase();
}

export interface Junction {
  /** Right end of the fragment before the junction. */
  readonly from: FragmentEnd;
  /** Left end of the fragment after it. */
  readonly to: FragmentEnd;
  /** Whether a ligase can make this join: matching ends, and a 5′ phosphate on at least one side. */
  readonly compatible: boolean;
  /**
   * The ends match but both sides are dephosphorylated, so neither strand
   * can be joined (#10). Only meaningful when `compatible` is false.
   */
  readonly dephosphorylated: boolean;
}

function junction(a: DigestFragment, b: DigestFragment): Junction {
  const match = endsCompatible(a.right, b.left);
  const bare = a.dephosphorylated === true && b.dephosphorylated === true;
  return { from: a.right, to: b.left, compatible: match && !bare, dephosphorylated: match && bare };
}

/**
 * The joins an assembly of `fragments` in order would need: one between each
 * consecutive pair, plus the closing join from the last back to the first
 * when the product is circular. Fewer than two fragments give no junctions
 * unless circularising a single one.
 */
export function assemblyJunctions(
  fragments: readonly DigestFragment[],
  circular: boolean,
): Junction[] {
  const out: Junction[] = [];
  for (let i = 1; i < fragments.length; i++) {
    const a = fragments[i - 1];
    const b = fragments[i];
    if (a === undefined || b === undefined) continue;
    out.push(junction(a, b));
  }
  const last = fragments[fragments.length - 1];
  const first = fragments[0];
  if (circular && last !== undefined && first !== undefined) {
    out.push(junction(last, first));
  }
  return out;
}

export interface LigateOptions {
  readonly name: string;
  readonly circular: boolean;
  readonly metadata?: Partial<DocumentMetadata>;
}

/**
 * Joins the fragments end to end into a new document. Throws when a join is
 * not compatible; callers check `assemblyJunctions` first to tell the user
 * which one. The product's top strand is the fragments' top strands
 * concatenated: at every join exactly one side contributes the overhang
 * bases (the left fragment for 3' overhangs, the right one for 5').
 */
export function ligate(fragments: readonly DigestFragment[], options: LigateOptions): SeqDocument {
  if (fragments.length === 0) throw new Error('Nothing to ligate');
  for (const j of assemblyJunctions(fragments, options.circular)) {
    if (j.dephosphorylated) {
      throw new Error(`Both ends are dephosphorylated: ${describeEnd(j.from)} cannot be joined`);
    }
    if (!j.compatible) {
      throw new Error(
        `Incompatible ends: ${j.from.kind} ${j.from.overhang} and ${j.to.kind} ${j.to.overhang}`,
      );
    }
  }
  let sequence = '';
  const features: Feature[] = [];
  const product = {
    length: fragments.reduce((n, f) => n + f.sequence.length, 0),
    topology: options.circular ? 'circular' : 'linear',
  } as const;
  for (const f of fragments) {
    const offset = sequence.length;
    sequence += f.sequence;
    const from = { length: f.sequence.length, topology: 'linear' } as const;
    for (const feature of f.features) {
      features.push({ ...shiftFeature(feature, offset, from, product), id: newId() });
    }
  }
  const first = fragments[0];
  const last = fragments[fragments.length - 1];
  return SeqDocument.create({
    name: options.name,
    sequence,
    topology: options.circular ? 'circular' : 'linear',
    features,
    // A linear product still has the two outermost ends of the assembly: it
    // can go on to be ligated into something else.
    ends:
      options.circular || first === undefined || last === undefined
        ? null
        : { left: first.left, right: last.right },
    metadata: createMetadata({
      moleculeType: 'DNA',
      division: 'SYN',
      description: describeAssembly(fragments, options.circular),
      ...options.metadata,
    }),
  });
}

function describeAssembly(fragments: readonly DigestFragment[], circular: boolean): string {
  const parts = fragments.map((f) => {
    const ends = [f.left.enzyme, f.right.enzyme].filter((e) => e !== null);
    const cut = ends.length === 0 ? '' : ` ${[...new Set(ends)].join('-')}`;
    return `${f.source}${cut} fragment (${f.sequence.length.toLocaleString()} bp)`;
  });
  return `${circular ? 'Circular' : 'Linear'} ligation of ${parts.join(', ')}`;
}

/**
 * A digest fragment as a document of its own, sticky ends and all, so a
 * piece of a digest can be looked at, edited and saved like anything else.
 */
export function documentFromFragment(
  fragment: DigestFragment,
  options: { readonly name?: string } = {},
): SeqDocument {
  return ligate([fragment], {
    name: options.name ?? defaultFragmentName(fragment),
    circular: false,
    metadata: {
      description: `${fragment.sequence.length.toLocaleString()} bp fragment of ${fragment.source}: ${describeEnd(fragment.left)} to ${describeEnd(fragment.right)}`,
    },
  });
}

/** "pBR322 EcoRI-BamHI fragment", or just "... fragment" for an uncut end. */
export function defaultFragmentName(fragment: DigestFragment): string {
  const enzymes = [...new Set([fragment.left.enzyme, fragment.right.enzyme])].filter(
    (e): e is string => e !== null,
  );
  const cut = enzymes.length === 0 ? '' : ` ${enzymes.join('-')}`;
  return `${fragment.source}${cut} fragment`;
}
