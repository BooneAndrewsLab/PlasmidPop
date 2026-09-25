import { type LineageNode, lineageDepth } from '@/core';

import { formatMadeFromComment, isMadeFromComment, parseMadeFromComment } from './madeFromComment';

const HEADER = 'PlasmidPop-made-from: 1';
const SUM_C = 'cdseguid=AAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** A block of these molecule lines under the header. */
function block(lines: readonly string[]): string {
  return [HEADER, ...lines].join('\n');
}

/**
 * The same lines hung 30 levels down a chain of edits, past the depth a
 * lineage keeps, so that what they say is cut away once read. A damaged
 * molecule there must still spoil the block: the reader checks every line,
 * not only what it keeps.
 */
function buried(lines: readonly string[]): string {
  const chain = Array.from(
    { length: 30 },
    (_, d) => `${String(d)} edited - 10 linear m${String(d)}`,
  );
  const moved = lines.map((l) => l.replace(/^\d+/, (d) => String(Number(d) + 30)));
  return block([...chain, ...moved]);
}

function leaf(name: string, length = 10): LineageNode {
  return { name, checksum: null, topology: 'linear', length, step: null };
}

describe('the made-from block, written out exactly', () => {
  it('writes a lone molecule on one line', () => {
    const node: LineageNode = {
      name: 'pUC19',
      checksum: SUM_C,
      topology: 'circular',
      length: 2686,
      step: null,
    };
    expect(formatMadeFromComment(node)).toBe(`${HEADER}\n0 - ${SUM_C} 2686 circular pUC19`);
  });

  it('writes a complete digest through the origin without an uncut count', () => {
    const node: LineageNode = {
      name: '',
      checksum: null,
      topology: 'linear',
      length: 2665,
      step: {
        op: 'digest',
        enzymes: ['EcoRI', 'BamHI'],
        range: { start: 2660, end: 2686 + 2639 },
        uncut: 0,
        parents: [{ ...leaf('pUC19', 2686), topology: 'circular' }],
      },
    };
    const text = formatMadeFromComment(node);
    expect(text).toBe(
      [
        HEADER,
        '0 digest - 2665 linear - enzymes=EcoRI,BamHI range=2661..2639',
        '1 - - 2686 circular pUC19',
      ].join('\n'),
    );
    expect(parseMadeFromComment(text)).toEqual(node);
  });

  it('writes a partial digest with its uncut count', () => {
    const node: LineageNode = {
      ...leaf('f', 5),
      step: {
        op: 'digest',
        enzymes: [],
        range: { start: 2, end: 7 },
        uncut: 2,
        parents: [leaf('p')],
      },
    };
    expect(formatMadeFromComment(node)).toBe(
      [HEADER, '0 digest - 5 linear f enzymes= range=3..7 uncut=2', '1 - - 10 linear p'].join('\n'),
    );
  });

  it('writes a range as it is under a parent with no length', () => {
    const node: LineageNode = {
      ...leaf('f', 5),
      step: {
        op: 'digest',
        enzymes: ['EcoRI'],
        range: { start: 0, end: 5 },
        uncut: 0,
        parents: [leaf('p', 0)],
      },
    };
    const text = formatMadeFromComment(node);
    expect(text).toBe(
      [HEADER, '0 digest - 5 linear f enzymes=EcoRI range=1..5', '1 - - 0 linear p'].join('\n'),
    );
    expect(parseMadeFromComment(text)).toEqual(node);
  });

  it('writes a digest with no parent without failing', () => {
    const node: LineageNode = {
      ...leaf('f', 5),
      step: { op: 'digest', enzymes: [], range: { start: 0, end: 5 }, uncut: 0, parents: [] },
    };
    expect(formatMadeFromComment(node)).toBe(
      `${HEADER}\n0 digest - 5 linear f enzymes= range=1..5`,
    );
  });

  it('writes an edited molecule with no settings, and an elided one with its count', () => {
    const node: LineageNode = {
      ...leaf('e'),
      step: {
        op: 'edited',
        parents: [{ ...leaf('x'), step: { op: 'elided', parents: [], nodes: 7 } }],
      },
    };
    const text = formatMadeFromComment(node);
    expect(text).toBe(
      [HEADER, '0 edited - 10 linear e', '1 elided - 10 linear x nodes=7'].join('\n'),
    );
    expect(parseMadeFromComment(text)).toEqual(node);
  });

  it('escapes a name that is just a dash, so it is not read as no name', () => {
    const text = formatMadeFromComment(leaf('-'));
    expect(text).toBe(`${HEADER}\n0 - - 10 linear %2D`);
    expect(parseMadeFromComment(text)).toEqual(leaf('-'));
    expect(parseMadeFromComment(formatMadeFromComment(leaf('')))).toEqual(leaf(''));
  });

  it('escapes an equals sign, a percent and a comma, and keeps other printable ASCII', () => {
    const text = formatMadeFromComment(leaf('a=b%c,d!~'));
    expect(text).toBe(`${HEADER}\n0 - - 10 linear a%3Db%25c%2Cd!~`);
    expect(parseMadeFromComment(text)).toEqual(leaf('a=b%c,d!~'));
  });

  it('writes a lone surrogate as the replacement character', () => {
    const text = formatMadeFromComment(leaf('a\uD800b'));
    expect(text).toBe(`${HEADER}\n0 - - 10 linear a%EF%BF%BDb`);
    expect(parseMadeFromComment(text)).toEqual(leaf('a�b'));
  });

  it('fills a line to exactly 67 columns before going on to the next', () => {
    const name = 'n'.repeat(67 - '0 - - 10 linear '.length);
    const text = formatMadeFromComment(leaf(name));
    expect(text).toBe(`${HEADER}\n0 - - 10 linear ${name}`);
    const longer = formatMadeFromComment(leaf(`${name}n`));
    expect(longer).toBe(`${HEADER}\n0 - - 10 linear\n+ ${name}n`);
  });
});

describe('the made-from block, read back exactly', () => {
  it('takes a range right round a circle, starting anywhere', () => {
    const read = parseMadeFromComment(
      block(['0 digest - 10 linear f enzymes=EcoRI range=3..2', '1 - - 10 circular p']),
    );
    expect(read?.step).toMatchObject({ op: 'digest', range: { start: 2, end: 12 } });
  });

  it('takes a range across the origin of a circle', () => {
    const read = parseMadeFromComment(
      block(['0 digest - 5 linear f enzymes=EcoRI range=8..2', '1 - - 10 circular p']),
    );
    expect(read?.step).toMatchObject({ op: 'digest', range: { start: 7, end: 12 } });
  });

  it('takes any range under a parent with no length', () => {
    const read = parseMadeFromComment(
      block(['0 digest - 5 linear f enzymes= range=1..5', '1 - - 0 linear p']),
    );
    expect(read?.step).toMatchObject({ op: 'digest', range: { start: 0, end: 5 }, enzymes: [] });
  });

  it('takes a digest with no uncut count as a complete one', () => {
    const read = parseMadeFromComment(
      block(['0 digest - 5 linear f enzymes=EcoRI range=1..5', '1 - - 10 linear p']),
    );
    expect(read?.step).toMatchObject({ op: 'digest', uncut: 0 });
  });

  it('joins continuation lines and reads runs of spaces and tabs as one', () => {
    const read = parseMadeFromComment(
      block([
        '0\tpcr  -   5 linear f',
        '+ forward=F,ACGT',
        '+ reverse=R,TTGA polymerase=taq',
        '1 - - 10 linear t',
      ]),
    );
    expect(read).toEqual({
      ...leaf('f', 5),
      step: {
        op: 'pcr',
        forward: { name: 'F', sequence: 'ACGT' },
        reverse: { name: 'R', sequence: 'TTGA' },
        polymerase: 'taq',
        parents: [leaf('t')],
      },
    });
  });

  it('reads every kind of step', () => {
    const read = parseMadeFromComment(
      block([
        '0 ligation - 50 circular l circular=no flipped=10',
        '1 golden-gate - 20 circular g enzymes=BsaI,BsmBI flipped=1',
        '2 gibson - 20 circular h kit=in-fusion circular=yes overlap=15 flipped=00',
        '3 gateway - 20 circular w reaction=BP byproduct=yes',
        '4 - - 10 linear a',
        '4 - - 10 linear b',
        '3 mutagenesis - 10 circular m change=A1G method=back-to-back primers=AC,-',
        '4 phosphates - 10 linear q removed=no',
        '5 elided - 10 linear e nodes=3',
        '1 - - 10 linear c',
      ]),
    );
    expect(read).toEqual({
      ...leaf('l', 50),
      topology: 'circular',
      step: {
        op: 'ligation',
        circular: false,
        flipped: [true, false],
        parents: [
          {
            ...leaf('g', 20),
            topology: 'circular',
            step: {
              op: 'golden-gate',
              enzymes: ['BsaI', 'BsmBI'],
              flipped: [true],
              parents: [
                {
                  ...leaf('h', 20),
                  topology: 'circular',
                  step: {
                    op: 'gibson',
                    kit: 'in-fusion',
                    circular: true,
                    overlap: 15,
                    flipped: [false, false],
                    parents: [
                      {
                        ...leaf('w', 20),
                        topology: 'circular',
                        step: {
                          op: 'gateway',
                          reaction: 'BP',
                          byproduct: true,
                          parents: [leaf('a'), leaf('b')],
                        },
                      },
                      {
                        ...leaf('m'),
                        topology: 'circular',
                        step: {
                          op: 'mutagenesis',
                          change: 'A1G',
                          method: 'back-to-back',
                          primers: ['AC', ''],
                          parents: [
                            {
                              ...leaf('q'),
                              step: {
                                op: 'phosphates',
                                removed: false,
                                parents: [
                                  { ...leaf('e'), step: { op: 'elided', parents: [], nodes: 3 } },
                                ],
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
          leaf('c'),
        ],
      },
    });
  });

  it('keeps what it cuts away readable: the buried lines are read in full', () => {
    const read = parseMadeFromComment(buried(['0 - - 10 linear x']));
    expect(read).not.toBeNull();
    if (read !== null) expect(lineageDepth(read)).toBe(24);
  });

  it('reads a block of the most lines it takes, and refuses one line more', () => {
    const chain = (n: number): string[] =>
      Array.from({ length: n }, (_, d) =>
        d === n - 1 ? `${String(d)} - - 10 linear m` : `${String(d)} edited - 10 linear m`,
      );
    expect(parseMadeFromComment(block(chain(1999)))).not.toBeNull();
    expect(parseMadeFromComment(block(chain(2000)))).toBeNull();
  });

  it('knows its own block with a space before it', () => {
    expect(isMadeFromComment(`  ${HEADER}\n0 - - 10 linear x`)).toBe(true);
    expect(isMadeFromComment('a note: PlasmidPop-made-from: 1')).toBe(false);
  });
});

// ------------------------------------------------------------ what is refused

const LEAF = '1 - - 10 linear p';

/** Well-formed molecules of each kind, each with its parents, as a subtree at depth 0. */
const GOOD = {
  leaf: ['0 - - 10 linear x'],
  digest: ['0 digest - 5 linear f enzymes=EcoRI,BamHI range=3..7', LEAF],
  circularDigest: ['0 digest - 5 linear f enzymes=EcoRI range=8..2', '1 - - 10 circular p'],
  emptyDigest: ['0 digest - 5 linear f enzymes= range=1..5', '1 - - 0 circular p'],
  pcr: ['0 pcr - 5 linear f forward=F,ACGT reverse=R,TTGA polymerase=taq', LEAF],
  ligation: ['0 ligation - 20 circular l circular=yes flipped=01', LEAF, LEAF],
  goldenGate: ['0 golden-gate - 20 circular g enzymes=BsaI flipped=0', LEAF],
  gibson: ['0 gibson - 20 circular g kit=gibson circular=yes overlap=20 flipped=00', LEAF, LEAF],
  gateway: ['0 gateway - 20 circular w reaction=LR byproduct=no', LEAF, LEAF],
  mutagenesis: ['0 mutagenesis - 10 circular m change=A1G method=overlapping primers=AC,GT', LEAF],
  phosphates: ['0 phosphates - 10 linear q removed=yes', LEAF],
  edited: ['0 edited - 10 linear e', LEAF],
  elided: ['0 elided - 10 linear e nodes=3'],
} as const;

type Kind = keyof typeof GOOD;

/** A damage done to the first line of a good molecule, or to its whole list of lines. */
const DAMAGED: readonly [string, Kind, (lines: readonly string[]) => string[]][] = [
  ['a molecule without a name', 'leaf', () => ['0 - - 10 linear']],
  ['a length of ten digits', 'leaf', () => ['0 - - 1234567890 linear x']],
  ['a length that is not a number', 'leaf', () => ['0 - - ten linear x']],
  ['a length with a letter after it', 'leaf', () => ['0 - - 10x linear x']],
  ['a length with a letter before it', 'leaf', () => ['0 - - x10 linear x']],
  ['a topology of neither kind', 'leaf', () => ['0 - - 10 loop x']],
  ['a name with a bad escape', 'leaf', () => ['0 - - 10 linear a%ZZ']],
  ['a setting without an equals sign', 'leaf', () => ['0 - - 10 linear x junk']],
  ['a setting without a key', 'leaf', () => ['0 - - 10 linear x =junk']],
  ['a molecule of no history that has parents', 'leaf', () => ['0 - - 10 linear x', LEAF]],
  ['a lone continuation mark', 'leaf', (l) => [...l, '+']],
  ['a digest without its enzymes', 'digest', (l) => rewrite(l, ' enzymes=EcoRI,BamHI', '')],
  ['a digest with a bad escape in its enzymes', 'digest', (l) => rewrite(l, 'BamHI', 'Bam%ZZ')],
  ['a digest with a bad uncut count', 'digest', (l) => [`${first(l)} uncut=x`, ...l.slice(1)]],
  ['a digest without its range', 'digest', (l) => rewrite(l, ' range=3..7', '')],
  ['a range that is not one', 'digest', (l) => rewrite(l, '3..7', 'three')],
  ['a range with a letter before it', 'digest', (l) => rewrite(l, '3..7', 'x3..7')],
  ['a range with a letter after it', 'digest', (l) => rewrite(l, '3..7', '3..7x')],
  ['a range from position 0', 'digest', (l) => rewrite(l, '3..7', '0..7')],
  ['a range backwards in a linear parent', 'digest', (l) => rewrite(l, '3..7', '7..3')],
  ['a range starting past its parent', 'digest', (l) => rewrite(l, '3..7', '11..12')],
  ['a range longer than its parent', 'digest', (l) => rewrite(l, '3..7', '1..11')],
  ['a digest with two parents', 'digest', (l) => [...l, LEAF]],
  ['a range through a circle of no length', 'emptyDigest', (l) => rewrite(l, '1..5', '3..2')],
  [
    'a range past the origin that starts past the circle',
    'circularDigest',
    (l) => rewrite(l, '8..2', '16..2'),
  ],
  ['a PCR without its forward primer', 'pcr', (l) => rewrite(l, ' forward=F,ACGT', '')],
  ['a PCR without its reverse primer', 'pcr', (l) => rewrite(l, ' reverse=R,TTGA', '')],
  ['a primer of three parts', 'pcr', (l) => rewrite(l, 'F,ACGT', 'F,ACGT,G')],
  ['a primer of one part', 'pcr', (l) => rewrite(l, 'F,ACGT', 'F')],
  ['an unknown polymerase', 'pcr', (l) => rewrite(l, 'taq', 'pfu')],
  ['a PCR with two parents', 'pcr', (l) => [...l, LEAF]],
  ['a ligation without its topology', 'ligation', (l) => rewrite(l, ' circular=yes', '')],
  [
    'a ligation neither circular nor linear',
    'ligation',
    (l) => rewrite(l, 'circular=yes', 'circular=maybe'),
  ],
  ['a ligation without its flags', 'ligation', (l) => rewrite(l, ' flipped=01', '')],
  ['flags that are not flags', 'ligation', (l) => rewrite(l, 'flipped=01', 'flipped=ab')],
  ['flags with a letter after them', 'ligation', (l) => rewrite(l, 'flipped=01', 'flipped=0x')],
  ['flags with a letter before them', 'ligation', (l) => rewrite(l, 'flipped=01', 'flipped=x1')],
  ['a ligation of nothing', 'ligation', (l) => [rewrite(l, 'flipped=01', 'flipped=')[0] ?? '']],
  ['a Golden Gate without its enzymes', 'goldenGate', (l) => rewrite(l, ' enzymes=BsaI', '')],
  ['a Golden Gate with too many flags', 'goldenGate', (l) => rewrite(l, 'flipped=0', 'flipped=00')],
  ['an unknown kit', 'gibson', (l) => rewrite(l, 'kit=gibson', 'kit=glue')],
  ['a Gibson without its topology', 'gibson', (l) => rewrite(l, ' circular=yes', '')],
  ['a Gibson without its overlap', 'gibson', (l) => rewrite(l, ' overlap=20', '')],
  ['a Gibson with too few flags', 'gibson', (l) => rewrite(l, 'flipped=00', 'flipped=0')],
  ['an unknown Gateway reaction', 'gateway', (l) => rewrite(l, 'reaction=LR', 'reaction=XY')],
  ['a Gateway without its byproduct', 'gateway', (l) => rewrite(l, ' byproduct=no', '')],
  ['a Gateway of one parent', 'gateway', (l) => l.slice(0, 2)],
  ['a mutagenesis without its change', 'mutagenesis', (l) => rewrite(l, ' change=A1G', '')],
  ['a change with a bad escape', 'mutagenesis', (l) => rewrite(l, 'A1G', 'A%ZZ')],
  ['a mutagenesis without its primers', 'mutagenesis', (l) => rewrite(l, ' primers=AC,GT', '')],
  ['an unknown mutagenesis method', 'mutagenesis', (l) => rewrite(l, 'overlapping', 'sideways')],
  ['phosphates neither on nor off', 'phosphates', (l) => rewrite(l, ' removed=yes', '')],
  ['an edit of nothing', 'edited', (l) => l.slice(0, 1)],
  ['an elided molecule without its count', 'elided', (l) => rewrite(l, ' nodes=3', '')],
  ['an elided molecule with a parent', 'elided', (l) => [...l, LEAF]],
];

function first(lines: readonly string[]): string {
  return lines[0] ?? '';
}

function rewrite(lines: readonly string[], from: string, to: string): string[] {
  if (!first(lines).includes(from)) throw new Error(`no ${from} in ${first(lines)}`);
  return [first(lines).replace(from, to), ...lines.slice(1)];
}

describe('the made-from block, refused whole when damaged', () => {
  it.each(Object.entries(GOOD))('reads a good %s, near the root and buried', (_kind, lines) => {
    expect(parseMadeFromComment(block(lines))).not.toBeNull();
    expect(parseMadeFromComment(buried(lines))).not.toBeNull();
  });

  it.each(DAMAGED)('refuses %s, near the root and buried', (_what, kind, damage) => {
    const lines = damage(GOOD[kind]);
    expect(parseMadeFromComment(block(lines))).toBeNull();
    expect(parseMadeFromComment(buried(lines))).toBeNull();
  });

  const shallow: readonly [string, string[]][] = [
    ['a line with a bad depth after the root', ['0 - - 10 linear x', 'x - - 10 linear y']],
    ['a first molecule one level down', ['1 - - 10 linear x']],
    ['a depth that skips a level', ['0 - - 10 linear x', '2 - - 10 linear y']],
  ];

  it.each(shallow)('refuses %s', (_what, lines) => {
    expect(parseMadeFromComment(block(lines))).toBeNull();
  });
});
