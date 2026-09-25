import { useMemo } from 'react';

import {
  type AssemblyPart,
  type SeqDocument,
  defaultFragmentName,
  documentFromFragment,
} from '@/core';

import { type DocumentState, cloningDocuments } from '../state/editorStore';

/** One thing in the tube: an open document, or a fragment off the shelf. */
export interface Ingredient {
  /** The document's tab id, or the shelf part's id. */
  readonly id: string;
  readonly document: SeqDocument;
  /** What it is, beside the name: its length, and where it came from. */
  readonly detail: string;
}

/**
 * The shelf as a one-pot reaction sees it: each collected fragment as a
 * linear document of its own, ends and features and all, which is what
 * `documentFromFragment` already makes for **Open** in the digest list. So a
 * piece cut out of a plasmid and a product opened from a file go into the
 * same tube without Golden Gate or Gibson knowing the difference.
 *
 * Two fragments of one digest with the same enzyme at both ends have the
 * same default name, and a name is how both panels report an ambiguity, so a
 * repeat is numbered.
 */
export function shelfIngredients(assembly: readonly AssemblyPart[]): Ingredient[] {
  const used = new Map<string, number>();
  return assembly.map((part) => {
    const base = defaultFragmentName(part.fragment);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const name = n === 1 ? base : `${base} ${n}`;
    return {
      id: part.id,
      document: documentFromFragment(part.fragment, { name }),
      detail: `${part.fragment.sequence.length.toLocaleString()} bp from the shelf`,
    };
  });
}

/** The open tabs as ingredients, in tab order and ahead of the shelf. */
export function openIngredients(documents: readonly DocumentState[]): Ingredient[] {
  // A protein tab is no ingredient (#66).
  return cloningDocuments(documents).map((d) => ({
    id: d.documentId,
    document: d.history.present,
    detail: `${d.history.present.length.toLocaleString()} bp`,
  }));
}

/** The documents a reaction should run over, and the ticks that chose them. */
export function useTube(
  documents: readonly DocumentState[],
  assembly: readonly AssemblyPart[],
  excluded: ReadonlySet<string>,
): { readonly ingredients: Ingredient[]; readonly docs: SeqDocument[] } {
  const fromShelf = useMemo(() => shelfIngredients(assembly), [assembly]);
  const ingredients = useMemo(
    () => [...openIngredients(documents), ...fromShelf],
    [documents, fromShelf],
  );
  const docs = useMemo(
    () => ingredients.filter((i) => !excluded.has(i.id)).map((i) => i.document),
    [ingredients, excluded],
  );
  return { ingredients, docs };
}
