// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { PlasmidPopDb } from './db';
import { DocumentRepository } from './documentRepository';

let counter = 0;
function fresh(): { db: PlasmidPopDb; repo: DocumentRepository } {
  const db = new PlasmidPopDb(`myparts-${Date.now()}-${counter++}`);
  return { db, repo: new DocumentRepository(db) };
}

const a = {
  id: 'a',
  name: 'pA',
  type: 'promoter',
  sequence: 'ACGTACGTACGTACGT',
  notes: 'n',
  origin: 'My parts',
};
const b = {
  id: 'b',
  name: 'pB',
  type: 'CDS',
  sequence: '',
  protein: 'MKVLAA',
  notes: '',
  origin: 'pLannotate: fpbase',
};

describe('the stored My parts (#210)', () => {
  it('starts empty and gives back what was put, in the order added', async () => {
    const { repo } = fresh();
    expect(await repo.loadMyParts()).toEqual([]);
    await repo.putMyParts([a, b]);
    expect(await repo.loadMyParts()).toEqual([a, b]);
  });

  it('keeps an edited part in its place and deletes by id', async () => {
    const { repo } = fresh();
    await repo.putMyParts([a, b]);
    await repo.putMyParts([{ ...a, name: 'renamed' }]);
    expect((await repo.loadMyParts()).map((p) => p.name)).toEqual(['renamed', 'pB']);
    await repo.deleteMyParts(['a']);
    expect((await repo.loadMyParts()).map((p) => p.id)).toEqual(['b']);
  });

  it('skips a row written wrong and defaults a missing origin', async () => {
    const { db, repo } = fresh();
    await db.myParts.bulkPut([
      { id: 'x', name: 'bad', type: 't', sequence: 'ACGN', notes: '', origin: 'o', addedAt: 1 },
      { id: 'y', name: 'empty', type: 't', sequence: '', notes: '', origin: 'o', addedAt: 2 },
      { id: 'z', name: 'ok', type: 't', sequence: 'ACGTACGTACGT', origin: '', addedAt: 3 } as never,
    ]);
    const rows = await repo.loadMyParts();
    expect(rows).toEqual([
      { id: 'z', name: 'ok', type: 't', sequence: 'ACGTACGTACGT', notes: '', origin: 'My parts' },
    ]);
  });
});
