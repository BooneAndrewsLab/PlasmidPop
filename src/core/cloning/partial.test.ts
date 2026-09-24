import { findCutSites, getEnzyme } from '../analysis';
import { SeqDocument } from '../document';
import { assemblyJunctions, digest, ligate, partialDigest, partialDigestSize } from './index';

function sites(doc: SeqDocument, ...names: string[]) {
  const table = names.map((n) => {
    const e = getEnzyme(n);
    if (e === undefined) throw new Error(`no enzyme ${n}`);
    return e;
  });
  return findCutSites(doc.sequence.toString(), doc.topology, table);
}

// EcoRI cuts after 5 and 25: two sites, 20 bases apart.
const SEQ = 'CCCCGAATTCAAAAAAAAAAAAAAGAATTCTTTTTTTTTT';

describe('partialDigest', () => {
  it('gives every stretch between two stops on a linear molecule', () => {
    const doc = SeqDocument.create({ name: 'lin', sequence: SEQ, topology: 'linear' });
    const found = sites(doc, 'EcoRI');
    const partial = partialDigest(doc, found);
    // Stops at 0, 5, 25, 40: six stretches, the whole molecule among them,
    // longest first.
    expect(partial.map((f) => [f.range.start, f.range.end, f.uncut])).toEqual([
      [0, 40, 2],
      [5, 40, 1],
      [0, 25, 1],
      [5, 25, 0],
      [25, 40, 0],
      [0, 5, 0],
    ]);
    expect(partialDigestSize(doc, found)).toBe(6);
    // The complete digest's fragments are exactly the ones with nothing uncut.
    const complete = digest(doc, found).map((f) => f.sequence);
    expect(
      partial
        .filter((f) => f.uncut === 0)
        .map((f) => f.sequence)
        .sort(),
    ).toEqual([...complete].sort());
    // The uncut molecule keeps its own ends.
    expect(partial[0]?.sequence).toBe(SEQ);
    expect(partial[0]?.left.enzyme).toBeNull();
    // A limit keeps the pieces that miss the fewest sites, longest first
    // among those, and cuts out only them.
    expect(partialDigest(doc, found, 4).map((f) => [f.range.start, f.range.end, f.uncut])).toEqual([
      [5, 40, 1],
      [5, 25, 0],
      [25, 40, 0],
      [0, 5, 0],
    ]);
  });

  it('runs round a circle, including all the way to the same cut', () => {
    const doc = SeqDocument.create({ name: 'circ', sequence: SEQ, topology: 'circular' });
    const partial = partialDigest(doc, sites(doc, 'EcoRI'));
    expect(partial.map((f) => [f.range.start, f.range.end, f.uncut])).toEqual([
      [5, 45, 1],
      [25, 65, 1],
      [5, 25, 0],
      [25, 45, 0],
    ]);
    // Linearised at either site: the whole circle, EcoRI ends on both sides.
    expect(partial[0]?.sequence.length).toBe(SEQ.length);
    expect(partial[0]?.left.overhang).toBe('AATT');
    expect(partial[0]?.right.overhang).toBe('AATT');
  });
});

describe('dephosphorylation', () => {
  const doc = SeqDocument.create({ name: 'circ', sequence: SEQ, topology: 'circular' });
  const [insert, vector] = digest(doc, sites(doc, 'EcoRI'));
  if (insert === undefined || vector === undefined) throw new Error('expected two fragments');
  const bare = { ...vector, dephosphorylated: true };

  it('stops a dephosphorylated vector closing on itself', () => {
    const [self] = assemblyJunctions([bare], true);
    expect(self).toMatchObject({ compatible: false, dephosphorylated: true });
    expect(() => ligate([bare], { name: 'x', circular: true })).toThrow(/dephosphorylated/);
    // Untreated, it closes.
    expect(assemblyJunctions([vector], true)[0]?.compatible).toBe(true);
  });

  it('still takes an insert, whose phosphates join one strand at each end', () => {
    const joins = assemblyJunctions([bare, insert], true);
    expect(joins.every((j) => j.compatible)).toBe(true);
    expect(ligate([bare, insert], { name: 'x', circular: true }).length).toBe(SEQ.length);
    // Two treated pieces do not join at all.
    const both = assemblyJunctions([bare, { ...insert, dephosphorylated: true }], true);
    expect(both.every((j) => !j.compatible && j.dephosphorylated)).toBe(true);
  });

  it('does not call mismatched ends a phosphate problem', () => {
    const blunt = {
      ...insert,
      dephosphorylated: true,
      left: { ...insert.left, kind: 'blunt' as const, overhang: '' },
    };
    const [into, closing] = assemblyJunctions([bare, blunt], true);
    expect(into).toMatchObject({ compatible: false, dephosphorylated: false });
    expect(closing).toMatchObject({ compatible: false, dephosphorylated: true });
  });
});
