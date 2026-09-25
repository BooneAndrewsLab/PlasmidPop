import fc from 'fast-check';

import {
  type LineageNode,
  type LineageStep,
  MAX_LINEAGE_NODES,
  SeqDocument,
  lineageDepth,
  lineageNodeCount,
  MAX_LINEAGE_DEPTH,
} from '@/core';

import { formatMadeFromComment, isMadeFromComment, parseMadeFromComment } from './madeFromComment';
import { isOwnComment } from './ownComments';
import { parseGenBank } from './parseGenBank';
import { writeGenBank } from './writeGenBank';

const SUM_A = 'cdseguid=dUxN7YQyVInv3oDcvz8ByupL44A';
const SUM_B = 'ldseguid=dmS9Y4eutZMCbPaGkq0blFgh8RU';
const SUM_C = 'cdseguid=AAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** pUC19 cut with EcoRI and BamHI and joined to a PCR product of pEGFP. */
const EXAMPLE: LineageNode = {
  name: 'pUC19+GFP assembly',
  checksum: SUM_A,
  topology: 'circular',
  length: 3426,
  step: {
    op: 'ligation',
    circular: true,
    flipped: [false, true],
    parents: [
      {
        name: 'pUC19 EcoRI-BamHI fragment',
        checksum: SUM_B,
        topology: 'linear',
        length: 2665,
        step: {
          op: 'digest',
          enzymes: ['EcoRI', 'BamHI'],
          range: { start: 2660, end: 2686 + 2639 },
          uncut: 0,
          parents: [
            { name: 'pUC19', checksum: SUM_C, topology: 'circular', length: 2686, step: null },
          ],
        },
      },
      {
        name: 'GFP PCR',
        checksum: null,
        topology: 'linear',
        length: 761,
        step: {
          op: 'pcr',
          forward: { name: 'GFP fwd, 5′ EcoRI', sequence: 'GGAATTCATGGTGAGCAAGGGCGAGGAG' },
          reverse: { name: 'GFP rev', sequence: 'CGGGATCCTTACTTGTACAGCTCGTCCATG' },
          polymerase: 'proofreading',
          parents: [
            { name: 'pEGFP-N1', checksum: SUM_A, topology: 'circular', length: 4733, step: null },
          ],
        },
      },
    ],
  },
};

function readBack(text: string): SeqDocument {
  const doc = parseGenBank(text).documents[0];
  if (doc === undefined) throw new Error('no document');
  return doc;
}

describe('the PlasmidPop-made-from block (#67)', () => {
  it('writes one header line, then a line or two per molecule, within GenBank’s width', () => {
    const text = formatMadeFromComment(EXAMPLE);
    const lines = text.split('\n');
    expect(lines[0]).toBe('PlasmidPop-made-from: 1');
    expect(lines[1]).toBe('0 ligation cdseguid=dUxN7YQyVInv3oDcvz8ByupL44A 3426 circular');
    expect(lines[2]).toBe('+ pUC19+GFP%20assembly circular=yes flipped=01');
    expect(text).toContain('enzymes=EcoRI,BamHI');
    // 1-based and inclusive; across the origin the end is the smaller number.
    expect(text).toContain('range=2661..2639');
    expect(text).toContain('2 - cdseguid=AAAAAAAAAAAAAAAAAAAAAAAAAAA 2686 circular pUC19');
    expect(text).toContain('forward=GFP%20fwd%2C%205%E2%80%B2%20EcoRI,GGAATTC');
    expect(text).toContain('1 pcr - 761 linear GFP%20PCR');
    // A token longer than the width (a long primer) runs over, as the
    // writer lets a long word do; every other line fits.
    for (const line of lines) {
      if (line.replace(/^\+ /, '').includes(' ')) expect(line.length).toBeLessThanOrEqual(67);
    }
    expect(lines.some((l) => l.startsWith('+ '))).toBe(true);
  });

  it('reads back what it wrote', () => {
    expect(parseMadeFromComment(formatMadeFromComment(EXAMPLE))).toEqual(EXAMPLE);
  });

  it('is our own comment, understood', () => {
    const text = formatMadeFromComment(EXAMPLE);
    expect(isMadeFromComment(text)).toBe(true);
    expect(isOwnComment(text)).toBe(true);
    expect(isOwnComment('PlasmidPop-made-from: 1\n0 teleport - 1 linear x')).toBe(false);
  });

  it('survives a save and an open, and a second save changes nothing', () => {
    const doc = SeqDocument.create({
      name: 'pUC19+GFP',
      sequence: 'ACGT'.repeat(20),
      topology: 'circular',
      metadata: { lineage: EXAMPLE, comments: ['a note of the user’s own'] },
    });
    const text = writeGenBank(doc);
    expect(text).toContain('COMMENT     PlasmidPop-made-from: 1\n            0 ligation');
    const back = readBack(text);
    expect(back.metadata.lineage).toEqual(EXAMPLE);
    // Taken out of the comments, and written once.
    expect(back.metadata.comments).toEqual(['a note of the user’s own']);
    expect(writeGenBank(back)).toBe(text);
    expect(text.match(/PlasmidPop-made-from:/g)).toHaveLength(1);
  });

  it('reads an older file without the block as made from nothing', () => {
    const doc = SeqDocument.create({ name: 'old', sequence: 'ACGTACGT' });
    const back = readBack(writeGenBank(doc));
    expect(back.metadata.lineage).toBeNull();
    expect(writeGenBank(back)).not.toContain('PlasmidPop-made-from');
  });

  it('writes a stale copy in the comments once, as the document says', () => {
    const stale = formatMadeFromComment({ ...EXAMPLE, name: 'stale' });
    const doc = SeqDocument.create({
      name: 'p',
      sequence: 'ACGT',
      metadata: { lineage: EXAMPLE, comments: [stale] },
    });
    const text = writeGenBank(doc);
    expect(text.match(/PlasmidPop-made-from:/g)).toHaveLength(1);
    expect(text).not.toContain(
      '0 ligation cdseguid=dUxN7YQyVInv3oDcvz8ByupL44A 3426 circular stale',
    );
  });

  describe('a damaged block', () => {
    const good = formatMadeFromComment(EXAMPLE);
    const lines = good.split('\n');
    const damaged: readonly [string, string][] = [
      ['a version this build does not know', good.replace('made-from: 1', 'made-from: 2')],
      ['no molecules', 'PlasmidPop-made-from: 1'],
      ['a molecule missing', lines.filter((l) => !l.startsWith('2 - cdseguid=AAAA')).join('\n')],
      ['a depth that skips a level', good.replace('\n2 - cdseguid=AAAA', '\n3 - cdseguid=AAAA')],
      ['two roots', `${good}\n0 - - 10 linear extra`],
      ['an unknown step', good.replace('0 ligation', '0 teleport')],
      ['a bad checksum', good.replace(SUM_A, 'cdseguid=short')],
      ['flags that do not match the parts', good.replace('flipped=01', 'flipped=011')],
      ['a range outside its parent', good.replace('range=2661..2639', 'range=9999..3')],
      ['a bad escape', good.replace('pUC19%20EcoRI', 'pUC19%ZZEcoRI')],
      ['a continuation with nothing before it', 'PlasmidPop-made-from: 1\n+ flipped=0'],
      ['a missing setting', good.replace(' polymerase=proofreading', '')],
    ];

    it.each(damaged)('with %s is not read', (_what, text) => {
      expect(parseMadeFromComment(text)).toBeNull();
      expect(isOwnComment(text)).toBe(false);
      expect(isMadeFromComment(text)).toBe(true);
    });

    it.each(damaged)('with %s is kept as an ordinary comment through a save', (_what, text) => {
      const doc = SeqDocument.create({
        name: 'p',
        sequence: 'ACGTACGT',
        metadata: { comments: ['before', text, 'after'] },
      });
      const written = writeGenBank(doc);
      const back = readBack(written);
      expect(back.metadata.lineage).toBeNull();
      expect(back.metadata.comments).toEqual(['before', text, 'after']);
      expect(writeGenBank(back)).toBe(written);
    });
  });

  it('keeps the largest tree it allows under 20 KB', () => {
    // The largest tree the app keeps: 64 molecules, each a PCR with two long primers.
    const primer = { name: 'a long primer name', sequence: 'ACGT'.repeat(15) };
    const pcrOf = (parent: LineageNode, i: number): LineageNode => ({
      name: `amplicon number ${String(i)} of a long series`,
      checksum: SUM_B,
      topology: 'linear',
      length: 1000 + i,
      step: { op: 'pcr', forward: primer, reverse: primer, polymerase: 'taq', parents: [parent] },
    });
    // A ligation of three chains of 21 PCRs each.
    const chain = (seed: number): LineageNode => {
      let node: LineageNode = {
        name: `template ${String(seed)}`,
        checksum: SUM_C,
        topology: 'circular',
        length: 5000,
        step: null,
      };
      for (let i = 0; i < 20; i++) node = pcrOf(node, seed * 100 + i);
      return node;
    };
    const tree: LineageNode = {
      name: 'the end of it',
      checksum: SUM_A,
      topology: 'circular',
      length: 9000,
      step: {
        op: 'ligation',
        circular: true,
        flipped: [false, false, false],
        parents: [chain(1), chain(2), chain(3)],
      },
    };
    expect(lineageNodeCount(tree)).toBe(MAX_LINEAGE_NODES);
    const text = formatMadeFromComment(tree);
    expect(text.length).toBeLessThan(20 * 1024);
    expect(parseMadeFromComment(text)).toEqual(tree);
  });

  it('cuts a tree past the limits, from a file this app did not write, down to them', () => {
    const lines = ['PlasmidPop-made-from: 1'];
    for (let d = 0; d <= 40; d++)
      lines.push(`${String(d)} ${d === 40 ? '-' : 'edited'} - 10 linear m${String(d)}`);
    const read = parseMadeFromComment(lines.join('\n'));
    expect(read).not.toBeNull();
    if (read === null) return;
    expect(lineageDepth(read)).toBe(MAX_LINEAGE_DEPTH);
  });
});

// ---------------------------------------------------------------- property

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.match(/./g) ?? [];
const checksumArb = fc.option(
  fc
    .tuple(
      fc.constantFrom('ls', 'cs', 'ld', 'cd'),
      fc.string({ unit: fc.constantFrom(...B64), minLength: 27, maxLength: 27 }),
    )
    .map(([k, v]) => `${k}seguid=${v}`),
  { nil: null },
);
const textArb = fc.string({ unit: 'grapheme', maxLength: 24 });
const topologyArb = fc.constantFrom('linear' as const, 'circular' as const);
const shellArb = fc.record({
  name: textArb,
  checksum: checksumArb,
  topology: topologyArb,
  length: fc.integer({ min: 1, max: 10_000_000 }),
});
const primerArb = fc.record({ name: textArb, sequence: textArb });
const flagsOf = (n: number) => fc.array(fc.boolean(), { minLength: n, maxLength: n });

function stepArb(parentArb: fc.Arbitrary<LineageNode>): fc.Arbitrary<LineageStep> {
  const one = parentArb.map((p) => [p]);
  const some = fc.array(parentArb, { minLength: 1, maxLength: 3 });
  return fc.oneof(
    fc
      .tuple(parentArb, fc.array(textArb, { maxLength: 3 }), fc.nat(), fc.nat(), fc.nat(5))
      .map(([parent, enzymes, a, b, uncut]): LineageStep => {
        const L = parent.length;
        const start = a % L;
        const span = parent.topology === 'circular' ? 1 + (b % L) : 1 + (b % (L - start));
        return {
          op: 'digest',
          parents: [parent],
          enzymes,
          range: { start, end: start + span },
          uncut,
        };
      }),
    fc
      .tuple(one, primerArb, primerArb, fc.constantFrom('taq' as const, 'proofreading' as const))
      .map(([parents, forward, reverse, polymerase]): LineageStep => ({
        op: 'pcr',
        parents,
        forward,
        reverse,
        polymerase,
      })),
    some.chain((parents) =>
      fc.tuple(fc.boolean(), flagsOf(parents.length)).map(([circular, flipped]): LineageStep => ({
        op: 'ligation',
        parents,
        circular,
        flipped,
      })),
    ),
    some.chain((parents) =>
      fc
        .tuple(fc.array(textArb, { maxLength: 2 }), flagsOf(parents.length))
        .map(([enzymes, flipped]): LineageStep => ({
          op: 'golden-gate',
          parents,
          enzymes,
          flipped,
        })),
    ),
    some.chain((parents) =>
      fc
        .tuple(
          fc.constantFrom('gibson' as const, 'in-fusion' as const, 'nebuilder' as const),
          fc.boolean(),
          fc.nat(100),
          flagsOf(parents.length),
        )
        .map(([kit, circular, overlap, flipped]): LineageStep => ({
          op: 'gibson',
          parents,
          kit,
          circular,
          overlap,
          flipped,
        })),
    ),
    fc
      .tuple(parentArb, parentArb, fc.constantFrom('BP' as const, 'LR' as const), fc.boolean())
      .map(([a, b, reaction, byproduct]): LineageStep => ({
        op: 'gateway',
        parents: [a, b],
        reaction,
        byproduct,
      })),
    fc
      .tuple(
        one,
        textArb,
        fc.constantFrom('back-to-back' as const, 'overlapping' as const),
        fc.array(textArb, { maxLength: 2 }),
      )
      .map(([parents, change, method, primers]): LineageStep => ({
        op: 'mutagenesis',
        parents,
        change,
        method,
        primers,
      })),
    fc
      .tuple(one, fc.boolean())
      .map(([parents, removed]): LineageStep => ({ op: 'phosphates', parents, removed })),
    one.map((parents): LineageStep => ({ op: 'edited', parents })),
    fc.nat(999_999_999).map((nodes): LineageStep => ({ op: 'elided', parents: [], nodes })),
  );
}

const lineageArb: fc.Arbitrary<LineageNode> = fc.letrec<{ node: LineageNode }>((tie) => ({
  node: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    shellArb.map((s): LineageNode => ({ ...s, step: null })),
    fc.tuple(shellArb, stepArb(tie('node'))).map(([s, step]): LineageNode => ({ ...s, step })),
  ),
})).node;

describe('the block, for any tree', () => {
  it('reads back exactly the tree it wrote, through a GenBank file', () => {
    fc.assert(
      fc.property(lineageArb, (tree) => {
        fc.pre(
          lineageNodeCount(tree) <= MAX_LINEAGE_NODES && lineageDepth(tree) <= MAX_LINEAGE_DEPTH,
        );
        const block = formatMadeFromComment(tree);
        expect(parseMadeFromComment(block)).toEqual(tree);
        const doc = SeqDocument.create({
          name: 'p',
          sequence: 'ACGT',
          metadata: { lineage: tree },
        });
        const text = writeGenBank(doc);
        // Printable ASCII only, whatever the names hold.
        expect(/^[\x20-\x7e\n]*$/.test(text)).toBe(true);
        expect(readBack(text).metadata.lineage).toEqual(tree);
      }),
      { numRuns: 300 },
    );
  });
});
