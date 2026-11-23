import { SeqDocument, createFeature, rangeSegment, reverseComplement } from '@/core';

import {
  cdsProteinFasta,
  cdsProteinFileName,
  exportableCds,
  geneCds,
  geneProteinFileName,
  rangeProteinFasta,
  rangeProteinFileName,
} from './proteinExport';

// ATG GCC AAA TTT TAA = M A K F *
const GENE = 'ATGGCCAAATTTTAA';

function cds(
  name: string,
  strand: 'forward' | 'reverse',
  segments: readonly [number, number][],
  qualifiers: { name: string; value: string }[] = [],
) {
  return createFeature({
    type: 'CDS',
    name,
    strand,
    segments: segments.map(([s, e]) => rangeSegment(s, e)),
    qualifiers,
  });
}

function docWith(
  sequence: string,
  topology: 'linear' | 'circular',
  ...fs: ReturnType<typeof cds>[]
) {
  return SeqDocument.create({ name: 'my plasmid', sequence, topology, features: fs });
}

describe('cdsProteinFasta', () => {
  it('translates a forward CDS, drops the terminal stop and writes the header', () => {
    const doc = docWith(`CC${GENE}GG`, 'linear', cds('geneA', 'forward', [[2, 17]]));
    expect(cdsProteinFasta(doc, doc.features.all())).toBe(
      '>my_plasmid_geneA my plasmid geneA CDS 3..17, 4 aa\nMAKF\n',
    );
  });

  it('reverse-complements a reverse-strand CDS first', () => {
    const doc = docWith(
      `CC${reverseComplement(GENE)}GG`,
      'linear',
      cds('rv', 'reverse', [[2, 17]]),
    );
    expect(cdsProteinFasta(doc, doc.features.all())).toBe(
      '>my_plasmid_rv my plasmid rv CDS complement(3..17), 4 aa\nMAKF\n',
    );
  });

  it('reads the segments of a join in order', () => {
    // ATGGCC | GG | AAATTTTAA: the two Gs between the exons are skipped.
    const doc = docWith(
      'ATGGCCGGAAATTTTAA',
      'linear',
      cds('j', 'forward', [
        [0, 6],
        [8, 17],
      ]),
    );
    const out = cdsProteinFasta(doc, doc.features.all());
    expect(out).toBe('>my_plasmid_j my plasmid j CDS join(1..6,9..17), 4 aa\nMAKF\n');
  });

  it('reads a CDS across the origin of a circular sequence', () => {
    // The gene starts 9 bases from the end of the sequence and wraps.
    const doc = SeqDocument.create({
      name: 'c',
      sequence: `${GENE.slice(6)}${GENE.slice(0, 6)}`,
      topology: 'circular',
      features: [
        createFeature({
          type: 'CDS',
          name: 'w',
          strand: 'forward',
          segments: [rangeSegment(9, 9 + GENE.length)],
        }),
      ],
    });
    expect(cdsProteinFasta(doc, doc.features.all())).toContain('\nMAKF\n');
    expect(doc.features.all()).toHaveLength(1);
  });

  it('names a non-standard genetic code and reads with it', () => {
    // TGA is Trp under table 4, a stop under table 1.
    const doc = docWith(
      'ATGTGAAAATAA',
      'linear',
      cds('m', 'forward', [[0, 12]], [{ name: 'transl_table', value: '4' }]),
    );
    expect(cdsProteinFasta(doc, doc.features.all())).toBe(
      '>my_plasmid_m my plasmid m CDS 1..12, 3 aa, genetic code 4 (Mold Mitochondrial; Protozoan Mitochondrial; Coelenterate Mitochondrial; Mycoplasma; Spiroplasma)\nMWK\n',
    );
  });

  it('honours /codon_start', () => {
    const doc = docWith(
      `G${GENE}`,
      'linear',
      cds('cs', 'forward', [[0, 16]], [{ name: 'codon_start', value: '2' }]),
    );
    expect(cdsProteinFasta(doc, doc.features.all())).toContain('\nMAKF\n');
  });

  it('keeps same-named features apart', () => {
    const doc = docWith(
      `${GENE}${GENE}`,
      'linear',
      cds('g', 'forward', [[0, 15]]),
      cds('g', 'forward', [[15, 30]]),
    );
    const ids = [...cdsProteinFasta(doc, doc.features.all()).matchAll(/^>(\S+)/gm)].map(
      (m) => m[1],
    );
    expect(ids).toEqual(['my_plasmid_g', 'my_plasmid_g_2']);
  });
});

describe('exportableCds', () => {
  it('is empty without a CDS', () => {
    const doc = SeqDocument.create({ name: 'x', sequence: GENE });
    expect(exportableCds(doc)).toEqual([]);
  });

  it('lists CDS features only, in document order', () => {
    const gene = cds('a', 'forward', [[0, 15]]);
    const other = createFeature({
      type: 'gene',
      name: 'g',
      strand: 'forward',
      segments: [rangeSegment(0, 15)],
    });
    const doc = docWith(GENE, 'linear', other, gene);
    expect(exportableCds(doc).map((f) => f.name)).toEqual(['a']);
  });
});

describe('file names', () => {
  const doc = docWith(GENE, 'linear', cds('my gene', 'forward', [[0, 15]]));
  it('names the whole export and one feature', () => {
    expect(cdsProteinFileName(doc)).toBe('my_plasmid_proteins.faa');
    expect(cdsProteinFileName(doc, doc.features.all()[0] ?? null)).toBe('my_plasmid_my_gene.faa');
  });
});

describe('a gene or mRNA (#452)', () => {
  // ATG GC|gtaagt|C AAA TTT TAA: CDS join(3..7,14..23) inside the gene 1..25.
  const SPLICED = 'CCATGGCGTAAGTCAAATTTTAAGG';
  const gene = createFeature({ type: 'gene', name: 'ACT1', segments: [rangeSegment(0, 25)] });
  const spliced = cds('actin', 'forward', [
    [2, 7],
    [13, 23],
  ]);

  it('gives the protein of the CDS inside, not of the gene span', () => {
    const doc = docWith(SPLICED, 'linear', gene, spliced);
    const found = geneCds(doc, gene);
    expect(found).toEqual([spliced]);
    expect(cdsProteinFasta(doc, found)).toBe(
      '>my_plasmid_actin my plasmid actin CDS join(3..7,14..23), 4 aa\nMAKF\n',
    );
    expect(geneProteinFileName(doc, gene, found.length)).toBe('my_plasmid_ACT1.faa');
  });

  it('writes several isoforms as one file, a record each', () => {
    const unspliced = cds('actin', 'forward', [[2, 11]]);
    const doc = docWith(SPLICED, 'linear', gene, spliced, unspliced);
    const found = geneCds(doc, gene);
    expect(found).toHaveLength(2);
    expect(cdsProteinFasta(doc, found)).toBe(
      '>my_plasmid_actin my plasmid actin CDS join(3..7,14..23), 4 aa\nMAKF\n' +
        '>my_plasmid_actin_2 my plasmid actin CDS 3..11, 2 aa\nMA\n',
    );
    expect(geneProteinFileName(doc, gene, found.length)).toBe('my_plasmid_ACT1_proteins.faa');
  });

  it('leaves out a CDS that translates to nothing, and names an unnamed gene by its type', () => {
    const stop = cds('empty', 'forward', [[8, 11]]); // TAA
    const unnamed = createFeature({ type: 'mRNA', segments: [rangeSegment(0, 25)] });
    const doc = docWith(SPLICED, 'linear', unnamed, stop);
    expect(geneCds(doc, unnamed)).toEqual([]);
    expect(geneProteinFileName(doc, unnamed, 1)).toBe('my_plasmid_mRNA.faa');
  });
});

describe('rangeProteinFasta', () => {
  const doc = docWith(GENE, 'linear');
  it('writes an ORF with its coordinates, strand and code', () => {
    expect(rangeProteinFasta(doc, { start: 0, end: 15 }, 'forward', 'MAKF*', 1, 'ORF')).toBe(
      '>my_plasmid_ORF_1-15 my plasmid ORF 1..15, 4 aa\nMAKF\n',
    );
    expect(rangeProteinFasta(doc, { start: 0, end: 15 }, 'reverse', 'MAKF*', 11, 'ORF')).toContain(
      '>my_plasmid_ORF_1-15_rev my plasmid ORF complement(1..15), 4 aa, genetic code 11',
    );
    expect(rangeProteinFileName(doc, { start: 0, end: 15 }, 'reverse')).toBe(
      'my_plasmid_1-15_rev.faa',
    );
  });
});
