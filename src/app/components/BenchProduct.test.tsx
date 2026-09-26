// @vitest-environment jsdom
import { fireEvent, render, within } from '@testing-library/react';

import {
  type DigestFragment,
  SeqDocument,
  digest,
  documentFromFragment,
  findCutSites,
  getEnzyme,
  ligate,
} from '@/core';

import { BenchProduct } from './BenchProduct';
import { BenchProductSlot } from './benchProductSlot';
import { type Ingredient } from './tube';

/** Bases from a fixed seed, with no EcoRI site of their own. */
function bases(n: number, seed: number): string {
  let x = seed;
  let out = '';
  while (out.length < n) {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    out += 'ACGT'[(x >>> 16) % 4] ?? 'A';
  }
  return out.replaceAll('GAATTC', 'GAATTA');
}

function cutWithEcoRI(doc: SeqDocument): DigestFragment[] {
  const enzyme = getEnzyme('EcoRI');
  if (enzyme === undefined) throw new Error('no EcoRI');
  return digest(doc, findCutSites(doc.sequence.toString(), doc.topology, [enzyme]));
}

// A 3 kb vector opened at its one EcoRI site, and an 800 bp EcoRI insert.
const [backbone] = cutWithEcoRI(
  SeqDocument.create({
    name: 'pVec',
    topology: 'circular',
    sequence: `${bases(1500, 1)}GAATTC${bases(1494, 2)}`,
  }),
);
const insert = cutWithEcoRI(
  SeqDocument.create({ name: 'ins', sequence: `CCGAATTC${bases(800, 3)}GAATTCGG` }),
)[1];
if (backbone === undefined || insert === undefined) throw new Error('no fragments');
const product = ligate([backbone, insert], { name: 'pVec-ins', circular: true });

const part = (id: string, fragment: DigestFragment): Ingredient => ({
  id,
  document: documentFromFragment(fragment),
  detail: '',
  fragment,
});

function renderBench(parts: readonly Ingredient[]) {
  const slot = document.createElement('div');
  document.body.append(slot);
  render(
    <BenchProductSlot.Provider value={slot}>
      <BenchProduct product={product} parts={parts} />
    </BenchProductSlot.Provider>,
  );
  return within(slot);
}

describe('BenchProduct check digest against the empty vector (#78)', () => {
  it('ranks by how well the product and the self-closed vector differ, and draws both', () => {
    const column = renderBench([part('v', backbone), part('i', insert)]);
    const against = column.getByRole('combobox', { name: 'Vector to check against' });
    // The longest part is taken for the vector.
    expect((against as HTMLSelectElement).value).toBe('v');
    const options = within(column.getByRole('combobox', { name: 'Check digest enzyme' }))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options[0]).toMatch(/; empty .* \(tells apart best\)$/);
    expect(column.getByRole('figure')).toHaveTextContent('Empty');
    // An enzyme that cuts only the insert leaves the empty vector uncut,
    // which is not drawn as a lane.
    const uncut = options.find((o) => o.includes('empty uncut'));
    if (uncut === undefined) throw new Error('no enzyme cuts only the insert');
    fireEvent.change(column.getByRole('combobox', { name: 'Check digest enzyme' }), {
      target: { value: uncut.split(':')[0] },
    });
    expect(column.getByText(/runs as supercoiled DNA/)).toBeInTheDocument();
    expect(column.getByRole('figure')).not.toHaveTextContent('Empty');
  });

  it('checks the product alone when the vector cannot close on itself', () => {
    const column = renderBench([
      part('v', { ...backbone, dephosphorylated: true }),
      part('i', insert),
    ]);
    expect(column.getByText(/cannot close on itself/)).toBeInTheDocument();
    const first = within(
      column.getByRole('combobox', { name: 'Check digest enzyme' }),
    ).getAllByRole('option')[0];
    expect(first?.textContent).toMatch(/\(clearest\)$/);
  });

  it('offers no choice of vector with one part', () => {
    const column = renderBench([part('v', backbone)]);
    expect(column.queryByRole('combobox', { name: 'Vector to check against' })).toBeNull();
  });
});
