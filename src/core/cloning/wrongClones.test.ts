import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  type DigestFragment,
  MAX_WRONG_LANES,
  SeqDocument,
  type WrongClone,
  WRONG_CLONE_KINDS,
  assemblyJunctions,
  cuttableSites,
  diagnosticDigests,
  digest,
  emptyVectorClone,
  enzymeProfile,
  findCutSites,
  getEnzyme,
  ligate,
  ligationWrongClones,
  reverseComplement,
  wrongLanes,
} from '@/core';

/*
 * Item 132 (#361): the wrong clones of a restriction ligation. Each is
 * built by `ligate` from the same fragments as the product; the cross-check
 * builds the same molecules by slicing the source sequences by hand, from
 * the cut positions alone, and compares bases and EcoRI fragments.
 */

function def<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('missing');
  return value;
}

/** Bases from a seed, with no BamHI, EcoRI, EcoRV or HindIII site. */
function bases(n: number, seed: number): string {
  let x = seed >>> 0;
  let out = '';
  while (out.length < n + 8) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out += 'ACGT'.charAt(x >>> 30);
  }
  for (const site of ['GGATCC', 'GAATTC', 'GATATC', 'AAGCTT']) {
    while (out.includes(site)) out = out.replace(site, site.slice(0, 2) + 'C' + site.slice(3));
  }
  return out.slice(0, n);
}

const enzyme = (name: string) => def(getEnzyme(name));

function cut(doc: SeqDocument, ...names: string[]): DigestFragment[] {
  return digest(doc, findCutSites(doc.sequence.toString(), doc.topology, names.map(enzyme)));
}

/** Fragment lengths of `doc` cut with `name`, its host methylation allowed for, longest first. */
function lengths(doc: SeqDocument, name: string): number[] {
  const text = doc.sequence.toString();
  const sites = cuttableSites(
    text,
    doc.topology,
    doc.methylation,
    findCutSites(text, doc.topology, [enzyme(name)]),
    () => enzyme(name).site.length,
  );
  return digest(doc, sites)
    .map((f) => f.sequence.length)
    .sort((a, b) => b - a);
}

// A 3 kb vector with one BamHI site and one EcoRI site, and an 812 bp
// BamHI insert (GATCC, 100 bases, GAATTC, 700 bases, G) with its EcoRI site
// 100 bp from its left end, so that the insert's orientation and the two
// inverted doubles show in an EcoRI digest.
const VECTOR_TEXT = `${bases(1000, 5)}GAATTC${bases(500, 6)}GGATCC${bases(1494, 7)}`;
const INSERT_SRC = `CCGGATCC${bases(100, 3)}GAATTC${bases(700, 4)}GGATCCGG`;
const vector = SeqDocument.create({ name: 'pV', topology: 'circular', sequence: VECTOR_TEXT });
const insertSource = SeqDocument.create({ name: 'ins', sequence: INSERT_SRC });
const backbone = def(cut(vector, 'BamHI')[0]);
const insert = def(cut(insertSource, 'BamHI')[1]);
const product = ligate([backbone, insert], { name: 'pV-ins', circular: true });

/** The same molecules sliced by hand from the two sources, by the cut positions. */
function byHand(): Readonly<Record<WrongClone['kind'], string>> & { readonly product: string } {
  // BamHI is G^GATCC: the top strand is cut after the first G.
  const s = VECTOR_TEXT.indexOf('GGATCC');
  const V = VECTOR_TEXT.slice(s + 1) + VECTOR_TEXT.slice(0, s + 1);
  const s1 = INSERT_SRC.indexOf('GGATCC');
  const s2 = INSERT_SRC.indexOf('GGATCC', s1 + 1);
  const I = INSERT_SRC.slice(s1 + 1, s2 + 1);
  // Turned over, the insert's top strand is what its bottom strand covered:
  // the window shifted by the four-base 5′ overhang, read backwards.
  const F = reverseComplement(INSERT_SRC.slice(s1 + 5, s2 + 5));
  return {
    product: V + I,
    empty: V,
    reversed: V + F,
    tandem: V + I + I,
    dimer: V + V,
    'head-to-head': V + I + F,
    'tail-to-tail': V + F + I,
  };
}

describe('the fixtures', () => {
  it('have one BamHI and one EcoRI site in the vector, and the insert has an EcoRI site', () => {
    expect(lengths(vector, 'BamHI')).toEqual([3006]);
    expect(lengths(vector, 'EcoRI')).toEqual([3006]);
    expect(insert.sequence).toHaveLength(812);
    expect(insert.sequence).toContain('GAATTC');
    expect(product.length).toBe(3006 + 812);
    expect(product.sequence.toString()).toBe(byHand().product);
  });
});

describe('ligationWrongClones of a one-enzyme ligation', () => {
  const wrong = ligationWrongClones([backbone, insert], 0, product);

  it('gives every kind, most common first, each a circle its ends can close', () => {
    expect(wrong.map((w) => w.kind)).toEqual(WRONG_CLONE_KINDS);
    for (const w of wrong) {
      expect(w.molecule.isCircular).toBe(true);
      expect(w.label.length).toBeLessThanOrEqual(7);
      expect(w.name).not.toBe('');
      expect(w.why).toMatch(/\.$/);
    }
  });

  it('is the same bases as the molecules sliced by hand', () => {
    const hand = byHand();
    for (const w of wrong) expect(w.molecule.sequence.toString()).toBe(hand[w.kind]);
  });

  it('has the lengths the kinds imply', () => {
    const by = Object.fromEntries(wrong.map((w) => [w.kind, w.molecule.length]));
    expect(by).toEqual({
      empty: 3006,
      reversed: product.length,
      tandem: product.length + 812,
      dimer: 2 * 3006,
      'head-to-head': product.length + 812,
      'tail-to-tail': product.length + 812,
    });
  });

  it('cut with EcoRI, each gives the fragments of the hand-built molecule, and the orientations differ', () => {
    const hand = byHand();
    const ecoRI = enzyme('EcoRI');
    for (const w of wrong) {
      const theirs = SeqDocument.create({ sequence: hand[w.kind], topology: 'circular' });
      expect(lengths(w.molecule, 'EcoRI')).toEqual(lengths(theirs, 'EcoRI'));
      // The lane the Bench draws is the same digest.
      const sites = findCutSites(w.molecule.sequence.toString(), 'circular', [ecoRI]);
      expect(enzymeProfile(sites, w.molecule.length, 'circular').fragments).toEqual(
        lengths(w.molecule, 'EcoRI'),
      );
    }
    const of = (kind: WrongClone['kind']) =>
      lengths(def(wrong.find((w) => w.kind === kind)).molecule, 'EcoRI');
    // EcoRI cuts the vector once and the insert once: two bands, and the
    // insert turned round moves its cut, so the bands move.
    expect(lengths(product, 'EcoRI')).toHaveLength(2);
    expect(of('reversed')).toHaveLength(2);
    expect(of('reversed')).not.toEqual(lengths(product, 'EcoRI'));
    // Two inserts give three bands; head to head and tail to tail differ
    // from each other and from the tandem.
    expect(of('tandem')).toHaveLength(3);
    expect(of('head-to-head')).toHaveLength(3);
    expect(of('tail-to-tail')).toHaveLength(3);
    expect(new Set([of('tandem'), of('head-to-head'), of('tail-to-tail')].map(String)).size).toBe(
      3,
    );
    // The tandem repeats the insert's own EcoRI-to-EcoRI stretch, the insert's length.
    expect(of('tandem')).toContain(812);
    // A dimer has the vector's EcoRI site twice: two halves of one size.
    expect(of('dimer')).toEqual([3006, 3006]);
    // The empty vector is linearised.
    expect(of('empty')).toEqual([3006]);
  });

  it('is built by ligate, with every junction compatible, and not the product', () => {
    for (const w of wrong) {
      expect(w.molecule.sequence.toString()).not.toBe(product.sequence.toString());
      expect(w.molecule.metadata.description).toMatch(/^Circular ligation of/);
    }
  });

  it('is capped at MAX_WRONG_LANES for the gel, naming the rest', () => {
    const { shown, omitted } = wrongLanes(wrong);
    expect(shown.map((w) => w.kind)).toEqual(WRONG_CLONE_KINDS.slice(0, MAX_WRONG_LANES));
    expect(omitted).toEqual(['Two inserts, head to head', 'Two inserts, tail to tail']);
  });
});

describe('ligationWrongClones where the ends refuse', () => {
  it('a dephosphorylated vector cannot close or dimerise, but the insert still goes in twice or turned', () => {
    const treated = { ...backbone, dephosphorylated: true };
    const wrong = ligationWrongClones([treated, insert], 0, product);
    expect(wrong.map((w) => w.kind)).toEqual([
      'reversed',
      'tandem',
      'head-to-head',
      'tail-to-tail',
    ]);
  });

  it('a directional insert (two different sticky ends) has no wrong clone at all', () => {
    const v = SeqDocument.create({
      name: 'pD',
      topology: 'circular',
      sequence: `${bases(1000, 11)}GAATTC${bases(40, 12)}GGATCC${bases(1500, 13)}`,
    });
    const i = SeqDocument.create({
      name: 'insD',
      sequence: `CCGAATTC${bases(700, 14)}GGATCCGG`,
    });
    const bb = def(
      cut(v, 'EcoRI', 'BamHI').sort((a, b) => b.sequence.length - a.sequence.length)[0],
    );
    const piece = def(cut(i, 'EcoRI', 'BamHI')[1]);
    const clone = ligate([bb, piece], { name: 'pD-ins', circular: true });
    expect(assemblyJunctions([bb, piece], true).every((j) => j.compatible)).toBe(true);
    expect(ligationWrongClones([bb, piece], 0, clone)).toEqual([]);
  });

  it('a blunt (EcoRV) ligation can go wrong in every way', () => {
    const v = SeqDocument.create({
      name: 'pB',
      topology: 'circular',
      sequence: `${bases(1200, 21)}GATATC${bases(1800, 22)}`,
    });
    const i = SeqDocument.create({
      name: 'insB',
      sequence: `CCGATATC${bases(500, 23)}GATATCGG`,
    });
    const bb = def(cut(v, 'EcoRV')[0]);
    const piece = def(cut(i, 'EcoRV')[1]);
    const clone = ligate([bb, piece], { name: 'pB-ins', circular: true });
    const wrong = ligationWrongClones([bb, piece], 0, clone);
    expect(wrong.map((w) => w.kind)).toEqual(WRONG_CLONE_KINDS);
    // The vector's EcoRV site is destroyed when the insert's left end (a
    // blunt GAT) meets the vector's ATC... only where the bases happen to
    // make one, so the lengths are the check.
    expect(def(wrong.find((w) => w.kind === 'reversed')).molecule.length).toBe(clone.length);
  });

  it('a palindromic insert turned round is the product, so it is left out', () => {
    const half = bases(300, 31);
    const i = SeqDocument.create({
      name: 'pal',
      sequence: `CCGGATCC${half}${reverseComplement(half)}GGATCCGG`,
    });
    const piece = def(cut(i, 'BamHI')[1]);
    const clone = ligate([backbone, piece], { name: 'pV-pal', circular: true });
    const wrong = ligationWrongClones([backbone, piece], 0, clone);
    expect(wrong.map((w) => w.kind)).not.toContain('reversed');
    expect(wrong.map((w) => w.kind)).toContain('tandem');
  });

  it('a linear product has no colonies, so no wrong clones', () => {
    const linear = ligate([backbone, insert], { name: 'lin', circular: false });
    expect(ligationWrongClones([backbone, insert], 0, linear)).toEqual([]);
  });

  it('the vector need not be first: the order on the shelf is kept', () => {
    const clone = ligate([insert, backbone], { name: 'ins-pV', circular: true });
    const wrong = ligationWrongClones([insert, backbone], 1, clone);
    expect(wrong.map((w) => w.kind)).toEqual(WRONG_CLONE_KINDS);
    const reversed = def(wrong.find((w) => w.kind === 'reversed')).molecule;
    expect(reversed.sequence.toString().endsWith(backbone.sequence)).toBe(true);
  });

  it('two inserts: one list per insert, named after it, in the kinds’ order', () => {
    const second = def(
      cut(
        SeqDocument.create({ name: 'ins2', sequence: `CCGGATCC${bases(400, 41)}GGATCCGG` }),
        'BamHI',
      )[1],
    );
    const clone = ligate([backbone, insert, second], { name: 'three', circular: true });
    const wrong = ligationWrongClones([backbone, insert, second], 0, clone);
    expect(wrong.map((w) => w.kind)).toEqual([
      'empty',
      'reversed',
      'reversed',
      'tandem',
      'tandem',
      'dimer',
      'head-to-head',
      'head-to-head',
      'tail-to-tail',
      'tail-to-tail',
    ]);
    expect(wrong[1]?.name).toBe('Insert reversed (ins BamHI fragment)');
    expect(wrong[2]?.name).toBe('Insert reversed (ins2 BamHI fragment)');
    expect(wrong[4]?.molecule.length).toBe(clone.length + second.sequence.length);
  });
});

describe('emptyVectorClone', () => {
  it('is the uncut circle for a circular vector, the closed piece for a cut one, none for a PCR product', () => {
    expect(emptyVectorClone(vector).map((w) => [w.kind, w.molecule.length])).toEqual([
      ['empty', 3006],
    ]);
    expect(emptyVectorClone(vector)[0]?.why).toMatch(/uncut/);
    expect(emptyVectorClone(backbone)[0]?.why).toMatch(/closed on itself/);
    expect(emptyVectorClone(SeqDocument.create({ sequence: 'ACGT'.repeat(50) }))).toEqual([]);
  });
});

describe('diagnosticDigests against the wrong clones (the protocol)', () => {
  it('gives each wrong lane the digest of that molecule, and ranks by telling all apart', () => {
    const wrong = wrongLanes(ligationWrongClones([backbone, insert], 0, product)).shown;
    const digests = diagnosticDigests(product, {}, 50, wrong);
    expect(digests.length).toBeGreaterThan(0);
    for (const d of digests) {
      expect(d.wrong.map((w) => w.label)).toEqual(wrong.map((w) => w.label));
      d.wrong.forEach((lane, i) => {
        expect(lane.profile.fragments).toEqual(lengths(def(wrong[i]).molecule, d.enzyme));
      });
    }
    // The best tells every wrong lane apart; EcoRI does.
    expect(def(digests[0]).wrong.every((w) => w.apart)).toBe(true);
    const ecoRI = def(digests.find((d) => d.enzyme === 'EcoRI'));
    expect(ecoRI.wrong.every((w) => w.apart)).toBe(true);
    // An enzyme that cuts the insert alone leaves the empty vector and the dimer uncut.
    const insertOnly = digests.find(
      (d) => d.wrong.find((w) => w.label === 'Empty')?.profile.bands.length === 0,
    );
    if (insertOnly !== undefined) {
      expect(def(insertOnly.wrong.find((w) => w.label === 'Empty')).apart).toBe(false);
      expect(def(insertOnly.wrong.find((w) => w.label === 'Dimer')).profile.bands).toEqual([]);
    }
    // Ranked best first: nothing above tells fewer apart than what is below.
    const told = digests.map((d) => d.wrong.filter((w) => w.apart).length);
    for (let i = 1; i < told.length; i++)
      expect(def(told[i - 1])).toBeGreaterThanOrEqual(def(told[i]));
  });
});

describe('ligationWrongClones, by property', () => {
  const seeds = fc.record({
    left: fc.integer({ min: 300, max: 1500 }),
    right: fc.integer({ min: 300, max: 1500 }),
    insertLength: fc.integer({ min: 100, max: 900 }),
    seed: fc.integer({ min: 1, max: 1 << 30 }),
    site: fc.constantFrom('GGATCC', 'GAATTC', 'AAGCTT', 'GATATC'),
    dephosphorylated: fc.boolean(),
  });
  const enzymeOf: Record<string, string> = {
    GGATCC: 'BamHI',
    GAATTC: 'EcoRI',
    AAGCTT: 'HindIII',
    GATATC: 'EcoRV',
  };

  it('every wrong clone is a circle its ends close, with the length its kind implies, and never the product', () => {
    fc.assert(
      fc.property(seeds, ({ left, right, insertLength, seed, site, dephosphorylated }) => {
        const name = def(enzymeOf[site]);
        const v = SeqDocument.create({
          name: 'v',
          topology: 'circular',
          sequence: `${bases(left, seed)}${site}${bases(right, seed + 1)}`,
        });
        const i = SeqDocument.create({
          name: 'i',
          sequence: `CC${site}${bases(insertLength, seed + 2)}${site}GG`,
        });
        const bb = { ...def(cut(v, name)[0]), ...(dephosphorylated ? { dephosphorylated } : {}) };
        const piece = def(cut(i, name)[1]);
        const clone = ligate([bb, piece], { name: 'c', circular: true });
        const wrong = ligationWrongClones([bb, piece], 0, clone);
        const kinds = wrong.map((w) => w.kind);
        // In the kinds' order, each at most once with one insert.
        expect(kinds).toEqual(WRONG_CLONE_KINDS.filter((k) => kinds.includes(k)));
        expect(kinds.includes('empty')).toBe(!dephosphorylated);
        expect(kinds.includes('dimer')).toBe(!dephosphorylated);
        expect(kinds).toContain('tandem');
        const vectorLength = bb.sequence.length;
        const insertLen = piece.sequence.length;
        for (const w of wrong) {
          expect(w.molecule.isCircular).toBe(true);
          expect(w.molecule.sequence.toString()).not.toBe(clone.sequence.toString());
          const expected = {
            empty: vectorLength,
            reversed: clone.length,
            tandem: clone.length + insertLen,
            dimer: 2 * vectorLength,
            'head-to-head': clone.length + insertLen,
            'tail-to-tail': clone.length + insertLen,
          }[w.kind];
          expect(w.molecule.length).toBe(expected);
        }
      }),
      { numRuns: 25 },
    );
  });
});
