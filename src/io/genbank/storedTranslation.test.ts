import {
  type SeqDocument,
  checkTranslations,
  firstQualifier,
  isCodingFeature,
  translateCds,
} from '@/core';
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

  it('reads the selenocysteine of GPX1 from its /transl_except', () => {
    // NM_000581: human glutathione peroxidase 1, whose UGA at 220..222 is
    // residue 49, Sec. Without the exception the same codon is a stop and
    // the record's own /translation disagrees with us.
    const doc = parseGenBank(readFixture('NM_000581.gb')).documents[0];
    const gpx1 = doc?.features.all().find((f) => isCodingFeature(f));
    if (doc === undefined || gpx1 === undefined) throw new Error('no CDS in NM_000581');
    expect(translateCds(doc, gpx1).protein.charAt(48)).toBe('U');
    expect(checkTranslations(doc)).toEqual([]);
    const without = doc.updateFeature(gpx1.id, {
      qualifiers: gpx1.qualifiers.filter((q) => q.name !== 'transl_except'),
    });
    expect(checkTranslations(without).map((p) => p.kind)).toEqual(['residue']);
  });

  it('has something to compare', () => {
    // Guards the tests above from passing because nothing was checked at
    // all: the committed records state 20 proteins between them.
    const total = files
      .flatMap(({ text }) => parseGenBank(text).documents)
      .reduce((n, doc) => n + stated(doc), 0);
    expect(total).toBeGreaterThanOrEqual(20);
  });
});
