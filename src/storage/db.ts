import Dexie, { type EntityTable } from 'dexie';

import { type AssemblyPart, type Enzyme, type Topology } from '@/core';

/**
 * A document as kept in IndexedDB. The sequence and annotations are stored
 * as GenBank text produced by our own writer: it round-trips losslessly,
 * stays readable if the app disappears, and avoids a second schema.
 */
export interface StoredDocument {
  readonly id: string;
  readonly name: string;
  /** Name of the file it came from or was last saved to, if any. */
  readonly fileName: string | null;
  readonly text: string;
  readonly length: number;
  readonly topology: Topology;
  readonly featureCount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** File handles are structured-clonable, so they can live in IndexedDB but not in JSON. */
export interface StoredHandle {
  readonly id: string;
  readonly handle: FileSystemFileHandle;
  /**
   * Whether the user has agreed that Save may overwrite this file on disk.
   * Set when they pick the file in a save dialog or accept the overwrite
   * prompt; absent for handles that came from opening a file.
   */
  readonly writeConfirmed?: boolean;
}

/**
 * The Cloning tab's assembly shelf. There is only ever one, under `SHELF_ID`;
 * the parts hold whole sequences, so this belongs in IndexedDB rather than
 * with the view preferences in localStorage.
 */
export interface StoredShelf {
  readonly id: string;
  readonly parts: readonly AssemblyPart[];
  readonly updatedAt: number;
}

/** Key of the single `shelf` row. */
export const SHELF_ID = 'shelf';

/**
 * An enzyme set the user imported from their own REBASE download, parsed and
 * kept so it does not have to be read again on every reload. There is only
 * ever one, under `ENZYME_SET_ID`.
 *
 * This is the user's copy of REBASE sitting in the user's own browser. We
 * neither ship it nor upload it anywhere; see `src/io/rebase/withrefm.ts`.
 */
export interface StoredEnzymeSet {
  readonly id: string;
  /** What to call it, e.g. `REBASE 609`. */
  readonly label: string;
  readonly enzymes: readonly Enzyme[];
  readonly suppliers: readonly { readonly code: string; readonly name: string }[];
  /** The file it was read from, to show in the Enzymes tab. */
  readonly fileName: string | null;
  readonly importedAt: number;
}

/** Key of the single `enzymeSets` row. */
export const ENZYME_SET_ID = 'active';

export class PlasmidPopDb extends Dexie {
  declare documents: EntityTable<StoredDocument, 'id'>;
  declare handles: EntityTable<StoredHandle, 'id'>;
  declare shelf: EntityTable<StoredShelf, 'id'>;
  declare enzymeSets: EntityTable<StoredEnzymeSet, 'id'>;

  constructor(name = 'plasmidpop') {
    super(name);
    this.version(1).stores({
      documents: 'id, updatedAt, name',
      handles: 'id',
    });
    // Version 2 adds the assembly shelf; the older stores carry over.
    this.version(2).stores({
      shelf: 'id',
    });
    // Version 3 adds the imported enzyme set.
    this.version(3).stores({
      enzymeSets: 'id',
    });
  }
}

let shared: PlasmidPopDb | null = null;

/** The app's database, created on first use so importing this module has no side effects. */
export function getDb(): PlasmidPopDb {
  shared ??= new PlasmidPopDb();
  return shared;
}
