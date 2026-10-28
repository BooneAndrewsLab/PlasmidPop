import Dexie, { type EntityTable } from 'dexie';

import {
  type AssemblyPart,
  type Enzyme,
  type SequencingRead,
  type Topology,
  documentChecksum,
  lineageParent,
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

/**
 * What a stored document is to the user (item 110): a `file` is theirs to
 * keep, a `scratch` document is something the app made on the way to one (a
 * cloning product, a fragment, a record fetched for primer design) that
 * goes after a while unless it is kept.
 */
export type DocumentKind = 'file' | 'scratch';

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
  /** Absent in every row from before scratch documents, which are all kept (a `file`). */
  readonly kind?: DocumentKind;
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
  /**
   * The checksum and name of the molecule this document was first made from
   * (`lineageParent`, item 111), so the products of one parent can be shown
   * together without parsing every text. Absent for a document with no
   * lineage, and on rows from before version 14 until the upgrade fills it in.
   */
  readonly parentChecksum?: string;
  readonly parentName?: string;
}

/**
 * What a listing of the stored documents needs of each, kept in a table of
 * its own so that listing never reads the GenBank text (item 111). It is
 * written with the row it describes, in the same transaction, by
 * `summaryOf`.
 */
export interface StoredSummary {
  readonly id: string;
  readonly name: string;
  readonly fileName: string | null;
  readonly length: number;
  readonly topology: Topology;
  readonly alphabet?: 'protein';
  readonly featureCount: number;
  readonly kind: DocumentKind;
  readonly updatedAt: number;
  readonly parentChecksum?: string;
  readonly parentName?: string;
}

/** The summary of a stored row: its small fields, none of its text. */
export function summaryOf(row: StoredDocument): StoredSummary {
  return {
    id: row.id,
    name: row.name,
    fileName: row.fileName,
    length: row.length,
    topology: row.topology,
    ...(row.alphabet === undefined ? {} : { alphabet: row.alphabet }),
    featureCount: row.featureCount,
    kind: row.kind ?? 'file',
    updatedAt: row.updatedAt,
    ...(row.parentChecksum === undefined ? {} : { parentChecksum: row.parentChecksum }),
    ...(row.parentName === undefined ? {} : { parentName: row.parentName }),
  };
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

/**
 * An enzyme the user typed in (#217), one row each under its lowercased name.
 * Kept apart from `enzymeSets` so that importing or clearing a REBASE table
 * never takes the user's own enzymes with it.
 */
export interface StoredCustomEnzyme {
  readonly id: string;
  readonly enzyme: Enzyme;
  readonly addedAt: number;
}

/** Key of the single `enzymeSets` row. */
export const ENZYME_SET_ID = 'active';

/**
 * The ligation-fidelity table the user imported (#68), one row. The data is
 * not bundled (its terms do not let this project redistribute it), so what
 * is stored is the user's own copy, kept here so it survives a reload as an
 * imported enzyme table does.
 */
export interface StoredFidelityTable {
  readonly id: string;
  readonly label: string;
  readonly fileName: string | null;
  readonly overhangLength: number;
  /** The matrix as rows of `[overhang, [[partner, count], …]]`. */
  readonly counts: readonly (readonly [string, readonly (readonly [string, number])[]])[];
  readonly importedAt: number;
}

/**
 * An overhang standard the user imported (#214), a row each under the
 * standard's id. The bundled ones are code; these are the user's own.
 */
export interface StoredOverhangStandard {
  readonly id: string;
  readonly name: string;
  readonly enzyme: string;
  readonly positions: readonly {
    readonly name: string;
    readonly left: string;
    readonly right: string;
  }[];
  readonly importedAt: number;
}

/** A codon usage table the user imported (#209), a row each under its id. */
export interface StoredCodonTable {
  readonly id: string;
  readonly name: string;
  /** Codon counts in TCAG order. */
  readonly counts: readonly number[];
  readonly importedAt: number;
}

/** Key of the single `fidelityTables` row. */
export const FIDELITY_TABLE_ID = 'active';

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

/**
 * One of the user's own parts (#210, item 86), a row each, kept as
 * `MyPart` is. Like the primers it stays in this browser.
 */
export interface StoredMyPart {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly sequence: string;
  readonly protein?: string;
  readonly notes: string;
  readonly origin: string;
  /** When it was added, which is the order the list is shown in. */
  readonly addedAt: number;
}

export class PlasmidPopDb extends Dexie {
  declare documents: EntityTable<StoredDocument, 'id'>;
  /** A small row per document for listing them without their text (item 111). */
  declare summaries: EntityTable<StoredSummary, 'id'>;
  declare shelf: EntityTable<StoredShelf, 'id'>;
  declare enzymeSets: EntityTable<StoredEnzymeSet, 'id'>;
  /** Enzymes the user typed in (#217), a row each. */
  declare customEnzymes: EntityTable<StoredCustomEnzyme, 'id'>;
  /** Each document's undo history, under the document's id (item 51). */
  declare histories: EntityTable<StoredHistory, 'id'>;
  /** The primer collection, a row per primer (#64). */
  declare primers: EntityTable<StoredPrimer, 'id'>;
  /** The imported ligation-fidelity table (#68), one row. */
  declare fidelityTables: EntityTable<StoredFidelityTable, 'id'>;
  /** Overhang standards the user imported (#214), a row each. */
  declare overhangStandards: EntityTable<StoredOverhangStandard, 'id'>;
  /** The user's own codon usage tables (#209). */
  declare codonTables: EntityTable<StoredCodonTable, 'id'>;
  /** The user's own parts for Detect features (#210), a row each. */
  declare myParts: EntityTable<StoredMyPart, 'id'>;

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
    // Version 8 adds the imported ligation-fidelity table (#68).
    this.version(8).stores({
      fidelityTables: 'id',
    });
    // Version 9 adds the user's own enzymes (#217).
    this.version(9).stores({
      customEnzymes: 'id',
    });
    // Version 10 adds the user's own overhang standards (#214).
    this.version(10).stores({
      overhangStandards: 'id',
    });
    // Version 11 adds the user's own codon usage tables (#209).
    this.version(11).stores({
      codonTables: 'id',
    });
    // Version 12 adds the user's own parts (#210).
    this.version(12).stores({
      myParts: 'id, addedAt',
    });
    // Version 13 marks scratch documents (item 110). Every row already
    // stored is the user's, and now says so, so none is ever swept up by the
    // removal of scratch rows.
    this.version(13)
      .stores({
        documents: 'id, updatedAt, name, checksum, kind',
      })
      .upgrade((tx) =>
        tx
          .table<StoredDocument, string>('documents')
          .toCollection()
          .modify((row: { kind?: DocumentKind }) => {
            row.kind ??= 'file';
          }),
      );
    // Version 14 puts what a listing needs in a table of its own, so that
    // listing no longer reads every document's text (item 111), and gives
    // each row the parent it was made from. One pass over the rows: a text
    // that will not parse is left without a parent and still listed.
    this.version(14)
      .stores({
        summaries: 'id, updatedAt',
      })
      .upgrade(async (tx) => {
        const summaries: StoredSummary[] = [];
        await tx
          .table<StoredDocument, string>('documents')
          .toCollection()
          .modify((row: { -readonly [K in keyof StoredDocument]: StoredDocument[K] }) => {
            const parent = parentOfText(row.text);
            if (parent !== null) {
              row.parentChecksum = parent.checksum;
              row.parentName = parent.name;
            }
            summaries.push(summaryOf(row));
          });
        await tx.table<StoredSummary, string>('summaries').bulkPut(summaries);
      });
  }
}

/** The molecule a stored GenBank text was first made from (`lineageParent`), or null when it has no lineage or will not parse. */
export function parentOfText(text: string): { name: string; checksum: string } | null {
  try {
    return lineageParent(parseGenBank(text).documents[0]?.metadata.lineage);
  } catch {
    return null;
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
