import { SeqDocument } from '@/core';
import { createFeature } from '@/core/features/feature';
import { rangeSegment } from '@/core/features/segment';

import { accessionStrand, primerBlastSource, primerBlastUrl, transcriptAt } from './primerBlast';

describe('primerBlastUrl (#298, stage a)', () => {
  it('puts the two primers in the form fields and nothing else', () => {
    const url = new URL(
      primerBlastUrl({ forward: 'CAGCTTGTCTGTAAGCGGAT', reverse: 'CACTTTATGCTTCCGGCTCG' }),
    );
    expect(url.origin + url.pathname).toBe(
      'https://www.ncbi.nlm.nih.gov/tools/primer-blast/index.cgi',
    );
    expect([...url.searchParams.keys()]).toEqual(['PRIMER_LEFT_INPUT', 'PRIMER_RIGHT_INPUT']);
    expect(url.searchParams.get('PRIMER_LEFT_INPUT')).toBe('CAGCTTGTCTGTAAGCGGAT');
    expect(url.searchParams.get('PRIMER_RIGHT_INPUT')).toBe('CACTTTATGCTTCCGGCTCG');
  });

  it('cleans the oligos the way the form does, and leaves an empty one out', () => {
    const url = new URL(primerBlastUrl({ forward: "5'-acg tt-3'", reverse: '' }));
    expect(url.searchParams.get('PRIMER_LEFT_INPUT')).toBe('ACGTT');
    expect(url.searchParams.has('PRIMER_RIGHT_INPUT')).toBe(false);
  });

  it('names the database and the organism only when asked to', () => {
    const url = new URL(
      primerBlastUrl({
        forward: 'ACGTACGTAC',
        reverse: 'GTACGTACGT',
        organism: ' Escherichia coli (taxid:562) ',
        database: 'refseq_representative_genomes',
      }),
    );
    expect(url.searchParams.get('PRIMER_SPECIFICITY_DATABASE')).toBe(
      'refseq_representative_genomes',
    );
    expect(url.searchParams.get('ORGANISM')).toBe('Escherichia coli (taxid:562)');
    const bare = new URL(primerBlastUrl({ forward: 'ACGT', reverse: 'ACGT', organism: '  ' }));
    expect(bare.searchParams.has('ORGANISM')).toBe(false);
  });
});

describe('primerBlastSource', () => {
  it('names an NCBI accession, the organism with its taxid, and a genome database', () => {
    expect(
      primerBlastSource({
        accession: 'NC_001136',
        version: 'NC_001136.10',
        organism: 'Saccharomyces cerevisiae S288C',
      }),
    ).toEqual({
      template: 'NC_001136.10',
      organism: 'Saccharomyces cerevisiae (taxid:4932)',
      database: 'refseq_representative_genomes',
    });
  });

  it('reads the id off a region record, whose ACCESSION line carries the region', () => {
    expect(
      primerBlastSource({
        accession: 'NC_001142 REGION: complement(100..900)',
        version: 'NC_001142.9',
        organism: 'Saccharomyces cerevisiae S288C',
      }).template,
    ).toBe('NC_001142.9');
    expect(primerBlastSource({ accession: 'NC_001142 REGION: 1..9', organism: '' }).template).toBe(
      'NC_001142',
    );
  });

  it('never sends a name that is not an NCBI accession', () => {
    const got = primerBlastSource({ accession: 'my_plasmid_3', organism: '' });
    expect(got).toEqual({});
  });

  it('sets the product range so a long product is not excluded', () => {
    const url = new URL(primerBlastUrl({ forward: 'ACGT', reverse: 'ACGT', productLength: 2500 }));
    expect(url.searchParams.get('PRIMER_PRODUCT_MIN')).toBe('70');
    expect(url.searchParams.get('PRIMER_PRODUCT_MAX')).toBe('2500');
  });
});

describe('transcriptAt', () => {
  const mrna = (id: string, strand: 'forward' | 'reverse', ...exons: [number, number][]) =>
    createFeature({
      type: 'mRNA',
      strand,
      segments: exons.map(([a, b]) => rangeSegment(a, b)),
      qualifiers: [{ name: 'transcript_id', value: id }],
    });
  const doc = SeqDocument.create({
    sequence: 'A'.repeat(1000),
    features: [
      mrna('NM_000001.1', 'forward', [100, 200], [400, 600]),
      mrna('NM_000002.2', 'reverse', [50, 200], [400, 900]),
      createFeature({ type: 'mRNA', segments: [rangeSegment(0, 1000)] }),
    ],
  });

  it('takes the isoform whose exons hold both sites, with its strand', () => {
    expect(
      transcriptAt(doc, [
        { start: 110, end: 130 },
        { start: 450, end: 470 },
      ])?.accession,
    ).toBe('NM_000001.1');
    expect(
      transcriptAt(doc, [
        { start: 60, end: 80 },
        { start: 450, end: 470 },
      ]),
    ).toEqual({
      accession: 'NM_000002.2',
      strand: 'reverse',
    });
  });

  it('is null when a site lies in an intron or outside every transcript, or the id is no accession', () => {
    expect(
      transcriptAt(doc, [
        { start: 110, end: 130 },
        { start: 250, end: 270 },
      ]),
    ).toBeNull();
    expect(transcriptAt(doc, [{ start: 950, end: 970 }])).toBeNull();
  });
});

describe('accessionStrand', () => {
  it('reads the region off the ACCESSION line', () => {
    expect(accessionStrand('NC_001134 REGION: complement(212631..216365)')).toBe('reverse');
    expect(accessionStrand('NC_000017 REGION: 100..200')).toBe('forward');
    expect(accessionStrand('NC_001134')).toBe('forward');
  });
});
