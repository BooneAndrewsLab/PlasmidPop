import Dexie, { type EntityTable } from 'dexie';

import {
  type AssemblyPart,
  type Enzyme,
  type SequencingRead,
  type Topology,
  documentChecksum,
} from '@/core';
import { parseGenBank } from '@/io';

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
  /** 'protein' for a protein (#66); absent for DNA, and in every row from before proteins. */
  readonly alphabet?: 'protein';
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
  /**
   * The molecule's checksum (`documentChecksum`, in full), so a lineage's
   * node can find the stored document it names without every stored text
   * being parsed (#67). Absent for an empty document, and on rows stored
   * before version 6 until the upgrade fills it in.
   */
  readonly checksum?: string;
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

/**
 * One primer of the user's collection (#64, item 56), a row each so that
 * adding or editing one writes one row. Like the documents it stays in this
 * browser: it leaves only as a download the user asks for.
 */
export interface StoredPrimer {
  readonly id: string;
  readonly name: string;
  readonly sequence: string;
  readonly notes: string;
  /** When it was added, which is the order the list is shown in. */
  readonly addedAt: number;
  readonly updatedAt: number;
}

export class PlasmidPopDb extends Dexie {
  declare documents: EntityTable<StoredDocument, 'id'>;
  declare shelf: EntityTable<StoredShelf, 'id'>;
  declare enzymeSets: EntityTable<StoredEnzymeSet, 'id'>;
  /** Each document's undo history, under the document's id (item 51). */
  declare histories: EntityTable<StoredHistory, 'id'>;
  /** The primer collection, a row per primer (#64). */
  declare primers: EntityTable<StoredPrimer, 'id'>;

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
    // Version 6 indexes each document's checksum, for finding the version a
    // node of a lineage names (#67). Rows already there get theirs from
    // their text; one that will not parse is left without, and is only
    // not found.
    this.version(6)
      .stores({
        documents: 'id, updatedAt, name, checksum',
      })
      .upgrade((tx) =>
        tx
          .table<StoredDocument, string>('documents')
          .toCollection()
          .modify((row: { text: string; checksum?: string }) => {
            const checksum = checksumOfText(row.text);
            if (checksum !== null) row.checksum = checksum;
          }),
      );
    // Version 7 adds the primer collection (#64).
    this.version(7).stores({
      primers: 'id, addedAt',
    });
  }
}

/** The checksum of the document a stored GenBank text holds, or null when there is none to take. */
export function checksumOfText(text: string): string | null {
  try {
    const doc = parseGenBank(text).documents[0];
    return doc === undefined ? null : (documentChecksum(doc)?.text ?? null);
  } catch {
    return null;
  }
}

let shared: PlasmidPopDb | null = null;

/** The app's database, created on first use so importing this module has no side effects. */
export function getDb(): PlasmidPopDb {
  shared ??= new PlasmidPopDb();
  return shared;
}
