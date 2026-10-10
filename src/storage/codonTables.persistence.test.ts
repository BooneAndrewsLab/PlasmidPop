// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { PlasmidPopDb } from './db';
import { DocumentRepository } from './documentRepository';

let counter = 0;
function fresh(): { db: PlasmidPopDb; repo: DocumentRepository } {
  const db = new PlasmidPopDb(`codons-${Date.now()}-${counter++}`);
  return { db, repo: new DocumentRepository(db) };
}

const table = (id: string, base: number) => ({
  id,
  name: id,
  organism: id,
  taxon: 0,
  cds: 0,
  counts: Array.from({ length: 64 }, (_, i) => base + i),
});

describe('the stored codon usage tables (#209)', () => {
  it('starts empty and gives back what was saved, oldest first', async () => {
    const { repo } = fresh();
    expect(await repo.loadCodonTables()).toEqual([]);
    await repo.saveCodonTable(table('custom-a', 1));
    await repo.saveCodonTable(table('custom-b', 2));
    expect((await repo.loadCodonTables()).map((t) => t.id)).toEqual(['custom-a', 'custom-b']);
    expect((await repo.loadCodonTables())[1]?.counts[63]).toBe(65);
  });

  it('replaces a table of the same id and deletes by id', async () => {
    const { repo } = fresh();
    await repo.saveCodonTable(table('custom-a', 1));
    await repo.saveCodonTable(table('custom-a', 10));
    expect((await repo.loadCodonTables())[0]?.counts[0]).toBe(10);
    await repo.deleteCodonTable('custom-a');
    expect(await repo.loadCodonTables()).toEqual([]);
  });

  it('skips a row that is not a table', async () => {
    const { db, repo } = fresh();
    await db.codonTables.put({ id: 'bad', name: 'bad', counts: [1, 2, 3], importedAt: 1 });
    await repo.saveCodonTable(table('custom-ok', 1));
    expect((await repo.loadCodonTables()).map((t) => t.id)).toEqual(['custom-ok']);
  });
});
