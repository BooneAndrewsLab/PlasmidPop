import { SeqDocument, createFeature, rangeSegment } from '@/core';

import { translationProblems } from './translationProblems';

describe('translationProblems', () => {
  // A CDS whose /translation is wrong from the start, and one that is right.
  const doc = SeqDocument.create({
    sequence: 'CCCATGGCCATTGTAATGGGCCGCTGACCCATGAAATAACCC',
    features: [
      createFeature({
        id: 'wrong',
        type: 'CDS',
        segments: [rangeSegment(3, 27)],
        qualifiers: [{ name: 'translation', value: 'MKIVMGR' }],
      }),
      createFeature({
        id: 'right',
        type: 'CDS',
        segments: [rangeSegment(30, 39)],
        qualifiers: [{ name: 'translation', value: 'MK' }],
      }),
    ],
  });

  it('reports the coding features whose claims the bases do not bear out', () => {
    const problems = translationProblems(doc);
    expect([...problems.keys()]).toEqual(['wrong']);
    expect(problems.get('wrong')?.[0]).toMatchObject({ kind: 'residue', position: 2 });
  });

  it('keeps the check of a feature an edit did not reach, and redoes the one it did', () => {
    const before = translationProblems(doc).get('wrong');
    // Upstream of both: the features move, their bases do not change.
    const moved = doc.apply({ type: 'insert', position: 0, text: 'GG' });
    expect(translationProblems(moved).get('wrong')).toEqual(before);
    // Inside the good one: AAA → CAA makes K a Q.
    const edited = doc.apply({ type: 'replace', range: { start: 33, end: 34 }, text: 'C' });
    expect([...translationProblems(edited).keys()]).toEqual(['wrong', 'right']);
    // The untouched feature is the same object, so its check is not redone.
    const again = doc.apply({ type: 'rename', name: 'x' });
    expect(translationProblems(again).get('wrong')).toBe(before);
  });
});
