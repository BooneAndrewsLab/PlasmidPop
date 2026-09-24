import { SeqDocument, reverseComplement } from '@/core';
import { randomDna, seededRandom } from '@/test/random';

import { digest } from '../cloning/digest';
import { ligate } from '../cloning/ligate';
import { designMutagenesis } from '../cloning/mutagenesis';
import { pcr } from '../cloning/pcr';
import { findAnnealingSites } from './anneal';
import { meltingTemperature } from './thermo';

/**
 * Degenerate primers (#75). The annealing search used to drop every base
 * that was not A, C, G or T, which joined the neighbours of a code into a
 * primer that was never ordered. A code now pairs with each template base
 * it stands for, is written into the product as the code it is, and takes
 * the template's base for the Tm, which is the molecule of the mix that
 * anneals there.
 */

// A fixed, non-repetitive template.
const TEXT =
  'ATGACCATGATTACGCCAAGCTTGCATGCCTGCAGGTCGACTCTAGAGGATCCCCGGGTACCGAGCTCGAATTCACTGGCCGTCGTTTTACAACGTCGTGACTGGGAAAACCCTGGCGTTACCCAACTTAATCGCCTTGCAGCACATCCCCCTTTCGCCAGCTGGCGTAATAGCGAAGAGGCCCGCACCGATCGCCCTTCCCAACAGTTGCGCAGCCTGAATGGCGAATGG';

describe('degenerate primers', () => {
  const at = 40;
  const exact = TEXT.slice(at, at + 22);
  /** The exact primer with the base at `i` replaced by `code`. */
  const withCode = (i: number, code: string): string =>
    exact.slice(0, i) + code + exact.slice(i + 1);

  it('pairs a code with every base it stands for, and no other', () => {
    const base = exact.charAt(8);
    const covering = { A: 'R', G: 'R', C: 'Y', T: 'Y' }[base] ?? 'N';
    const missing = { A: 'Y', G: 'Y', C: 'R', T: 'R' }[base] ?? 'N';
    const find = (primer: string) =>
      findAnnealingSites(TEXT, 'linear', primer).filter((s) => s.strand === 'forward');
    // N and the right two-base code anneal exactly where the plain primer does.
    for (const code of ['N', covering]) {
      const [site] = find(withCode(8, code));
      expect(site?.range).toEqual({ start: at, end: at + 22 });
      expect(site?.mismatches).toBe(0);
      expect(site?.primer).toBe(withCode(8, code));
    }
    // The wrong code is a mismatch, not a match.
    expect(find(withCode(8, missing))[0]?.mismatches).toBe(1);
  });

  it('keeps a code inside the 3′ anchor, where a mismatch would be no site at all', () => {
    const last = exact.length - 2;
    const [site] = findAnnealingSites(TEXT, 'linear', withCode(last, 'N')).filter(
      (s) => s.strand === 'forward',
    );
    expect(site?.annealLength).toBe(22);
  });

  it('does not let a template N pair with a plain base', () => {
    const blurred = TEXT.slice(0, at + 8) + 'N' + TEXT.slice(at + 9);
    const [site] = findAnnealingSites(blurred, 'linear', exact).filter(
      (s) => s.strand === 'forward',
    );
    expect(site?.mismatches).toBe(1);
  });

  it('gives a degenerate site the Tm of the template base it anneals to', () => {
    const [site] = findAnnealingSites(TEXT, 'linear', withCode(8, 'N')).filter(
      (s) => s.strand === 'forward',
    );
    expect(site?.tm).toBeCloseTo(meltingTemperature(exact), 6);
    // On the bottom strand too.
    const [back] = findAnnealingSites(TEXT, 'linear', reverseComplement(withCode(8, 'N'))).filter(
      (s) => s.strand === 'reverse',
    );
    expect(back?.tm).toBeCloseTo(meltingTemperature(reverseComplement(exact)), 6);
  });

  it('writes the code into the product, in place', () => {
    const template = SeqDocument.create({ name: 't', sequence: TEXT });
    const result = pcr(template, [
      { name: 'F', sequence: `GCNNK${exact}` },
      { name: 'R', sequence: reverseComplement(TEXT.slice(160, 182)) },
    ]);
    const product = result.products[0]?.document.sequence.toString() ?? '';
    expect(product.startsWith(`GCNNK${exact}`)).toBe(true);
    expect(product.length).toBe(5 + 182 - at);
  });

  it('amplifies an NNK codon library by mutagenesis and closes it', () => {
    const plasmid = SeqDocument.create({
      name: 'p',
      sequence: TEXT + randomDna(seededRandom(75), 1200),
      topology: 'circular',
    });
    const d = designMutagenesis(plasmid, { start: 120, end: 123 }, 'NNK', 'back-to-back');
    const result = pcr(plasmid, [
      { name: 'F', sequence: d.forward.sequence },
      { name: 'R', sequence: d.reverse.sequence },
    ]);
    expect(result.products).toHaveLength(1);
    const [whole] = digest(result.products[0]?.document ?? plasmid, []);
    if (whole === undefined) throw new Error('no fragment');
    const closed = ligate([whole], { name: 'c', circular: true }).sequence.toString().toUpperCase();
    const mutant = d.mutant.sequence.toString().toUpperCase();
    expect(closed.length).toBe(mutant.length);
    expect((closed + closed).includes(mutant)).toBe(true);
    expect(mutant.slice(120, 123)).toBe('NNK');
  });
});
