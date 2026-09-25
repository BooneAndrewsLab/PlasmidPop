// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import {
  type AssemblyPart,
  type LineageNode,
  History,
  SeqDocument,
  documentChecksum,
  withLineage,
} from '@/core';
import U49845 from '@/io/fixtures/U49845.gb?raw';

import { PlasmidPopDb, checksumOfText } from './db';
import { DocumentRepository } from './documentRepository';

let counter = 0;

function freshRepo(): { repo: DocumentRepository; db: PlasmidPopDb } {
  const db = new PlasmidPopDb(`lineage-${Date.now()}-${counter++}`);
  return { repo: new DocumentRepository(db), db };
}

function checksum(doc: SeqDocument): string {
  const c = documentChecksum(doc)?.text;
  if (c === undefined) throw new Error('no checksum');
  return c;
}

const vector = SeqDocument.create({
  name: 'pVec',
  sequence: 'GAATTCAAAAGGATCCTTTTAAGCTT',
  topology: 'circular',
});
const insert = SeqDocument.create({ name: 'insert', sequence: 'ATGAAATTTGGGCCCTAA' });

const parent: LineageNode = {
  name: 'pVec',
  checksum: checksum(vector),
  topology: 'circular',
  length: vector.length,
  step: null,
};
const product = withLineage(SeqDocument.create({ name: 'pMade', sequence: 'ACGTACGTAC' }), {
  op: 'edited',
  parents: [parent],
});

describe('finding a stored document by its checksum (#67)', () => {
  it('finds each stored molecule a lineage names, and nothing for the rest', async () => {
    const { repo } = freshRepo();
    await repo.save('v', vector, 'pVec.gb');
    await repo.save('i', insert, null);
    const found = await repo.findByChecksums([
      checksum(vector),
      checksum(insert),
      'cdseguid=AAAAAAAAAAAAAAAAAAAAAAAAAAA',
    ]);
    expect(found).toEqual(
      new Map([
        [checksum(vector), 'v'],
        [checksum(insert), 'i'],
      ]),
    );
    expect(await repo.findByChecksums([])).toEqual(new Map());
  });

  it('follows a document’s edits: its old checksum no longer finds it', async () => {
    const { repo } = freshRepo();
    await repo.save('v', vector, 'pVec.gb');
    const edited = vector.insert(3, 'CCC');
    await repo.save('v', edited, 'pVec.gb');
    const found = await repo.findByChecksums([checksum(vector), checksum(edited)]);
    expect(found).toEqual(new Map([[checksum(edited), 'v']]));
  });

  it('prefers the one written last when two hold the same molecule', async () => {
    const { repo } = freshRepo();
    await repo.save('a', vector, 'one.gb');
    await new Promise((r) => setTimeout(r, 5));
    await repo.save('b', vector.rename('copy'), 'two.gb');
    expect((await repo.findByChecksums([checksum(vector)])).get(checksum(vector))).toBe('b');
  });

  it('keeps a product’s lineage in the stored text and its history', async () => {
    const { repo } = freshRepo();
    const edited = product.insert(0, 'GG');
    await repo.save('p', edited, null, undefined, {
      history: History.create(product).push(edited, 'Insert 2 bases'),
      opened: product,
      saved: null,
      origin: null,
    });
    const back = await repo.load('p');
    expect(back?.historyStatus).toBe('restored');
    expect(back?.doc.metadata.lineage).toEqual(product.metadata.lineage);
    expect(back?.history?.history.undo().present.metadata.lineage).toEqual(
      product.metadata.lineage,
    );
  });
});

describe('the checksum index on a database an older build wrote', () => {
  it('is filled in from each row’s text on the way up to version 6', async () => {
    const name = `migration-v5-${Date.now()}`;
    // Dexie's version 5 is IndexedDB's 50: Dexie counts in tenths.
    const open = indexedDB.open(name, 50);
    open.onupgradeneeded = () => {
      const created = open.result;
      const docs = created.createObjectStore('documents', { keyPath: 'id' });
      docs.createIndex('updatedAt', 'updatedAt');
      docs.createIndex('name', 'name');
      created.createObjectStore('shelf', { keyPath: 'id' });
      created.createObjectStore('enzymeSets', { keyPath: 'id' });
      created.createObjectStore('histories', { keyPath: 'id' });
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => {
        resolve(open.result);
      };
      open.onerror = () => {
        reject(open.error ?? new Error('open failed'));
      };
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['documents'], 'readwrite');
      const row = (id: string, text: string) => ({
        id,
        name: 'SCU49845',
        fileName: null,
        text,
        length: 5028,
        topology: 'linear',
        featureCount: 9,
        createdAt: 1,
        updatedAt: 2,
      });
      tx.objectStore('documents').put(row('v5-doc', U49845));
      tx.objectStore('documents').put(row('broken', 'not GenBank at all'));
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        reject(tx.error ?? new Error('Could not seed the database'));
      };
    });
    db.close();

    const upgraded = new PlasmidPopDb(name);
    const repo = new DocumentRepository(upgraded);
    const wanted = checksumOfText(U49845);
    expect(wanted).toMatch(/^ldseguid=/);
    if (wanted === null) return;
    expect(await repo.findByChecksums([wanted])).toEqual(new Map([[wanted, 'v5-doc']]));
    // A row that will not parse comes through, only without a checksum.
    expect((await upgraded.documents.get('broken'))?.checksum).toBeUndefined();
    expect((await repo.list()).map((d) => d.id).sort()).toEqual(['broken', 'v5-doc']);
  });
});

describe('a shelf part’s lineage', () => {
  const part = (lineage: unknown): AssemblyPart =>
    ({
      id: 'p',
      flipped: false,
      fragment: {
        sequence: 'AATTCGGG',
        features: [],
        range: { start: 0, end: 8 },
        left: { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' },
        right: { kind: 'blunt', overhang: '', enzyme: null },
        source: 'pVec',
        lineage,
      },
    }) as AssemblyPart;

  it('comes back from storage with the part', async () => {
    const { repo } = freshRepo();
    const node: LineageNode = {
      name: 'pVec EcoRI fragment',
      checksum: null,
      topology: 'linear',
      length: 8,
      step: {
        op: 'digest',
        parents: [parent],
        enzymes: ['EcoRI'],
        range: { start: 0, end: 8 },
        uncut: 0,
      },
    };
    await repo.saveShelf([part(node)]);
    expect((await repo.loadShelf())[0]?.fragment.lineage).toEqual(node);
  });

  it('is dropped when it does not read back, and the part is kept', async () => {
    const { repo } = freshRepo();
    await repo.saveShelf([part({ name: 'bad', step: { op: 'teleport' } })]);
    const [back] = await repo.loadShelf();
    expect(back?.fragment.sequence).toBe('AATTCGGG');
    expect(back !== undefined && 'lineage' in back.fragment).toBe(false);
  });
});
