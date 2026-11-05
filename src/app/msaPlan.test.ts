import { MAX_MSA_SEQUENCES } from '@/core';

import { type MsaDocument, planMsa } from './msaPlan';

const dna = (name: string, s: string) => ({ name, sequence: s });
const bases = [
  dna('one', 'ATGGCGTACGTTAGCCTTGACC'),
  dna('two', 'ATGGCGTACGTAGCCATTGACC'),
  dna('three', 'ATGGCGTACGTTAGCCATTGACA'),
];
const proteins = [
  dna('p1', 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQ'),
  dna('p2', 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVA'),
];
const doc: MsaDocument = {
  name: 'target',
  alphabet: 'nucleotide',
  length: 23,
  sequence: () => 'ATGGCGTACGTTAGCCATTGACC',
};

describe('planMsa (#207, #369)', () => {
  it('with no document the records alone are aligned, and three are needed', () => {
    const two = planMsa(bases.slice(0, 2), 'auto', null, false);
    expect(two.total).toBe(2);
    expect(two.include).toBe(false);
    expect(two.docNote).toBeNull();
    expect(two.reason).toBe(
      'A multiple alignment needs at least three sequences: add records to the box.',
    );
    const three = planMsa(bases, 'auto', null, false);
    expect(three.reason).toBeNull();
    expect(three.names).toEqual(['one', 'two', 'three']);
    expect(three.sequences).toEqual(bases.map((r) => r.sequence));
    expect(three.use.alphabet).toBe('nucleotide');
    expect(three.alphabetNote).toMatch(/^Scored as nucleotide: the letters read as/);
  });

  it('with a document included it goes first and the reason names it as a way to three', () => {
    const plan = planMsa(bases.slice(0, 1), 'auto', doc, true);
    expect(plan.reason).toMatch(/or include this document\.$/);
    const three = planMsa(bases.slice(0, 2), 'auto', doc, true);
    expect(three.total).toBe(3);
    expect(three.names[0]).toBe('target');
    expect(three.sequences[0]).toBe(doc.sequence());
    expect(three.docNote).toBe('target is included as one more sequence.');
  });

  it('never reads the document while it is out', () => {
    let read = 0;
    const counted: MsaDocument = {
      ...doc,
      sequence: () => {
        read += 1;
        return '';
      },
    };
    const unticked = planMsa(bases, 'auto', counted, false);
    expect(unticked.docNote).toBe('target is not included (unticked).');
    const other = planMsa(proteins, 'auto', counted, true);
    expect(other.include).toBe(false);
    expect(other.joins.ok).toBe(false);
    expect(other.docNote).toMatch(/^target is not included\. It is a nucleotide document/);
    expect(read).toBe(0);
  });

  it('counts the limit over the box alone, or the box and the document', () => {
    const many = Array.from({ length: MAX_MSA_SEQUENCES + 1 }, (_, i) =>
      dna(`r${i}`, 'ACGTACGTACGTACGT'),
    );
    expect(planMsa(many, 'auto', null, false).reason).toBe(
      `A multiple alignment takes at most ${MAX_MSA_SEQUENCES} sequences; the box holds ${many.length}.`,
    );
    expect(planMsa(many.slice(0, MAX_MSA_SEQUENCES), 'auto', doc, true).reason).toBe(
      `A multiple alignment takes at most ${MAX_MSA_SEQUENCES} sequences; the box and this document make ${MAX_MSA_SEQUENCES + 1}.`,
    );
  });

  it('waits on a mixed set until an alphabet is chosen, then says so', () => {
    const mixed = [...bases, ...proteins];
    const waiting = planMsa(mixed, 'auto', null, false);
    expect(waiting.use.alphabet).toBeNull();
    expect(waiting.reason).toMatch(/mixed/);
    expect(waiting.alphabetNote).toBeNull();
    const chosen = planMsa(mixed, 'protein', null, false);
    expect(chosen.reason).toBeNull();
    expect(chosen.alphabetNote).toBe('Scored as protein, as chosen.');
    const against = planMsa(bases, 'protein', null, false);
    expect(against.alphabetNote).toBe(
      'Scored as protein, as chosen; the letters read as nucleotide.',
    );
  });
});
