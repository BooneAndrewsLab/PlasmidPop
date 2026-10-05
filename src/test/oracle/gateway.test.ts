import { SeqDocument, createFeature, rangeSegment, reverseComplement } from '@/core';
import { type GatewayReaction, gateway } from '@/core/cloning/gateway';

import oracle from './gateway.json';

/**
 * Gateway BP and LR reactions against pydna's gateway_assembly
 * (scripts/oracle/gateway.py), from authentic att sequences: every circle
 * pydna makes must be one of ours (product or byproduct), up to rotation and
 * strand, and we make no other. The entry clone whose origin-wrapping sites
 * hide the ccdB cassette's name is issue #133 and left out.
 */

interface Spec {
  readonly sequence: string;
  readonly circular: boolean;
  readonly features: readonly {
    readonly name: string;
    readonly start: number;
    readonly end: number;
    readonly strand: 'forward' | 'reverse';
    readonly kind: string;
  }[];
}

function build(name: string, m: Spec): SeqDocument {
  return SeqDocument.create({
    name,
    sequence: m.sequence,
    topology: m.circular ? 'circular' : 'linear',
    features: m.features.map((f) =>
      createFeature({
        type: f.kind === 'att' ? 'protein_bind' : f.kind === 'gene' ? 'CDS' : 'misc_feature',
        name: f.name,
        strand: f.strand,
        segments: [rangeSegment(f.start, f.end)],
      }),
    ),
  });
}

/** Canonical form of a circle: its smallest rotation on either strand. */
function circleKey(seq: string): string {
  const s = seq.toUpperCase();
  let best = '';
  for (const t of [s, reverseComplement(s)]) {
    const doubled = t + t;
    for (let i = 0; i < t.length; i++) {
      const r = doubled.slice(i, i + t.length);
      if (best === '' || r < best) best = r;
    }
  }
  return best;
}

describe('Gateway against pydna', () => {
  for (const c of oracle.cases) {
    it(c.id, () => {
      const run = gateway(
        build('insert', c.insert as Spec),
        build('vector', c.vector as Spec),
        c.reaction as GatewayReaction,
      );
      expect(run.problem).toBeNull();
      const ours = [run.product, run.byproduct]
        .filter((d): d is SeqDocument => d !== null)
        .map((d) => circleKey(d.sequence.toString()));
      const theirs = c.pydna.map(circleKey);
      expect(ours.sort()).toEqual(theirs.sort());
    });
  }
});
