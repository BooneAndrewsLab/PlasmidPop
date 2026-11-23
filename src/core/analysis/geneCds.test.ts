import { SeqDocument } from '../document';
import { type Feature, type Strand, createFeature, rangeSegment } from '../features';
import { translateCds } from './cdsTranslation';
import { codingFeaturesOf, isGeneLikeFeature } from './geneCds';

type Quals = Readonly<Record<string, string>>;

function feature(
  type: string,
  segments: readonly (readonly [number, number])[],
  opts: { strand?: Strand; quals?: Quals; name?: string } = {},
): Feature {
  return createFeature({
    type,
    name: opts.name ?? '',
    strand: opts.strand ?? 'forward',
    segments: segments.map(([s, e]) => rangeSegment(s, e)),
    qualifiers: Object.entries(opts.quals ?? {}).map(([name, value]) => ({ name, value })),
  });
}

function docOf(
  length: number,
  topology: 'linear' | 'circular',
  features: readonly Feature[],
): SeqDocument {
  return SeqDocument.create({ name: 'd', sequence: 'A'.repeat(length), topology, features });
}

function names(doc: SeqDocument, f: Feature): string[] {
  return codingFeaturesOf(doc, f).map((c) => c.name);
}

describe('isGeneLikeFeature', () => {
  it('is true for gene and mRNA only', () => {
    expect(isGeneLikeFeature(feature('gene', [[0, 9]]))).toBe(true);
    expect(isGeneLikeFeature(feature('mRNA', [[0, 9]]))).toBe(true);
    expect(isGeneLikeFeature(feature('CDS', [[0, 9]]))).toBe(false);
    expect(isGeneLikeFeature(feature('exon', [[0, 9]]))).toBe(false);
  });
});

describe('codingFeaturesOf', () => {
  it('resolves a gene with an intron to its spliced CDS, never its own span', () => {
    // ATG GC|gtaagt|C AAA TAA: the CDS is join(1..5,12..18), the gene 1..18.
    const sequence = 'ATGGCGTAAGTCAAATAA';
    const gene = feature('gene', [[0, 18]], { name: 'ACT1' });
    const cds = feature(
      'CDS',
      [
        [0, 5],
        [11, 18],
      ],
      { name: 'actin' },
    );
    const doc = SeqDocument.create({ name: 'd', sequence, features: [gene, cds] });
    const found = codingFeaturesOf(doc, gene);
    expect(found).toEqual([cds]);
    const first = found[0];
    expect(first === undefined ? '' : translateCds(doc, first).protein).toBe('MAK*');
    // Read straight through, the gene would give M A * (the intron's TAA).
  });

  it('takes only a CDS on the same strand', () => {
    const gene = feature('gene', [[10, 70]], { strand: 'reverse' });
    const same = feature('CDS', [[20, 50]], { strand: 'reverse', name: 'same' });
    const opposite = feature('CDS', [[20, 50]], { name: 'opposite' });
    const doc = docOf(100, 'linear', [gene, same, opposite]);
    expect(names(doc, gene)).toEqual(['same']);
  });

  it('resolves a reverse-strand gene to its reverse-strand spliced CDS', () => {
    const gene = feature('gene', [[10, 70]], { strand: 'reverse' });
    const cds = feature(
      'CDS',
      [
        [15, 30],
        [45, 66],
      ],
      { strand: 'reverse', name: 'rev' },
    );
    const doc = docOf(100, 'linear', [gene, cds]);
    expect(names(doc, gene)).toEqual(['rev']);
  });

  it('leaves out a CDS that only overlaps the span or lies outside it', () => {
    const gene = feature('gene', [[10, 70]]);
    const doc = docOf(100, 'linear', [
      gene,
      feature('CDS', [[4, 40]], { name: 'starts before' }),
      feature('CDS', [[40, 73]], { name: 'ends after' }),
      feature('CDS', [[80, 95]], { name: 'outside' }),
      feature('CDS', [[10, 70]], { name: 'exact' }),
      feature(
        'CDS',
        [
          [12, 20],
          [60, 75],
        ],
        { name: 'last exon runs out' },
      ),
    ]);
    expect(names(doc, gene)).toEqual(['exact']);
  });

  it('follows a gene over the origin of a circular sequence', () => {
    // The gene is 91..20 on a 100 bp circle, written as one wrapping range.
    const gene = feature('gene', [[90, 120]]);
    const doc = docOf(100, 'circular', [
      gene,
      feature('CDS', [[93, 117]], { name: 'wrapping range' }),
      feature(
        'CDS',
        [
          [93, 100],
          [0, 17],
        ],
        { name: 'split at the origin' },
      ),
      feature('CDS', [[3, 15]], { name: 'after the origin' }),
      feature('CDS', [[92, 98]], { name: 'before the origin' }),
      feature('CDS', [[80, 99]], { name: 'starts before the gene' }),
      feature('CDS', [[5, 29]], { name: 'ends after the gene' }),
      feature('CDS', [[40, 60]], { name: 'elsewhere' }),
    ]);
    expect(names(doc, gene)).toEqual([
      'wrapping range',
      'split at the origin',
      'after the origin',
      'before the origin',
    ]);
  });

  it('follows a gene written as a join over the origin', () => {
    const gene = feature('gene', [
      [90, 100],
      [0, 20],
    ]);
    const doc = docOf(100, 'circular', [
      gene,
      feature('CDS', [[93, 117]], { name: 'inside' }),
      feature('CDS', [[40, 60]], { name: 'elsewhere' }),
    ]);
    expect(names(doc, gene)).toEqual(['inside']);
  });

  it('does not go round the origin of a linear sequence', () => {
    const gene = feature('gene', [[50, 90]]);
    const doc = docOf(100, 'linear', [gene, feature('CDS', [[10, 40]], { name: 'upstream' })]);
    expect(names(doc, gene)).toEqual([]);
  });

  it('prefers a CDS naming the same /gene over others in the span', () => {
    const gene = feature('gene', [[0, 90]], { quals: { gene: 'ACT1' } });
    const doc = docOf(100, 'linear', [
      gene,
      feature('CDS', [[3, 60]], { name: 'mine', quals: { gene: 'ACT1' } }),
      feature('CDS', [[30, 45]], { name: 'unnamed' }),
      feature('CDS', [[66, 87]], { name: 'nested', quals: { gene: 'OTHER' } }),
    ]);
    expect(names(doc, gene)).toEqual(['mine']);
  });

  it('prefers /locus_tag, which decides before /gene does', () => {
    const gene = feature('gene', [[0, 90]], { quals: { gene: 'ACT1', locus_tag: 'YFL039C' } });
    const doc = docOf(100, 'linear', [
      gene,
      feature('CDS', [[3, 60]], { name: 'tagged', quals: { locus_tag: 'YFL039C' } }),
      feature('CDS', [[6, 60]], {
        name: 'same name, other tag',
        quals: { gene: 'ACT1', locus_tag: 'YFL040W' },
      }),
      feature('CDS', [[9, 60]], { name: 'by name', quals: { gene: 'ACT1' } }),
    ]);
    expect(names(doc, gene)).toEqual(['tagged', 'by name']);
  });

  it('falls back to the span when nothing is named, but never to a CDS of another gene', () => {
    const gene = feature('gene', [[0, 90]], { quals: { gene: 'ACT1' } });
    const doc = docOf(100, 'linear', [
      gene,
      feature('CDS', [[3, 60]], { name: 'unnamed' }),
      feature('CDS', [[66, 87]], { name: 'nested', quals: { gene: 'OTHER' } }),
    ]);
    expect(names(doc, gene)).toEqual(['unnamed']);

    const bare = feature('gene', [[0, 90]]);
    const doc2 = docOf(100, 'linear', [
      bare,
      feature('CDS', [[3, 60]], { name: 'a', quals: { gene: 'X' } }),
      feature('CDS', [[66, 87]], { name: 'b' }),
    ]);
    expect(names(doc2, bare)).toEqual(['a', 'b']);
  });

  it('returns every isoform of a gene, in document order', () => {
    const gene = feature('gene', [[0, 90]], { quals: { gene: 'G' } });
    const doc = docOf(100, 'linear', [
      feature(
        'CDS',
        [
          [3, 20],
          [40, 80],
        ],
        { name: 'isoform 1', quals: { gene: 'G' } },
      ),
      gene,
      feature(
        'CDS',
        [
          [3, 20],
          [30, 35],
          [40, 80],
        ],
        { name: 'isoform 2', quals: { gene: 'G' } },
      ),
    ]);
    expect(names(doc, gene)).toEqual(['isoform 1', 'isoform 2']);
  });

  it('resolves an mRNA to the CDS spliced as it is', () => {
    const long = feature('mRNA', [
      [0, 20],
      [30, 35],
      [40, 90],
    ]);
    const short = feature('mRNA', [
      [0, 20],
      [40, 90],
    ]);
    const doc = docOf(100, 'linear', [
      long,
      short,
      feature(
        'CDS',
        [
          [3, 20],
          [40, 80],
        ],
        { name: 'short' },
      ),
      feature(
        'CDS',
        [
          [3, 20],
          [30, 35],
          [40, 80],
        ],
        { name: 'long' },
      ),
    ]);
    expect(names(doc, long)).toEqual(['long']);
    expect(names(doc, short)).toEqual(['short']);
  });

  it('resolves an mRNA whose CDS lies in one exon, and one over the origin', () => {
    const mrna = feature('mRNA', [
      [80, 100],
      [0, 10],
      [30, 60],
    ]);
    const doc = docOf(100, 'circular', [
      mrna,
      feature('CDS', [[90, 108]], { name: 'one exon' }),
      feature(
        'CDS',
        [
          [95, 110],
          [30, 45],
        ],
        { name: 'spliced' },
      ),
    ]);
    expect(names(doc, mrna)).toEqual(['one exon', 'spliced']);
  });

  it('leaves an mRNA the CDS inside its exons, not one running into its intron', () => {
    const mrna = feature('mRNA', [
      [0, 20],
      [40, 90],
    ]);
    const doc = docOf(100, 'linear', [
      mrna,
      feature('CDS', [[3, 30]], { name: 'into the intron' }),
      feature('CDS', [[3, 18]], { name: 'first exon' }),
    ]);
    expect(names(doc, mrna)).toEqual(['first exon']);
  });

  it('falls back to every CDS in an mRNA when none is spliced as it is', () => {
    const mrna = feature('mRNA', [
      [0, 20],
      [40, 90],
    ]);
    const doc = docOf(100, 'linear', [mrna, feature('CDS', [[3, 80]], { name: 'unspliced' })]);
    expect(names(doc, mrna)).toEqual(['unspliced']);
  });

  it('is empty with no CDS inside, for other feature types and for a protein', () => {
    const gene = feature('gene', [[0, 90]]);
    const exon = feature('exon', [[0, 90]]);
    const cds = feature('CDS', [[3, 60]]);
    expect(codingFeaturesOf(docOf(100, 'linear', [gene]), gene)).toEqual([]);
    const doc = docOf(100, 'linear', [gene, exon, cds]);
    expect(codingFeaturesOf(doc, exon)).toEqual([]);
    expect(codingFeaturesOf(doc, cds)).toEqual([]);
    const sites = createFeature({ type: 'gene', segments: [{ kind: 'site', position: 4 }] });
    expect(codingFeaturesOf(docOf(100, 'linear', [sites, cds]), sites)).toEqual([]);
    const protein = SeqDocument.create({
      name: 'p',
      sequence: 'MAKF',
      alphabet: 'protein',
      features: [feature('gene', [[0, 4]]), feature('CDS', [[0, 4]])],
    });
    const first = protein.features.all()[0];
    expect(first === undefined ? null : codingFeaturesOf(protein, first)).toEqual([]);
  });
});
