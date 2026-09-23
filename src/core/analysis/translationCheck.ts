import { type SeqDocument } from '../document';
import { type Feature, type FeatureId, firstQualifier } from '../features';
import { type CdsTranslation, isCodingFeature, translateCds } from './cdsTranslation';
import { STOP, UNKNOWN_AA } from './codons';

/**
 * Something a coding feature says about itself that the sequence does not
 * bear out. Each carries the numbers rather than a sentence, so the words
 * belong to whatever shows them.
 */
export type TranslationProblem =
  | {
      readonly kind: 'unknown-table';
      readonly featureId: FeatureId;
      /** The `/transl_table` value, which names no genetic code NCBI uses. */
      readonly value: string;
    }
  | {
      readonly kind: 'unused-exception';
      readonly featureId: FeatureId;
      /** The `/transl_except` value, which is unreadable or names no codon of the feature. */
      readonly value: string;
    }
  | {
      readonly kind: 'length';
      readonly featureId: FeatureId;
      /** Residues in the stored `/translation`. */
      readonly stored: number;
      /** Residues the sequence gives, the terminal stop not counted. */
      readonly computed: number;
    }
  | {
      readonly kind: 'residue';
      readonly featureId: FeatureId;
      /** 1-based residue where the two first disagree. */
      readonly position: number;
      /** The residue the file holds there, and the one the sequence gives. */
      readonly stored: string;
      readonly computed: string;
      /** How many residues differ in all. */
      readonly differences: number;
    };

/**
 * A residue we decline to call a disagreement: `X` from us means the codon
 * holds an ambiguity code, so we cannot say what it is and the file may
 * legitimately know better, and `X` in the file is the file declining in
 * the same way. The `U` and `O` of selenocysteine and pyrrolysine are not
 * excused: a record states them through `/transl_except`, which the
 * translation applies, so one without it is a disagreement worth hearing.
 */
function excused(stored: string, computed: string): boolean {
  return computed === UNKNOWN_AA || stored === UNKNOWN_AA;
}

/** The `/translation` qualifier as one run of letters, or null when there is none. */
function storedTranslation(feature: Feature): string | null {
  const raw = firstQualifier(feature, 'translation');
  if (raw === undefined) return null;
  const protein = raw.replace(/\s+/g, '').toUpperCase();
  return protein === '' ? null : protein;
}

/** Our protein as `/translation` writes one: without the terminal stop. */
function comparable(t: CdsTranslation): string {
  return t.protein.endsWith(STOP) ? t.protein.slice(0, -1) : t.protein;
}

/**
 * The `/translation` a coding feature should carry for the bases it has now:
 * what "Update /translation" writes when an edit has left the stored one
 * behind (#2).
 */
export function translationFor(doc: SeqDocument, feature: Feature): string {
  return comparable(translateCds(doc, feature));
}

/** Whether a problem is the stored `/translation` disagreeing, which updating it would settle. */
export function isStaleTranslation(problem: TranslationProblem): boolean {
  return problem.kind === 'length' || problem.kind === 'residue';
}

/**
 * Checks one coding feature against what it claims: that its
 * `/transl_table` names a genetic code, that each `/transl_except` names one
 * of its codons, and that the `/translation` the file
 * carries is the protein its bases give. A feature with no `/translation` is
 * only checked for the first.
 *
 * The comparison is the honest test of everything under it — the genetic
 * codes, `/codon_start`, `join(...)`, the reverse strand, a CDS that wraps
 * the origin — because the file's own author translated the same bases.
 */
export function checkCdsTranslation(doc: SeqDocument, feature: Feature): TranslationProblem[] {
  const problems: TranslationProblem[] = [];
  const t = translateCds(doc, feature);
  if (t.unknownTable !== null) {
    problems.push({ kind: 'unknown-table', featureId: feature.id, value: t.unknownTable });
  }
  for (const value of t.unusedExceptions) {
    problems.push({ kind: 'unused-exception', featureId: feature.id, value });
  }
  const stored = storedTranslation(feature);
  if (stored === null) return problems;
  const computed = comparable(t);
  if (stored.length !== computed.length) {
    problems.push({
      kind: 'length',
      featureId: feature.id,
      stored: stored.length,
      computed: computed.length,
    });
    return problems;
  }
  let first = -1;
  let differences = 0;
  for (let i = 0; i < stored.length; i++) {
    const a = stored.charAt(i);
    const b = computed.charAt(i);
    if (a === b || excused(a, b)) continue;
    if (first < 0) first = i;
    differences++;
  }
  if (first >= 0) {
    problems.push({
      kind: 'residue',
      featureId: feature.id,
      position: first + 1,
      stored: stored.charAt(first),
      computed: computed.charAt(first),
      differences,
    });
  }
  return problems;
}

/** Every coding feature's problems, in the order the features are in. */
export function checkTranslations(doc: SeqDocument): TranslationProblem[] {
  return doc.features
    .all()
    .filter((f) => isCodingFeature(f))
    .flatMap((f) => checkCdsTranslation(doc, f));
}
