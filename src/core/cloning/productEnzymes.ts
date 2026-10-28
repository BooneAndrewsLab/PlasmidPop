import { type DigestFragment } from './digest';

/**
 * The enzymes a cloning product opens with ticked in its Enzymes tab (#309),
 * instead of every enzyme that cuts it once. Only the opening state: the
 * names are looked up in the enzyme table in use by the store, and nothing
 * here reaches a file, the undo history or the dirty mark.
 */

/** Each name once, in first-seen order, blanks dropped. */
function distinct(names: readonly (string | null | undefined)[]): string[] {
  return [...new Set(names.filter((n): n is string => n !== null && n !== undefined && n !== ''))];
}

/**
 * Ligation: the enzymes that cut the ends of the parts joined, which are
 * the ones the reaction used. A blunt or PCR end names none.
 */
export function ligationSeed(parts: readonly DigestFragment[]): string[] {
  return distinct(parts.flatMap((p) => [p.left.enzyme, p.right.enzyme]));
}

/** Restriction cloning from the primer workspace: the enzyme of each primer's end. */
export function cloningSeed(forward: string, reverse: string): string[] {
  return distinct([forward, reverse]);
}

/** Golden Gate and Modular: the Type IIS enzyme chosen, and the second when set. */
export function goldenGateSeed(enzyme: string | undefined, second?: string): string[] {
  return distinct([enzyme, second]);
}

/** An edit of a single parent (mutagenesis): what the parent has ticked. */
export function inheritedSeed(parentTicked: ReadonlySet<string>): string[] {
  return [...parentTicked];
}

/**
 * The set to open with: the wanted names the enzyme table knows, spelled as
 * the table spells them, or null when there are none, which leaves the usual
 * default in force.
 */
export function resolveSeed(
  wanted: readonly string[],
  table: readonly { readonly name: string }[],
): ReadonlySet<string> | null {
  const byName = new Map(table.map((e) => [e.name.toLowerCase(), e.name]));
  const found = wanted.flatMap((n) => byName.get(n.toLowerCase()) ?? []);
  return found.length === 0 ? null : new Set(found);
}
