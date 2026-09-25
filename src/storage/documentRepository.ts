import {
  type Alphabet,
  type AssemblyPart,
  type CollectionPrimer,
  type Enzyme,
  type EnzymeSet,
  type OverhangKind,
  type SeqDocument,
  type SequencingRead,
  cleanPrimer,
  describeEditOp,
  documentChecksum,
  isLineageNode,
} from '@/core';
import { parseGenBank, writeGenBank } from '@/io';

import { type PlasmidPopDb, type StoredDocument, ENZYME_SET_ID, SHELF_ID, getDb } from './db';
import {
  type HistoryToStore,
  type RestoredHistory,
  decodeHistory,
  encodeHistory,
} from './historyCodec';
import { isStoredHistory } from './historyFormat';

const LAST_DOCUMENT_KEY = 'plasmidpop.lastDocument';
const OPEN_DOCUMENTS_KEY = 'plasmidpop.openDocuments';

/**
 * Where a document came from, as `save` takes it: the file it was forked
 * from, if any, and whether it has been forked off it. Kept out of the
 * document itself because it describes the tab's relationship to a file,
 * not the molecule.
 */
export interface DocumentProvenance {
  readonly origin: { readonly fileName: string; readonly doc: SeqDocument } | null;
  readonly derived: boolean;
}

const NO_PROVENANCE: DocumentProvenance = { origin: null, derived: false };

/**
 * What became of a stored undo history on the way back in: there was none,
 * it came back, or there was a row that could not be read (or did not end at
 * the stored document) and was left behind.
 */
export type HistoryStatus = 'none' | 'restored' | 'dropped';

/** A stored document read back, with what is known about where it came from. */
export interface StoredLoad extends DocumentProvenance {
  readonly doc: SeqDocument;
  readonly fileName: string | null;
  /**
   * Its undo history, whose present is `doc`, with the baselines that point
   * into it; null when there is none to give back (`historyStatus` says why).
   */
  readonly history: RestoredHistory | null;
  readonly historyStatus: HistoryStatus;
}

export interface DocumentSummary {
  readonly id: string;
  readonly name: string;
  readonly fileName: string | null;
  readonly length: number;
  readonly topology: StoredDocument['topology'];
  readonly alphabet: Alphabet;
  readonly featureCount: number;
  readonly updatedAt: number;
}

/**
 * A stored document with its read put back. A read that no longer fits the
 * bases (it should not happen: an edit drops it) is left off rather than
 * losing the document.
 */
function withStoredRead<D extends SeqDocument | undefined>(
  doc: D,
  read: SequencingRead | undefined,
): D {
  if (doc === undefined || read === undefined) return doc;
  try {
    return doc.setRead(read) as D;
  } catch {
    return doc;
  }
}

/**
 * Persistence for open documents. Every method takes the database as an
 * optional last argument so tests can use an isolated instance.
 */
export class DocumentRepository {
  constructor(private readonly db: PlasmidPopDb = getDb()) {}

  /**
   * Writes a document, and with `history` its undo history in the same
   * transaction, so the two can never be read back out of step. A history
   * whose present is not `doc`, or that is too large to keep any of
   * (`encodeHistory`), deletes the stored one; null deletes it too, and
   * leaving `history` out leaves whatever is stored alone.
   */
  async save(
    id: string,
    doc: SeqDocument,
    fileName: string | null,
    provenance: DocumentProvenance = NO_PROVENANCE,
    history?: HistoryToStore | null,
  ): Promise<void> {
    const now = Date.now();
    const origin = provenance.origin;
    // Worked out before the transaction: IndexedDB commits a transaction
    // that has nothing pending while other work runs.
    const row =
      history === undefined
        ? undefined
        : history?.history.present !== doc
          ? null
          : encodeHistory(id, history, undefined, now);
    const text = writeGenBank(doc);
    const originText = origin === null ? null : writeGenBank(origin.doc);
    await this.db.transaction('rw', this.db.documents, this.db.histories, async () => {
      const existing = await this.db.documents.get(id);
      await this.db.documents.put(
        this.documentRow(
          id,
          doc,
          fileName,
          provenance,
          text,
          originText,
          existing?.createdAt ?? now,
          now,
        ),
      );
      if (row === null) await this.db.histories.delete(id);
      else if (row !== undefined) await this.db.histories.put(row);
    });
  }

  private documentRow(
    id: string,
    doc: SeqDocument,
    fileName: string | null,
    provenance: DocumentProvenance,
    text: string,
    originText: string | null,
    createdAt: number,
    now: number,
  ): StoredDocument {
    const origin = provenance.origin;
    const checksum = documentChecksum(doc)?.text;
    return {
      id,
      name: doc.name,
      fileName,
      text,
      ...(checksum === undefined ? {} : { checksum }),
      ...(doc.read === null ? {} : { read: doc.read }),
      length: doc.length,
      topology: doc.topology,
      ...(doc.isProtein ? { alphabet: 'protein' as const } : {}),
      featureCount: doc.features.size,
      createdAt,
      updatedAt: now,
      ...(origin === null || originText === null
        ? {}
        : {
            origin: {
              fileName: origin.fileName,
              text: originText,
              ...(origin.doc.read === null ? {} : { read: origin.doc.read }),
            },
          }),
      ...(provenance.derived ? { derived: true } : {}),
    };
  }

  async has(id: string): Promise<boolean> {
    return (await this.db.documents.where('id').equals(id).count()) > 0;
  }

  /**
   * Id of a stored document identical to `doc` (same GenBank text and file
   * name), so opening the same file or example twice does not add a second
   * entry to the recent list.
   */
  async findIdentical(doc: SeqDocument, fileName: string | null): Promise<string | null> {
    const text = writeGenBank(doc);
    const match = await this.db.documents
      .where('name')
      .equals(doc.name)
      .filter((d) => d.fileName === fileName && d.text === text)
      .first();
    return match?.id ?? null;
  }

  async load(id: string): Promise<StoredLoad | null> {
    const stored = await this.db.documents.get(id);
    if (stored === undefined) return null;
    const parsed = parseGenBank(stored.text).documents[0];
    if (parsed === undefined) return null;
    const doc = withStoredRead(parsed, stored.read);
    const storedOrigin = stored.origin;
    // A working copy whose origin will not parse is still a working copy:
    // it keeps `derived`, so the file it came from stays un-overwritable
    // even when we can no longer show what changed.
    const originDoc =
      storedOrigin === undefined
        ? undefined
        : withStoredRead(parseGenBank(storedOrigin.text).documents[0], storedOrigin.read);
    const origin =
      storedOrigin === undefined || originDoc === undefined
        ? null
        : { fileName: storedOrigin.fileName, doc: originDoc };
    const { history, historyStatus } = await this.loadHistory(id, stored, origin?.doc ?? null);
    return {
      doc: history?.history.present ?? doc.rename(stored.name),
      fileName: stored.fileName,
      origin,
      derived: stored.derived ?? false,
      history,
      historyStatus,
    };
  }

  /**
   * The undo history stored for a document, when there is one that reads
   * back and ends exactly at the stored document. Anything else — a row
   * from another build, a damaged one, one left out of step — costs the
   * history and never the document.
   */
  private async loadHistory(
    id: string,
    stored: StoredDocument,
    origin: SeqDocument | null,
  ): Promise<{ history: RestoredHistory | null; historyStatus: HistoryStatus }> {
    let row: unknown;
    try {
      row = await this.db.histories.get(id);
    } catch {
      return { history: null, historyStatus: 'dropped' };
    }
    if (row === undefined) return { history: null, historyStatus: 'none' };
    const decoded = decodeHistory(row, origin);
    const present = decoded?.history.present;
    const matches =
      decoded !== null &&
      present !== undefined &&
      isStoredHistory(row) &&
      row.id === id &&
      present.name === stored.name &&
      writeGenBank(present) === stored.text;
    return matches
      ? { history: decoded, historyStatus: 'restored' }
      : { history: null, historyStatus: 'dropped' };
  }

  /**
   * Renames a stored document in place; false when there is no such
   * document. The rename is a step of its history, as it would be in a tab.
   */
  async rename(id: string, name: string): Promise<boolean> {
    const stored = await this.load(id);
    if (stored === null) return false;
    const renamed = stored.doc.rename(name);
    const kept = stored.history;
    await this.save(
      id,
      renamed,
      stored.fileName,
      { origin: stored.origin, derived: stored.derived },
      kept === null
        ? null
        : {
            history: kept.history.seal().push(renamed, describeEditOp({ type: 'rename', name })),
            opened: kept.opened,
            saved: kept.saved,
            origin: stored.origin?.doc ?? null,
          },
    );
    return true;
  }

  /**
   * The stored documents holding each of `checksums`, as checksum → id, for
   * the nodes of a lineage (#67). One indexed lookup: no text is parsed. Of
   * two stored documents with one checksum, the one written last wins.
   */
  async findByChecksums(checksums: readonly string[]): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    if (checksums.length === 0) return found;
    const rows = await this.db.documents
      .where('checksum')
      .anyOf([...checksums])
      .toArray();
    rows.sort((a, b) => a.updatedAt - b.updatedAt);
    for (const row of rows) if (row.checksum !== undefined) found.set(row.checksum, row.id);
    return found;
  }

  /** Whether a document has a stored undo history row. */
  async hasHistory(id: string): Promise<boolean> {
    return (await this.db.histories.where('id').equals(id).count()) > 0;
  }

  async list(): Promise<DocumentSummary[]> {
    const all = await this.db.documents.orderBy('updatedAt').reverse().toArray();
    return all.map(
      ({ id, name, fileName, length, topology, alphabet, featureCount, updatedAt }) => ({
        id,
        name,
        fileName,
        length,
        topology,
        alphabet: alphabet ?? 'nucleotide',
        featureCount,
        updatedAt,
      }),
    );
  }

  /** Deletes a document and its undo history; closing a tab deletes neither. */
  async remove(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.documents, this.db.histories, async () => {
      await this.db.documents.delete(id);
      await this.db.histories.delete(id);
    });
    if (this.lastDocumentId() === id) this.setLastDocumentId(null);
    this.setOpenDocumentIds(this.openDocumentIds().filter((open) => open !== id));
  }

  /** The document that was in front when the page was last left, or null for the file list. */
  lastDocumentId(): string | null {
    try {
      return globalThis.localStorage.getItem(LAST_DOCUMENT_KEY);
    } catch {
      return null;
    }
  }

  /** Ids of the documents that were open in tabs, in tab order, when the page was last left. */
  openDocumentIds(): readonly string[] {
    try {
      const raw = globalThis.localStorage.getItem(OPEN_DOCUMENTS_KEY);
      if (raw === null) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }

  setOpenDocumentIds(ids: readonly string[]): void {
    try {
      if (ids.length === 0) globalThis.localStorage.removeItem(OPEN_DOCUMENTS_KEY);
      else globalThis.localStorage.setItem(OPEN_DOCUMENTS_KEY, JSON.stringify(ids));
    } catch {
      // Best effort, like `setLastDocumentId`.
    }
  }

  /**
   * The Cloning tab's assembly shelf. Stored parts are checked on the way in
   * rather than trusted: a row written by an older build, or one that has
   * gone bad, should cost the user a fragment, not the Cloning tab.
   */
  async loadShelf(): Promise<AssemblyPart[]> {
    const stored = await this.db.shelf.get(SHELF_ID);
    if (stored === undefined) return [];
    return stored.parts.filter((p): p is AssemblyPart => isAssemblyPart(p)).map(withUsableLineage);
  }

  /** Writes the shelf, removing the row altogether when it is empty. */
  async saveShelf(parts: readonly AssemblyPart[]): Promise<void> {
    if (parts.length === 0) {
      await this.db.shelf.delete(SHELF_ID);
      return;
    }
    await this.db.shelf.put({ id: SHELF_ID, parts, updatedAt: Date.now() });
  }

  /**
   * The imported enzyme set, checked on the way in like the shelf: a row from
   * an older build should cost the user an import, not the Enzymes tab.
   * Returns null when nothing was imported or nothing survived the check.
   */
  async loadEnzymeSet(): Promise<(EnzymeSet & { fileName: string | null }) | null> {
    const stored = await this.db.enzymeSets.get(ENZYME_SET_ID);
    if (stored === undefined) return null;
    const enzymes = (stored.enzymes as readonly unknown[]).filter((e): e is Enzyme => isEnzyme(e));
    if (enzymes.length === 0) return null;
    const suppliers = (stored.suppliers as readonly unknown[]).filter(
      (v): v is { code: string; name: string } =>
        isObject(v) && isString(v['code']) && isString(v['name']),
    );
    return {
      id: 'rebase',
      label: isString(stored.label) ? stored.label : 'Imported enzymes',
      enzymes,
      suppliers,
      fileName: isString(stored.fileName) ? stored.fileName : null,
    };
  }

  /** Writes the imported set, removing the row when given null. */
  async saveEnzymeSet(set: (EnzymeSet & { fileName: string | null }) | null): Promise<void> {
    if (set === null) {
      await this.db.enzymeSets.delete(ENZYME_SET_ID);
      return;
    }
    await this.db.enzymeSets.put({
      id: ENZYME_SET_ID,
      label: set.label,
      enzymes: set.enzymes,
      suppliers: set.suppliers,
      fileName: set.fileName,
      importedAt: Date.now(),
    });
  }

  /**
   * The primer collection, in the order the primers were added. Rows are
   * checked on the way in like the shelf's: one written wrong costs that
   * primer, not the list.
   */
  async loadPrimers(): Promise<CollectionPrimer[]> {
    const rows = (await this.db.primers.orderBy('addedAt').toArray()) as readonly unknown[];
    const out: CollectionPrimer[] = [];
    for (const row of rows) {
      if (!isObject(row)) continue;
      const { id, name, sequence, notes } = row;
      if (typeof id !== 'string' || typeof name !== 'string' || typeof sequence !== 'string') {
        continue;
      }
      const bases = cleanPrimer(sequence);
      if (bases === '') continue;
      out.push({ id, name, sequence: bases, notes: typeof notes === 'string' ? notes : '' });
    }
    return out;
  }

  /**
   * Writes primers of the collection, new or edited, keeping the time each
   * was first added so an edit does not move it down the list.
   */
  async putPrimers(primers: readonly CollectionPrimer[]): Promise<void> {
    if (primers.length === 0) return;
    const now = Date.now();
    await this.db.transaction('rw', this.db.primers, async () => {
      const before = await this.db.primers.bulkGet(primers.map((p) => p.id));
      await this.db.primers.bulkPut(
        primers.map((p, i) => ({
          id: p.id,
          name: p.name,
          sequence: p.sequence,
          notes: p.notes,
          // Distinct times for a batch, so the order it was pasted in holds.
          addedAt: before[i]?.addedAt ?? now + i / 1000,
          updatedAt: now,
        })),
      );
    });
  }

  async deletePrimers(ids: readonly string[]): Promise<void> {
    await this.db.primers.bulkDelete([...ids]);
  }

  setLastDocumentId(id: string | null): void {
    try {
      if (id === null) globalThis.localStorage.removeItem(LAST_DOCUMENT_KEY);
      else globalThis.localStorage.setItem(LAST_DOCUMENT_KEY, id);
    } catch {
      // Storage may be unavailable (private mode, quota); persistence is best effort.
    }
  }
}

function isEnzyme(v: unknown): v is Enzyme {
  return (
    isObject(v) &&
    isString(v['name']) &&
    isString(v['site']) &&
    typeof v['cutTop'] === 'number' &&
    typeof v['cutBottom'] === 'number' &&
    typeof v['palindromic'] === 'boolean'
  );
}

const OVERHANG_KINDS: ReadonlySet<string> = new Set<OverhangKind>(['blunt', "5'", "3'"]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isString(v: unknown): boolean {
  return typeof v === 'string';
}

function isStrandEnd(v: unknown): boolean {
  if (!isObject(v)) return false;
  const kind: unknown = v['kind'];
  return (
    typeof kind === 'string' &&
    OVERHANG_KINDS.has(kind) &&
    isString(v['overhang']) &&
    (v['enzyme'] === null || isString(v['enzyme']))
  );
}

function isRange(v: unknown): boolean {
  return isObject(v) && typeof v['start'] === 'number' && typeof v['end'] === 'number';
}

/** Enough of a feature to place and to draw; the rest is the parser's business. */
function isFeature(v: unknown): boolean {
  return (
    isObject(v) &&
    isString(v['id']) &&
    isString(v['type']) &&
    isString(v['name']) &&
    (v['strand'] === 'forward' || v['strand'] === 'reverse') &&
    Array.isArray(v['segments']) &&
    v['segments'].length > 0 &&
    Array.isArray(v['qualifiers'])
  );
}

function isAssemblyPart(v: unknown): boolean {
  if (!isObject(v) || !isString(v['id']) || typeof v['flipped'] !== 'boolean') return false;
  const f: unknown = v['fragment'];
  return (
    isObject(f) &&
    isString(f['sequence']) &&
    isString(f['source']) &&
    isRange(f['range']) &&
    isStrandEnd(f['left']) &&
    isStrandEnd(f['right']) &&
    Array.isArray(f['features']) &&
    f['features'].every(isFeature) &&
    (f['dephosphorylated'] === undefined || typeof f['dephosphorylated'] === 'boolean') &&
    (f['methylation'] === undefined || isMethylation(f['methylation']))
  );
}

/** A host methylation state as a fragment stores it: two booleans. */
function isMethylation(v: unknown): boolean {
  return isObject(v) && typeof v['dam'] === 'boolean' && typeof v['dcm'] === 'boolean';
}

/**
 * A stored part whose lineage (#67) does not read back loses the lineage
 * rather than the part: the fragment is still good, and a product made from
 * it names it without its history.
 */
function withUsableLineage(part: AssemblyPart): AssemblyPart {
  const lineage: unknown = part.fragment.lineage;
  if (lineage === undefined || isLineageNode(lineage)) return part;
  const { lineage: _dropped, ...fragment } = part.fragment;
  return { ...part, fragment };
}

let shared: DocumentRepository | null = null;

export function getRepository(): DocumentRepository {
  shared ??= new DocumentRepository();
  return shared;
}
