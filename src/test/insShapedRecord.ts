import { type Feature, type Qualifier, createFeature, rangeSegment } from '@/core';

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
 * bases that names the other gene. Coordinates are 0-based half-open. The
 * grouping (item 115) and the transcript pick (item 119) are tested on it.
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
