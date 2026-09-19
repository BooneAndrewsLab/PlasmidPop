import { type Feature } from '../features';
import { newId } from '../ids';
import { type DocumentMetadata, SeqDocument, createMetadata } from '../document';
import { reverseComplement } from '../sequence';
import { type DigestFragment, type FragmentEnd } from './digest';

/**
 * The same piece of DNA turned around: the bottom strand becomes the top
 * strand, so the ends swap and each overhang is read from the other strand.
 */
export function flipFragment(fragment: DigestFragment): DigestFragment {
  const flipped = SeqDocument.create({
    sequence: fragment.sequence,
    features: fragment.features,
    topology: 'linear',
  }).reverseComplement();
  const flipEnd = (end: FragmentEnd): FragmentEnd => ({
    ...end,
    overhang: reverseComplement(end.overhang),
  });
  return {
    ...fragment,
    sequence: flipped.sequence.toString(),
    features: flipped.features.all(),
    left: flipEnd(fragment.right),
    right: flipEnd(fragment.left),
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
  readonly compatible: boolean;
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
    out.push({ from: a.right, to: b.left, compatible: endsCompatible(a.right, b.left) });
  }
  const last = fragments[fragments.length - 1];
  const first = fragments[0];
  if (circular && last !== undefined && first !== undefined) {
    out.push({
      from: last.right,
      to: first.left,
      compatible: endsCompatible(last.right, first.left),
    });
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
    if (!j.compatible) {
      throw new Error(
        `Incompatible ends: ${j.from.kind} ${j.from.overhang} and ${j.to.kind} ${j.to.overhang}`,
      );
    }
  }
  let sequence = '';
  const features: Feature[] = [];
  for (const f of fragments) {
    const offset = sequence.length;
    sequence += f.sequence;
    for (const feature of f.features) {
      features.push({
        ...feature,
        id: newId(),
        segments: feature.segments.map((seg) =>
          seg.kind === 'range'
            ? { ...seg, start: seg.start + offset, end: seg.end + offset }
            : { kind: 'site', position: seg.position + offset },
        ),
      });
    }
  }
  return SeqDocument.create({
    name: options.name,
    sequence,
    topology: options.circular ? 'circular' : 'linear',
    features,
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
