import { SeqDocument, createFeature, rangeSegment, reverseComplement } from '@/core';
import { type GatewayReaction, gateway } from '@/core/cloning/gateway';

import oracle from './gateway.json';

/**
 * Gateway BP and LR reactions against pydna's gateway_assembly
 * (scripts/oracle/gateway.py), from authentic att sequences: every circle
 * pydna makes must be one of ours (product or byproduct), up to rotation and
 * strand, and we make no other. Which of the two is the clone is checked
 * by its bases, with the lethal cassette under another name too (#133).
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

/** The bases a feature named `name` covers, unrolled across the origin. */
function featureBases(m: Spec, name: string): string {
  const f = m.features.find((x) => x.name === name);
  if (f === undefined) throw new Error(name);
  const s = m.sequence.toUpperCase();
  return f.end <= s.length
    ? s.slice(f.start, f.end)
    : s.slice(f.start) + s.slice(0, f.end - s.length);
}

function carries(doc: SeqDocument, bases: string): boolean {
  const s = doc.sequence.toString().toUpperCase();
  const circle = s + s;
  return circle.includes(bases) || circle.includes(reverseComplement(bases));
}

describe('Gateway against pydna: the product is the clone (#133)', () => {
  for (const c of oracle.cases) {
    for (const [cassette, backbone] of [
      ['ccdB', null],
      ['Gateway cassette', null],
      ['lethal cassette', 'ccdB promoter'],
    ] as const) {
      it(`${c.id}, cassette named ${cassette}${backbone === null ? '' : `, backbone ${backbone}`}`, () => {
        const vector = c.vector as Spec;
        const renamed: Spec = {
          ...vector,
          features: vector.features.map((f) =>
            f.name === 'ccdB'
              ? { ...f, name: cassette }
              : backbone !== null && f.name === 'ampR'
                ? { ...f, name: backbone }
                : f,
          ),
        };
        const run = gateway(
          build('insert', c.insert as Spec),
          build('vector', renamed),
          c.reaction as GatewayReaction,
        );
        const gene = featureBases(c.insert as Spec, 'gene');
        const lethal = featureBases(vector, 'ccdB');
        const product = run.product;
        if (product === null) throw new Error('no product');
        expect(carries(product, gene)).toBe(true);
        expect(carries(product, lethal)).toBe(false);
        expect(run.warnings.join(' ')).not.toMatch(/named ccdB/);
      });
    }
  }
});

describe('Gateway against pydna: sites numbered against the convention (#133)', () => {
  const numberOf = (name: string): string => /^att[BPLR](\d+r?)$/i.exec(name)?.[1] ?? '';
  /**
   * Exchanges the two numbers of a molecule's att sites, keeping where they
   * are: whatever order the names would have given, this is the other one.
   * Both molecules are relabelled alike, so the partners still pair (#147 —
   * the old version swapped the numbers 1 and 2, which left a MultiSite pair
   * such as attB4/attB1r untouched).
   */
  const swapped = (m: Spec, [a, b]: readonly [string, string]): Spec => ({
    ...m,
    features: m.features.map((f) =>
      f.kind !== 'att'
        ? f
        : {
            ...f,
            name: f.name.replace(/\d+r?$/, (n) => (n === a ? b : n === b ? a : n)),
          },
    ),
  });
  const sameStrand = (m: Spec): boolean =>
    new Set(m.features.filter((f) => f.kind === 'att').map((f) => f.strand)).size === 1;
  const pairOf = (m: Spec): readonly [string, string] => {
    const [a, b] = [
      ...new Set(m.features.filter((f) => f.kind === 'att').map((f) => numberOf(f.name))),
    ];
    if (a === undefined || b === undefined) throw new Error('two att numbers');
    return [a, b];
  };

  for (const c of oracle.cases.filter((x) => sameStrand(x.insert as Spec))) {
    it(`${c.id}: the ccdB gene decides, and says so`, () => {
      const pair = pairOf(c.insert as Spec);
      const run = gateway(
        build('insert', swapped(c.insert as Spec, pair)),
        build('vector', swapped(c.vector as Spec, pair)),
        c.reaction as GatewayReaction,
      );
      const product = run.product;
      if (product === null) throw new Error('no product');
      expect(carries(product, featureBases(c.insert as Spec, 'gene'))).toBe(true);
      expect(carries(product, featureBases(c.vector as Spec, 'ccdB'))).toBe(false);
      expect(run.warnings.join(' ')).toMatch(/both drawn on one strand/);
    });
  }
});
