import { type Feature, type Qualifier, createFeature, rangeSegment, siteSegment } from '@/core';

import {
  describeGroupMembers,
  featureForHit,
  groupFeatures,
  groupTip,
  isGroupId,
} from './featureGroups';
import { assignLanes } from './linear/lanes';
import { drawableFeatures } from './visibleFeatures';

const q = (name: string, value: string | null = null): Qualifier => ({ name, value });

const f = (
  id: string,
  type: string,
  segments: readonly [number, number][],
  options: {
    readonly name?: string;
    readonly strand?: 'forward' | 'reverse';
    readonly qualifiers?: readonly Qualifier[];
  } = {},
): Feature =>
  createFeature({
    id,
    type,
    name: options.name ?? '',
    strand: options.strand ?? 'forward',
    segments: segments.map(([s, e]) => rangeSegment(s, e)),
    qualifiers: options.qualifiers ?? [],
  });

/**
 * A record shaped like the INS slice of NG_050578.1 (1,451 bp, 36 features),
 * built here rather than read from NCBI: two genes, five mRNAs (four INS
 * variants and an INS-IGF2 readthrough), two exons, five CDSs (four INS that
 * differ only in /protein_id), and after each INS CDS the same sig_peptide,
 * proprotein and three mat_peptides, plus a fifth sig_peptide on the same
 * bases that names the other gene. Coordinates are 0-based half-open.
 */
export function insShapedRecord(): Feature[] {
  const gene = (g: string): Qualifier => q('gene', g);
  const out: Feature[] = [
    f('src', 'source', [[0, 1451]]),
    f('g-rt', 'gene', [[10, 1451]], { name: 'INS-IGF2', qualifiers: [gene('INS-IGF2')] }),
    f(
      'm-rt',
      'mRNA',
      [
        [10, 52],
        [231, 435],
      ],
      {
        name: 'INS-IGF2 readthrough, transcript variant 2',
        qualifiers: [gene('INS-IGF2'), q('transcript_id', 'NM_001042376.3')],
      },
    ),
    f('g-ins', 'gene', [[10, 1441]], { name: 'INS', qualifiers: [gene('INS')] }),
  ];
  const variants: [string, number, string][] = [
    ['3', 435, 'NM_001185098.2'],
    ['4', 112, 'NM_001291897.2'],
    ['2', 78, 'NM_001185097.2'],
    ['1', 52, 'NM_000207.3'],
  ];
  for (const [n, firstExonEnd, acc] of variants) {
    const exons: [number, number][] =
      firstExonEnd === 435
        ? [
            [10, 435],
            [1222, 1441],
          ]
        : [
            [10, firstExonEnd],
            [231, 435],
            [1222, 1441],
          ];
    out.push(
      f(`m-${n}`, 'mRNA', exons, {
        name: `insulin, transcript variant ${n}`,
        qualifiers: [gene('INS'), q('transcript_id', acc)],
      }),
    );
  }
  out.push(
    f('x1', 'exon', [[10, 52]], { qualifiers: [gene('INS-IGF2')] }),
    f('x2', 'exon', [[231, 435]], { qualifiers: [gene('INS-IGF2')] }),
    f('c-rt', 'CDS', [[248, 435]], {
      name: 'insulin, isoform 2 precursor',
      qualifiers: [gene('INS-IGF2'), q('protein_id', 'NP_001035835.1')],
    }),
    f('s-rt', 'sig_peptide', [[248, 320]], { qualifiers: [gene('INS-IGF2')] }),
  );
  const proteins = ['NP_001172026.1', 'NP_001172027.1', 'NP_000198.1', 'NP_001278826.1'];
  proteins.forEach((pid, i) => {
    const k = String(i + 1);
    out.push(
      f(
        `c-${k}`,
        'CDS',
        [
          [248, 435],
          [1222, 1368],
        ],
        {
          name: 'insulin preproprotein',
          qualifiers: [gene('INS'), q('product', 'insulin preproprotein'), q('protein_id', pid)],
        },
      ),
      f(`s-${k}`, 'sig_peptide', [[248, 320]], { qualifiers: [gene('INS')] }),
      f(
        `p-${k}`,
        'proprotein',
        [
          [320, 435],
          [1222, 1365],
        ],
        { name: 'proinsulin', qualifiers: [gene('INS'), q('product', 'proinsulin')] },
      ),
      f(`b-${k}`, 'mat_peptide', [[320, 410]], {
        name: 'insulin B chain',
        qualifiers: [gene('INS')],
      }),
      f(
        `cp-${k}`,
        'mat_peptide',
        [
          [416, 435],
          [1222, 1296],
        ],
        { name: 'C-peptide', qualifiers: [gene('INS')] },
      ),
      f(`a-${k}`, 'mat_peptide', [[1302, 1365]], {
        name: 'insulin A chain',
        qualifiers: [gene('INS')],
      }),
    );
  });
  return out;
}

export const INS_LENGTH = 1451;

describe('groupFeatures', () => {
  it('leaves a list with nothing alike as it is', () => {
    const list = [f('a', 'CDS', [[0, 10]]), f('b', 'CDS', [[20, 30]]), f('c', 'gene', [[0, 10]])];
    const grouped = groupFeatures(list, 100);
    expect(grouped.features).toEqual(list);
    expect(grouped.groups.size).toBe(0);
    expect(grouped.groupOf.size).toBe(0);
  });

  it('draws exact copies as one bar with a count', () => {
    const list = [
      f('a', 'sig_peptide', [[5, 20]], { qualifiers: [q('gene', 'INS')] }),
      f('x', 'CDS', [[0, 50]]),
      f('b', 'sig_peptide', [[5, 20]], { qualifiers: [q('gene', 'INS')] }),
      f('c', 'sig_peptide', [[5, 20]], { qualifiers: [q('gene', 'INS')] }),
    ];
    const grouped = groupFeatures(list, 100);
    expect(grouped.features.map((x) => x.id)).toEqual([grouped.features[0]?.id ?? '', 'x']);
    const standIn = grouped.features[0];
    expect(standIn?.name).toBe('sig_peptide ×3');
    expect(standIn?.type).toBe('sig_peptide');
    expect(standIn?.segments).toEqual(list[0]?.segments);
    expect(isGroupId(standIn?.id ?? '')).toBe(true);
    const group = grouped.groups.get(standIn?.id ?? '');
    expect(group?.kind).toBe('copies');
    expect(group?.members.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(grouped.groupOf.get('b')).toBe(group);
    expect(grouped.groupOf.has('x')).toBe(false);
  });

  it('groups by type, strand and location, qualifiers ignored', () => {
    const list = [
      f('a', 'CDS', [[0, 30]], { name: 'p', qualifiers: [q('protein_id', 'NP_1')] }),
      f('b', 'CDS', [[0, 30]], { name: 'p', qualifiers: [q('protein_id', 'NP_2')] }),
      // The same bases, another type: its own bar.
      f('c', 'gene', [[0, 30]], { name: 'p' }),
      // The other strand: its own bar.
      f('d', 'CDS', [[0, 30]], { name: 'p', strand: 'reverse' }),
      // One base off: its own bar.
      f('e', 'CDS', [[0, 31]], { name: 'p' }),
      // Several pieces are compared piece by piece.
      f('j1', 'CDS', [
        [40, 50],
        [60, 70],
      ]),
      f('j2', 'CDS', [
        [40, 50],
        [60, 70],
      ]),
      f('j3', 'CDS', [[40, 70]]),
    ];
    const grouped = groupFeatures(list, 100);
    expect(grouped.features.map((x) => x.name)).toEqual(['p ×2', 'p', 'p', 'p', 'CDS ×2', '']);
    expect(grouped.features.map((x) => grouped.groups.get(x.id)?.members.length)).toEqual([
      2,
      undefined,
      undefined,
      undefined,
      2,
      undefined,
    ]);
  });

  it('keeps a partial end and a site apart from a plain range', () => {
    const list = [
      createFeature({
        id: 'a',
        type: 'CDS',
        segments: [rangeSegment(0, 30, { partialEnd: true })],
      }),
      createFeature({ id: 'b', type: 'CDS', segments: [rangeSegment(0, 30)] }),
      createFeature({ id: 's1', type: 'misc', segments: [siteSegment(10)] }),
      createFeature({ id: 's2', type: 'misc', segments: [siteSegment(10)] }),
    ];
    const grouped = groupFeatures(list, 100);
    expect(grouped.features.map((x) => x.id)).toEqual(['a', 'b', grouped.features[2]?.id ?? '']);
    expect(grouped.features[2]?.name).toBe('misc ×2');
  });

  it('does not take a feature id for a group id', () => {
    expect(isGroupId('b2f9c1e0-1234-4abc-8def-0123456789ab')).toBe(false);
  });

  describe('transcripts', () => {
    const mrnas = (): Feature[] => [
      f(
        'm1',
        'mRNA',
        [
          [0, 10],
          [20, 30],
          [50, 60],
        ],
        { name: 'v1', qualifiers: [q('gene', 'G'), q('transcript_id', 'NM_1')] },
      ),
      f(
        'm2',
        'mRNA',
        [
          [0, 12],
          [40, 60],
        ],
        { name: 'v2', qualifiers: [q('gene', 'G'), q('transcript_id', 'NM_2')] },
      ),
      f('m3', 'mRNA', [[70, 90]], { name: 'other', qualifiers: [q('gene', 'H')] }),
    ];

    it('shows the open arrow only once the row is selected or open', () => {
      const name = (selected: string | null, open: ReadonlySet<string> = new Set()) =>
        groupFeatures(mrnas(), 100, open, selected).features[0]?.name;
      expect(name(null)).toBe('G · 2 transcripts');
      expect(name('other')).toBe('G · 2 transcripts');
      expect(name('m1')).toBe('G · 2 transcripts ▸');
      expect(name('m2')).toBe('G · 2 transcripts ▸');
      const id = groupFeatures(mrnas(), 100).features[0]?.id ?? '';
      expect(name(null, new Set([id]))).toBe('G · 2 transcripts ▾');
      expect(name('m1', new Set([id]))).toBe('G · 2 transcripts ▾');
    });

    it('draws a gene with several mRNAs as one row, the union of their exons', () => {
      const grouped = groupFeatures(mrnas(), 100);
      expect(grouped.features.map((x) => x.name)).toEqual(['G · 2 transcripts', 'other']);
      const row = grouped.features[0];
      expect(row?.type).toBe('mRNA');
      expect(row?.segments).toEqual([
        rangeSegment(0, 12),
        rangeSegment(20, 30),
        rangeSegment(40, 60),
      ]);
      const group = grouped.groups.get(row?.id ?? '');
      expect(group?.kind).toBe('transcripts');
      expect(group?.expanded).toBe(false);
      expect(group?.members.map((m) => m.id)).toEqual(['m1', 'm2']);
      // A gene with one transcript is not a group (the INS-IGF2 readthrough).
      expect(grouped.groupOf.has('m3')).toBe(false);
    });

    it('keeps the strands apart and ignores an mRNA with no gene', () => {
      const list = [
        f('a', 'mRNA', [[0, 10]], { qualifiers: [q('gene', 'G')] }),
        f('b', 'mRNA', [[0, 20]], { qualifiers: [q('gene', 'G')], strand: 'reverse' }),
        f('c', 'mRNA', [[0, 30]]),
        f('d', 'mRNA', [[0, 40]], { qualifiers: [q('gene', '  ')] }),
      ];
      const grouped = groupFeatures(list, 100);
      expect(grouped.groups.size).toBe(0);
      expect(grouped.features).toEqual(list);
    });

    it('expands in place: the row stays and a row per transcript follows it', () => {
      const collapsed = groupFeatures(mrnas(), 100);
      const id = collapsed.features[0]?.id ?? '';
      const grouped = groupFeatures(mrnas(), 100, new Set([id]));
      expect(grouped.features.map((x) => x.id)).toEqual([id, 'm1', 'm2', 'm3']);
      expect(grouped.features[0]?.name).toBe('G · 2 transcripts ▾');
      expect(grouped.groups.get(id)?.expanded).toBe(true);
      // The members are still the group's, so the inspector can say so.
      expect(grouped.groupOf.get('m1')?.id).toBe(id);
    });

    it('collapses the copies among expanded transcripts', () => {
      const list = [
        f('m1', 'mRNA', [[0, 10]], { qualifiers: [q('gene', 'G'), q('transcript_id', 'NM_1')] }),
        f('m2', 'mRNA', [[0, 10]], { qualifiers: [q('gene', 'G'), q('transcript_id', 'NM_2')] }),
      ];
      const id = groupFeatures(list, 100).features[0]?.id ?? '';
      const grouped = groupFeatures(list, 100, new Set([id]));
      expect(grouped.features.map((x) => x.name)).toEqual(['G · 2 transcripts ▾', 'mRNA ×2']);
      expect(grouped.groupOf.get('m1')?.kind).toBe('copies');
    });

    it('joins a union through the origin of a circular sequence into one wrapped segment', () => {
      // In forward-coordinate order a wrapped feature lists the wrapping piece first.
      const list = [
        f(
          'm1',
          'mRNA',
          [
            [90, 110],
            [30, 40],
          ],
          { qualifiers: [q('gene', 'G')] },
        ),
        f('m2', 'mRNA', [[95, 105]], { qualifiers: [q('gene', 'G')] }),
      ];
      const grouped = groupFeatures(list, 100);
      expect(grouped.features[0]?.segments).toEqual([rangeSegment(90, 110), rangeSegment(30, 40)]);
      expect(assignLanes(grouped.features, 100).laneCount).toBe(1);
    });

    it('keeps two pieces that merely meet the ends of a linear sequence apart', () => {
      const list = [
        f('m1', 'mRNA', [[0, 10]], { qualifiers: [q('gene', 'G')] }),
        f('m2', 'mRNA', [[90, 100]], { qualifiers: [q('gene', 'G')] }),
      ];
      expect(groupFeatures(list, 100).features[0]?.segments).toEqual([
        rangeSegment(0, 10),
        rangeSegment(90, 100),
      ]);
    });
  });

  it('groups after the hidden types are gone (item 109)', () => {
    const list = [
      f('m1', 'mRNA', [[0, 10]], { qualifiers: [q('gene', 'G')] }),
      f('m2', 'mRNA', [[0, 20]], { qualifiers: [q('gene', 'G')] }),
      f('c1', 'CDS', [[0, 10]]),
      f('c2', 'CDS', [[0, 10]]),
    ];
    const grouped = groupFeatures(drawableFeatures(list, new Set(['mRNA'])), 100);
    expect(grouped.features.map((x) => x.name)).toEqual(['CDS ×2']);
    expect(grouped.groupOf.has('m1')).toBe(false);
  });

  describe('on a record shaped like NG_050578.1 INS', () => {
    const record = insShapedRecord();
    const drawable = drawableFeatures(record);

    it('has the shape measured on the real record', () => {
      expect(record).toHaveLength(36);
      expect(drawable).toHaveLength(35);
      expect(assignLanes(drawable, INS_LENGTH).laneCount).toBe(21);
    });

    it('takes 21 lanes to 9', () => {
      const grouped = groupFeatures(drawable, INS_LENGTH);
      expect(grouped.features.map((x) => x.name)).toEqual([
        'INS-IGF2',
        'INS-IGF2 readthrough, transcript variant 2',
        'INS',
        'INS · 4 transcripts',
        '',
        '',
        'insulin, isoform 2 precursor',
        'sig_peptide ×5',
        'insulin preproprotein ×4',
        'proinsulin ×4',
        'insulin B chain ×4',
        'C-peptide ×4',
        'insulin A chain ×4',
      ]);
      expect(assignLanes(grouped.features, INS_LENGTH).laneCount).toBe(9);
    });

    it('expanding the INS transcripts adds a lane per transcript', () => {
      const id = groupFeatures(drawable, INS_LENGTH).features[3]?.id ?? '';
      const grouped = groupFeatures(drawable, INS_LENGTH, new Set([id]));
      expect(grouped.features).toHaveLength(17);
      expect(assignLanes(grouped.features, INS_LENGTH).laneCount).toBe(13);
    });

    it('hiding mRNA and exon first leaves the copies to group', () => {
      const hidden = drawableFeatures(record, new Set(['mRNA', 'exon']));
      const grouped = groupFeatures(hidden, INS_LENGTH);
      expect(grouped.features).toHaveLength(9);
      expect(assignLanes(grouped.features, INS_LENGTH).laneCount).toBe(6);
    });
  });
});

describe('featureForHit', () => {
  const list = [
    f('a', 'CDS', [[0, 30]], { qualifiers: [q('protein_id', 'NP_1')] }),
    f('b', 'CDS', [[0, 30]], { qualifiers: [q('protein_id', 'NP_2')] }),
    f('c', 'gene', [[0, 30]]),
  ];
  const grouped = groupFeatures(list, 100);
  const lookup = (id: string): Feature | undefined => list.find((x) => x.id === id);

  it('gives a feature back as itself and a group as its first member', () => {
    expect(featureForHit(grouped, 'c', lookup)?.id).toBe('c');
    expect(featureForHit(grouped, grouped.features[0]?.id ?? '', lookup)?.id).toBe('a');
    expect(featureForHit(grouped, 'nothing', lookup)).toBeUndefined();
  });
});

describe('describeGroupMembers and groupTip', () => {
  it('names each copy by the qualifiers that tell it from the others', () => {
    const list = [
      f('a', 'CDS', [[0, 30]], {
        name: 'p',
        qualifiers: [q('gene', 'INS'), q('protein_id', 'NP_1'), q('pseudo')],
      }),
      f('b', 'CDS', [[0, 30]], {
        name: 'p',
        qualifiers: [q('gene', 'INS'), q('protein_id', 'NP_2'), q('pseudo')],
      }),
      f('c', 'CDS', [[0, 30]], { name: 'p', qualifiers: [q('gene', 'INS'), q('pseudo')] }),
    ];
    const grouped = groupFeatures(list, 100);
    const group = grouped.groups.get(grouped.features[0]?.id ?? '');
    if (group === undefined) throw new Error('no group');
    expect(describeGroupMembers(group, 100, 'linear')).toEqual([
      'p: /protein_id=NP_1',
      'p: /protein_id=NP_2',
      'p: identical',
    ]);
    expect(groupTip(group, 100, 'linear')).toBe(
      '3 features drawn as one bar\np: /protein_id=NP_1\np: /protein_id=NP_2\np: identical',
    );
  });

  it('says identical for exact copies', () => {
    const list = [f('a', 'sig_peptide', [[5, 20]]), f('b', 'sig_peptide', [[5, 20]])];
    const grouped = groupFeatures(list, 100);
    const group = grouped.groups.get(grouped.features[0]?.id ?? '');
    if (group === undefined) throw new Error('no group');
    expect(describeGroupMembers(group, 100, 'linear')).toEqual([
      'sig_peptide: identical',
      'sig_peptide: identical',
    ]);
  });

  it('names each transcript with its accession and location', () => {
    const list = [
      f(
        'm1',
        'mRNA',
        [
          [0, 10],
          [20, 30],
        ],
        { name: 'v1', qualifiers: [q('gene', 'G'), q('transcript_id', 'NM_1')] },
      ),
      f('m2', 'mRNA', [[0, 30]], { name: 'v2', qualifiers: [q('gene', 'G')] }),
    ];
    const grouped = groupFeatures(list, 100);
    const group = grouped.groups.get(grouped.features[0]?.id ?? '');
    if (group === undefined) throw new Error('no group');
    expect(describeGroupMembers(group, 100, 'linear')).toEqual([
      'v1 (NM_1): join(1..10,21..30)',
      'v2: 1..30',
    ]);
    expect(groupTip(group, 100, 'linear').split('\n')[0]).toBe(
      '2 transcripts drawn as one row (click to select, again to expand)',
    );
    const expanded = groupFeatures(list, 100, new Set([group.id]));
    const open = expanded.groups.get(group.id);
    if (open === undefined) throw new Error('no group');
    expect(groupTip(open, 100, 'linear').split('\n')[0]).toBe(
      '2 transcripts drawn as one row (click to collapse)',
    );
  });
});
