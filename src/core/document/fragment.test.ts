import { createFeature, rangeSegment, siteSegment } from '../features';
import { fragmentFromRange, fragmentToJSON, parseFragmentJSON } from './fragment';
import { SeqDocument } from './seqDocument';

const SEQ = 'ACGTTGCAAGGCTTAACCGG'; // 20 bp

const doc = SeqDocument.create({
  name: 'pX',
  sequence: SEQ,
  topology: 'circular',
  features: [
    createFeature({ id: 'in', type: 'gene', name: 'inside', segments: [rangeSegment(6, 9)] }),
    createFeature({
      id: 'span',
      type: 'CDS',
      name: 'spanning',
      strand: 'reverse',
      segments: [rangeSegment(2, 14)],
      qualifiers: [
        { name: 'note', value: 'x' },
        { name: 'pseudo', value: null },
      ],
    }),
    createFeature({ id: 'site', type: 'misc', segments: [siteSegment(7)] }),
    createFeature({ id: 'wrap', type: 'misc', name: 'wrapped', segments: [rangeSegment(17, 23)] }),
    createFeature({ id: 'src', type: 'source', segments: [rangeSegment(0, 20)] }),
  ],
});

describe('fragmentFromRange', () => {
  it('carries the bases and the trimmed features in fragment coordinates', () => {
    const frag = fragmentFromRange(doc, { start: 5, end: 12 });
    expect(frag.sequence).toBe(SEQ.slice(5, 12));
    expect(frag.features.map((f) => f.name)).toEqual(['inside', 'spanning', '']);
    expect(frag.features[0]?.segments).toEqual([rangeSegment(1, 4)]);
    expect(frag.features[1]?.segments).toEqual([
      rangeSegment(0, 7, { partialStart: true, partialEnd: true }),
    ]);
    expect(frag.features[2]?.segments).toEqual([siteSegment(2)]);
  });

  it('leaves whole-record source features behind', () => {
    const frag = fragmentFromRange(doc, { start: 0, end: 20 });
    expect(frag.features.some((f) => f.type === 'source')).toBe(false);
    expect(frag.features).toHaveLength(4);
  });

  it('follows the sequence around the origin', () => {
    const frag = fragmentFromRange(doc, { start: 16, end: 24 });
    expect(frag.sequence).toBe(SEQ.slice(16) + SEQ.slice(0, 4));
    expect(frag.features.find((f) => f.name === 'wrapped')?.segments).toEqual([rangeSegment(1, 7)]);
  });
});

describe('fragment JSON', () => {
  it('round-trips features, qualifiers and partial markers', () => {
    const frag = fragmentFromRange(doc, { start: 5, end: 12 });
    const back = parseFragmentJSON(fragmentToJSON(frag));
    expect(back).toEqual(frag);
    expect(back?.features[1]?.qualifiers).toEqual([
      { name: 'note', value: 'x' },
      { name: 'pseudo', value: null },
    ]);
  });

  it('accepts a fragment without features', () => {
    expect(parseFragmentJSON(fragmentToJSON({ sequence: 'ACGT', features: [] }))).toEqual({
      sequence: 'ACGT',
      features: [],
    });
  });

  it('rejects anything that is not one of our fragments', () => {
    expect(parseFragmentJSON('ACGT')).toBeNull();
    expect(parseFragmentJSON('{"sequence":"ACGT"}')).toBeNull();
    expect(parseFragmentJSON('[]')).toBeNull();
    const base = { format: 'plasmidpop-fragment', version: 1, sequence: 'ACGTACGT' };
    const feature = createFeature({ id: 'f', type: 'gene', segments: [rangeSegment(1, 4)] });
    const withFeatures = (features: unknown): string => JSON.stringify({ ...base, features });
    expect(parseFragmentJSON(withFeatures([feature]))).not.toBeNull();
    // bases outside IUPAC
    expect(parseFragmentJSON(JSON.stringify({ ...base, sequence: 'HELLO', features: [] }))).toBe(
      null,
    );
    // segments outside the fragment
    expect(
      parseFragmentJSON(withFeatures([{ ...feature, segments: [rangeSegment(4, 9)] }])),
    ).toBeNull();
    expect(parseFragmentJSON(withFeatures([{ ...feature, segments: [siteSegment(9)] }]))).toBe(
      null,
    );
    // empty or malformed segments, bad strand, duplicate ids, non-string qualifier
    expect(parseFragmentJSON(withFeatures([{ ...feature, segments: [] }]))).toBeNull();
    expect(parseFragmentJSON(withFeatures([{ ...feature, segments: [{ kind: 'x' }] }]))).toBe(null);
    expect(parseFragmentJSON(withFeatures([{ ...feature, strand: 'both' }]))).toBeNull();
    expect(parseFragmentJSON(withFeatures([feature, feature]))).toBeNull();
    expect(
      parseFragmentJSON(withFeatures([{ ...feature, qualifiers: [{ name: 'a', value: 1 }] }])),
    ).toBeNull();
    expect(parseFragmentJSON(withFeatures(['nope']))).toBeNull();
  });
});
