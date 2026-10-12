// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { SeqDocument } from '@/core';
import { writeZip } from '@/io';

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
  });
});
