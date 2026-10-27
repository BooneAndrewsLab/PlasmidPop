import { primerBlastUrl } from './primerBlast';

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
