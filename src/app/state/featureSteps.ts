import { type Feature, type Range } from '@/core';
import { newId } from '@/core';

import { editorStore } from './editorStore';

/**
 * Adds features as one undo step: each after the first merges into the step
 * before it, so a button that annotates several sites at once is taken back
 * by one Undo, as it was made by one click (#64, #96). `selectionAfter` is
 * where the caret or selection goes once they are in.
 */
export function addFeaturesAsOneStep(
  features: readonly Feature[],
  selectionAfter?: Range | null,
): void {
  const run = `primer-sites:${newId()}`;
  features.forEach((feature, i) => {
    editorStore.apply({ type: 'addFeature', feature }, selectionAfter, undefined, {
      follows: i === 0 ? `${run}:start` : run,
      key: run,
      withinMs: 60_000,
      relabel: (n) => `Add ${n.toLocaleString()} primer sites`,
    });
  });
}
