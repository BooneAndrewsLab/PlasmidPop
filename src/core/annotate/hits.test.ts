import { describe, expect, it } from 'vitest';

import { createFeature, rangeSegment, siteSegment } from '../features';
import { type FeatureHit } from './detect';
import { describeMatch, duplicatesExisting, featureFromHit, formatIdentity } from './hits';
import { type LibraryPart } from './library';

const AMP: LibraryPart = {
  name: 'AmpR',
  type: 'CDS',
  category: 'marker',
  sequence: 'A'.repeat(861),
  accession: 'J01749.1',
  location: 'complement(3293..4153)',
  note: 'beta-lactamase',
  source: 'core',
};

function hit(start: number, end: number, extra: Partial<FeatureHit> = {}): FeatureHit {
  return {
    part: 0,
    range: { start, end },
    strand: 'reverse',
    mismatches: 0,
    ambiguous: 0,
    identity: 1,
    ...extra,
  };
}

describe('duplicatesExisting', () => {
  const existing = (
    start: number,
    end: number,
    init: { type?: string; name?: string; strand?: 'forward' | 'reverse' } = {},
  ) =>
    createFeature({
      type: init.type ?? 'CDS',
      name: init.name ?? 'bla',
      strand: init.strand ?? 'reverse',
      segments: [rangeSegment(start, end)],
    });

  it('matches a feature of the same type over the same bases on the same strand', () => {
    expect(duplicatesExisting(hit(100, 961), AMP, [existing(100, 961)], 5000, 'linear')).toBe(true);
  });

  it('allows a few bases of difference either way, such as a stop codon', () => {
    expect(duplicatesExisting(hit(100, 961), AMP, [existing(103, 961)], 5000, 'linear')).toBe(true);
    expect(duplicatesExisting(hit(100, 961), AMP, [existing(100, 1000)], 5000, 'linear')).toBe(
      true,
    );
  });

  it('does not match a feature that covers much less or much more', () => {
    expect(duplicatesExisting(hit(100, 961), AMP, [existing(100, 500)], 5000, 'linear')).toBe(
      false,
    );
    expect(duplicatesExisting(hit(100, 961), AMP, [existing(0, 2000)], 5000, 'linear')).toBe(false);
  });

  it('needs 90% of each, and exactly 90% is enough', () => {
    // 90 of the hit's 100 bases.
    expect(duplicatesExisting(hit(0, 100), AMP, [existing(10, 100)], 5000, 'linear')).toBe(true);
    expect(duplicatesExisting(hit(0, 100), AMP, [existing(11, 100)], 5000, 'linear')).toBe(false);
    // 90 of the feature's 100 bases.
    expect(duplicatesExisting(hit(0, 90), AMP, [existing(0, 100)], 5000, 'linear')).toBe(true);
    expect(duplicatesExisting(hit(0, 89), AMP, [existing(0, 100)], 5000, 'linear')).toBe(false);
  });

  it('does not match one on the other strand', () => {
    const f = existing(100, 961, { strand: 'forward' });
    expect(duplicatesExisting(hit(100, 961), AMP, [f], 5000, 'linear')).toBe(false);
  });

  it('matches one of another type only by name', () => {
    const gene = existing(100, 961, { type: 'gene', name: 'bla' });
    expect(duplicatesExisting(hit(100, 961), AMP, [gene], 5000, 'linear')).toBe(false);
    const named = existing(100, 961, { type: 'misc_feature', name: 'ampr' });
    expect(duplicatesExisting(hit(100, 961), AMP, [named], 5000, 'linear')).toBe(true);
  });

  it('matches through the origin of a circle', () => {
    const f = existing(4900, 5761);
    expect(duplicatesExisting(hit(4900, 5761), AMP, [f], 5000, 'circular')).toBe(true);
    expect(duplicatesExisting(hit(4850, 5711), AMP, [f], 5000, 'circular')).toBe(true);
    expect(duplicatesExisting(hit(0, 861), AMP, [f], 5000, 'circular')).toBe(false);
  });

  it('ignores a feature of sites alone', () => {
    const site = createFeature({
      type: 'CDS',
      name: 'bla',
      strand: 'reverse',
      segments: [siteSegment(100)],
    });
    expect(duplicatesExisting(hit(100, 961), AMP, [site], 5000, 'linear')).toBe(false);
  });
});

describe('describing a match', () => {
  it('says exact, or counts mismatches and ambiguous bases with the identity', () => {
    expect(describeMatch(hit(0, 100))).toBe('exact');
    expect(describeMatch(hit(0, 100, { mismatches: 1, identity: 0.99 }))).toBe('1 mismatch, 99%');
    expect(describeMatch(hit(0, 861, { mismatches: 3, identity: 858 / 861 }))).toBe(
      '3 mismatches, 99.6%',
    );
    expect(describeMatch(hit(0, 100, { mismatches: 1, ambiguous: 2, identity: 0.97 }))).toBe(
      '1 mismatch, 2 ambiguous bases, 97%',
    );
    expect(describeMatch(hit(0, 100, { ambiguous: 1, identity: 0.99 }))).toBe(
      '1 ambiguous base, 99%',
    );
  });

  it('never rounds a near match up to 100%', () => {
    expect(formatIdentity(0.9999)).toBe('99.9%');
    expect(formatIdentity(1)).toBe('100%');
    expect(formatIdentity(0.95)).toBe('95%');
  });
});

describe('featureFromHit', () => {
  it('annotates the part where it was found, saying so and citing the record', () => {
    const f = featureFromHit(hit(4900, 5761, { mismatches: 2, identity: 859 / 861 }), AMP);
    expect(f).toMatchObject({
      type: 'CDS',
      name: 'AmpR',
      strand: 'reverse',
      segments: [rangeSegment(4900, 5761)],
    });
    expect(f.qualifiers).toEqual([
      { name: 'label', value: 'AmpR' },
      { name: 'note', value: 'beta-lactamase' },
      {
        name: 'note',
        value: 'Detected by PlasmidPop: 2 mismatches, 99.7% to J01749.1 complement(3293..4153)',
      },
    ]);
  });

  it('credits FPbase for a fluorescent protein', () => {
    const fp: LibraryPart = {
      ...AMP,
      name: 'EGFP',
      source: 'fpbase',
      accession: 'U55761.1',
      location: '97..816',
      fpbase: 'https://www.fpbase.org/protein/egfp/',
    };
    const { note: _note, ...plain } = fp;
    const f = featureFromHit(hit(0, 720, { strand: 'forward' }), plain);
    expect(f.qualifiers.at(-1)?.value).toBe(
      'Detected by PlasmidPop: exact to U55761.1 97..816 via FPbase https://www.fpbase.org/protein/egfp/',
    );
    expect(f.qualifiers).toHaveLength(2);
  });
});

describe('describeMatch on a translation hit (#93)', () => {
  const hit = {
    part: 0,
    range: { start: 0, end: 30 },
    strand: 'forward' as const,
    ambiguous: 0,
  };

  it('says the match was on the protein, and how much of it', () => {
    expect(describeMatch({ ...hit, mismatches: 0, identity: 1, viaProtein: true })).toBe(
      'exact protein match',
    );
    expect(describeMatch({ ...hit, mismatches: 1, identity: 0.99, viaProtein: true })).toBe(
      '1 residue differs, 99% of the protein',
    );
    expect(describeMatch({ ...hit, mismatches: 3, identity: 0.97, viaProtein: true })).toBe(
      '3 residues differ, 97% of the protein',
    );
    // A hit on the bases still reads as it did.
    expect(describeMatch({ ...hit, mismatches: 1, identity: 0.99 })).toBe('1 mismatch, 99%');
  });

  it('notes it in the feature it makes, so it can be told from a DNA match', () => {
    const part = {
      name: '6xHis',
      type: 'CDS',
      category: 'tag',
      accession: 'NP_043127.1',
      location: '1..7',
      source: 'core' as const,
    };
    const feature = featureFromHit({ ...hit, mismatches: 0, identity: 1, viaProtein: true }, part);
    expect(feature.qualifiers.filter((q) => q.name === 'note').at(-1)?.value).toBe(
      'Detected by PlasmidPop: exact protein match to NP_043127.1 1..7',
    );
  });
});

describe('a part cut off by the end of a linear sequence (#94)', () => {
  const hit = {
    part: 0,
    range: { start: 0, end: 300 },
    strand: 'forward' as const,
    mismatches: 0,
    ambiguous: 0,
    identity: 1,
  };

  it('says which end took it, and how well the piece that is there matched', () => {
    expect(describeMatch({ ...hit, partialStart: true })).toBe(
      'exact as far as it goes, cut off at the start',
    );
    expect(describeMatch({ ...hit, partialEnd: true })).toBe(
      'exact as far as it goes, cut off at the end',
    );
    expect(describeMatch({ ...hit, partialStart: true, partialEnd: true })).toBe(
      'exact as far as it goes, cut off at both ends',
    );
    expect(describeMatch({ ...hit, mismatches: 1, identity: 0.99, partialEnd: true })).toBe(
      '99% as far as it goes, cut off at the end',
    );
  });

  it('marks the feature partial there, as GenBank writes it', () => {
    const part = {
      name: 'AmpR',
      type: 'CDS',
      category: 'marker',
      accession: 'J01749.1',
      location: '1..861',
      source: 'core' as const,
    };
    const [segment] = featureFromHit({ ...hit, partialEnd: true }, part).segments;
    expect(segment).toMatchObject({ kind: 'range', partialStart: false, partialEnd: true });
    const [whole] = featureFromHit(hit, part).segments;
    expect(whole).toMatchObject({ partialStart: false, partialEnd: false });
  });
});
