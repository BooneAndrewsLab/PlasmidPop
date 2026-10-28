import { FormatError, parseGenBank, readZip, writeZip } from '@/io';

import { type PlasmidPopDb, type StoredDocument, getDb } from './db';
import { type StoredHistory, isStoredHistory } from './historyFormat';

/**
 * Backing up everything the browser holds, and reading it back (#203, item
 * 88). A backup is a ZIP, so it opens in any tool and the user's own copy of
 * their work is something they can look inside:
 *
 *   plasmidpop-backup.json      the manifest: format, when, what is counted
 *   documents/0001.json …       a document row and its undo history, each
 *   tables/<name>.json          the other stores, a JSON array of rows each
 *
 * Rows go out as they are stored (so a restore is exact, and no second
 * schema exists to drift); typed arrays, which a sequencing read is made of,
 * travel as base64.
 */

export const BACKUP_FORMAT = 'plasmidpop-backup';
export const BACKUP_VERSION = 1;
const MANIFEST = 'plasmidpop-backup.json';

export interface BackupManifest {
  readonly format: typeof BACKUP_FORMAT;
  readonly version: number;
  readonly createdAt: number;
  readonly documents: number;
  /** Rows of each other store. */
  readonly tables: Readonly<Record<string, number>>;
}

/** The stores besides documents, and the field that says which of two rows is newer (if any). */
const TABLES = [
  { name: 'shelf', stamp: 'updatedAt' },
  { name: 'enzymeSets', stamp: 'importedAt' },
  { name: 'customEnzymes', stamp: null },
  { name: 'primers', stamp: 'updatedAt' },
  { name: 'fidelityTables', stamp: 'importedAt' },
  { name: 'overhangStandards', stamp: null },
  { name: 'codonTables', stamp: null },
  { name: 'myParts', stamp: null },
] as const;

interface Row {
  readonly id: string;
}

// ---------------------------------------------------------------- JSON codec

const TYPED = { Uint8Array, Int16Array, Int32Array } as const;
type TypedName = keyof typeof TYPED;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  // Stryker disable next-line EqualityOperator: the extra pass at i == length takes an empty subarray, which adds ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text);
  const bytes = new Uint8Array(s.length);
  // Stryker disable next-line EqualityOperator: a write at index == length of a typed array is ignored
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify(value, (_key, v: unknown) => {
      // By name, not `instanceof`: a clone from IndexedDB may be of another realm.
      if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
        const type = v.constructor.name;
        if (!(type in TYPED)) throw new Error(`Cannot back up a ${type}`);
        return {
          $typed: type,
          data: toBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)),
        };
      }
      return v;
    }),
  );
}

function decodeJson(data: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(data), (_key, v: unknown) => {
    if (typeof v !== 'object' || v === null || !('$typed' in v)) return v;
    const { $typed: type, data: text } = v as { $typed: unknown; data: unknown };
    if (typeof type !== 'string' || !(type in TYPED) || typeof text !== 'string') {
      throw new FormatError('The backup holds data of a kind this version does not know');
    }
    const bytes = fromBase64(text);
    const Ctor = TYPED[type as TypedName];
    if (bytes.length % Ctor.BYTES_PER_ELEMENT !== 0) {
      throw new FormatError('The backup holds damaged data');
    }
    return new Ctor(bytes.buffer, 0, bytes.length / Ctor.BYTES_PER_ELEMENT);
  });
}

// ------------------------------------------------------------------- writing

/** Everything in the database as one ZIP, and how many documents went into it. */
export async function createBackup(
  db: PlasmidPopDb = getDb(),
  now = Date.now(),
): Promise<{ readonly bytes: Uint8Array; readonly manifest: BackupManifest }> {
  const entries: { path: string; data: Uint8Array }[] = [];
  const tables: Record<string, number> = {};
  const documents = await db.documents.toArray();
  const histories = new Map((await db.histories.toArray()).map((h) => [h.id, h]));
  documents.forEach((document, i) => {
    const history = histories.get(document.id) ?? null;
    entries.push({
      path: `documents/${String(i + 1).padStart(4, '0')}.json`,
      data: encodeJson({ document, history }),
    });
  });
  for (const { name } of TABLES) {
    const rows = await db.table<Row, string>(name).toArray();
    tables[name] = rows.length;
    if (rows.length > 0) entries.push({ path: `tables/${name}.json`, data: encodeJson(rows) });
  }
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: now,
    documents: documents.length,
    tables,
  };
  entries.unshift({ path: MANIFEST, data: encodeJson(manifest) });
  return { bytes: writeZip(entries), manifest };
}

// ------------------------------------------------------------------- reading

export interface RestoreReport {
  /** Documents the backup had that this browser did not. */
  readonly added: number;
  /** Documents replaced by the backup's newer copy. */
  readonly replaced: number;
  /** Documents where this browser's copy is the same or newer, so was kept. */
  readonly kept: number;
  /** Documents left alone because they are open in a tab. */
  readonly open: number;
  /** Rows of the other stores (primers, parts, enzymes, …) added or replaced. */
  readonly otherRows: number;
  /** Entries that could not be read, with why. */
  readonly skipped: readonly { readonly name: string; readonly reason: string }[];
  readonly createdAt: number;
}

export interface RestoreOptions {
  /** Ids of documents open in a tab; their stored copy is not touched. */
  readonly openIds?: ReadonlySet<string>;
}

/** Whether `bytes` is a PlasmidPop backup, as opposed to some other ZIP. */
export function isBackup(bytes: Uint8Array): boolean {
  try {
    return readZip(bytes).entries.some((e) => e.path === MANIFEST);
  } catch {
    return false;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A document row of the shape the app writes, with a text that reads as a record. */
function isStoredDocument(v: unknown): v is StoredDocument {
  if (
    !isObject(v) ||
    typeof v['id'] !== 'string' ||
    v['id'] === '' ||
    typeof v['name'] !== 'string' ||
    // Stryker disable next-line ConditionalExpression: a non-string text makes parseGenBank throw, which the catch below turns into false, so this guard only narrows the type
    typeof v['text'] !== 'string' ||
    typeof v['length'] !== 'number' ||
    typeof v['featureCount'] !== 'number' ||
    typeof v['createdAt'] !== 'number' ||
    typeof v['updatedAt'] !== 'number' ||
    (v['topology'] !== 'linear' && v['topology'] !== 'circular') ||
    (v['fileName'] !== null && typeof v['fileName'] !== 'string') ||
    (v['kind'] !== undefined && v['kind'] !== 'file' && v['kind'] !== 'scratch')
  ) {
    return false;
  }
  const origin = v['origin'];
  if (origin !== undefined && !(isObject(origin) && typeof origin['text'] === 'string')) {
    return false;
  }
  try {
    // Stryker disable next-line EqualityOperator: parseGenBank throws on a text with no records and never returns an empty list, so > 0 and >= 0 agree
    return parseGenBank(v['text']).documents.length > 0;
    // Stryker disable next-line BlockStatement: an empty catch leaves the function returning undefined, which every caller treats as false
  } catch {
    return false;
  }
}

function stampOf(row: Row, field: string | null): number | null {
  // Stryker disable next-line ConditionalExpression: row['null'] is undefined for every stored row, so it gives null just the same
  if (field === null) return null;
  const v = (row as unknown as Record<string, unknown>)[field];
  return typeof v === 'number' ? v : null;
}

/**
 * Merges a backup into the database. By document id: a document this browser
 * lacks is added; one it has is replaced only by a strictly newer copy, so a
 * restore never takes back edits made since the backup. The other stores
 * merge the same way per row; rows with no timestamp keep the local one.
 * Nothing is deleted.
 */
export async function restoreBackup(
  data: ArrayBuffer | Uint8Array,
  db: PlasmidPopDb = getDb(),
  options: RestoreOptions = {},
): Promise<RestoreReport> {
  const { entries, skipped: unread } = readZip(data);
  const manifestEntry = entries.find((e) => e.path === MANIFEST);
  if (manifestEntry === undefined) {
    throw new FormatError('This ZIP is not a PlasmidPop backup');
  }
  const manifest = decodeJson(manifestEntry.data);
  if (!isObject(manifest) || manifest['format'] !== BACKUP_FORMAT) {
    throw new FormatError('This ZIP is not a PlasmidPop backup');
  }
  const version = manifest['version'];
  if (typeof version !== 'number' || version > BACKUP_VERSION) {
    throw new FormatError(
      'This backup was made by a newer version of PlasmidPop. Open the newest version to restore it.',
    );
  }
  const createdAt = typeof manifest['createdAt'] === 'number' ? manifest['createdAt'] : 0;
  const skipped: { name: string; reason: string }[] = unread.map((s) => ({
    name: s.path,
    reason: s.reason,
  }));
  let added = 0;
  let replaced = 0;
  let kept = 0;
  let open = 0;
  let otherRows = 0;
  const openIds = options.openIds ?? new Set<string>();

  for (const entry of entries) {
    if (!entry.path.startsWith('documents/')) continue;
    try {
      const body = decodeJson(entry.data);
      if (!isObject(body) || !isStoredDocument(body['document'])) {
        throw new FormatError('not a document this version can read');
      }
      const document = body['document'];
      const history: StoredHistory | null =
        isStoredHistory(body['history']) && body['history'].id === document.id
          ? body['history']
          : null;
      if (openIds.has(document.id)) {
        open++;
        continue;
      }
      const outcome = await db.transaction('rw', db.documents, db.histories, async () => {
        const local = await db.documents.get(document.id);
        if (local !== undefined && local.updatedAt >= document.updatedAt) return 'kept' as const;
        // A backup from before scratch documents has no kind: all of it was kept.
        await db.documents.put({ ...document, kind: document.kind ?? 'file' });
        if (history === null) await db.histories.delete(document.id);
        else await db.histories.put(history);
        return local === undefined ? ('added' as const) : ('replaced' as const);
      });
      if (outcome === 'added') added++;
      else if (outcome === 'replaced') replaced++;
      else kept++;
    } catch (e) {
      skipped.push({ name: entry.path, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  for (const { name, stamp } of TABLES) {
    const entry = entries.find((e) => e.path === `tables/${name}.json`);
    if (entry === undefined) continue;
    try {
      const rows = decodeJson(entry.data);
      if (!Array.isArray(rows)) throw new FormatError('not a list of rows');
      const table = db.table<Row, string>(name);
      for (const row of rows as unknown[]) {
        if (!isObject(row) || typeof row['id'] !== 'string') continue;
        const incoming = row as unknown as Row;
        const local = await table.get(incoming.id);
        if (local !== undefined) {
          const a = stampOf(incoming, stamp);
          const b = stampOf(local, stamp);
          if (a === null || b === null || a <= b) continue;
        }
        await table.put(incoming);
        otherRows++;
      }
    } catch (e) {
      skipped.push({ name: entry.path, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return { added, replaced, kept, open, otherRows, skipped, createdAt };
}

// -------------------------------------------------------------------- status

/** How long an unbacked-up change may sit before the status says so. */
export const BACKUP_NUDGE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const LAST_BACKUP_KEY = 'plasmidpop.lastBackup';

/** When the last backup was made in this browser, or null if never. */
export function lastBackupAt(): number | null {
  try {
    const v = Number(globalThis.localStorage.getItem(LAST_BACKUP_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function recordBackup(at: number): void {
  try {
    globalThis.localStorage.setItem(LAST_BACKUP_KEY, String(at));
  } catch {
    // Best effort, like the rest of what is kept in localStorage.
  }
}

export interface BackupStatus {
  readonly documents: number;
  readonly lastBackupAt: number | null;
  /** Documents changed since the last backup (all of them if there has been none). */
  readonly unbackedUp: number;
  /** True when the oldest of those changes is older than `BACKUP_NUDGE_DAYS`. */
  readonly nudge: boolean;
}

/** What the Files screen says about backups, from the documents' last-change times. */
export function backupStatus(
  updatedAts: readonly number[],
  last: number | null,
  now = Date.now(),
): BackupStatus {
  const pending = updatedAts.filter((t) => last === null || t > last);
  // Stryker disable next-line ConditionalExpression: Math.min() of nothing is Infinity, and now - Infinity never exceeds the limit, so nudge is false either way
  const oldest = pending.length === 0 ? null : Math.min(...pending);
  return {
    documents: updatedAts.length,
    lastBackupAt: last,
    unbackedUp: pending.length,
    nudge: oldest !== null && now - oldest > BACKUP_NUDGE_DAYS * DAY_MS,
  };
}

/**
 * Whether the browser is WebKit outside an installed app. Safari drops the
 * script-written storage of a site not visited for seven days unless it is
 * added to the home screen, and every browser on iOS is WebKit.
 */
export function mayBeDroppedAfterAWeek(env: {
  readonly userAgent: string;
  readonly standalone: boolean;
}): boolean {
  const ua = env.userAgent;
  const ios = /\b(iPhone|iPad|iPod)\b/.test(ua);
  const safari =
    ua.includes('Safari/') &&
    !/(Chrome|Chromium|Edg|OPR|Android|Firefox)\//.test(ua) &&
    ua.includes('Version/');
  return (ios || safari) && !env.standalone;
}

/**
 * The sentence about the browser's promise. Where the seven-day cap applies
 * (Safari, not installed) a granted `persisted()` does not exempt the site
 * from it, so the promise is not stated there and the warning speaks.
 */
export function persistenceSentence(persisted: boolean | null, capApplies: boolean): string {
  if (persisted === true) return capApplies ? '' : 'The browser has agreed to keep them.';
  if (persisted === false) return 'The browser may clear them when disk space runs low.';
  return '';
}
