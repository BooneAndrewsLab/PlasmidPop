import { SeqDocument, reverseComplement } from '@/core';
import { meltingTemperature } from '@/core/primers/thermo';

import { designMultiOverlapPrimers } from './overlapAssembly';
import { OVERLAP_DEFAULTS, designOverlapPrimers } from './overlapPrimers';

function filler(length: number, seed: number): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

const VECTOR = filler(3000, 31);
const vector = SeqDocument.create({ name: 'pBack', sequence: VECTOR, topology: 'linear' });
const GENOME = filler(6000, 77);
const source = SeqDocument.create({ name: 'gDNA', sequence: GENOME, topology: 'linear' });
const A = { start: 500, end: 1300 };
const B = { start: 2500, end: 3400 };
const C = { start: 4200, end: 4900 };

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

describe('designMultiOverlapPrimers', () => {
  it('with one insert is the single design', () => {
    const one = designMultiOverlapPrimers(vector, [{ template: source, region: A }], 'yeast');
    const single = designOverlapPrimers(vector, source, A, 'yeast');
    expect(one.problem).toBeNull();
    expect(one.inserts[0]?.forward.sequence).toBe(single.forward.sequence);
    expect(one.inserts[0]?.reverse.sequence).toBe(single.reverse.sequence);
  });

  it('gives each insert’s primers as a tail and the shortest annealing part that reaches the Tm', () => {
    const d = designMultiOverlapPrimers(
      vector,
      [A, B].map((region) => ({ template: source, region })),
      'yeast',
    );
    expect(d.problem).toBeNull();
    const { minAnneal, targetTm } = OVERLAP_DEFAULTS;
    for (const [n, region] of [A, B].entries()) {
      const insert = GENOME.slice(region.start, region.end).toUpperCase();
      const made = must(d.inserts[n]);
      const forward = insert.slice(0, made.forward.annealLength);
      const reverse = reverseComplement(insert.slice(insert.length - made.reverse.annealLength));
      expect(made.forward.sequence).toBe(made.forward.tail + forward.toLowerCase());
      expect(made.reverse.sequence).toBe(made.reverse.tail + reverse.toLowerCase());
      expect(made.forward.tm).toBe(meltingTemperature(forward));
      expect(made.reverse.tm).toBe(meltingTemperature(reverse));
      for (const [p, part] of [
        [made.forward, forward],
        [made.reverse, reverse],
      ] as const) {
        expect(p.annealLength >= minAnneal).toBe(true);
        if (p.annealLength > minAnneal) {
          const shorter = part === forward ? forward.slice(0, -1) : reverse.slice(0, -1);
          expect(meltingTemperature(shorter)).toBeLessThan(targetTm);
        }
      }
    }
  });

  it('reads an insert across the origin of a circular template, and one on the reverse strand', () => {
    const circle = SeqDocument.create({ name: 'ring', sequence: GENOME, topology: 'circular' });
    const wrap = { start: 5900, end: 6100 };
    const insert = (GENOME.slice(5900) + GENOME.slice(0, 100)).toUpperCase();
    const d = designMultiOverlapPrimers(
      vector,
      [
        { template: circle, region: wrap },
        { template: source, region: B, reverse: true },
      ],
      'yeast',
    );
    expect(d.problem).toBeNull();
    const first = must(d.inserts[0]);
    expect(first.forward.sequence.slice(40)).toBe(
      insert.slice(0, first.forward.annealLength).toLowerCase(),
    );
    expect(first.reverse.sequence.slice(first.reverse.tail.length)).toBe(
      reverseComplement(insert.slice(insert.length - first.reverse.annealLength)).toLowerCase(),
    );
    expect(must(first.amplicon).length).toBe(insert.length + 40 + 20);
    // The second insert is read as its reverse complement.
    const second = reverseComplement(GENOME.slice(B.start, B.end)).toUpperCase();
    const made = must(d.inserts[1]);
    expect(made.forward.sequence.slice(made.forward.tail.length)).toBe(
      second.slice(0, made.forward.annealLength).toLowerCase(),
    );
    expect(must(d.product).length).toBe(3000 + 200 + 900);
  });

  it.each(['both', 'forward', 'reverse'] as const)(
    'closes vector + three inserts with the homology split %s',
    (split) => {
      const d = designMultiOverlapPrimers(
        vector,
        [A, B, C].map((region) => ({ template: source, region })),
        'yeast',
        { split },
      );
      expect(d.problem).toBeNull();
      expect(d.inserts).toHaveLength(3);
      const product = must(d.product);
      expect(product.isCircular).toBe(true);
      expect(product.length).toBe(3000 + 800 + 900 + 700);
      const [a, b] = d.inserts;
      // The first forward tail is the vector's end; each junction is shared by both amplicons.
      expect(a?.forward.tail).toBe(VECTOR.slice(-40));
      const endOfA = must(a?.amplicon).sequence.toString().toUpperCase();
      const startOfB = must(b?.amplicon).sequence.toString().toUpperCase();
      expect(startOfB.slice(0, 40)).toBe(endOfA.slice(-40));
    },
  );

  it('splits a junction between the two primers', () => {
    const d = designMultiOverlapPrimers(
      vector,
      [A, B].map((region) => ({ template: source, region })),
      'yeast',
      { overlap: 41, split: 'both' },
    );
    expect(d.inserts[1]?.forward.tail.length).toBe(21);
    expect(d.inserts[0]?.reverse.tail.length).toBe(20);
  });

  it('carries a junction whole on one primer when asked', () => {
    const inserts = [A, B].map((region) => ({ template: source, region }));
    const f = designMultiOverlapPrimers(vector, inserts, 'yeast', { split: 'forward' });
    expect(f.inserts[1]?.forward.tail).toBe(GENOME.slice(A.end - 40, A.end));
    const r = designMultiOverlapPrimers(vector, inserts, 'yeast', { split: 'reverse' });
    expect(r.inserts[0]?.reverse.tail).toBe(reverseComplement(GENOME.slice(B.start, B.start + 40)));
  });

  it('reads an insert on the reverse strand', () => {
    const d = designMultiOverlapPrimers(
      vector,
      [
        { template: source, region: A },
        { template: source, region: B, reverse: true },
      ],
      'yeast',
    );
    expect(d.problem).toBeNull();
    const circle = must(d.product).sequence.toString().toUpperCase();
    expect((circle + circle).includes(reverseComplement(GENOME.slice(B.start, B.end)))).toBe(true);
  });

  it('works for Gibson kits too, with the kit’s own overlap', () => {
    const d = designMultiOverlapPrimers(
      vector,
      [A, B].map((region) => ({ template: source, region })),
      'nebuilder',
      { overlap: 70 },
    );
    expect(d.problem).toBeNull();
    expect(d.overlap).toBe(20);
  });

  it('holds a yeast overlap to 20 to 80', () => {
    const inserts = [A, B].map((region) => ({ template: source, region }));
    expect(designMultiOverlapPrimers(vector, inserts, 'yeast', { overlap: 5 }).overlap).toBe(20);
    expect(designMultiOverlapPrimers(vector, inserts, 'yeast', { overlap: 500 }).overlap).toBe(80);
  });

  it('refuses a circular vector, no inserts and an insert too short for its junction', () => {
    const circle = SeqDocument.create({ name: 'c', sequence: VECTOR, topology: 'circular' });
    const inserts = [A, B].map((region) => ({ template: source, region }));
    expect(designMultiOverlapPrimers(circle, inserts, 'yeast').problem).toMatch(/circular/);
    expect(designMultiOverlapPrimers(vector, [], 'yeast').problem).toMatch(/at least one/);
    const tiny = { template: source, region: { start: 10, end: 50 } };
    expect(
      designMultiOverlapPrimers(vector, [{ template: source, region: A }, tiny], 'yeast', {
        overlap: 60,
      }).problem,
    ).toMatch(/Insert 2/);
  });
});

describe('designMultiOverlapPrimers, pinned (#413)', () => {
  const both = [A, B].map((region) => ({ template: source, region }));
  const first = must(both[0]);
  const tiny = (length: number) =>
    SeqDocument.create({ name: 'tiny', sequence: filler(length, 5), topology: 'linear' });
  const piece = (start: number, length: number) => ({
    template: source,
    region: { start, end: start + length },
  });

  it('gives back no primers and no warnings when there is nothing to design', () => {
    const none = designMultiOverlapPrimers(vector, [], 'yeast');
    expect(none.problem).toBe('Choose at least one insert.');
    expect(none.inserts).toEqual([]);
    expect(none.warnings).toEqual([]);
    expect(none.product).toBeNull();
    expect(none.overlap).toBe(40);
  });

  it('refuses a vector shorter than the kit’s homology, by its name, and not one exactly as long', () => {
    expect(designMultiOverlapPrimers(tiny(39), [first], 'yeast').problem).toBe(
      'tiny is shorter than the 40 bases of homology Yeast assembly asks for.',
    );
    expect(designMultiOverlapPrimers(tiny(19), [first], 'nebuilder').problem).toBe(
      'tiny is shorter than the 20 bases of homology NEBuilder HiFi asks for.',
    );
    // 40 bases is not shorter than 40: the assembler, not this check, says what is wrong.
    expect(designMultiOverlapPrimers(tiny(40), [first], 'yeast').problem).toBe(
      'The vector tiny is shorter than the 40 bp of homology a junction needs.',
    );
  });

  it('numbers an insert too short to amplify from 1, and holds it to two primers’ worth', () => {
    expect(designMultiOverlapPrimers(vector, [piece(10, 35)], 'yeast').problem).toBe(
      'Insert 1 (gDNA) is 35 bp, too short to amplify: a primer needs 18 bases at each end.',
    );
    expect(designMultiOverlapPrimers(vector, [first, piece(10, 35)], 'yeast').problem).toBe(
      'Insert 2 (gDNA) is 35 bp, too short to amplify: a primer needs 18 bases at each end.',
    );
    // 36 bases are two primers' worth, so the next rule is the one that speaks.
    expect(designMultiOverlapPrimers(vector, [first, piece(10, 36)], 'yeast').problem).toBe(
      'Insert 2 (gDNA) is 36 bp, shorter than the 40 bases of homology its junction is made of.',
    );
  });

  it('wants an insert as long as the homology only when a junction is made of it', () => {
    // Alone, an insert may be shorter than the homology: its junctions are the vector's.
    const alone = designMultiOverlapPrimers(vector, [piece(10, 38)], 'yeast');
    expect(alone.problem).toBeNull();
    expect(must(alone.product).length).toBe(3038);
    // Next to another, 38 is short and 40 is enough.
    expect(designMultiOverlapPrimers(vector, [first, piece(10, 38)], 'yeast').problem).toBe(
      'Insert 2 (gDNA) is 38 bp, shorter than the 40 bases of homology its junction is made of.',
    );
    const enough = designMultiOverlapPrimers(vector, [first, piece(10, 40)], 'yeast');
    expect(enough.problem).toBeNull();
    expect(must(enough.product).length).toBe(3000 + 800 + 40);
  });

  it('does not let an annealing part grow past half of a short insert', () => {
    // 40 bases of A and T melt well under 60 °C at 20 bases, so each primer takes
    // the 20 that are allowed, not the 30 that the default would.
    const at = 'AATTATATAATTATTAATATTATAATATATTAATAATTAT';
    const host = SeqDocument.create({
      name: 'host',
      sequence: filler(300, 3) + at + filler(300, 4),
      topology: 'linear',
    });
    const d = designMultiOverlapPrimers(
      vector,
      [{ template: host, region: { start: 300, end: 340 } }],
      'yeast',
    );
    expect(d.problem).toBeNull();
    expect(d.inserts[0]?.forward.annealLength).toBe(20);
    expect(d.inserts[0]?.reverse.annealLength).toBe(20);
  });

  it('labels each insert’s primers on the product', () => {
    const d = designMultiOverlapPrimers(vector, both, 'yeast');
    const names = must(d.product)
      .features.all()
      .filter((f) => f.type === 'primer_bind')
      .map((f) => f.name);
    expect(names).toEqual(['Forward', 'Reverse', 'Forward', 'Reverse']);
  });

  it('names the product as asked, for each kit, and closes it into a circle', () => {
    for (const kit of ['yeast', 'nebuilder'] as const) {
      const d = designMultiOverlapPrimers(vector, both, kit, { name: 'pMulti' });
      expect(d.problem, kit).toBeNull();
      expect(must(d.product).name, kit).toBe('pMulti');
      expect(must(d.product).isCircular, kit).toBe(true);
      expect(must(d.product).length, kit).toBe(3000 + 800 + 900);
    }
    expect(must(designMultiOverlapPrimers(vector, both, 'yeast').product).name).toBe(
      'pBack+gDNA PCR product assembly',
    );
  });

  it('marks junctions and speaks of yeast for the yeast kit only', () => {
    const homologies = (kit: 'yeast' | 'nebuilder') =>
      must(designMultiOverlapPrimers(vector, both, kit).product)
        .features.all()
        .filter((f) => f.name.startsWith('homology'))
        .map((f) => f.name);
    expect(homologies('yeast')).toEqual(['homology 1', 'homology 2', 'homology 3']);
    expect(homologies('nebuilder')).toEqual([]);
    const text = designMultiOverlapPrimers(vector, both, 'nebuilder').warnings.join(' ');
    expect(text).not.toMatch(/yeast|cell/i);
  });

  it('says why the primers of an insert are not specific, and keeps what was made', () => {
    // 20.5 kb is past a proofreading polymerase's reach, and on 21 kb of
    // random sequence the primers find somewhere else to make one product.
    const long = SeqDocument.create({ name: 'gDNA', sequence: filler(21000, 5) });
    const d = designMultiOverlapPrimers(
      vector,
      [first, { template: long, region: { start: 100, end: 20600 } }],
      'yeast',
    );
    expect(d.problem).toBe(
      'The primers for insert 2 amplify 1 other product of gDNA but not the selection; they are not specific to it.',
    );
    expect(d.product).toBeNull();
    expect(d.warnings).toEqual([]);
    expect(d.inserts).toHaveLength(2);
    expect(d.inserts[0]?.amplicon).not.toBeNull();
    expect(d.inserts[1]?.amplicon).toBeNull();
    expect(d.inserts[1]?.forward.annealLength).toBeGreaterThanOrEqual(18);
    expect(d.inserts[1]?.reverse.tail).toBe(reverseComplement(VECTOR.slice(0, 40)));
    const many = SeqDocument.create({ name: 'gDNA', sequence: filler(21000, 7) });
    expect(
      designMultiOverlapPrimers(
        vector,
        [{ template: many, region: { start: 100, end: 20600 } }],
        'yeast',
      ).problem,
    ).toBe(
      'The primers for insert 1 amplify 5 other products of gDNA but not the selection; they are not specific to it.',
    );
  });

  it('keeps the primers and the assembler’s reason when the circle does not close', () => {
    // A vector whose two ends are each other's reverse complement gives both tails
    // the same bases, so an amplicon fits after it either way round.
    const end = filler(40, 9);
    const itr = SeqDocument.create({
      name: 'pITR',
      sequence: end + filler(2000, 10) + reverseComplement(end),
      topology: 'linear',
    });
    const d = designMultiOverlapPrimers(itr, both, 'yeast');
    expect(d.problem).toBe(
      'The end of pITR matches gDNA PCR product either way round, so the assembly is ambiguous.',
    );
    expect(d.product).toBeNull();
    expect(d.warnings).toEqual([]);
    expect(d.inserts).toHaveLength(2);
  });

  describe('the warnings', () => {
    const ends = (left: 'blunt' | "5'" | "3'", right: 'blunt' | "5'" | "3'") =>
      vector.setEnds({
        left: { kind: left, overhang: left === 'blunt' ? '' : VECTOR.slice(0, 4), enzyme: 'EcoRI' },
        right: {
          kind: right,
          overhang: right === 'blunt' ? '' : VECTOR.slice(-4),
          enzyme: 'KpnI',
        },
      });
    const sticky = (chews: string) =>
      `pBack has sticky ends; the tails match its top strand, and ${chews} either way, but check the ends are where you meant to cut.`;
    const asks = (kit: string, bases: number, split: string) =>
      `${kit} asks for ${bases} bases of homology at each of the 3 junctions. ${split}`;
    const HALF = 'The two primers at an internal junction carry half each.';

    it('says in the kit’s own words what happens to sticky ends, whichever end is sticky', () => {
      for (const [left, right] of [
        ["5'", 'blunt'],
        ['blunt', "3'"],
        ["5'", "3'"],
      ] as const) {
        const y = designMultiOverlapPrimers(ends(left, right), both, 'yeast');
        expect(y.warnings[0], `${left} ${right}`).toBe(
          sticky("the cell's own resection trims them"),
        );
        const n = designMultiOverlapPrimers(ends(left, right), both, 'nebuilder');
        expect(n.warnings[0], `${left} ${right}`).toBe(
          sticky("the kit's exonuclease chews them back"),
        );
      }
    });

    it('says nothing of the ends of a vector with blunt ends, or with none', () => {
      const blunt = designMultiOverlapPrimers(ends('blunt', 'blunt'), both, 'yeast');
      expect(blunt.warnings[0]).toBe(asks('Yeast assembly', 40, HALF));
      expect(designMultiOverlapPrimers(vector, both, 'nebuilder').warnings[0]).toBe(
        asks('NEBuilder HiFi', 20, HALF),
      );
    });

    it('says which primer carries an internal junction, for each split', () => {
      const first = (split: 'both' | 'forward' | 'reverse') =>
        designMultiOverlapPrimers(vector, both, 'nebuilder', { split }).warnings[0];
      expect(first('both')).toBe(asks('NEBuilder HiFi', 20, HALF));
      expect(first('forward')).toBe(
        asks(
          'NEBuilder HiFi',
          20,
          "The next insert's forward primer carries each internal junction whole.",
        ),
      );
      expect(first('reverse')).toBe(
        asks(
          'NEBuilder HiFi',
          20,
          "The previous insert's reverse primer carries each internal junction whole.",
        ),
      );
    });
  });
});
