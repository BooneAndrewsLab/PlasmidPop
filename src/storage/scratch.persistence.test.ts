// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { History, SeqDocument } from '@/core';

import { createBackup, restoreBackup } from './backup';
import { PlasmidPopDb } from './db';
import { DocumentRepository } from './documentRepository';
import { SCRATCH_LIFETIME_DAYS } from './scratch';

const DAY = 24 * 60 * 60 * 1000;

let counter = 0;
function fresh(): { db: PlasmidPopDb; repo: DocumentRepository } {
  const db = new PlasmidPopDb(`scratch-${Date.now()}-${counter++}`);
  return { db, repo: new DocumentRepository(db) };
}

/** Sets a row's time as a clock in the past would have left it, in the row and in its summary. */
async function touch(db: PlasmidPopDb, id: string, updatedAt: number): Promise<void> {
  await db.documents.update(id, { updatedAt });
  await db.summaries.update(id, { updatedAt });
}

const doc = (name: string) =>
  SeqDocument.create({ name, sequence: 'ACGTACGTACGTACGTACGT', topology: 'circular' });

const SCRATCH = { origin: null, derived: false, kind: 'scratch' as const };

describe('the kind of a stored document (item 110)', () => {
  it('is kept unless it is said to be scratch, and is listed and loaded as it was written', async () => {
    const { repo } = fresh();
    await repo.save('f', doc('file'), 'file.gb');
    await repo.save('s', doc('product'), null, SCRATCH);
    const kinds = Object.fromEntries((await repo.list()).map((d) => [d.id, d.kind]));
    expect(kinds).toEqual({ f: 'file', s: 'scratch' });
    expect((await repo.load('f'))?.kind).toBe('file');
    expect((await repo.load('s'))?.kind).toBe('scratch');
  });

  it('is never made scratch again by a write that has not heard it was kept', async () => {
    const { repo } = fresh();
    await repo.save('s', doc('product'), null, SCRATCH);
    await repo.keep(['s']);
    await repo.save('s', doc('product').insert(2, 'GG'), null, SCRATCH);
    expect((await repo.load('s'))?.kind).toBe('file');
  });

  it('becomes kept when a kept write is made over a scratch row', async () => {
    const { repo } = fresh();
    await repo.save('s', doc('product'), null, SCRATCH);
    await repo.save('s', doc('product'), null);
    expect((await repo.load('s'))?.kind).toBe('file');
  });

  it('is kept by renaming a stored scratch document', async () => {
    const { repo } = fresh();
    await repo.save('s', doc('product'), null, SCRATCH);
    expect(await repo.rename('s', 'mine')).toBe(true);
    expect((await repo.load('s'))?.kind).toBe('file');
  });

  it('is kept by Keep, which leaves the time alone and ignores ids that are gone', async () => {
    const { repo, db } = fresh();
    await repo.save('s', doc('product'), null, SCRATCH);
    await touch(db, 's', 5);
    expect(await repo.keep(['s', 'nothing'])).toBe(1);
    const row = await db.documents.get('s');
    expect(row).toMatchObject({ kind: 'file', updatedAt: 5 });
  });

  it('comes back from the stash as it went in', () => {
    const { repo } = fresh();
    repo.stash('a', null, doc('a'), 'LOCUS', 1);
    repo.stash('b', null, doc('b'), 'LOCUS', 1, true);
    expect(repo.stashed('a')).not.toContain('scratch');
    expect(repo.stashed('b')).toContain('"scratch":true');
  });
});

describe('removing scratch documents that have outlived their time', () => {
  async function seed() {
    const t = fresh();
    const { repo, db } = t;
    await repo.save('old', doc('old'), null, SCRATCH);
    await repo.save('older-open', doc('open'), null, SCRATCH);
    await repo.save('young', doc('young'), null, SCRATCH);
    await repo.save('kept', doc('kept'), 'kept.gb');
    await touch(db, 'old', 1);
    await touch(db, 'older-open', 1);
    await touch(db, 'kept', 1);
    await db.histories.put({ id: 'old' } as never);
    return t;
  }
  const NOW = 1 + SCRATCH_LIFETIME_DAYS * DAY;

  it('removes the due ones with their history, and nothing else', async () => {
    const { repo, db } = await seed();
    const removed = await repo.pruneScratch(new Set(['older-open']), NOW);
    expect(removed).toBe(1);
    expect((await repo.list()).map((d) => d.id).sort()).toEqual(['kept', 'older-open', 'young']);
    expect(await db.histories.get('old')).toBeUndefined();
  });

  it('removes nothing a moment early', async () => {
    const { repo } = await seed();
    expect(await repo.pruneScratch(new Set(), NOW - 1)).toBe(0);
    expect(await repo.list()).toHaveLength(4);
  });

  it('does nothing for a kept row of any age', async () => {
    const { repo } = fresh();
    await repo.save('k', doc('k'), 'k.gb');
    expect(await repo.pruneScratch(new Set(), Date.now() + 1000 * DAY)).toBe(0);
    expect(await repo.has('k')).toBe(true);
  });
});

describe('a backup carries the kind (item 110)', () => {
  it('restores scratch as scratch and kept as kept', async () => {
    const a = fresh();
    await a.repo.save('s', doc('product'), null, SCRATCH);
    await a.repo.save('f', doc('file'), 'file.gb');
    const { bytes } = await createBackup(a.db, 1);
    const b = fresh();
    await restoreBackup(bytes, b.db);
    expect((await b.repo.load('s'))?.kind).toBe('scratch');
    expect((await b.repo.load('f'))?.kind).toBe('file');
  });

  it('restores a backup from before kinds as kept', async () => {
    const a = fresh();
    await a.repo.save('old', doc('old'), 'old.gb');
    const row = await a.db.documents.get('old');
    // What a build before this one wrote: no kind at all.
    const { kind: _kind, ...legacy } = row ?? { kind: undefined };
    await a.db.documents.clear();
    await a.db.documents.put(legacy as never);
    const { bytes } = await createBackup(a.db, 1);
    const b = fresh();
    await restoreBackup(bytes, b.db);
    expect((await b.db.documents.get('old'))?.kind).toBe('file');
    expect((await b.repo.list())[0]?.kind).toBe('file');
  });

  it('never deletes: a restore leaves the scratch rows that are only here, and a newer local row wins', async () => {
    const a = fresh();
    await a.repo.save('s', doc('product'), null, SCRATCH);
    const { bytes } = await createBackup(a.db, 1);
    const b = fresh();
    await b.repo.save('only-here', doc('here'), null, SCRATCH);
    await b.repo.save('s', doc('product'), 'product.gb');
    await b.db.documents.update('s', { updatedAt: Date.now() + 10_000 });
    await restoreBackup(bytes, b.db);
    expect(await b.repo.has('only-here')).toBe(true);
    // The newer local row, kept, is not downgraded by the older scratch copy.
    expect((await b.repo.load('s'))?.kind).toBe('file');
  });

  it('skips a row whose kind is neither', async () => {
    const a = fresh();
    await a.repo.save('x', doc('x'), 'x.gb');
    await a.db.documents.update('x', { kind: 'bogus' as never });
    const { bytes } = await createBackup(a.db, 1);
    const report = await restoreBackup(bytes, fresh().db);
    expect(report.skipped).toHaveLength(1);
    expect(report.added).toBe(0);
  });
});

describe('a history on a scratch row', () => {
  it('is kept while it is, and goes with the row', async () => {
    const { repo, db } = fresh();
    const d = doc('product');
    await repo.save('s', d, null, SCRATCH, {
      history: History.create(d),
      opened: d,
      saved: null,
      origin: null,
    });
    expect(await repo.hasHistory('s')).toBe(true);
    await repo.pruneScratch(new Set(), Date.now() + 40 * DAY);
    expect(await db.documents.get('s')).toBeUndefined();
    expect(await repo.hasHistory('s')).toBe(false);
  });
});
