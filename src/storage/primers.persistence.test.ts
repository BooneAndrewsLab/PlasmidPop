// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { PlasmidPopDb } from './db';
import { DocumentRepository } from './documentRepository';

/**
 * The primer collection in IndexedDB (#64): a row per primer, read back in
 * the order added, an edit keeping its place, and a row gone bad costing
 * that primer only.
 */

let counter = 0;
function fresh(): { db: PlasmidPopDb; repo: DocumentRepository } {
  const db = new PlasmidPopDb(`primers-${Date.now()}-${counter++}`);
  return { db, repo: new DocumentRepository(db) };
}

const m13f = { id: 'a', name: 'M13F', sequence: 'GTAAAACGACGGCCAGT', notes: 'universal' };
const t7 = { id: 'b', name: 'T7', sequence: 'TAATACGACTCACTATAGGG', notes: '' };

describe('the stored primer collection', () => {
  it('starts empty, and gives back what was put, in the order it was added', async () => {
    const { repo } = fresh();
    expect(await repo.loadPrimers()).toEqual([]);
    await repo.putPrimers([m13f, t7]);
    await repo.putPrimers([{ id: 'c', name: 'SP6', sequence: 'ATTTAGGTGACACTATAG', notes: '' }]);
    expect((await repo.loadPrimers()).map((p) => p.name)).toEqual(['M13F', 'T7', 'SP6']);
    expect((await repo.loadPrimers())[0]).toEqual(m13f);
  });

  it('keeps an edited primer where it was', async () => {
    const { repo } = fresh();
    await repo.putPrimers([m13f, t7]);
    await repo.putPrimers([{ ...m13f, name: 'M13 fwd (-20)' }]);
    expect((await repo.loadPrimers()).map((p) => p.name)).toEqual(['M13 fwd (-20)', 'T7']);
  });

  it('deletes the primers it is told to', async () => {
    const { repo } = fresh();
    await repo.putPrimers([m13f, t7]);
    await repo.deletePrimers(['a']);
    expect(await repo.loadPrimers()).toEqual([t7]);
  });

  it('leaves out a row gone bad, and reads a row without notes as having none', async () => {
    const { db, repo } = fresh();
    await repo.putPrimers([m13f]);
    const bad: unknown[] = [
      { id: 'x1', name: 7, sequence: 'ACGTACGT', addedAt: 1 },
      { id: 'x2', name: 'no bases', sequence: '1234', addedAt: 2 },
      { id: 'x3', name: 'no sequence', addedAt: 3 },
      { id: 'x4', name: 'older', sequence: 'acgu acgt', addedAt: 4 },
    ];
    await db.primers.bulkPut(bad as never[]);
    const loaded = await repo.loadPrimers();
    expect(loaded.map((p) => p.id)).toEqual(['x4', 'a']);
    expect(loaded[0]).toEqual({ id: 'x4', name: 'older', sequence: 'ACGTACGT', notes: '' });
  });
});
