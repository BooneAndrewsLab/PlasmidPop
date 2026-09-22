import { type SeqDocument, checkTranslations, firstQualifier, isCodingFeature } from '@/core';
import { listFixtures, listLocalFixtures, readFixture } from '@/test/fixtures';

import { parseGenBank } from './parseGenBank';

/** Coding features whose record states the protein it expects. */
function stated(doc: SeqDocument): number {
  return doc.features
    .all()
    .filter((f) => isCodingFeature(f) && firstQualifier(f, 'translation') !== undefined).length;
}

/**
 * The records themselves are the oracle for how we translate: their authors
 * translated the same bases and wrote the answer down in `/translation`, so
 * a disagreement is a bug in the genetic code we chose, in `/codon_start`,
 * in how a `join(...)` is spliced, in the reverse strand, or in a CDS that
 * wraps the origin — which is most of what there is to get wrong.
 */
describe('stored /translation qualifiers', () => {
  const files = [
    ...listFixtures().map((name) => ({ name, text: readFixture(name) })),
    ...listLocalFixtures(),
  ];

  for (const { name, text } of files) {
    it(`agrees with the sequence in ${name}`, () => {
      for (const doc of parseGenBank(text).documents) {
        expect(checkTranslations(doc)).toEqual([]);
      }
    });
  }

  it('has something to compare', () => {
    // Guards the tests above from passing because nothing was checked at
    // all: the committed records state 19 proteins between them.
    const total = files
      .flatMap(({ text }) => parseGenBank(text).documents)
      .reduce((n, doc) => n + stated(doc), 0);
    expect(total).toBeGreaterThanOrEqual(19);
  });
});
