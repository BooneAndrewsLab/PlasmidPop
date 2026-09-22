import { SeqDocument, createFeature, rangeSegment } from '@/core';

import { translationWarnings } from './translationWarnings';

//               0         1         2
//               012345678901234567890123456789
const SEQUENCE = 'ATGAAAGGGTGACCCAAATTTCCCGGGTTT';

function docWith(qualifiers: { name: string; value: string }[][]): SeqDocument {
  return SeqDocument.create({
    sequence: SEQUENCE,
    topology: 'linear',
    features: qualifiers.map((q, i) =>
      createFeature({
        id: `cds${i}`,
        type: 'CDS',
        name: i === 0 ? 'orf' : '',
        segments: [rangeSegment(0, 12)],
        qualifiers: q,
      }),
    ),
  });
}

describe('translationWarnings', () => {
  it('says nothing about a file that agrees with itself', () => {
    expect(translationWarnings(docWith([[{ name: 'translation', value: 'MKG' }]]))).toEqual([]);
  });

  it('names the feature, where it is, and what disagrees', () => {
    const [warning] = translationWarnings(docWith([[{ name: 'translation', value: 'MQG' }]]));
    expect(warning?.message).toBe(
      "CDS orf at 1..12 — the file's /translation differs from the sequence at residue 2: the file says Q, the sequence gives K.",
    );
  });

  it('falls back to the type when the feature has no name', () => {
    // The first feature is the named one, the second is not; after the
    // naming fix of item 23 most features on a real record are unnamed.
    const warnings = translationWarnings(docWith([[], [{ name: 'transl_table', value: '7' }]]));
    expect(warnings.map((w) => w.message)).toEqual([
      'CDS at 1..12 — /transl_table=7 is not a genetic code NCBI uses, so the standard code was used.',
    ]);
  });

  it('counts the rest rather than listing every feature of a file that is wrong throughout', () => {
    const many = docWith(Array.from({ length: 12 }, () => [{ name: 'translation', value: 'MQG' }]));
    const warnings = translationWarnings(many);
    expect(warnings).toHaveLength(9);
    expect(warnings[8]?.message).toBe(
      '4 more coding features disagree with the sequence in the same way.',
    );
  });
});
