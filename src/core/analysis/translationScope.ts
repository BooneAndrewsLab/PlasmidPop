import { type Feature, featureLength, firstQualifier } from '../features';

/**
 * Which CDS features get a translation line (#304): every one, only the
 * selected one, or one per gene so overlapping isoforms do not stack.
 */
export type TranslationScope = 'all' | 'selected' | 'gene';

export const TRANSLATION_SCOPES: readonly TranslationScope[] = ['all', 'selected', 'gene'];

export const DEFAULT_TRANSLATION_SCOPE: TranslationScope = 'gene';

export function isTranslationScope(v: unknown): v is TranslationScope {
  return typeof v === 'string' && (TRANSLATION_SCOPES as readonly string[]).includes(v);
}

/** Whether `a` is the better of two CDSs of one gene to show: longer, then named for the gene, then first listed. */
function betterOf(a: Feature, b: Feature, gene: string): Feature {
  const byLength = featureLength(a) - featureLength(b);
  if (byLength !== 0) return byLength > 0 ? a : b;
  const aNamed = a.name === gene;
  if (aNamed !== (b.name === gene)) return aNamed ? a : b;
  // Equal in both: keep the earlier one so the choice does not depend on how a map orders its keys.
  return a;
}

/**
 * The coding features to translate, in their given order. `coding` is the
 * document's CDS features; `selectedId` is the feature selected in the
 * view, which every scope but 'selected' shows in addition. Under 'gene' a
 * gene's CDSs share one line: the longest by total length over all its
 * segments (a join or a wrap counts every piece), the one named after the
 * gene on a tie. A CDS with no `/gene` is a group of its own.
 */
export function translatedFeatures(
  coding: readonly Feature[],
  scope: TranslationScope,
  selectedId: string | null,
): readonly Feature[] {
  if (scope === 'all') return coding;
  if (scope === 'selected') return coding.filter((f) => f.id === selectedId);
  const best = new Map<string, Feature>();
  for (const feature of coding) {
    const gene = firstQualifier(feature, 'gene')?.trim();
    if (gene === undefined || gene === '') continue;
    const kept = best.get(gene);
    best.set(gene, kept === undefined ? feature : betterOf(kept, feature, gene));
  }
  const chosen = new Set(best.values());
  return coding.filter((f) => {
    const gene = firstQualifier(f, 'gene')?.trim();
    return f.id === selectedId || gene === undefined || gene === '' || chosen.has(f);
  });
}
