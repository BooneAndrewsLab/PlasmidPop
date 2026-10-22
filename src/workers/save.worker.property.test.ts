import fc from 'fast-check';

import {
  type DocumentMetadata,
  type Feature,
  type Qualifier,
  type SeqDocument as Doc,
  SeqDocument,
  createFeature,
  rangeSegment,
} from '@/core';
import { parseGenBank, writeGenBank } from '@/io';
import { docShapeArb, layFeatures, opShapeArb, resolveOp } from '@/test/editArbitraries';
import { listFixtures, readFixture } from '@/test/fixtures';
import { randomDna, seededRandom } from '@/test/random';

import { handleSaveRequest } from './save.worker';
import { snapshotOf } from './saveProtocol';

/**
 * The save worker must write exactly the text the main thread would (#272):
 * the stored row is compared with the file on every reload of a history,
 * and a text that differs by a byte would cost the user their undo steps.
 * Each document goes the whole way a save sends it — the snapshot, the
 * structured clone `postMessage` makes, the worker's handler, the clone of
 * its answer — and the text that comes back must be `writeGenBank`'s.
 */

function throughWorker(docs: readonly Doc[]): readonly string[] {
  const req = structuredClone({ id: 1, kind: 'genbank' as const, docs: docs.map(snapshotOf) });
  const res = structuredClone(handleSaveRequest(req));
  if (res.kind !== 'genbank') throw new Error(res.message);
  return res.texts;
}

function expectSameText(doc: Doc): void {
  expect(throughWorker([doc])).toEqual([writeGenBank(doc)]);
}

// Text with what a qualifier or a header can trip over: quotes, line breaks,
// runs of spaces, slashes, non-ASCII and a lone surrogate.
const awkward = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc.constantFrom(
    'a "quoted" word',
    'two\nlines',
    'wide   gap',
    '/not=a qualifier',
    'Ωmega – ünïcode',
    '\uD800 lone',
    '123',
    '[4]',
    '',
  ),
);

const qualifierArb: fc.Arbitrary<Qualifier> = fc.record({
  name: fc.constantFrom(
    'note',
    'gene',
    'product',
    'codon_start',
    'translation',
    'label',
    'db_xref',
  ),
  value: fc.oneof({ arbitrary: awkward, weight: 5 }, { arbitrary: fc.constant(null), weight: 1 }),
});

const metadataArb: fc.Arbitrary<Partial<DocumentMetadata>> = fc.record(
  {
    description: awkward,
    accession: fc.constantFrom('', 'U49845', 'NC_001422'),
    version: fc.constantFrom('', 'U49845.1'),
    keywords: awkward,
    organism: awkward,
    taxonomy: fc.constantFrom('', 'Bacteria; Pseudomonadota; Gammaproteobacteria.'),
    moleculeType: fc.constantFrom('', 'DNA', 'ds-DNA', 'mRNA'),
    division: fc.constantFrom('', 'SYN', 'BCT'),
    // An empty date is written as today's: the worker's clock is the page's.
    date: fc.constantFrom('', '21-OCT-2026'),
    dbLinks: fc.array(fc.constantFrom('BioProject: PRJNA1', 'BioSample: SAMN2'), { maxLength: 2 }),
    references: fc.array(
      fc.record({
        number: fc.integer({ min: 1, max: 9 }),
        location: fc.constantFrom('', '(bases 1 to 50)', '.', 'loose text'),
        authors: awkward,
        consortium: fc.constant(''),
        title: awkward,
        journal: awkward,
        pubmed: fc.constantFrom('', '12345'),
        remark: awkward,
      }),
      { maxLength: 2 },
    ),
    comments: fc.array(awkward, { maxLength: 2 }),
    extraHeaders: fc.array(fc.record({ keyword: fc.constant('PROJECT'), value: awkward }), {
      maxLength: 1,
    }),
    derivedFrom: fc.option(
      fc.record({
        checksum: fc.constant('cdseguid=Ra9y8Z0kv0Ub6x4MB5_x7DCBk8Y'),
        fileName: awkward,
      }),
    ),
  },
  { requiredKeys: [] },
);

const sessionArb = fc.record({
  shape: docShapeArb,
  name: awkward,
  qualifiers: fc.array(fc.array(qualifierArb, { maxLength: 4 }), { maxLength: 8 }),
  metadata: metadataArb,
  methylation: fc.record({ dam: fc.boolean(), dcm: fc.boolean() }),
  sticky: fc.boolean(),
  ops: fc.array(opShapeArb, { maxLength: 6 }),
});

function withQualifiers(
  features: readonly Feature[],
  qualifiers: readonly Qualifier[][],
): Feature[] {
  return features.map((f, i) => ({ ...f, qualifiers: qualifiers[i] ?? [] }));
}

describe('the save worker writes what writeGenBank writes (#272)', () => {
  it('for edited documents of every kind', () => {
    fc.assert(
      fc.property(sessionArb, ({ shape, name, qualifiers, metadata, methylation, sticky, ops }) => {
        const linear = shape.topology === 'linear';
        let doc = SeqDocument.create({
          name,
          sequence: shape.sequence,
          topology: shape.topology,
          features: withQualifiers(layFeatures(shape), qualifiers),
          metadata,
          methylation,
          ...(linear && sticky
            ? {
                ends: {
                  left: { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' },
                  right: { kind: 'blunt', overhang: '', enzyme: null },
                },
              }
            : {}),
        });
        expectSameText(doc);
        // Edits leave styled runs, changed case, features moved over the
        // origin and joins cut in two, which a document straight from a
        // file does not have.
        for (const shapeOp of ops) {
          const op = resolveOp(doc, shapeOp);
          if (op === null) continue;
          doc = doc.apply(op);
        }
        expectSameText(doc);
      }),
      { numRuns: 300 },
    );
  });

  it('for every committed GenBank and GenPept record, with a working copy’s original beside it', () => {
    const names = [...listFixtures(), 'NP_000509.gp', 'NP_000198.gp'];
    expect(names.length).toBeGreaterThan(5);
    for (const name of names) {
      for (const doc of parseGenBank(readFixture(name)).documents) {
        const edited = doc.length > 10 ? doc.delete({ start: 2, end: 5 }) : doc;
        expect(throughWorker([edited, doc])).toEqual([writeGenBank(edited), writeGenBank(doc)]);
      }
    }
  });

  it('for a long circular sequence with many features, joins across the origin among them', () => {
    const length = 300_000;
    const rand = seededRandom(272);
    const features: Feature[] = [];
    for (let i = 0; i < 300; i++) {
      const start = Math.floor((i * length) / 300);
      features.push(
        createFeature({
          id: `f${i}`,
          type: i % 3 === 0 ? 'CDS' : 'misc_feature',
          name: `feature ${i}`,
          strand: i % 2 === 0 ? 'forward' : 'reverse',
          segments:
            i === 299
              ? [rangeSegment(length - 40, length), rangeSegment(0, 40)]
              : [rangeSegment(start, start + 60), rangeSegment(start + 90, start + 150)],
          joining: i % 7 === 0 ? 'order' : undefined,
          qualifiers: [
            { name: 'note', value: `note ${i} with "quotes" and a long tail `.repeat(3) },
            { name: 'pseudo', value: null },
          ],
        }),
      );
    }
    const doc = SeqDocument.create({
      name: 'pLong',
      sequence: randomDna(rand, length),
      topology: 'circular',
      features,
    })
      .insert(12, 'acgtn')
      .styleBases({ start: 100, end: 200 }, { bold: true });
    expectSameText(doc);
  });

  it('for a protein', () => {
    const doc = SeqDocument.create({
      name: 'insulin',
      sequence: 'MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKTRREAEDLQVGQVEL',
      alphabet: 'protein',
      features: [
        createFeature({ type: 'Region', name: 'signal', segments: [rangeSegment(0, 24)] }),
      ],
    });
    expectSameText(doc);
  });
});
