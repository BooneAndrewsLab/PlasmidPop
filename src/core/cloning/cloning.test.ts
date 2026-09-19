import { findCutSites, getEnzyme } from '../analysis';
import { BLUNT_END, SeqDocument, describeEnd } from '../document';
import { createFeature, rangeSegment } from '../features';
import {
  assemblyJunctions,
  cutOffset,
  defaultFragmentName,
  digest,
  documentFromFragment,
  endsCompatible,
  flipFragment,
  ligate,
} from './index';

function enzymes(...names: string[]) {
  return names.map((n) => {
    const e = getEnzyme(n);
    if (e === undefined) throw new Error(`no enzyme ${n}`);
    return e;
  });
}

function cutWith(doc: SeqDocument, ...names: string[]) {
  return digest(doc, findCutSites(doc.sequence.toString(), doc.topology, enzymes(...names)));
}

//              0         1         2         3
//              0123456789012345678901234567890123456789
const LINEAR = 'CCCCGAATTCAAAAAAAGGATCCTTTTTTCTGCAGGGCCCGGGAA';
// EcoRI at 4 (cut 5/9), BamHI at 17 (cut 18/22), PstI at 29 (cut 34/30), SmaI at 37 (cut 40/40)

describe('digest', () => {
  const doc = SeqDocument.create({
    name: 'lin',
    sequence: LINEAR,
    features: [
      createFeature({ id: 'a', type: 'gene', name: 'mid', segments: [rangeSegment(10, 17)] }),
      createFeature({ id: 'b', type: 'misc', name: 'over', segments: [rangeSegment(15, 25)] }),
    ],
  });

  it('cuts a linear molecule into fragments with described ends', () => {
    const frags = cutWith(doc, 'EcoRI', 'BamHI', 'PstI', 'SmaI');
    expect(frags.map((f) => f.sequence)).toEqual([
      LINEAR.slice(0, 5),
      LINEAR.slice(5, 18),
      LINEAR.slice(18, 34),
      LINEAR.slice(34, 40),
      LINEAR.slice(40),
    ]);
    expect(frags[0]?.left).toEqual(BLUNT_END);
    expect(frags[0]?.right).toEqual({ kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' });
    expect(frags[1]?.left).toEqual({ kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' });
    expect(frags[1]?.right).toEqual({ kind: "5'", overhang: 'GATC', enzyme: 'BamHI' });
    expect(frags[2]?.right).toEqual({ kind: "3'", overhang: 'TGCA', enzyme: 'PstI' });
    expect(frags[3]?.left).toEqual({ kind: "3'", overhang: 'TGCA', enzyme: 'PstI' });
    expect(frags[3]?.right).toEqual({ kind: 'blunt', overhang: '', enzyme: 'SmaI' });
    expect(frags[4]?.right).toEqual(BLUNT_END);
    expect(frags.map((f) => f.source)).toEqual(['lin', 'lin', 'lin', 'lin', 'lin']);
    expect(frags[2]?.range).toEqual({ start: 18, end: 34 });
  });

  it('trims features to the fragment and marks cut ones partial', () => {
    const frags = cutWith(doc, 'EcoRI', 'BamHI');
    const mid = frags[1];
    expect(mid?.features.map((f) => f.name)).toEqual(['mid', 'over']);
    expect(mid?.features[0]?.segments).toEqual([rangeSegment(5, 12)]);
    expect(mid?.features[1]?.segments).toEqual([rangeSegment(10, 13, { partialEnd: true })]);
    expect(frags[2]?.features[0]?.segments).toEqual([rangeSegment(0, 7, { partialStart: true })]);
  });

  it('returns an uncut linear molecule as one blunt fragment', () => {
    const frags = cutWith(doc, 'NotI');
    expect(frags).toHaveLength(1);
    expect(frags[0]?.sequence).toBe(LINEAR);
    expect(frags[0]?.left).toEqual(BLUNT_END);
    expect(frags[0]?.right).toEqual(BLUNT_END);
  });

  it('cuts a circular molecule starting at the first cut, wrapping the last fragment', () => {
    const circ = SeqDocument.create({ name: 'circ', sequence: LINEAR, topology: 'circular' });
    const frags = cutWith(circ, 'EcoRI', 'BamHI');
    expect(frags.map((f) => f.sequence)).toEqual([
      LINEAR.slice(5, 18),
      LINEAR.slice(18) + LINEAR.slice(0, 5),
    ]);
    expect(frags[1]?.range).toEqual({ start: 18, end: LINEAR.length + 5 });
    expect(frags[1]?.left.enzyme).toBe('BamHI');
    expect(frags[1]?.right.enzyme).toBe('EcoRI');
    // One cut: the whole molecule opened up, both ends from the same site.
    const one = cutWith(circ, 'EcoRI');
    expect(one).toHaveLength(1);
    expect(one[0]?.sequence).toBe(LINEAR.slice(5) + LINEAR.slice(0, 5));
    expect(one[0]?.left).toEqual(one[0]?.right);
    expect(cutWith(circ, 'NotI')).toEqual([]);
  });

  it('reads overhangs across the origin of a circular molecule', () => {
    const seq = 'TTCAAAAAAAAGAA'; // GAATTC spans the origin: cut 12, bottom cut 2
    const circ = SeqDocument.create({ name: 'o', sequence: seq, topology: 'circular' });
    const sites = findCutSites(seq, 'circular', enzymes('EcoRI'));
    expect(cutOffset(sites[0] ?? { cut: 0, cutBottom: 0 }, seq.length, 'circular')).toBe(4);
    const frags = digest(circ, sites);
    expect(frags[0]?.left).toEqual({ kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' });
    expect(frags[0]?.sequence).toBe(seq.slice(12) + seq.slice(0, 12));
  });

  it('keeps one cut per position and drops cuts at the ends of a linear molecule', () => {
    const frags = digest(doc, [
      { enzyme: 'X', cut: 0, cutBottom: 0, siteStart: 0, strand: 'forward' },
      { enzyme: 'Y', cut: 10, cutBottom: 10, siteStart: 8, strand: 'forward' },
      { enzyme: 'Z', cut: 10, cutBottom: 14, siteStart: 8, strand: 'forward' },
      {
        enzyme: 'W',
        cut: LINEAR.length,
        cutBottom: LINEAR.length,
        siteStart: 40,
        strand: 'forward',
      },
    ]);
    expect(frags).toHaveLength(2);
    expect(frags[0]?.right.enzyme).toBe('Y');
    expect(digest(SeqDocument.create({ sequence: '' }), [])).toEqual([]);
  });

  it('describes ends', () => {
    expect(describeEnd(BLUNT_END)).toBe('blunt end');
    expect(describeEnd({ kind: "5'", overhang: 'aatt', enzyme: 'EcoRI' })).toBe('EcoRI 5′ AATT');
    expect(describeEnd({ kind: "3'", overhang: 'TGCA', enzyme: 'PstI' })).toBe('PstI 3′ TGCA');
    expect(describeEnd({ kind: 'blunt', overhang: '', enzyme: 'SmaI' })).toBe('SmaI blunt');
  });
});

describe('digesting a molecule that already has ends', () => {
  const sticky = SeqDocument.create({
    name: 'piece',
    sequence: LINEAR,
    ends: {
      left: { kind: "5'", overhang: 'CCCC', enzyme: 'AgeI' },
      right: { kind: "3'", overhang: 'GGAA', enzyme: 'KpnI' },
    },
  });

  it('gives the outer fragments the ends of the molecule itself', () => {
    const frags = cutWith(sticky, 'BamHI');
    expect(frags).toHaveLength(2);
    expect(frags[0]?.left).toEqual({ kind: "5'", overhang: 'CCCC', enzyme: 'AgeI' });
    expect(frags[0]?.right).toEqual({ kind: "5'", overhang: 'GATC', enzyme: 'BamHI' });
    expect(frags[1]?.right).toEqual({ kind: "3'", overhang: 'GGAA', enzyme: 'KpnI' });
  });

  it('hands an uncut sticky molecule back whole, ends and all', () => {
    const [whole] = cutWith(sticky);
    expect(whole?.sequence).toBe(LINEAR);
    expect(whole?.left.enzyme).toBe('AgeI');
    expect(whole?.right.enzyme).toBe('KpnI');
  });
});

describe('ligation', () => {
  const doc = SeqDocument.create({
    name: 'lin',
    sequence: LINEAR,
    features: [
      createFeature({ id: 'a', type: 'gene', name: 'mid', segments: [rangeSegment(10, 17)] }),
    ],
  });

  it('flips a fragment: ends swap and overhangs are read from the other strand', () => {
    // BsaI GGTCTC(1/5) leaves a non-palindromic overhang.
    const seq = 'CCGGTCTCAACTGTTTTTTTTT';
    const frags = cutWith(SeqDocument.create({ name: 's', sequence: seq }), 'BsaI');
    expect(frags[0]?.right).toEqual({ kind: "5'", overhang: 'ACTG', enzyme: 'BsaI' });
    expect(frags[1]?.left).toEqual({ kind: "5'", overhang: 'ACTG', enzyme: 'BsaI' });
    const second = frags[1];
    if (second === undefined) throw new Error('expected 2');
    const flipped = flipFragment(second);
    expect(flipped.right).toEqual({ kind: "5'", overhang: 'CAGT', enzyme: 'BsaI' });
    expect(flipped.left).toEqual(BLUNT_END);
    expect(flipped.sequence).toBe('AAAAAAAAACAGT');
    // Flipping twice is the identity.
    expect(flipFragment(flipped)).toEqual(frags[1]);
  });

  it('judges end compatibility by kind and overhang', () => {
    const ecoRI = { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' } as const;
    const mfeI = { kind: "5'", overhang: 'AATT', enzyme: 'MfeI' } as const;
    const bamHI = { kind: "5'", overhang: 'GATC', enzyme: 'BamHI' } as const;
    const pstI = { kind: "3'", overhang: 'TGCA', enzyme: 'PstI' } as const;
    expect(endsCompatible(ecoRI, ecoRI)).toBe(true);
    expect(endsCompatible(ecoRI, mfeI)).toBe(true);
    expect(endsCompatible(ecoRI, bamHI)).toBe(false);
    expect(endsCompatible(pstI, ecoRI)).toBe(false);
    expect(endsCompatible(BLUNT_END, { kind: 'blunt', overhang: '', enzyme: 'SmaI' })).toBe(true);
    expect(endsCompatible({ ...ecoRI, overhang: 'aatt' }, ecoRI)).toBe(true);
  });

  it('lists junctions including the closing one for circular products', () => {
    const [a, b, c] = cutWith(doc, 'EcoRI', 'BamHI');
    if (a === undefined || b === undefined || c === undefined) throw new Error('expected 3');
    expect(assemblyJunctions([a, b, c], false).map((j) => j.compatible)).toEqual([true, true]);
    expect(assemblyJunctions([a, c], false).map((j) => j.compatible)).toEqual([false]);
    // a's right is EcoRI, b's left is EcoRI; closing b→a: BamHI vs blunt.
    const circ = assemblyJunctions([a, b], true);
    expect(circ.map((j) => j.compatible)).toEqual([true, false]);
    expect(assemblyJunctions([a], false)).toEqual([]);
    expect(assemblyJunctions([a], true)).toHaveLength(1);
  });

  it('re-ligating all fragments in order recreates the molecule with its features', () => {
    const frags = cutWith(doc, 'EcoRI', 'BamHI', 'PstI', 'SmaI');
    const product = ligate(frags, { name: 'back', circular: false });
    expect(product.sequence.toString()).toBe(LINEAR);
    expect(product.topology).toBe('linear');
    // The feature was cut by BamHI into two partial pieces, one per fragment.
    const names = product.features.all().map((f) => f.name);
    expect(names).toEqual(['mid']);
    expect(product.features.all()[0]?.segments).toEqual([rangeSegment(10, 17)]);
    expect(product.metadata.description).toMatch(/^Linear ligation of lin EcoRI fragment/);
  });

  it('closes a circle only when the ends fit, so an EcoRI–BamHI insert keeps its direction', () => {
    const circ = SeqDocument.create({ name: 'p', sequence: LINEAR, topology: 'circular' });
    const [insert, vector] = cutWith(circ, 'EcoRI', 'BamHI');
    if (insert === undefined || vector === undefined) throw new Error('expected 2');
    // The vector alone cannot close: BamHI against EcoRI.
    expect(() => ligate([vector], { name: 'x', circular: true })).toThrow(/Incompatible/);
    // Neither can the insert go in backwards.
    expect(
      assemblyJunctions([vector, flipFragment(insert)], true).map((j) => j.compatible),
    ).toEqual([false, false]);
    // Forwards it recreates the plasmid, rotated to the BamHI cut.
    const product = ligate([vector, insert], { name: 'back', circular: true });
    expect(product.isCircular).toBe(true);
    expect(product.sequence.toString()).toBe(LINEAR.slice(18) + LINEAR.slice(0, 18));
    expect(product.metadata.division).toBe('SYN');
    expect(product.metadata.description).toBe(
      'Circular ligation of p BamHI-EcoRI fragment (32 bp), p EcoRI-BamHI fragment (13 bp)',
    );
  });

  it('inverts a fragment whose two ends match', () => {
    const seq = 'CCGAATTCAAAGGGAATTCTT'; // EcoRI at 2 (cut 3) and 13 (cut 14)
    const two = SeqDocument.create({
      name: 'two',
      sequence: seq,
      features: [createFeature({ type: 'gene', name: 'g', segments: [rangeSegment(8, 11)] })],
    });
    const [a, b, c] = cutWith(two, 'EcoRI');
    if (a === undefined || b === undefined || c === undefined) throw new Error('expected 3');
    const product = ligate([a, flipFragment(b), c], { name: 'inv', circular: false });
    const middle = SeqDocument.create({ sequence: seq.slice(3, 14) })
      .reverseComplement()
      .sequence.toString();
    expect(product.sequence.toString()).toBe(seq.slice(0, 3) + middle + seq.slice(14));
    const g = product.features.all()[0];
    expect(g?.strand).toBe('reverse');
    // g covered bases 8..11 of the 3..14 fragment, i.e. fragment bases 5..8 → flipped 3..6 → +3.
    expect(g?.segments).toEqual([rangeSegment(6, 9)]);
  });

  it('ligates blunt ends and refuses empty input', () => {
    const frags = cutWith(doc, 'SmaI');
    const [head, tail] = frags;
    if (head === undefined || tail === undefined) throw new Error('expected 2');
    const product = ligate([tail, head], { name: 'swap', circular: false });
    expect(product.sequence.toString()).toBe(LINEAR.slice(40) + LINEAR.slice(0, 40));
    expect(() => ligate([], { name: 'none', circular: false })).toThrow(/Nothing/);
  });
});

describe('a fragment as a document', () => {
  const doc = SeqDocument.create({ name: 'pXYZ', sequence: LINEAR });

  it('opens with the sticky ends the digest left', () => {
    const frags = cutWith(doc, 'EcoRI', 'BamHI');
    const insert = frags[1];
    if (insert === undefined) throw new Error('no fragment');
    const opened = documentFromFragment(insert);
    expect(opened.sequence.toString()).toBe(insert.sequence);
    expect(opened.topology).toBe('linear');
    expect(opened.ends).toEqual({ left: insert.left, right: insert.right });
    expect(opened.name).toBe('pXYZ EcoRI-BamHI fragment');
    expect(opened.metadata.description).toContain('EcoRI 5′ AATT');
    // Digesting the piece again finds the ends it arrived with.
    expect(cutWith(opened)[0]?.left).toEqual(insert.left);
  });

  it('names a fragment with one enzyme, or none, sensibly', () => {
    const frags = cutWith(doc, 'EcoRI');
    expect(defaultFragmentName(frags[0] as never)).toBe('pXYZ EcoRI fragment');
    const uncut = cutWith(doc);
    expect(defaultFragmentName(uncut[0] as never)).toBe('pXYZ fragment');
  });

  it('gives a linear ligation product the outermost ends of the assembly', () => {
    const frags = cutWith(doc, 'EcoRI', 'BamHI');
    const [first, second] = frags;
    if (first === undefined || second === undefined) throw new Error('no fragments');
    const product = ligate([first, second], { name: 'joined', circular: false });
    expect(product.ends).toEqual({ left: first.left, right: second.right });
    // A circle has no ends.
    const circle = cutWith(
      SeqDocument.create({ name: 'c', sequence: LINEAR, topology: 'circular' }),
      'EcoRI',
      'BamHI',
    );
    const closed = ligate(circle, { name: 'closed', circular: true });
    expect(closed.ends).toBeNull();
  });
});
