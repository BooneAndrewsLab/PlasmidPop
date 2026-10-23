import { translate } from '../analysis/codons';
import { type Topology } from '../range';
import { reverseComplement } from '../sequence/alphabet';
import { type FeatureHit } from './detect';
import { type FeatureLibrary, type LibraryPart } from './library';

/**
 * Variant names (#284, docs/design/59-detect-features.md).
 *
 * Some parts are named for one variant of an element: the trc promoter
 * against tac, kanMX's kanamycin gene against the transposon's, luc+ against
 * luc2, avGFP against the GFP mutants, DsRed-Express2 against the other
 * DsReds, the Tn10 repressor against the one inside an rtTA. The name is a
 * claim about the bases, and a near match of the variant's part is usually
 * the other variant: within the identity a match allows, and so reported
 * under a name its bases do not support.
 *
 * A part may therefore say in the library what a hit must show for its name
 * to be used (`variant`, see `PartVariant`), and what the element itself is
 * called (`family`). A hit that does not show it is reported under the
 * family name, or, where the part names no family — because another part of
 * ours is the right answer there — not reported at all.
 */

/** A hit's bases as the part reads them: the matched stretch, on the hit's strand. */
function matchedBases(hit: FeatureHit, sequence: string, topology: Topology): string {
  const { start, end } = hit.range;
  const n = sequence.length;
  const plain =
    topology === 'circular' && end > n
      ? sequence.slice(start, n) + sequence.slice(0, end - n)
      : sequence.slice(Math.max(0, start), Math.min(end, n));
  return hit.strand === 'forward' ? plain : reverseComplement(plain);
}

/**
 * Whether a hit shows what names the part's variant. A part with no
 * `variant` always does; everything else is a question about the bases that
 * were matched.
 */
export function showsVariant(
  hit: FeatureHit,
  part: Pick<LibraryPart, 'sequence' | 'protein' | 'variant'>,
  sequence: string,
  topology: Topology,
): boolean {
  const variant = part.variant;
  if (variant === undefined) return true;
  // A homologue is only similar to the part (#219), so it shows nothing of
  // what tells one variant of it from another.
  if (hit.similar !== undefined) return false;
  if (variant.codons === true && hit.viaProtein === true) return false;
  const bases = matchedBases(hit, sequence, topology);
  if (variant.bases !== undefined) {
    const want = part.sequence.slice(variant.bases.start - 1, variant.bases.end);
    // Looked for in what was matched rather than at a fixed offset, so a
    // base missing from the stretch itself is caught (the one base of the
    // trc spacer that makes it tac) along with any other indel before it.
    if (want === '' || !bases.includes(want)) return false;
  }
  if (variant.protein !== undefined) {
    const want = part.protein ?? '';
    // Residues are counted off from the start of the part, which an indel or
    // a cut-off end moves. Such a hit cannot be held against them.
    const whole =
      (hit.insertions ?? 0) === 0 &&
      (hit.deletions ?? 0) === 0 &&
      !(hit.partialStart ?? false) &&
      !(hit.partialEnd ?? false);
    if (!whole) return false;
    const got = translate(bases).replace(/\*$/, '');
    if (got.length !== want.length) return false;
    const positions =
      variant.protein === 'exact'
        ? Array.from({ length: want.length }, (_, i) => i + 1)
        : variant.protein;
    for (const at of positions) {
      if (got[at - 1] !== want[at - 1]) return false;
    }
  }
  return true;
}

/**
 * Hits with their variant names settled: a hit that does not show what names
 * its part is marked `family` (so it is reported under the element's name),
 * or dropped where the part names no family. Applied before the hits are
 * reduced, so a hit no one will see displaces nothing.
 */
export function withVariantNames<T extends FeatureHit>(
  hits: readonly T[],
  sequence: string,
  topology: Topology,
  library: FeatureLibrary,
): T[] {
  const out: T[] = [];
  for (const hit of hits) {
    const part = library.parts[hit.part];
    if (part?.variant === undefined || showsVariant(hit, part, sequence, topology)) {
      out.push(hit);
      continue;
    }
    if (part.variant.family === undefined) continue;
    out.push({ ...hit, family: true });
  }
  return out;
}

/**
 * What a hit is called: the part's name, the element's name where the hit
 * does not show the variant (#284), and either of those prefixed for a
 * homologue, which is never named as the part itself (#219).
 */
export function nameOfHit(
  hit: Pick<FeatureHit, 'family' | 'similar'>,
  part: Pick<LibraryPart, 'name' | 'variant'>,
): string {
  const name = (hit.family === true ? part.variant?.family : undefined) ?? part.name;
  return hit.similar === undefined ? name : `similar to ${name}`;
}
