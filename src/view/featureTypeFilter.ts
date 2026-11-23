import { type Feature } from '@/core';

/**
 * The Features tab's filter by type (item 150, #453): which rows the list
 * shows, and nothing else. It is a view concern through and through; the
 * document, the undo history, the views and every export are never asked
 * what it is set to.
 */

/**
 * The list has to be at least this long before the filter is offered. Under
 * it every row is in sight at once (a row is about 44 px, so eight are half
 * the panel on a desktop and one screen of it on a phone), and a row of
 * chips above four features is furniture, not help.
 */
export const TYPE_FILTER_MIN_FEATURES = 8;

/** One chip of the filter: a type, how many rows it has, whether it is on. */
export interface TypeChip {
  readonly type: string;
  readonly count: number;
  readonly on: boolean;
}

/** How many of `features` each type has. */
export function countTypes(features: readonly Feature[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of features) counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
  return counts;
}

/**
 * The chips to offer: one for each type the list has, plus any chosen type
 * the list has since lost (its features removed, or left out by a transcript
 * pick), at a count of zero, so a filter that empties the list still shows
 * what it is. Sorted as Format ▸ Feature types sorts its ticks, so a type is
 * in the same place in both.
 */
export function typeChips(
  counts: ReadonlyMap<string, number>,
  chosen: readonly string[],
): TypeChip[] {
  const types = new Set([...counts.keys(), ...chosen]);
  return [...types].sort().map((type) => ({
    type,
    count: counts.get(type) ?? 0,
    on: chosen.includes(type),
  }));
}

/**
 * How many type chips are shown before the rest fold behind **+N more**. A
 * plasmid has six to ten types, which is two or three rows of chips; a record
 * with twenty would put a screen of buttons between a phone's user and the
 * list they came for.
 */
export const TYPE_FILTER_FOLD = 8;

/**
 * The chips shown while the filter is folded, and how many are behind **+N
 * more**: the `limit` types with the most features (the ones a filter is most
 * likely wanted for; ties go to the earlier chip), and every chip that is on,
 * so a filter in force is never out of sight. They stay in the order they
 * were given. Nothing folds for a single chip over the limit: the button that
 * would hide it takes the room it would free.
 */
export function foldChips(
  chips: readonly TypeChip[],
  limit: number = TYPE_FILTER_FOLD,
): { readonly shown: readonly TypeChip[]; readonly folded: number } {
  if (chips.length <= limit + 1) return { shown: chips, folded: 0 };
  const top = new Set(
    chips
      .map((chip, at) => ({ chip, at }))
      .sort((a, b) => b.chip.count - a.chip.count || a.at - b.at)
      .slice(0, limit)
      .map(({ chip }) => chip.type),
  );
  const shown = chips.filter((c) => c.on || top.has(c.type));
  return { shown, folded: chips.length - shown.length };
}

/**
 * Whether the filter is worth its row: two types or more to choose between,
 * in a list long enough to need it. A filter that is set is always shown,
 * whatever the list has shrunk to, or there would be no way to clear it.
 */
export function offersTypeFilter(
  counts: ReadonlyMap<string, number>,
  chosen: readonly string[],
): boolean {
  if (chosen.length > 0) return true;
  let total = 0;
  for (const n of counts.values()) total += n;
  return counts.size >= 2 && total >= TYPE_FILTER_MIN_FEATURES;
}

/** `chosen` with `type` switched: added when absent, taken out when there. */
export function toggleType(chosen: readonly string[], type: string): string[] {
  return chosen.includes(type) ? chosen.filter((t) => t !== type) : [...chosen, type].sort();
}

/**
 * The rows the filter leaves: every feature when nothing is chosen, else
 * those of a chosen type. `keep` are features shown whatever their type: the
 * one being renamed or edited, whose form would otherwise vanish under the
 * user's hands (a feature just added from the selection opens in the editor,
 * and is a `misc_feature` until they say otherwise).
 */
export function filterByType(
  features: readonly Feature[],
  chosen: readonly string[],
  keep: ReadonlySet<string> = NONE,
): readonly Feature[] {
  if (chosen.length === 0) return features;
  return features.filter((f) => chosen.includes(f.type) || keep.has(f.id));
}

const NONE: ReadonlySet<string> = new Set();

/** "No CDS features in this list." / "No CDS, gene or mRNA features in this list." */
export function emptyFilterText(chosen: readonly string[]): string {
  const types = [...chosen].sort();
  const last = types.pop() ?? '';
  const named = types.length === 0 ? last : `${types.join(', ')} or ${last}`;
  return `No ${named} features in this list.`;
}
