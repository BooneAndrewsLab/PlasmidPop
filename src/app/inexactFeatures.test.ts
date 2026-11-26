import { parseGenBank } from '@/io';

import { inexactFeatures, inexactSaveMessage } from './inexactFeatures';

function gb(features: string): string {
  return [
    'LOCUS       T          60 bp    DNA     linear   SYN 01-JAN-2000',
    'FEATURES             Location/Qualifiers',
    features,
    'ORIGIN',
    '        1 acgtacgtac gtacgtacgt acgtacgtac gtacgtacgt acgtacgtac gtacgtacgt',
    '//',
    '',
  ].join('\n');
}

const TRANS = `     CDS             join(complement(5..10),20..30)
                     /gene="rps12"`;
const REMOTE = `     gene            join(1..10,AF032048.1:67..345)
                     /gene="remoteGene"`;

describe('inexactFeatures', () => {
  it('names a trans-spliced feature', () => {
    const items = inexactFeatures(parseGenBank(gb(TRANS)).warnings);
    expect(items).toEqual([{ kind: 'mixed-strand', featureType: 'CDS', name: 'rps12', count: 1 }]);
  });

  it('names a feature skipped for its remote location', () => {
    const items = inexactFeatures(parseGenBank(gb(REMOTE)).warnings);
    expect(items).toEqual([
      { kind: 'skipped-location', featureType: 'gene', name: 'remoteGene', count: 1 },
    ]);
  });

  it('finds nothing in an ordinary file', () => {
    const plain = '     gene            1..10\n                     /gene="a"';
    expect(inexactFeatures(parseGenBank(gb(plain)).warnings)).toEqual([]);
    expect(inexactSaveMessage([])).toBeNull();
  });

  it('counts the skipped features past the ones listed', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      [
        `     gene            join(1..10,AF032048.1:${i + 1}..9)`,
        `                     /gene="g${i}"`,
      ].join('\n'),
    ).join('\n');
    const items = inexactFeatures(parseGenBank(gb(many)).warnings);
    const message = inexactSaveMessage(items) ?? '';
    expect(items.reduce((n, f) => n + f.count, 0)).toBe(8);
    expect(message).toContain('8 features');
    expect(message).toContain('gene g0');
    expect(message).not.toContain('gene g5');
    expect(message).toContain('and 3 more');
  });
});
