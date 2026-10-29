// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { strToU8, zipSync } from 'fflate';

import { type LineageNode, History, SeqDocument, withLineage } from '@/core';
import { readZip, writeZip } from '@/io';

import {
  BACKUP_NUDGE_DAYS,
  backupStatus,
  createBackup,
  isBackup,
  lastBackupAt,
  mayBeDroppedAfterAWeek,
  recordBackup,
  restoreBackup,
} from './backup';
import { PlasmidPopDb } from './db';
import { DocumentRepository } from './documentRepository';

let counter = 0;
function fresh(): { db: PlasmidPopDb; repo: DocumentRepository } {
  const db = new PlasmidPopDb(`backup-${Date.now()}-${counter++}`);
  return { db, repo: new DocumentRepository(db) };
}

const doc = (name: string) =>
  SeqDocument.create({ name, sequence: 'ACGTACGTACGTACGTACGT', topology: 'circular' });
const part = {
  id: 'p1',
  name: 'pA',
  type: 'promoter',
  sequence: 'ACGTACGTACGTACGT',
  notes: '',
  origin: 'My parts',
  addedAt: 5,
};
const read = {
  qualities: Uint8Array.from([30, 31, 32, 33]),
  trace: {
    channels: {
      A: Int16Array.from([0, -900, 0, 0, 0, 0]),
      C: Int16Array.from([0, 0, 800, 0, 0, 0]),
      G: Int16Array.from([0, 0, 0, 700, 0, 0]),
      T: Int16Array.from([0, 0, 0, 0, 600, 0]),
    },
    peaks: Int32Array.from([1, 2, 3, 4]),
  },
};

describe('back up and restore (#203)', () => {
  it('carries documents, histories, reads and the other stores to an empty browser', async () => {
    const a = fresh();
    await a.repo.save('d1', doc('one'), 'one.gb');
    const withRead = SeqDocument.create({ name: 'clone', sequence: 'ACGT', read });
    await a.repo.save('d2', withRead, 'clone.ab1');
    await a.repo.putMyParts([part]);
    await a.db.primers.put({
      id: 'pr',
      name: 'fwd',
      sequence: 'ACGT',
      notes: '',
      addedAt: 1,
      updatedAt: 1,
    });
    const { bytes, manifest } = await createBackup(a.db, 1234);
    expect(manifest.documents).toBe(2);
    expect(manifest.createdAt).toBe(1234);
    expect(isBackup(bytes)).toBe(true);

    const b = fresh();
    const report = await restoreBackup(bytes, b.db);
    expect(report).toMatchObject({ added: 2, replaced: 0, kept: 0, skipped: [], createdAt: 1234 });
    expect(report.otherRows).toBe(2);
    expect((await b.repo.list()).map((d) => d.name).sort()).toEqual(['clone', 'one']);
    const row = await b.db.documents.get('d2');
    expect([...(row?.read?.qualities ?? [])]).toEqual([30, 31, 32, 33]);
    expect([...(row?.read?.trace?.channels.A ?? [])]).toEqual([0, -900, 0, 0, 0, 0]);
    expect([...(row?.read?.trace?.peaks ?? [])]).toEqual([1, 2, 3, 4]);
    expect((await b.repo.loadMyParts()).map((p) => p.name)).toEqual(['pA']);
    expect(await b.db.primers.count()).toBe(1);
  });

  it('never replaces a local copy that is the same or newer, and replaces an older one', async () => {
    const a = fresh();
    await a.repo.save('d1', doc('backed up'), null);
    const { bytes } = await createBackup(a.db);
    const row = await a.db.documents.get('d1');
    if (row === undefined) throw new Error('not stored');

    const same = fresh();
    await same.db.documents.put({ ...row, name: 'local' });
    expect(await restoreBackup(bytes, same.db)).toMatchObject({ kept: 1, replaced: 0 });
    expect((await same.db.documents.get('d1'))?.name).toBe('local');

    const newer = fresh();
    await newer.db.documents.put({ ...row, name: 'local', updatedAt: row.updatedAt + 10 });
    expect(await restoreBackup(bytes, newer.db)).toMatchObject({ kept: 1, replaced: 0 });
    expect((await newer.db.documents.get('d1'))?.name).toBe('local');

    const older = fresh();
    await older.db.documents.put({ ...row, name: 'old', updatedAt: row.updatedAt - 10 });
    expect(await restoreBackup(bytes, older.db)).toMatchObject({ replaced: 1, kept: 0 });
    expect((await older.db.documents.get('d1'))?.name).toBe('backed up');
  });

  it('leaves documents that are open in a tab alone', async () => {
    const a = fresh();
    await a.repo.save('d1', doc('one'), null);
    const { bytes } = await createBackup(a.db);
    const b = fresh();
    const report = await restoreBackup(bytes, b.db, { openIds: new Set(['d1']) });
    expect(report).toMatchObject({ open: 1, added: 0 });
    expect(await b.db.documents.count()).toBe(0);
  });

  it('keeps the local row of a store without a timestamp, and the newer of one with', async () => {
    const a = fresh();
    await a.repo.putMyParts([part]);
    await a.db.shelf.put({ id: 'shelf', parts: [], updatedAt: 50 });
    const { bytes } = await createBackup(a.db);
    const b = fresh();
    await b.repo.putMyParts([{ ...part, name: 'local' }]);
    await b.db.shelf.put({ id: 'shelf', parts: [], updatedAt: 10 });
    const report = await restoreBackup(bytes, b.db);
    expect(report.otherRows).toBe(1);
    expect((await b.repo.loadMyParts())[0]?.name).toBe('local');
    expect((await b.db.shelf.get('shelf'))?.updatedAt).toBe(50);
  });

  it('refuses a ZIP that is not a backup, and a newer format', async () => {
    const enc = new TextEncoder();
    const other = writeZip([{ path: 'a.gb', data: enc.encode('x') }]);
    expect(isBackup(other)).toBe(false);
    await expect(restoreBackup(other, fresh().db)).rejects.toThrow(/not a PlasmidPop backup/);
    await expect(restoreBackup(enc.encode('LOCUS'), fresh().db)).rejects.toThrow();
    const newer = writeZip([
      {
        path: 'plasmidpop-backup.json',
        data: enc.encode('{"format":"plasmidpop-backup","version":99}'),
      },
    ]);
    await expect(restoreBackup(newer, fresh().db)).rejects.toThrow(/newer version/);
  });

  it('skips a damaged document and still restores the rest', async () => {
    const a = fresh();
    await a.repo.save('d1', doc('one'), null);
    const { bytes } = await createBackup(a.db);
    const enc = new TextEncoder();
    const broken = writeZip([
      {
        path: 'plasmidpop-backup.json',
        data: enc.encode('{"format":"plasmidpop-backup","version":1}'),
      },
      { path: 'documents/0001.json', data: enc.encode('{"document":{"id":"x"}}') },
      { path: 'documents/0002.json', data: enc.encode('not json') },
    ]);
    const b = fresh();
    const report = await restoreBackup(broken, b.db);
    expect(report.skipped.map((s) => s.name)).toEqual([
      'documents/0001.json',
      'documents/0002.json',
    ]);
    expect(await restoreBackup(bytes, b.db)).toMatchObject({ added: 1 });
  });
});

const enc = new TextEncoder();
const dec = new TextDecoder();
const json = (v: unknown) => enc.encode(JSON.stringify(v));
const manifestOf = (extra: Record<string, unknown> = {}) =>
  json({ format: 'plasmidpop-backup', version: 1, createdAt: 7, ...extra });
const zipOf = (files: Record<string, unknown>, manifest: Uint8Array = manifestOf()) =>
  writeZip([
    { path: 'plasmidpop-backup.json', data: manifest },
    ...Object.entries(files).map(([path, v]) => ({ path, data: json(v) })),
  ]);
const entryOf = (bytes: Uint8Array, path: string): unknown => {
  const e = readZip(bytes).entries.find((x) => x.path === path);
  if (e === undefined) throw new Error(`no ${path}`);
  return JSON.parse(dec.decode(e.data));
};
const shelf = (id: string, updatedAt: number) => ({ id, parts: [], updatedAt });

async function validRow() {
  const a = fresh();
  await a.repo.save('d1', doc('one'), 'one.gb');
  const row = await a.db.documents.get('d1');
  if (row === undefined) throw new Error('not stored');
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

describe('backup contents', () => {
  it('names the files, counts the rows and lists only the tables that hold rows', async () => {
    const a = fresh();
    await a.repo.save('d1', doc('one'), null);
    await a.repo.save('d2', doc('two'), null);
    await a.repo.putMyParts([part]);
    const { bytes, manifest } = await createBackup(a.db, 99);
    const zip = readZip(bytes);
    expect(zip.entries.map((e) => e.path).sort()).toEqual([
      'documents/0001.json',
      'documents/0002.json',
      'plasmidpop-backup.json',
      'tables/myParts.json',
    ]);
    expect(manifest).toEqual({
      format: 'plasmidpop-backup',
      version: 1,
      createdAt: 99,
      documents: 2,
      tables: {
        shelf: 0,
        enzymeSets: 0,
        customEnzymes: 0,
        primers: 0,
        fidelityTables: 0,
        overhangStandards: 0,
        codonTables: 0,
        myParts: 1,
      },
    });
    expect(entryOf(bytes, 'plasmidpop-backup.json')).toEqual(manifest);
  });

  it('writes a document without history as null, and one with history as the row', async () => {
    const a = fresh();
    await a.repo.save('d1', doc('one'), null);
    const h = History.create(doc('h'), { at: 1 }).push(doc('h').rename('h2'), 'Rename', 2);
    await a.repo.save('d2', h.present, null, undefined, {
      history: h,
      opened: doc('h'),
      saved: h.present,
      origin: null,
    });
    const { bytes } = await createBackup(a.db);
    const bodies = ['documents/0001.json', 'documents/0002.json'].map(
      (p) => entryOf(bytes, p) as { document: { id: string }; history: { id: string } | null },
    );
    const plain = bodies.find((b) => b.document.id === 'd1');
    const withHistory = bodies.find((b) => b.document.id === 'd2');
    expect(plain?.history).toBeNull();
    expect(withHistory?.history?.id).toBe('d2');

    const b = fresh();
    await restoreBackup(bytes, b.db);
    expect(await b.repo.hasHistory('d2')).toBe(true);
    expect(await b.repo.hasHistory('d1')).toBe(false);
  });

  it('carries a typed array longer than one base64 chunk', async () => {
    const a = fresh();
    const big = Uint8Array.from({ length: 0x8000 * 2 + 5 }, (_, i) => i % 251);
    await a.db.table('myParts').put({ id: 'big', blob: big });
    const { bytes } = await createBackup(a.db);
    const b = fresh();
    await restoreBackup(bytes, b.db);
    const back = (await b.db.table('myParts').get('big')) as { blob: Uint8Array };
    expect(back.blob.constructor.name).toBe('Uint8Array');
    expect(back.blob.length).toBe(big.length);
    expect(back.blob[0x8000 + 3]).toBe((0x8000 + 3) % 251);
    expect(back.blob[big.length - 1]).toBe((big.length - 1) % 251);
  });

  it('refuses to back up a kind of typed array it cannot restore', async () => {
    const a = fresh();
    await a.db.table('myParts').put({ id: 'f', blob: new Float32Array(2) });
    await expect(createBackup(a.db)).rejects.toThrow('Cannot back up a Float32Array');
  });
});

describe('restoring odd backups', () => {
  const table = (rows: unknown) => zipOf({ 'tables/myParts.json': rows });
  const reasonOf = async (bytes: Uint8Array, name: string) =>
    (await restoreBackup(bytes, fresh().db)).skipped.find((s) => s.name === name)?.reason;

  it('names why typed data cannot be read', async () => {
    const unknown = 'The backup holds data of a kind this version does not know';
    const bad: [unknown, string][] = [
      [{ $typed: 'Float32Array', data: 'AAAA' }, unknown],
      [{ $typed: ['Uint8Array'], data: 'AAAA' }, unknown],
      [{ $typed: 5, data: 'AAAA' }, unknown],
      [{ $typed: 'Uint8Array', data: 5 }, unknown],
      [{ $typed: 'Uint8Array' }, unknown],
      [{ $typed: 'Int16Array', data: 'AAAA' }, 'The backup holds damaged data'],
      [{ $typed: 'Int32Array', data: 'AAAA' }, 'The backup holds damaged data'],
    ];
    for (const [v, reason] of bad) {
      expect(await reasonOf(table([{ id: 'x', v }]), 'tables/myParts.json')).toBe(reason);
    }
    const ok = await restoreBackup(
      table([{ id: 'x', v: { $typed: 'Int16Array', data: 'AAAAAA==' } }]),
      fresh().db,
    );
    expect(ok).toMatchObject({ otherRows: 1, skipped: [] });
  });

  it('rejects a manifest that is not an object of this format', async () => {
    for (const m of ['null', '[]', '5', '{"format":"other","version":1}', '{"version":1}']) {
      await expect(restoreBackup(zipOf({}, enc.encode(m)), fresh().db)).rejects.toThrow(
        'This ZIP is not a PlasmidPop backup',
      );
    }
  });

  it('accepts version 1 only, with the newer-version message', async () => {
    const msg =
      'This backup was made by a newer version of PlasmidPop. Open the newest version to restore it.';
    for (const v of [2, '1', null]) {
      await expect(
        restoreBackup(zipOf({}, manifestOf({ version: v })), fresh().db),
      ).rejects.toThrow(msg);
    }
    await expect(
      restoreBackup(zipOf({}, enc.encode('{"format":"plasmidpop-backup"}')), fresh().db),
    ).rejects.toThrow(msg);
    expect((await restoreBackup(zipOf({}), fresh().db)).createdAt).toBe(7);
  });

  it('reads the creation time as 0 unless it is a number', async () => {
    const missing = enc.encode('{"format":"plasmidpop-backup","version":1}');
    expect((await restoreBackup(zipOf({}, missing), fresh().db)).createdAt).toBe(0);
    const text = manifestOf({ createdAt: '5' });
    expect((await restoreBackup(zipOf({}, text), fresh().db)).createdAt).toBe(0);
  });

  it('reports ZIP entries that could not be opened, ahead of the others', async () => {
    const bytes = zipSync({
      'plasmidpop-backup.json': manifestOf(),
      '..\\evil.json': strToU8('{}'),
    });
    const report = await restoreBackup(bytes, fresh().db);
    expect(report.skipped).toEqual([
      { name: '../evil.json', reason: 'The name points outside the archive' },
    ]);
  });

  it('skips documents that are not of the shape the app writes', async () => {
    const row = await validRow();
    const not = 'not a document this version can read';
    const without = (k: string) => {
      const { [k]: _gone, ...rest } = row;
      return rest;
    };
    const bad: unknown[] = [
      { ...row, id: '' },
      { ...row, id: 5 },
      { ...row, name: 5 },
      { ...row, text: 5 },
      { ...row, length: '3' },
      { ...row, featureCount: '3' },
      { ...row, createdAt: '3' },
      { ...row, updatedAt: '3' },
      { ...row, topology: 'ring' },
      without('topology'),
      without('fileName'),
      { ...row, fileName: 5 },
      { ...row, origin: { text: 5 } },
      { ...row, origin: 'text' },
      { ...row, origin: null },
      { ...row, text: 'not a record' },
      { ...row, text: '' },
      null,
      [],
      'text',
    ];
    for (const document of bad) {
      const report = await restoreBackup(
        zipOf({ 'documents/0001.json': { document, history: null } }),
        fresh().db,
      );
      expect(report).toMatchObject({
        added: 0,
        skipped: [{ name: 'documents/0001.json', reason: not }],
      });
    }
    for (const body of [null, [], 5]) {
      expect(await reasonOf(zipOf({ 'documents/0001.json': body }), 'documents/0001.json')).toBe(
        not,
      );
    }
    for (const document of [
      row,
      { ...row, fileName: null },
      { ...row, topology: 'linear' },
      { ...row, origin: { text: row['text'] } },
    ]) {
      const report = await restoreBackup(
        zipOf({ 'documents/0001.json': { document } }),
        fresh().db,
      );
      expect(report).toMatchObject({ added: 1, skipped: [] });
    }
  });

  it('keeps a history only when it is whole and belongs to its document', async () => {
    const a = fresh();
    const h = History.create(doc('h'), { at: 1 }).push(doc('h').rename('h2'), 'Rename', 2);
    await a.repo.save('d1', h.present, null, undefined, {
      history: h,
      opened: doc('h'),
      saved: h.present,
      origin: null,
    });
    const { bytes } = await createBackup(a.db);
    const body = entryOf(bytes, 'documents/0001.json') as {
      document: unknown;
      history: Record<string, unknown>;
    };
    const restoreWith = async (history: unknown) => {
      const b = fresh();
      await b.db.histories.put({ ...body.history, id: 'stale-marker' } as never);
      const r = await restoreBackup(
        zipOf({ 'documents/0001.json': { document: body.document, history } }),
        b.db,
      );
      return { r, ids: (await b.db.histories.toArray()).map((x) => x.id).sort() };
    };
    expect((await restoreWith(body.history)).ids).toEqual(['d1', 'stale-marker']);
    expect((await restoreWith({ ...body.history, id: 'other' })).ids).toEqual(['stale-marker']);
    expect((await restoreWith({ id: 'd1' })).ids).toEqual(['stale-marker']);
    expect((await restoreWith(null)).ids).toEqual(['stale-marker']);
  });

  it('trusts the parent a row carries only when it has both halves, else reads it from the text', async () => {
    const parent: LineageNode = {
      name: 'pVec',
      checksum: 'cdseguid=AAAAAAAAAAAAAAAAAAAAAAAAAAA',
      topology: 'circular',
      length: 20,
      step: null,
    };
    const made = withLineage(doc('made'), { op: 'edited', parents: [parent] });
    const a = fresh();
    await a.repo.save('d1', made, null);
    const stored = await a.db.documents.get('d1');
    if (stored === undefined) throw new Error('not stored');
    const {
      parentChecksum: _c,
      parentName: _n,
      ...bare
    } = JSON.parse(JSON.stringify(stored)) as Record<string, unknown>;
    const restored = async (extra: Record<string, unknown>) => {
      const target = fresh().db;
      const report = await restoreBackup(
        zipOf({ 'documents/0001.json': { document: { ...bare, ...extra } } }),
        target,
      );
      expect(report).toMatchObject({ added: 1, skipped: [] });
      const row = await target.documents.get('d1');
      const summary = await target.summaries.get('d1');
      // the summary row mirrors the document row
      expect(summary?.parentChecksum).toBe(row?.parentChecksum);
      expect(summary?.parentName).toBe(row?.parentName);
      return row;
    };
    const fromText = { parentChecksum: parent.checksum, parentName: 'pVec' };
    // a backup from before item 111: no parent on the row, so the text says
    expect(await restored({})).toMatchObject(fromText);
    // both halves on the row: trusted over the text
    expect(await restored({ parentChecksum: 'cdseguid=X', parentName: 'Other' })).toMatchObject({
      parentChecksum: 'cdseguid=X',
      parentName: 'Other',
    });
    // one half alone is not enough
    expect(await restored({ parentChecksum: 'cdseguid=X' })).toMatchObject(fromText);
    expect(await restored({ parentName: 'Other' })).toMatchObject(fromText);
    // nothing on the row and no lineage in the text: no parent at all
    const plain = fresh();
    await plain.repo.save('d2', doc('plain'), null);
    const plainRow = JSON.parse(JSON.stringify(await plain.db.documents.get('d2'))) as Record<
      string,
      unknown
    >;
    const target = fresh().db;
    await restoreBackup(zipOf({ 'documents/0001.json': { document: plainRow } }), target);
    const got = await target.documents.get('d2');
    expect(got).toBeDefined();
    expect(Object.keys(got ?? {})).not.toContain('parentChecksum');
    expect(Object.keys(got ?? {})).not.toContain('parentName');
  });

  it('removes the stored history of a document the backup replaces without one', async () => {
    const a = fresh();
    await a.repo.save('d1', doc('new'), null);
    const { bytes } = await createBackup(a.db);
    const row = await a.db.documents.get('d1');
    const h = History.create(doc('h'), { at: 1 }).push(doc('h').rename('h2'), 'Rename', 2);
    const b = fresh();
    await b.repo.save('d1', h.present, null, undefined, {
      history: h,
      opened: doc('h'),
      saved: h.present,
      origin: null,
    });
    await b.db.documents.update('d1', { updatedAt: (row?.updatedAt ?? 0) - 10 });
    expect(await b.repo.hasHistory('d1')).toBe(true);
    expect(await restoreBackup(bytes, b.db)).toMatchObject({ replaced: 1 });
    expect(await b.repo.hasHistory('d1')).toBe(false);
  });

  it('does not take a backup for a different kind of file', () => {
    expect(isBackup(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(isBackup(zipOf({}))).toBe(true);
  });

  it('skips a table that is not a list, and rows without a string id', async () => {
    expect(await reasonOf(table({ id: 'x' }), 'tables/myParts.json')).toBe('not a list of rows');
    const b = fresh();
    const report = await restoreBackup(
      table([5, null, [], { id: 3 }, { name: 'no id' }, { id: 'ok' }]),
      b.db,
    );
    expect(report).toMatchObject({ otherRows: 1, skipped: [] });
    expect(await b.db.table('myParts').count()).toBe(1);
  });

  it('merges stamped rows by strictly newer, and keeps the local row when a stamp is unusable', async () => {
    const b = fresh();
    await b.db.shelf.bulkPut([
      shelf('same', 50),
      shelf('newer', 60),
      shelf('older', 40),
      { ...shelf('badlocal', 0), updatedAt: 'x' as never },
      shelf('nostamp', 5),
    ]);
    const bytes = zipOf({
      'tables/shelf.json': [
        shelf('same', 50),
        shelf('newer', 50),
        shelf('older', 50),
        shelf('badlocal', 50),
        { id: 'nostamp', parts: [] },
        shelf('fresh', 1),
      ],
    });
    const report = await restoreBackup(bytes, b.db);
    expect(report.otherRows).toBe(2);
    const stamps = Object.fromEntries((await b.db.shelf.toArray()).map((r) => [r.id, r.updatedAt]));
    expect(stamps).toEqual({
      same: 50,
      newer: 60,
      older: 50,
      badlocal: 'x',
      nostamp: 5,
      fresh: 1,
    });
  });

  it('keeps the local row when the incoming one has no stamp, even if the local stamp is negative', async () => {
    const b = fresh();
    await b.db.shelf.bulkPut([shelf('neg', -5)]);
    const report = await restoreBackup(
      zipOf({ 'tables/shelf.json': [{ id: 'neg', parts: [] }] }),
      b.db,
    );
    expect(report.otherRows).toBe(0);
    expect((await b.db.shelf.get('neg'))?.updatedAt).toBe(-5);
  });
});

describe('backup status', () => {
  const DAY = 24 * 60 * 60 * 1000;
  it('counts what changed since the last backup, and nudges on old unbacked changes', () => {
    const now = 100 * DAY;
    expect(backupStatus([], null, now)).toMatchObject({
      documents: 0,
      unbackedUp: 0,
      nudge: false,
    });
    expect(backupStatus([now - DAY], null, now)).toMatchObject({ unbackedUp: 1, nudge: false });
    expect(backupStatus([0], null, now).unbackedUp).toBe(1);
    // A change made at the very moment of the backup is in it.
    expect(backupStatus([5 * DAY], 5 * DAY, now).unbackedUp).toBe(0);
    expect(backupStatus([5 * DAY + 1], 5 * DAY, now).unbackedUp).toBe(1);
    // The oldest pending change decides, not the newest.
    expect(backupStatus([now - 20 * DAY, now - DAY], null, now).nudge).toBe(true);
    expect(backupStatus([now - DAY, now - 20 * DAY], null, now).nudge).toBe(true);
    // Exactly the limit is not yet over it.
    expect(backupStatus([now - BACKUP_NUDGE_DAYS * DAY], null, now).nudge).toBe(false);
    expect(backupStatus([now - BACKUP_NUDGE_DAYS * DAY - 1], null, now).nudge).toBe(true);
    expect(backupStatus([now - (BACKUP_NUDGE_DAYS + 1) * DAY], null, now).nudge).toBe(true);
    // Backed up after the change: nothing pending.
    expect(backupStatus([now - 20 * DAY], now - DAY, now)).toMatchObject({
      unbackedUp: 0,
      nudge: false,
    });
    expect(backupStatus([now - 20 * DAY, now - 2 * DAY], now - 10 * DAY, now)).toMatchObject({
      unbackedUp: 1,
      nudge: false,
    });
  });

  it('remembers when the last backup was made', () => {
    globalThis.localStorage.clear();
    expect(lastBackupAt()).toBeNull();
    recordBackup(42);
    expect(lastBackupAt()).toBe(42);
  });

  it('reads no last backup when the browser refuses to give the time', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect(lastBackupAt()).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('does not fail when the browser refuses to store the time', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    try {
      expect(() => {
        recordBackup(1);
      }).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });

  it('knows Safari and iOS browsers outside an installed app', () => {
    const safari =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
    const chrome =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
    const ios =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1';
    expect(mayBeDroppedAfterAWeek({ userAgent: safari, standalone: false })).toBe(true);
    expect(mayBeDroppedAfterAWeek({ userAgent: safari, standalone: true })).toBe(false);
    expect(mayBeDroppedAfterAWeek({ userAgent: chrome, standalone: false })).toBe(false);
    expect(mayBeDroppedAfterAWeek({ userAgent: ios, standalone: false })).toBe(true);
    // WebKit only counts with both its markers.
    const noSafari =
      'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4';
    const noVersion =
      'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Safari/605.1.15';
    expect(mayBeDroppedAfterAWeek({ userAgent: noSafari, standalone: false })).toBe(false);
    expect(mayBeDroppedAfterAWeek({ userAgent: noVersion, standalone: false })).toBe(false);
    expect(mayBeDroppedAfterAWeek({ userAgent: ios, standalone: true })).toBe(false);
  });
});
