import { describe, expect, it } from 'vitest';
import {
  type DigestFragment,
  type Enzyme,
  type Feature,
  SeqDocument,
  createFeature,
  digest,
  documentFromFragment,
  emptyVector,
  findCutSites,
  firstQualifier,
  flipFragment,
  getEnzyme,
  ligate,
  rangeSegment,
  translateCds,
} from '@/core';

/*
 * #182: a piece of a split feature remembers the feature it was cut from,
 * and ligation puts pieces back together only when they meet again exactly
 * as they were cut: same original, consecutive bases, no base lost or
 * gained between them, any intron the cut fell in whole again.
 */

function def<T>(x: T | null | undefined): T {
  if (x === undefined || x === null) throw new Error('expected a value');
  return x;
}

const enzyme = (name: string): Enzyme => def(getEnzyme(name));

function cut(doc: SeqDocument, name: string): DigestFragment[] {
  return digest(doc, findCutSites(doc.sequence.toString(), doc.topology, [enzyme(name)]));
}

function ranges(f: Feature): [number, number, boolean, boolean][] {
  return f.segments.flatMap((s): [number, number, boolean, boolean][] =>
    s.kind === 'range' ? [[s.start, s.end, s.partialStart, s.partialEnd]] : [],
  );
}

const cdsOf = (doc: SeqDocument): Feature[] => doc.features.all().filter((f) => f.type === 'CDS');

const proteins = (doc: SeqDocument): string[] =>
  cdsOf(doc).map((f) => translateCds(doc, f).protein);

describe('a /transl_except across the cut (#182 F1)', () => {
  // ATG AAA TGA ATT CCC GGG TAA at [10, 31); the TGA at 17..19 is Sec, and
  // EcoRI (G^AATTC) cuts inside it.
  const cds = 'ATGAAATGAATTCCCGGGTAA';
  const source = SeqDocument.create({
    name: 'p',
    sequence: 'C'.repeat(10) + cds + 'C'.repeat(29),
    topology: 'circular',
    features: [
      createFeature({
        type: 'CDS',
        name: 'selP',
        segments: [rangeSegment(10, 31)],
        qualifiers: [
          { name: 'transl_except', value: '(pos:17..19,aa:Sec)' },
          { name: 'translation', value: 'MKUIPG' },
        ],
      }),
    ],
  });

  it.each([
    ['forward', source],
    ['reverse', source.reverseComplement()],
  ] as const)('%s strand: closing the cut vector gives the selenoprotein back', (strand, doc) => {
    expect(proteins(doc)).toEqual(['MKUIPG*']);
    const [frag] = cut(doc, 'EcoRI');
    // Forward, the top-strand cut splits the Sec codon, so neither piece
    // can hold the exception (on the other strand it falls just outside).
    const opened = documentFromFragment(def(frag));
    const kept = opened.features.all().flatMap((f) => f.qualifiers.map((q) => q.name));
    expect(kept.includes('transl_except')).toBe(strand === 'reverse');
    for (const closed of [
      ligate([def(frag)], { name: 'c', circular: true }),
      def(emptyVector(opened)),
      def(emptyVector(def(frag))),
    ]) {
      const [f, ...rest] = cdsOf(closed);
      expect(rest).toHaveLength(0);
      expect(translateCds(closed, def(f)).protein).toBe('MKUIPG*');
      expect(firstQualifier(def(f), 'translation')).toBe('MKUIPG');
      expect(def(f).origin).toBeUndefined();
      expect(ranges(def(f)).every(([, , ps, pe]) => !ps && !pe)).toBe(true);
    }
  });
});

describe('pieces that meet with bases lost or gained stay apart (#182 F2)', () => {
  it('a dropout of an in-frame stretch leaves two partial pieces', () => {
    const body = 'ATG' + 'GCT'.repeat(29) + 'TAA';
    let sequence = 'C'.repeat(10) + body.slice(0, 93) + 'C'.repeat(17);
    for (const at of [30, 60]) sequence = sequence.slice(0, at) + 'GAATTC' + sequence.slice(at + 6);
    const doc = SeqDocument.create({
      sequence,
      topology: 'circular',
      features: [
        createFeature({ type: 'rep_origin', name: 'ori', segments: [rangeSegment(10, 100)] }),
        createFeature({ type: 'CDS', name: 'geneX', segments: [rangeSegment(10, 100)] }),
      ],
    });
    const backbone = def(cut(doc, 'EcoRI').find((f) => f.sequence.length === 90));
    const closed = ligate([backbone], { name: 'c', circular: true });
    for (const name of ['ori', 'geneX']) {
      expect(
        closed.features
          .all()
          .filter((f) => f.name === name)
          .map(ranges),
      ).toEqual([[[69, 90, false, true]], [[0, 39, true, false]]]);
    }
  });

  it.each(['trim', 'fill'] as const)(
    'a single cut, ends %s-blunted, closes as two pieces',
    (how) => {
      const doc = SeqDocument.create({
        sequence: 'C'.repeat(20) + 'AAAAGGTACCTTTT' + 'C'.repeat(46),
        topology: 'circular',
        features: [
          createFeature({ type: 'promoter', name: 'Ptac', segments: [rangeSegment(15, 45)] }),
        ],
      });
      const blunted = documentFromFragment(def(cut(doc, 'KpnI')[0])).bluntEnds(how);
      const closed = ligate([def(digest(blunted, [])[0])], { name: 'c', circular: true });
      expect(closed.features.all()).toHaveLength(2);
      expect(closed.features.all().every((f) => f.origin !== undefined)).toBe(true);
    },
  );
});

describe('a join cut in its intron (#182 F4)', () => {
  // exon 1 [10, 22) MKPG, intron [22, 46) with EcoRI sites at 26 and 36,
  // exon 2 [46, 58) FAW*, read with the TTT as Sec; another site at 62.
  const sequence =
    'C'.repeat(10) +
    'ATGAAACCCGGG' +
    'GTAAGAATTCAAAAGAATTCAAAG' +
    'TTTGCATGGTAA' +
    'CCCCGAATTC' +
    'C'.repeat(22);
  const make = () =>
    SeqDocument.create({
      name: 'intron',
      sequence,
      topology: 'circular',
      features: [
        createFeature({
          type: 'CDS',
          name: 'spliced',
          segments: [rangeSegment(10, 22), rangeSegment(46, 58)],
          qualifiers: [
            { name: 'transl_except', value: '(pos:47..49,aa:Sec)' },
            { name: 'translation', value: 'MKPGUAW' },
          ],
        }),
      ],
    });
  const doc = make();
  const [small, withExon2, withExon1] = cut(doc, 'EcoRI').map((f) => def(f));

  it('is the spliced CDS again when the fragments go back in order', () => {
    expect(proteins(doc)).toEqual(['MKPGUAW*']);
    const product = ligate([def(small), def(withExon2), def(withExon1)], {
      name: 'p',
      circular: true,
    });
    const [f, ...rest] = cdsOf(product);
    expect(rest).toHaveLength(0);
    // The product starts at the first cut, 27.
    expect(ranges(def(f))).toEqual([
      [73, 85, false, false],
      [19, 31, false, false],
    ]);
    expect(translateCds(product, def(f)).protein).toBe('MKPGUAW*');
    expect(firstQualifier(def(f), 'transl_except')).toBe('(pos:20..22,aa:Sec)');
    expect(firstQualifier(def(f), 'translation')).toBe('MKPGUAW');
  });

  it('is the spliced CDS on the other strand when every fragment is turned round', () => {
    const product = ligate(
      [flipFragment(def(withExon1)), flipFragment(def(withExon2)), flipFragment(def(small))],
      { name: 'p', circular: true },
    );
    const [f, ...rest] = cdsOf(product);
    expect(rest).toHaveLength(0);
    expect(def(f).strand).toBe('reverse');
    expect(translateCds(product, def(f)).protein).toBe('MKPGUAW*');
  });

  it('stays in pieces when the intron lost bases or holds others', () => {
    const other = 'GAATTCTTTTGAATTC';
    const [, swap] = cut(SeqDocument.create({ sequence: other, topology: 'linear' }), 'EcoRI');
    expect(def(swap).sequence).toHaveLength(def(small).sequence.length);
    for (const parts of [
      [def(withExon2), def(withExon1)],
      [def(swap), def(withExon2), def(withExon1)],
    ]) {
      const product = ligate(parts, { name: 'p', circular: true });
      expect(cdsOf(product)).toHaveLength(2);
    }
  });

  it('stays in pieces when one side is another plasmid’s, or was edited since', () => {
    const [, , fromTwin] = cut(make(), 'EcoRI');
    const edited = digest(documentFromFragment(def(withExon1)).insert(40, 'A'), [])[0];
    for (const last of [fromTwin, edited]) {
      const product = ligate([def(small), def(withExon2), def(last)], {
        name: 'p',
        circular: true,
      });
      expect(cdsOf(product)).toHaveLength(2);
    }
  });

  it('stays in pieces in the wrong order', () => {
    const product = ligate([def(small), def(withExon1), def(withExon2)], {
      name: 'p',
      circular: true,
    });
    expect(cdsOf(product)).toHaveLength(2);
  });
});

describe('a feature across the origin of a circle (#182)', () => {
  it('a reverse CDS across it, cut inside, closes to the same wrapped feature', () => {
    // A reverse CDS across the origin of a 60 bp circle, cut by EcoRV (GAT^ATC).
    const body = 'ATGGATATCAAACCCGGGTTTGCATGGTAA'; // M D I K P G F A W *
    const seq = body.slice(12) + 'C'.repeat(30) + body.slice(0, 12);
    const doc = SeqDocument.create({
      sequence: seq,
      topology: 'circular',
      features: [
        createFeature({
          type: 'CDS',
          name: 'wrap',
          segments: [rangeSegment(48, 78)],
          qualifiers: [{ name: 'note', value: 'kept' }],
        }),
      ],
    }).reverseComplement();
    expect(proteins(doc)).toEqual(['MDIKPGFAW*']);
    const [frag] = cut(doc, 'EcoRV');
    const closed = ligate([def(frag)], { name: 'c', circular: true });
    const [f, ...rest] = cdsOf(closed);
    expect(rest).toHaveLength(0);
    expect(def(f).strand).toBe('reverse');
    expect(def(f).qualifiers).toEqual([{ name: 'note', value: 'kept' }]);
    expect(translateCds(closed, def(f)).protein).toBe('MDIKPGFAW*');
  });
});

describe('pieces of three', () => {
  it('two of three pieces back together make one larger piece that still knows the third', () => {
    const doc = SeqDocument.create({
      sequence: 'C'.repeat(10) + 'ATGGATATCAAAGATATCTTTGCATGGTAA' + 'C'.repeat(20),
      topology: 'circular',
      features: [createFeature({ type: 'CDS', name: 'g', segments: [rangeSegment(10, 40)] })],
    });
    // EcoRV cuts at 16 and 25: [16, 25) and [25, 76).
    const [mid, rest] = cut(doc, 'EcoRV').map((f) => def(f));
    const linear = ligate([def(mid), def(rest)], { name: 'l', circular: false });
    // Linear, the two pieces of the CDS at the ends cannot meet; the middle
    // one and the 3' one become one piece.
    const fs = cdsOf(linear);
    expect(fs.map(ranges)).toEqual([[[0, 24, true, false]], [[54, 60, false, true]]]);
    expect(fs[0]?.origin).toMatchObject({ from: 6, to: 30 });
    // Closed, all three are the CDS again.
    const closed = def(emptyVector(linear));
    expect(cdsOf(closed).map((f) => translateCds(closed, f).protein)).toEqual(['MDIKDIFAW*']);
  });
});
