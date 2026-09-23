import { useMemo } from 'react';

import {
  type Feature,
  type FeatureId,
  type SeqDocument,
  type TranslationProblem,
  checkCdsTranslation,
  isCodingFeature,
} from '@/core';

/**
 * A coding feature's last check, and the bases it was made on. Features are
 * immutable, so a feature an edit did not touch is the same object in the
 * next version of the document, and its bases say whether the edit reached
 * under it; only when either changed is it translated again.
 */
const cache = new WeakMap<
  Feature,
  { readonly bases: string; readonly problems: TranslationProblem[] }
>();

/**
 * What each coding feature of `doc` claims that its bases no longer bear out,
 * by feature, for the version on screen rather than the file as it was
 * opened (#2): an edit inside a CDS that carries a `/translation` leaves the
 * stored protein behind, and the feature list says so there and then.
 */
export function translationProblems(
  doc: SeqDocument,
): ReadonlyMap<FeatureId, TranslationProblem[]> {
  const out = new Map<FeatureId, TranslationProblem[]>();
  for (const feature of doc.features.all()) {
    if (!isCodingFeature(feature)) continue;
    const bases = doc.featureSequence(feature.id);
    const hit = cache.get(feature);
    const problems = hit?.bases === bases ? hit.problems : checkCdsTranslation(doc, feature);
    if (hit?.problems !== problems) cache.set(feature, { bases, problems });
    if (problems.length > 0) out.set(feature.id, problems);
  }
  return out;
}

export function useTranslationProblems(
  doc: SeqDocument,
): ReadonlyMap<FeatureId, TranslationProblem[]> {
  return useMemo(() => translationProblems(doc), [doc]);
}
