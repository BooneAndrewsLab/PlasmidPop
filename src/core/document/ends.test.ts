import { type Feature, createFeature, rangeSegment } from '../features';
import { reverseComplement } from '../sequence';
import { SeqDocument } from './seqDocument';
import {
  type DocumentEnds,
  type StrandEnd,
  BLUNT_END,
  describeEnd,
  describeEnds,
  endsEqual,
  flipEnds,
  hasOverhang,
  normalizeEnds,
  topStrandOverhang,
} from './ends';

const ecoRI: StrandEnd = { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' };
const pstI: StrandEnd = { kind: "3'", overhang: 'TGCA', enzyme: 'PstI' };
const smaI: StrandEnd = { kind: 'blunt', overhang: '', enzyme: 'SmaI' };
const sticky: DocumentEnds = { left: ecoRI, right: pstI };

/** 40 bases, the first four of which are EcoRI's overhang when it is the left end. */
const SEQ = `AATT${'GCTAGCTAGC'.repeat(3)}CCCCCC`;

function doc(ends: DocumentEnds | null = sticky): SeqDocument {
  return SeqDocument.create({ sequence: SEQ, topology: 'linear', ends });
}

describe('strand ends', () => {
  it('normalizes away what is not worth storing', () => {
    expect(normalizeEnds(null, 'linear')).toBeNull();
    expect(normalizeEnds(sticky, 'circular')).toBeNull();
    expect(normalizeEnds({ left: BLUNT_END, right: BLUNT_END }, 'linear')).toBeNull();
    // A blunt end an enzyme made is worth keeping: it says what cut there.
    expect(normalizeEnds({ left: smaI, right: BLUNT_END }, 'linear')).not.toBeNull();
  });

  it('swaps and re-reads the ends when the molecule is turned around', () => {
    expect(flipEnds(sticky)).toEqual({
      left: { kind: "3'", overhang: 'TGCA', enzyme: 'PstI' },
      right: { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' },
    });
    // AATT is its own reverse complement, TGCA too, so flipping twice is the
    // same molecule either way round.
    expect(flipEnds(flipEnds(sticky))).toEqual(sticky);
    expect(flipEnds(null)).toBeNull();
  });

  it('knows which overhang bases are part of the sequence', () => {
    // A 5' overhang on the left and a 3' overhang on the right are on the top
    // strand, so they are in the document's own bases; the other two are not.
    expect(topStrandOverhang(ecoRI, 'left')).toBe(4);
    expect(topStrandOverhang(ecoRI, 'right')).toBe(0);
    expect(topStrandOverhang(pstI, 'right')).toBe(4);
    expect(topStrandOverhang(pstI, 'left')).toBe(0);
    expect(topStrandOverhang(BLUNT_END, 'left')).toBe(0);
  });

  it('describes ends for people', () => {
    expect(describeEnd(ecoRI)).toBe('EcoRI 5′ AATT');
    expect(describeEnd(smaI)).toBe('SmaI blunt');
    expect(describeEnd(BLUNT_END)).toBe('blunt end');
    expect(describeEnds(sticky)).toBe('EcoRI 5′ AATT / PstI 3′ TGCA');
    expect(describeEnds(null)).toBe('blunt ends');
    expect(hasOverhang(sticky)).toBe(true);
    expect(hasOverhang({ left: smaI, right: BLUNT_END })).toBe(false);
    expect(hasOverhang(null)).toBe(false);
  });
});

describe('SeqDocument ends', () => {
  it('keeps the ends it was created with, and drops meaningless ones', () => {
    expect(doc().ends).toEqual(sticky);
    expect(SeqDocument.create({ sequence: SEQ, ends: null }).ends).toBeNull();
    expect(
      SeqDocument.create({ sequence: SEQ, topology: 'circular', ends: sticky }).ends,
    ).toBeNull();
  });

  it('sets and clears the ends as an op', () => {
    const d = SeqDocument.create({ sequence: SEQ });
    const withEnds = d.apply({ type: 'setEnds', ends: sticky });
    expect(withEnds.ends).toEqual(sticky);
    expect(withEnds.apply({ type: 'setEnds', ends: null }).ends).toBeNull();
    // No change, no new document.
    expect(withEnds.apply({ type: 'setEnds', ends: { ...sticky } })).toBe(withEnds);
  });

  it('leaves the ends alone for an edit in the middle', () => {
    const edited = doc().insert(20, 'GGGG').delete({ start: 10, end: 14 });
    expect(edited.ends).toEqual(sticky);
    expect(endsEqual(edited.ends, sticky)).toBe(true);
  });

  it('blunts an end the edit reaches', () => {
    // Typing over the first base of the 5' overhang destroys it.
    expect(doc().replace({ start: 0, end: 1 }, 'G').ends).toEqual({
      left: BLUNT_END,
      right: pstI,
    });
    // ...as does cutting the last bases, which are the 3' overhang.
    expect(doc().delete({ start: SEQ.length - 2, end: SEQ.length }).ends).toEqual({
      left: ecoRI,
      right: BLUNT_END,
    });
    // An edit that reaches both leaves an ordinary blunt molecule.
    expect(doc().replace({ start: 0, end: SEQ.length }, 'ACGT').ends).toBeNull();
  });

  it('blunts the end of a bottom-strand overhang only at the very tip', () => {
    // A 5' overhang on the right hangs off the bottom strand, past the last
    // base, so only an edit at the end itself touches it.
    const right: StrandEnd = { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' };
    const d = SeqDocument.create({
      sequence: SEQ,
      topology: 'linear',
      ends: { left: BLUNT_END, right },
    });
    expect(d.insert(SEQ.length - 1, 'G').ends?.right).toEqual(right);
    // With the other end plain too, blunting this one leaves an ordinary
    // linear molecule with nothing to describe.
    expect(d.insert(SEQ.length, 'G').ends).toBeNull();
  });

  it('follows a reverse complement and a change of topology', () => {
    expect(doc().reverseComplement().ends).toEqual(flipEnds(sticky));
    const circular = doc().setTopology('circular');
    expect(circular.ends).toBeNull();
    // Cutting it open again leaves ends nobody has described.
    expect(circular.setTopology('linear').ends).toBeNull();
  });

  it('carries the ends through annotation-only changes', () => {
    const renamed = doc().rename('cut piece').setMetadata({ description: 'x' });
    expect(renamed.ends).toEqual(sticky);
  });
});

describe('turning a sticky-ended molecule over', () => {
  // EcoRI at the left, PstI at the right, both overhangs really in the
  // sequence: the first four bases sit on the top strand alone, and so do
  // the last four.
  const left: StrandEnd = ecoRI;
  const right: StrandEnd = pstI;
  const INNER = 'GGGCCCAAA';
  const STICKY = `AATT${INNER}TGCA`;

  function sticky3(features: Feature[] = []): SeqDocument {
    return SeqDocument.create({
      sequence: STICKY,
      topology: 'linear',
      features,
      ends: { left, right },
    });
  }

  it('moves the window by an overhang at each end', () => {
    const flipped = sticky3().reverseComplement();
    // The new top strand is the old bottom one, which covers the double-
    // stranded middle and neither overhang.
    expect(flipped.sequence.toString()).toBe(reverseComplement(INNER));
    expect(flipped.ends).toEqual(flipEnds({ left, right }));
  });

  it('brings a bottom-strand overhang into the sequence', () => {
    // The same molecule written the other way round. Both overhangs are on
    // the bottom strand now, so they are not in the sequence at all and the
    // flip has to get them back from the ends: nine bases in, seventeen out.
    const other = SeqDocument.create({
      sequence: reverseComplement(INNER),
      topology: 'linear',
      ends: flipEnds({ left, right }),
    });
    expect(other.reverseComplement().sequence.toString()).toBe(STICKY);
    expect(other.reverseComplement().ends).toEqual({ left, right });
  });

  it('leaves a blunt molecule where it is', () => {
    const blunt = SeqDocument.create({ sequence: STICKY, topology: 'linear', ends: null });
    expect(blunt.reverseComplement().sequence.toString()).toBe(reverseComplement(STICKY));
    // A blunt end an enzyme made says what cut there and nothing about a window.
    const named = blunt.setEnds({ left: smaI, right: smaI });
    expect(named.reverseComplement().sequence.toString()).toBe(reverseComplement(STICKY));
  });

  it('takes a feature annotated on an overhang with the overhang', () => {
    // GGG, the first three bases of the double-stranded middle.
    const inner = feature('inner', 4, 7);
    const onOverhang = feature('on the overhang', 0, 4);
    const flipped = sticky3([inner, onOverhang]).reverseComplement();
    expect(flipped.features.all().map((f) => f.name)).toEqual(['inner']);
    // The overhang it was measured from is gone, so it is at 0..3 of the
    // window before the flip and the last three bases of the nine after it.
    expect(flipped.features.all()[0]?.segments).toEqual([
      rangeSegment(INNER.length - 3, INNER.length),
    ]);
    expect(flipped.subsequence({ start: 6, end: 9 })).toBe('CCC');
    expect(flipped.features.all()[0]?.strand).toBe('reverse');
  });
});

function feature(name: string, start: number, end: number): Feature {
  return createFeature({ name, type: 'misc_feature', segments: [rangeSegment(start, end)] });
}
