import { describe, expect, it } from 'vitest';

import { AlignmentTooLargeError, type MsaOptions, alignMultiple, sumOfPairs } from '.';

/** A seeded generator (mulberry32), so every set is the same on every run. */
const random = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const BASES = 'ACGT';
const RESIDUES = 'ACDEFGHIKLMNPQRSTVWY';
const letters = (rnd: () => number, alphabet: string, length: number): string =>
  Array.from({ length }, () => alphabet.charAt(Math.floor(rnd() * alphabet.length))).join('');
const copies = (
  rnd: () => number,
  alphabet: string,
  root: string,
  count: number,
  edits: number,
  longest = 20,
): string[] =>
  Array.from({ length: count }, () => {
    let s = root;
    for (let e = 0; e < edits; e++) {
      const p = Math.floor(rnd() * (s.length - longest));
      const len = 1 + Math.floor(rnd() * longest);
      const kind = Math.floor(rnd() * 3);
      if (kind === 0) s = s.slice(0, p) + s.slice(p + len);
      else if (kind === 1) s = s.slice(0, p) + letters(rnd, alphabet, len) + s.slice(p);
      else s = s.slice(0, p) + letters(rnd, alphabet, 1) + s.slice(p + 1);
    }
    return s;
  });

/** A short fingerprint of a long string (FNV-1a, 32 bits). */
const digest = (text: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16);
};

/**
 * What an alignment holds besides its letters: the cells filled and the cells
 * of the full matrix for each join in order (the progressive joins, then those
 * of refinement), each row's gap runs as `start+length`, the column count and
 * the sum-of-pairs score. Pinned from a run whose every join the full fill
 * confirms (the tests of #372 compare the two), so each number is the result
 * of one exact path through the band code.
 */
function shape(seqs: readonly string[], options: MsaOptions = {}) {
  const joins: [number, number][] = [];
  const out = alignMultiple(seqs, { ...options, onJoin: (f, a) => joins.push([f, a]) });
  const gaps = out.rows.map((r) => {
    const runs = Array.from(r.matchAll(/-+/g), (m) => `${String(m.index)}+${String(m[0].length)}`);
    const text = runs.join(' ');
    return text.length <= 60 ? text : `${String(runs.length)} runs, ${digest(text)}`;
  });
  const score = sumOfPairs(
    out.rows,
    options.alphabet ?? 'nucleotide',
    options.gapOpen,
    options.gapExtend,
  );
  return { joins, gaps, columns: out.columns, score: Math.round(score * 1000) / 1000 };
}

type Fixture = readonly [seqs: readonly string[], options: MsaOptions];

/** Three sequences of 1,000 bases, each with `copies` of one 40-base unit among spacers of its own. */
function unitsAmong(count: number): Fixture {
  const r = random(100 + count);
  const unit = letters(r, BASES, 40);
  const make = (): string => {
    let s = '';
    for (let c = 0; c < count; c++) s += letters(r, BASES, Math.floor(840 / count)) + unit;
    return s;
  };
  return [[make(), make(), make()], { bandAbove: 0 }];
}

/** Three copies of 800 bases, one of them with 40 more at its start or end. */
function endsWith(which: number, end: 'start' | 'end'): Fixture {
  const r = random(300 + which + (end === 'end' ? 10 : 0));
  const root = letters(r, BASES, 800);
  const extra = letters(r, BASES, 40);
  const seqs = copies(r, BASES, root, 3, 2).map((c, k) =>
    k !== which ? c : end === 'end' ? c + extra : extra + c,
  );
  return [seqs, { bandAbove: 0 }];
}

/** The first two of three sequences are close, the first with 40 bases more at its start or end; the third has edits of its own. */
function closePairWithExtra(end: 'start' | 'end'): Fixture {
  const r = random(end === 'end' ? 401 : 402);
  const root = letters(r, BASES, 800);
  const extra = letters(r, BASES, 40);
  const first = end === 'end' ? root + extra : extra + root;
  return [[first, root, ...copies(r, BASES, root, 1, 8)], { bandAbove: 0 }];
}

/** Three sequences of random bases around `count` shared words of 15 bases, one every 95 bases: so many anchors and no more. */
function wordsAlong(count: number): Fixture {
  const r = random(200 + count);
  const words = Array.from({ length: count }, () => letters(r, BASES, 15));
  // The base on either side of a word is one of its sequence's own, so no window wider than the word is shared.
  const make = (k: number): string =>
    words.map((w) => letters(r, BASES, 80) + BASES.charAt(k) + w + BASES.charAt(k)).join('') +
    letters(r, BASES, 80);
  return [[make(0), make(1), make(2)], { bandAbove: 0 }];
}

/** The sets pinned below, each aligned with a band tried for every join (`bandAbove: 0`) unless it says. */
const FIXTURES: Record<string, () => Fixture> = {
  nucleotides: () => {
    const r = random(1);
    return [copies(r, BASES, letters(r, BASES, 900), 3, 4), { bandAbove: 0 }];
  },
  moreNucleotides: () => {
    const r = random(2);
    return [copies(r, BASES, letters(r, BASES, 900), 4, 4), { bandAbove: 0 }];
  },
  proteins: () => {
    const r = random(11);
    return [
      copies(r, RESIDUES, letters(r, RESIDUES, 700), 4, 3, 8),
      { bandAbove: 0, alphabet: 'protein' },
    ];
  },
  longInsertion: () => {
    const r = random(21);
    const root = letters(r, BASES, 1200);
    return [
      [root, root, root.slice(0, 500) + letters(r, BASES, 400) + root.slice(500)],
      { bandAbove: 0 },
    ];
  },
  swappedHalves: () => {
    const r = random(32);
    const x = letters(r, BASES, 600);
    const y = letters(r, BASES, 600);
    return [[x + y, y + x, x + y], { bandAbove: 0 }];
  },
  identical: () => {
    const r = random(41);
    const root = letters(r, BASES, 1000);
    return [[root, root, root, root], { bandAbove: 0 }];
  },
  refined: () => {
    const r = random(51);
    const root = letters(r, BASES, 800);
    return [
      [
        ...copies(r, BASES, root, 3, 3),
        root.slice(0, 200) + letters(r, BASES, 60) + root.slice(200),
      ],
      { bandAbove: 0 },
    ];
  },
  unrelated: () => {
    const r = random(31);
    return [[600, 600, 600].map(() => letters(r, BASES, 600)), { bandAbove: 0 }];
  },
  oneSharedCore: () => {
    const r = random(31);
    letters(r, BASES, 1200);
    const core = letters(r, BASES, 100);
    return [
      [0, 1, 2].map(() => letters(r, BASES, 1000) + core + letters(r, BASES, 250)),
      { bandAbove: 0, refine: false },
    ];
  },
  openCheaperThanExtend: () => {
    const r = random(31);
    const x = letters(r, BASES, 600);
    const y = letters(r, BASES, 600);
    return [[x, x, x + y], { bandAbove: 0, gapOpen: -0.5, gapExtend: -2 }];
  },
  /* repeated words: a 40-base unit four times in each sequence, between spacers of their own */
  wordsMetFourTimes: () => unitsAmong(4),
  wordsMetFiveTimes: () => unitsAmong(5),
  wordsMetTwice: () => unitsAmong(2),
  tenAnchors: () => wordsAlong(10),
  nineAnchors: () => wordsAlong(9),
  ambiguityInEveryTwelfthColumn: () => {
    const r = random(61);
    // S, the fifth code in the aligner's order, is the first past the four bases.
    const root = letters(r, BASES, 900).replace(/(.{11})./g, '$1S');
    return [copies(r, BASES, root, 3, 3), { bandAbove: 0 }];
  },
  gapsThatPay: () => {
    const r = random(3);
    return [
      copies(r, BASES, letters(r, BASES, 900), 3, 4),
      { bandAbove: 0, gapOpen: 1, gapExtend: 1 },
    ];
  },
  divergentCopies: () => {
    const r = random(71);
    const root = letters(r, BASES, 900);
    const diverged = (): string =>
      Array.from(root, (c) => (r() < 0.15 ? letters(r, BASES, 1) : c)).join('');
    return [
      [
        diverged(),
        diverged(),
        diverged().slice(0, 300) + letters(r, BASES, 250) + root.slice(300),
        diverged(),
      ],
      { bandAbove: 0 },
    ];
  },
  /* bases past an end of one sequence: the best path starts or ends against a gap */
  extraAtTheEndOfTheFirst: () => endsWith(0, 'end'),
  extraAtTheEndOfTheLast: () => endsWith(2, 'end'),
  extraAtTheStartOfTheFirst: () => endsWith(0, 'start'),
  extraAtTheStartOfTheLast: () => endsWith(2, 'start'),
  /* two close sequences, one with bases past an end, joined to a looser third: the half-gapped columns meet its end */
  halfGappedStart: () => closePairWithExtra('start'),
  halfGappedEnd: () => closePairWithExtra('end'),
  openAsCheapAsExtend: () => {
    const r = random(3);
    return [
      copies(r, BASES, letters(r, BASES, 900), 3, 4),
      { bandAbove: 0, gapOpen: -2, gapExtend: -2 },
    ];
  },
  freeGaps: () => {
    const r = random(3);
    return [
      copies(r, BASES, letters(r, BASES, 900), 3, 4),
      { bandAbove: 0, gapOpen: 0, gapExtend: 0 },
    ];
  },
};

const PINS: Record<string, ReturnType<typeof shape>> = {
  nucleotides: {
    joins: [
      [112646, 816640],
      [207179, 867680],
      [188582, 867680],
      [199393, 846560],
      [207179, 867680],
      [206283, 867680],
      [199308, 846560],
      [193934, 867680],
    ],
    gaps: ['442+27 608+20 678+1 708+9 756+18 871+7', '708+9 756+18 871+7', '442+27'],
    columns: 961,
    score: 13058,
  },
  moreNucleotides: {
    joins: [
      [118077, 796920],
      [201039, 832636],
      [231997, 886392],
      [206128, 859876],
      [219654, 881192],
      [236937, 853470],
      [231997, 886392],
      [230773, 886392],
      [230703, 878036],
      [242276, 882154],
      [225321, 882108],
      [236937, 853470],
    ],
    gaps: [
      '75+20 105+13 125+13 236+2 456+13 626+4 636+1',
      '236+2 456+13 636+1 735+15 845+4',
      '75+20 105+13 125+13 636+1 735+15 837+12',
      '10 runs, fda6045a',
    ],
    columns: 981,
    score: 25717,
  },
  proteins: {
    joins: [
      [87762, 483664],
      [87607, 492788],
      [87442, 491376],
      [88053, 489288],
      [86797, 490544],
      [87524, 498372],
      [87442, 491376],
      [88427, 491376],
      [87524, 498372],
      [88870, 500554],
      [88091, 499130],
      [86554, 490544],
    ],
    gaps: [
      '98+8 374+1 617+2',
      '32+5 147+1 374+1 457+8 471+3',
      '98+8 147+1 207+3 374+1 471+3',
      '98+8 147+1 256+6 471+3 679+8',
    ],
    columns: 713,
    score: 23616,
  },
  longInsertion: {
    joins: [
      [153146, 1442401],
      [694957, 1922801],
      [153146, 1442401],
      [694957, 1922801],
      [694957, 1922801],
      [643757, 1922801],
      [641357, 1922801],
      [641357, 1922801],
    ],
    gaps: ['500+400', '500+400', ''],
    columns: 1600,
    score: 17581,
  },
  swappedHalves: {
    joins: [
      [153146, 1442401],
      [1215172, 1442401],
      [1215172, 1442401],
      [1607327, 2163001],
      [1215172, 1442401],
      [1215172, 1442401],
      [2140730, 2163001],
      [2140730, 2163001],
    ],
    gaps: ['1200+600', '0+600', '1200+600'],
    columns: 1800,
    score: 10800,
  },
  identical: {
    joins: [
      [126946, 1002001],
      [126946, 1002001],
      [126946, 1002001],
      [126946, 1002001],
      [126946, 1002001],
      [126946, 1002001],
      [126946, 1002001],
      [126946, 1002001],
      [126946, 1002001],
      [126946, 1002001],
      [126946, 1002001],
      [126946, 1002001],
    ],
    gaps: ['', '', '', ''],
    columns: 1000,
    score: 30000,
  },
  refined: {
    joins: [
      [168263, 681912],
      [178530, 696496],
      [189258, 683034],
      [167984, 695688],
      [174928, 687456],
      [190800, 683034],
      [189258, 683034],
      [199515, 683034],
      [184451, 700536],
      [201642, 700806],
      [189872, 691416],
      [186579, 700854],
    ],
    gaps: [
      '199+60 279+5 517+1',
      '199+60 279+5 357+4 378+10 411+3',
      '60+20 199+60 357+4 411+3 517+1',
      '279+5 357+4 411+3 517+1',
    ],
    columns: 873,
    score: 23115,
  },
  unrelated: {
    joins: [
      [361201, 361201],
      [454356, 454356],
      [361201, 361201],
      [454356, 454356],
      [454356, 454356],
      [454356, 454356],
      [485608, 485608],
      [490416, 490416],
    ],
    gaps: ['68 runs, 256ea7e8', '54 runs, d98216a0', '53 runs, 98c5477b'],
    columns: 892,
    score: 278.5,
  },
  oneSharedCore: {
    joins: [
      [1825201, 1825201],
      [2299402, 2299402],
    ],
    gaps: ['97 runs, 579e4886', '112 runs, 9d586ed6', '169 runs, c900b849'],
    columns: 2019,
    score: 2085,
  },
  openCheaperThanExtend: {
    joins: [
      [361201, 361201],
      [721801, 721801],
      [361201, 361201],
      [721801, 721801],
      [721801, 721801],
      [721801, 721801],
      [722402, 722402],
      [722402, 722402],
    ],
    gaps: ['231 runs, 83776920', '231 runs, 83776920', '1057+1'],
    columns: 1201,
    score: 7221,
  },
  wordsMetFourTimes: {
    joins: [
      [1153297, 1002001],
      [1452540, 1257256],
      [1144677, 1002001],
      [1475175, 1269268],
      [1452540, 1257256],
      [1479188, 1257256],
      [1491920, 1314313],
      [1513385, 1330329],
    ],
    gaps: ['72 runs, bea9356a', '109 runs, d06e5c3', '75 runs, 8def177f'],
    columns: 1469,
    score: 2738,
  },
  wordsMetFiveTimes: {
    joins: [
      [1083681, 1083681],
      [1367874, 1367874],
      [1083681, 1083681],
      [1354341, 1354341],
      [1354341, 1354341],
      [1354341, 1354341],
      [1425129, 1425129],
      [1410555, 1410555],
    ],
    gaps: ['73 runs, e3762d93', '115 runs, 441ddf2f', '78 runs, a850e26d'],
    columns: 1510,
    score: 3192,
  },
  wordsMetTwice: {
    joins: [
      [848241, 848241],
      [1102437, 1102437],
      [848241, 848241],
      [1102437, 1102437],
      [1102437, 1102437],
      [1102437, 1102437],
      [1115331, 1115331],
      [1113489, 1113489],
    ],
    gaps: ['108 runs, 67c7a8fc', '66 runs, f5184c2e', '67 runs, 8db54680'],
    columns: 1347,
    score: 1586,
  },
  tenAnchors: {
    joins: [
      [1203140, 1104601],
      [1437768, 1437768],
      [1203140, 1104601],
      [1535265, 1416748],
      [1535265, 1416748],
      [1569889, 1416748],
      [1455635, 1455635],
      [1461941, 1461941],
    ],
    gaps: ['78 runs, ade5589e', '83 runs, ae3c59c7', '119 runs, 77d2b822'],
    columns: 1535,
    score: 1838,
  },
  nineAnchors: {
    joins: [
      [910116, 910116],
      [1146708, 1146708],
      [910116, 910116],
      [1146708, 1146708],
      [1146708, 1146708],
      [1146708, 1146708],
      [1180098, 1180098],
      [1202040, 1202040],
    ],
    gaps: ['94 runs, 62d9c41b', '75 runs, 9e87d4e7', '78 runs, bc16d50a'],
    columns: 1377,
    score: 1902,
  },
  ambiguityInEveryTwelfthColumn: {
    joins: [
      [803640, 803640],
      [814324, 814324],
      [804545, 804545],
      [829392, 829392],
      [814324, 814324],
      [814324, 814324],
      [829392, 829392],
      [831695, 831695],
    ],
    gaps: ['49+15 74+13 143+18', '143+18 782+7 809+4', '49+15 652+18 855+12'],
    columns: 933,
    score: 11456,
  },
  gapsThatPay: {
    joins: [
      [849555, 849555],
      [849459, 849459],
      [847665, 847665],
      [863939, 863939],
      [849459, 849459],
      [849459, 849459],
      [868455, 868455],
      [863939, 863939],
    ],
    gaps: ['38+1 447+1 849+4 854+3 860+8 880+1', '25 runs, 4d4a41e4', '26 runs, 5e4be2f9'],
    columns: 962,
    score: 13432,
  },
  divergentCopies: {
    joins: [
      [864784, 1037051],
      [1037952, 1037952],
      [887537, 1037952],
      [817351, 1037051],
      [1040655, 1040655],
      [894358, 1044259],
      [894358, 1044259],
      [926199, 1044259],
      [874285, 1041556],
      [1084089, 1042965],
      [748743, 1039353],
      [835499, 1038853],
      [888797, 1037952],
      [920925, 1037952],
      [871239, 1037952],
      [1079719, 1039353],
      [748743, 1039353],
      [835499, 1038853],
    ],
    gaps: ['38+1 301+250 843+1', '41+1 301+250 846+1', '38+1 846+1', '38+1 301+250 846+1'],
    columns: 1152,
    score: 17653.5,
  },
  extraAtTheEndOfTheFirst: {
    joins: [
      [100666, 625672],
      [177516, 671238],
      [167287, 665372],
      [173244, 670588],
      [177516, 671238],
      [175119, 671238],
      [168904, 675694],
      [172782, 670588],
    ],
    gaps: ['5+13', '335+7 616+10 810+40', '616+10 696+13 810+40'],
    columns: 850,
    score: 11493,
  },
  extraAtTheEndOfTheLast: {
    joins: [
      [100852, 657662],
      [171959, 676164],
      [102229, 628728],
      [106161, 682051],
      [171959, 676164],
      [172955, 676164],
      [167055, 665482],
      [105039, 682051],
    ],
    gaps: ['705+7 810+40', '581+10 627+19 810+40', '581+10'],
    columns: 850,
    score: 11571,
  },
  extraAtTheStartOfTheFirst: {
    joins: [
      [102375, 648788],
      [104805, 673977],
      [102375, 648788],
      [104805, 673977],
      [104805, 673977],
      [105396, 673977],
      [105327, 683704],
      [166151, 680748],
    ],
    gaps: ['52+11 603+1 735+12', '0+40 603+1', '0+40 52+11 554+3'],
    columns: 852,
    score: 11671,
  },
  extraAtTheStartOfTheLast: {
    joins: [
      [99673, 632688],
      [105930, 677880],
      [104343, 677880],
      [160073, 664048],
      [105930, 677880],
      [105575, 677880],
      [159833, 664048],
      [104360, 678687],
    ],
    gaps: ['0+40 215+6 327+17', '0+40', '137+1 215+6'],
    columns: 846,
    score: 11645,
  },
  halfGappedStart: {
    joins: [
      [103931, 673641],
      [197355, 632432],
      [103931, 673641],
      [197355, 632432],
      [197355, 632432],
      [204047, 632432],
      [198526, 681210],
      [196466, 680850],
    ],
    gaps: ['173+5 812+4', '0+40 173+5 812+4', '0+40 46+17 263+14 544+11 765+16'],
    columns: 849,
    score: 11163,
  },
  halfGappedEnd: {
    joins: [
      [103946, 673641],
      [192718, 703917],
      [103946, 673641],
      [192718, 703917],
      [192718, 703917],
      [189629, 703917],
      [182752, 706440],
      [179901, 704880],
    ],
    gaps: ['67+19 202+19 805+1', '67+19 202+19 805+1 839+40', '761+3 839+40'],
    columns: 879,
    score: 11758,
  },
  openAsCheapAsExtend: {
    joins: [
      [121296, 849555],
      [192223, 847665],
      [194259, 847665],
      [189658, 863040],
      [192223, 847665],
      [198367, 847665],
      [190177, 865620],
      [191063, 863040],
    ],
    gaps: ['847+4 852+3 858+8', '22 runs, 8a3b602d', '23 runs, e077b5c2'],
    columns: 959,
    score: 12916,
  },
  freeGaps: {
    joins: [
      [121296, 849555],
      [195879, 849459],
      [194259, 847665],
      [194165, 863939],
      [195879, 849459],
      [202210, 849459],
      [197407, 868455],
      [195533, 863939],
    ],
    gaps: ['38+1 447+1 849+4 854+3 860+8 880+1', '25 runs, 4d4a41e4', '26 runs, 5e4be2f9'],
    columns: 962,
    score: 13260,
  },
};

/** Instrumented a fixture takes minutes (divergentCopies: 0.9 s plain, over 60 s in a mutation run's dry run). */
const SLOW = process.env['PLASMIDPOP_MUTATION'] === '1' ? 600_000 : 60_000;

describe('the cells and the paths of banded joins, exactly (#372)', () => {
  it.each(Object.keys(FIXTURES))(
    'gives the same cells, gaps and score for %s',
    { timeout: SLOW },
    (name) => {
      const [seqs, options] = (FIXTURES[name] as () => Fixture)();
      expect(shape(seqs, options)).toEqual(PINS[name]);
    },
  );
});

describe('small sets, row by row', () => {
  const cases: [string, string[], MsaOptions, string[]][] = [
    [
      'a base cut from the start and the end',
      ['ACGTACGTTAGCATCG', 'TACGTTAGCATCG', 'ACGTACGTTAGCAT'],
      {},
      ['ACGTACGTTAGCATCG', '---TACGTTAGCATCG', 'ACGTACGTTAGCAT--'],
    ],
    [
      'a base added and one cut inside',
      ['ACGTTGCAAGGCTT', 'ACGTTGCCAAGGCTT', 'ACGTTGCAAGGTT'],
      {},
      ['ACGTTG-CAAGGCTT', 'ACGTTGCCAAGGCTT', 'ACGTTG-CAAGGTT-'],
    ],
    [
      'a repeat in one sequence',
      ['GATTACAGATTACA', 'GATTACA', 'GATTAGGGGACA'],
      {},
      ['GATTACAGATT-----ACA', '-------GATT-----ACA', '-------GATTAGGGGACA'],
    ],
    [
      'residues',
      ['MKVLAAGIVGLLLAQ', 'MKVLAGIVGLLAQ', 'KVLAAGIVALLLAQP'],
      { alphabet: 'protein' },
      ['MKVLAAGIVGLLLAQ-', 'MKVL-AGIVG-LLAQ-', '-KVLAAGIVALLLAQP'],
    ],
    [
      'ambiguity codes',
      ['ACGTNNACGT', 'ACGTACGT', 'ACGTRACGT'],
      {},
      ['ACGTNNACGT', 'ACGT--ACGT', 'ACGT-RACGT'],
    ],
  ];
  it.each(cases)('aligns %s', (_name, seqs, options, rows) => {
    expect(alignMultiple(seqs, options).rows).toEqual(rows);
  });
});

describe('the limits a join is held to', () => {
  const r = random(81);
  const [x, y] = [letters(r, BASES, 30), letters(r, BASES, 40)];

  it('refuses a join of more cells than maxCells, and not one of exactly that many', () => {
    // (30 + 1) x (40 + 1) cells.
    expect(alignMultiple([x, y], { maxCells: 1271 }).rows).toHaveLength(2);
    expect(() => alignMultiple([x, y], { maxCells: 1270 })).toThrow(AlignmentTooLargeError);
  });

  it('tries a band only for a join of more cells than bandAbove', () => {
    const q = random(82);
    const pair = copies(q, BASES, letters(q, BASES, 900), 2, 4);
    const cells = (bandAbove: number): [number, number] => {
      let seen: [number, number] = [0, 0];
      alignMultiple(pair, {
        bandAbove,
        onJoin: (filled, full) => (seen = [filled, full]),
      });
      return seen;
    };
    const [, full] = cells(0);
    expect(cells(full)).toEqual([full, full]);
    const [filled] = cells(full - 1);
    expect(filled).toBeLessThan(full / 2);
  });
});
