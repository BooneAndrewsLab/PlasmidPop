import { describe, expect, it } from 'vitest';
import {
  type Feature,
  SeqDocument,
  createFeature,
  digest,
  documentFromFragment,
  extractRange,
  findCutSites,
  firstQualifier,
  getEnzyme,
  rangeSegment,
  translateCds,
} from '@/core';
import { reverseComplement } from '@/core/sequence/alphabet';
import { parseGenBank } from '@/io/genbank/parseGenBank';
import { writeGenBank } from '@/io/genbank/writeGenBank';

// Clipped and split CDS keep neither a stale /translation nor a /transl_except
// that belongs to another stretch (#179).

function def<T>(x: T | undefined): T {
  if (x === undefined) throw new Error('expected a value');
  return x;
}

const ORF = 'ATGCGAATTCCGAAACTGTTTGCATGGGACCATTAA'; // M R I P K L F A W D H *
const STORED = 'MRIPKLFAWDH';

/** A 60 bp circle with the 36-base CDS from `start` (it may wrap), codon 5 (`AAA`) read as Sec. */
function circle(strand: 'forward' | 'reverse', start: number): SeqDocument {
  const body = strand === 'forward' ? ORF : reverseComplement(ORF);
  const bases = Array.from({ length: 60 }, () => 'C');
  for (let k = 0; k < 36; k++) bases[(start + k) % 60] = body.charAt(k);
  const segments =
    start + 36 <= 60
      ? [rangeSegment(start, start + 36)]
      : [rangeSegment(start, 60), rangeSegment(0, start + 36 - 60)];
  // Codon 4 (0-based) is bases 12..15 of the reading; on the reverse strand it
  // is the same distance from the high end of the feature's own bases.
  const codonAt = strand === 'forward' ? 12 : 36 - 15;
  const first = ((start + codonAt) % 60) + 1;
  const pos = `${first}..${first + 2}`;
  const wrapped = ((start + codonAt) % 60) + 3 > 60;
  const location = wrapped ? `join(${first}..60,1..${first + 2 - 60})` : pos;
  const value = strand === 'forward' ? location : `complement(${location})`;
  return SeqDocument.create({
    sequence: bases.join(''),
    topology: 'circular',
    features: [
      createFeature({
        type: 'CDS',
        name: 'sec',
        strand,
        segments,
        qualifiers: [
          { name: 'translation', value: STORED },
          { name: 'transl_except', value: `(pos:${value},aa:Sec)` },
        ],
      }),
    ],
  });
}

const holders = (doc: SeqDocument): Feature[] =>
  doc.features.all().filter((f) => firstQualifier(f, 'transl_except') !== undefined);

describe('a CDS the region copy clips (one piece)', () => {
  for (const strand of ['forward', 'reverse'] as const) {
    for (const start of [10, 50]) {
      it(`drops /translation, ${strand}, CDS at ${start}`, () => {
        const doc = circle(strand, start);
        const cut = extractRange(doc, { start: (start + 5) % 60, end: ((start + 5) % 60) + 20 });
        const f = def(cut.features.all()[0]);
        expect(cut.features.all()).toHaveLength(1);
        expect(firstQualifier(f, 'translation')).toBeUndefined();
        expect(translateCds(cut, f).unusedExceptions).toEqual([]);
      });
      it(`keeps /translation when the whole CDS is copied, ${strand}, CDS at ${start}`, () => {
        const doc = circle(strand, start);
        const cut = extractRange(doc, { start: start - 2, end: start + 38 });
        const f = def(cut.features.all()[0]);
        expect(firstQualifier(f, 'translation')).toBe(STORED);
        expect(firstQualifier(f, 'transl_except')).toBeDefined();
        expect(translateCds(cut, f).unusedExceptions).toEqual([]);
        expect(translateCds(cut, f).protein).toBe(
          translateCds(doc, def(doc.features.all()[0])).protein,
        );
      });
    }
  }
});

describe('a split CDS copies /transl_except to the piece with its codon only', () => {
  for (const strand of ['forward', 'reverse'] as const) {
    for (const start of [10, 50]) {
      // Drops the middle [start+14, start+20) of the CDS, which holds neither
      // the codon at 12..15 of the reading (forward) nor its mirror.
      const drop: [number, number] =
        strand === 'forward' ? [start + 18, start + 24] : [start + 12, start + 18];
      it(`${strand}, CDS at ${start}`, () => {
        const doc = circle(strand, start);
        const cut = extractRange(doc, { start: drop[1] % 60, end: (drop[0] % 60) + 60 });
        const parts = cut.features.all();
        expect(parts).toHaveLength(2);
        expect(holders(cut)).toHaveLength(1);
        for (const part of parts) {
          expect(firstQualifier(part, 'translation')).toBeUndefined();
          expect(translateCds(cut, part).unusedExceptions).toEqual([]);
        }
        // The exception sits on the stretch that reads the Sec codon.
        const holder = def(holders(cut)[0]);
        expect(translateCds(cut, holder).protein).toContain('U');
      });
    }
  }

  it('drops a codon cut apart by the region, from both pieces', () => {
    const doc = circle('forward', 10); // codon at [22, 25)
    const cut = extractRange(doc, { start: 24, end: 24 + 56 });
    expect(holders(cut)).toHaveLength(0);
    for (const part of cut.features.all()) {
      expect(translateCds(cut, part).unusedExceptions).toEqual([]);
    }
  });
});

describe('the pieces through a digest and a GenBank round trip', () => {
  it('two copies of a circle keep no stale /translation or stray /transl_except', () => {
    const doc = circle('forward', 10);
    const frags = [
      extractRange(doc, { start: 5, end: 30 }),
      extractRange(doc, { start: 30, end: 65 }),
    ];
    expect(frags.flatMap((d) => holders(d))).toHaveLength(1);
    for (const d of frags) {
      for (const f of d.features.all()) {
        expect(firstQualifier(f, 'translation')).toBeUndefined();
        expect(translateCds(d, f).unusedExceptions).toEqual([]);
      }
    }
  });

  it('writes no /translation for a clipped CDS and reads back the same qualifiers', () => {
    const doc = circle('reverse', 50);
    const cut = extractRange(doc, { start: 55, end: 75 });
    const text = writeGenBank(cut);
    expect(text).not.toContain('/translation');
    const back = def(parseGenBank(text).documents[0]);
    const exceptions = (d: SeqDocument) =>
      d.features.all().map((f) => firstQualifier(f, 'transl_except'));
    expect(exceptions(back)).toEqual(exceptions(cut));
  });
});

describe('a digest fragment', () => {
  it('drops /translation from a CDS the cut runs through (ORF holds an EcoRI site)', () => {
    const seq = 'CC' + ORF + 'GG' + 'GAATTC' + 'TTTT';
    const doc = SeqDocument.create({
      sequence: seq,
      topology: 'linear',
      features: [
        createFeature({
          type: 'CDS',
          name: 'g',
          segments: [rangeSegment(2, 38)],
          qualifiers: [{ name: 'translation', value: STORED }],
        }),
      ],
    });
    const frags = digest(doc, findCutSites(seq, 'linear', [def(getEnzyme('EcoRI'))]));
    expect(frags.length).toBeGreaterThan(1);
    for (const frag of frags) {
      for (const f of documentFromFragment(frag).features.all()) {
        expect(firstQualifier(f, 'translation')).toBeUndefined();
      }
    }
  });
});
