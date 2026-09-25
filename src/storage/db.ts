import Dexie, { type EntityTable } from 'dexie';

import { type AssemblyPart, type Enzyme, type SequencingRead, type Topology } from '@/core';

import { type StoredHistory } from './historyFormat';

/**
 * A document as kept in IndexedDB. The sequence and annotations are stored
 * as GenBank text produced by our own writer: it round-trips losslessly,
 * stays readable if the app disappears, and avoids a second schema.
 */
/**
 * The file a working copy was forked from: its name and its contents as they
 * were read, in the same GenBank text a document is stored as.
 *
 * It is kept so that a reload cannot turn a working copy back into the file
 * it came from — the original must stay both un-overwritable and available
 * to compare against.
 */
export interface StoredOrigin {
  readonly fileName: string;
  readonly text: string;
  readonly read?: SequencingRead;
}

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
  /** The file this document was forked from, when it is a working copy. */
  readonly origin?: StoredOrigin;
  /**
   * Whether the document has been edited away from `origin`, so it has a
   * name of its own and may not be written back to that file. Absent on
   * documents stored before working copies existed, which read as false.
   */
  readonly derived?: boolean;
  /**
   * The qualities and trace of a document opened from a sequencing read
   * (AB1, FASTQ), which GenBank text cannot hold. Stored as the typed
   * arrays they are; IndexedDB keeps those as they are.
   */
  readonly read?: SequencingRead;
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
  declare shelf: EntityTable<StoredShelf, 'id'>;
  declare enzymeSets: EntityTable<StoredEnzymeSet, 'id'>;
  /** Each document's undo history, under the document's id (item 51). */
  declare histories: EntityTable<StoredHistory, 'id'>;

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
    // Version 4 drops the file handles: a document is no longer bound to a
    // file on disk, so there is nothing to write back to and nothing to ask
    // permission for. Dropping the table also drops handles stored by an
    // older build, which is the point — none of them may survive a reload.
    this.version(4).stores({
      handles: null,
    });
    // Version 5 adds the undo histories, one row per document, apart from
    // the documents so that listing the recent files never reads them.
    this.version(5).stores({
      histories: 'id',
    });
  }
}

let shared: PlasmidPopDb | null = null;

/** The app's database, created on first use so importing this module has no side effects. */
export function getDb(): PlasmidPopDb {
  shared ??= new PlasmidPopDb();
  return shared;
}
