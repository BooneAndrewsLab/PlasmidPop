import Dexie, { type EntityTable } from 'dexie';

import { type Topology } from '@/core';

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

export class PlasmidPopDb extends Dexie {
  declare documents: EntityTable<StoredDocument, 'id'>;
  declare handles: EntityTable<StoredHandle, 'id'>;

  constructor(name = 'plasmidpop') {
    super(name);
    this.version(1).stores({
      documents: 'id, updatedAt, name',
      handles: 'id',
    });
  }
}

let shared: PlasmidPopDb | null = null;

/** The app's database, created on first use so importing this module has no side effects. */
export function getDb(): PlasmidPopDb {
  shared ??= new PlasmidPopDb();
  return shared;
}
