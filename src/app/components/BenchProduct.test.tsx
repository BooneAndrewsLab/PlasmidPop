// @vitest-environment jsdom
import { fireEvent, render, within } from '@testing-library/react';

import {
  type DigestFragment,
  SeqDocument,
  type WrongClone,
  digest,
  documentFromFragment,
  findCutSites,
  getEnzyme,
  ligate,
  ligationWrongClones,
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

function def<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('missing');
  return value;
}

const part = (id: string, fragment: DigestFragment): Ingredient => ({
  id,
  document: documentFromFragment(fragment),
  detail: '',
  fragment,
});

function renderBench(
  parts: readonly Ingredient[],
  onCheckPrimers?: () => void,
  wrongClonesOf?: (vector: Ingredient) => readonly WrongClone[],
) {
  const slot = document.createElement('div');
  document.body.append(slot);
  render(
    <BenchProductSlot.Provider value={slot}>
      <BenchProduct
        product={product}
        parts={parts}
        onCheckPrimers={onCheckPrimers}
        wrongClonesOf={wrongClonesOf}
      />
    </BenchProductSlot.Provider>,
  );
  return within(slot);
}

/** The legend's entry for the lane labelled `label`. */
function legendItem(legend: HTMLElement, label: string): HTMLElement {
  return def(
    within(legend)
      .getAllByRole('listitem')
      .find((li) => li.textContent.startsWith(`${label} `)),
  );
}

/** The ligation's own wrong clones for `parts`, as the Ligation panel hands them over (item 132). */
const ligationWrong =
  (parts: readonly Ingredient[]) =>
  (vector: Ingredient): readonly WrongClone[] => {
    const fragments = parts.map((p) => def(p.fragment));
    return ligationWrongClones(fragments, fragments.indexOf(def(vector.fragment)), product);
  };

describe('BenchProduct check digest against the empty vector (#78)', () => {
  it('ranks by how well the product and the self-closed vector differ, and draws both', () => {
    const column = renderBench([part('v', backbone), part('i', insert)]);
    const against = column.getByRole('combobox', { name: 'Vector to check against' });
    // The longest part is taken for the vector.
    expect((against as HTMLSelectElement).value).toBe('v');
    const options = within(column.getByRole('combobox', { name: 'Check digest enzyme' }))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options[0]).toMatch(/ \(tells all apart\)$/);
    expect(column.getByRole('figure')).toHaveTextContent('Empty');
    // An enzyme that cuts only the insert leaves the empty vector uncut,
    // which is not drawn as a lane, and so cannot tell it apart.
    const legend = column.getByRole('list', { name: 'What a wrong colony gives' });
    const sites = (name: string): number => {
      const enzyme = getEnzyme(name);
      if (enzyme === undefined) throw new Error(`no ${name}`);
      return findCutSites(backbone.sequence, 'linear', [enzyme]).length;
    };
    const uncut = options.find((o) => sites(def(o.split(':')[0])) === 0 && o.includes('empty'));
    if (uncut === undefined) throw new Error('no enzyme cuts only the insert');
    fireEvent.change(column.getByRole('combobox', { name: 'Check digest enzyme' }), {
      target: { value: uncut.split(':')[0] },
    });
    expect(legendItem(legend, 'Empty')).toHaveTextContent(/Uncut, so it runs supercoiled/);
    expect(column.getByRole('figure')).not.toHaveTextContent('Empty');
  });

  it('checks the product alone when the vector cannot close on itself and nothing else can go wrong', () => {
    // A dephosphorylated vector with the default (one-pot) list of wrong
    // clones: the empty vector alone, which there is none of.
    const column = renderBench([
      part('v', { ...backbone, dephosphorylated: true }),
      part('i', insert),
    ]);
    expect(column.getByText(/cannot close on itself/)).toBeInTheDocument();
    expect(column.getByText(/checked alone/)).toBeInTheDocument();
    const first = within(
      column.getByRole('combobox', { name: 'Check digest enzyme' }),
    ).getAllByRole('option')[0];
    expect(first?.textContent).toMatch(/\(clearest\)$/);
    expect(column.queryByRole('list', { name: 'What a wrong colony gives' })).toBeNull();
  });

  it('draws a ligation’s wrong clones as lanes, four at most, and names the rest (item 132)', () => {
    const parts = [part('v', backbone), part('i', insert)];
    const column = renderBench(parts, undefined, ligationWrong(parts));
    // A one-enzyme ligation can go wrong in every way; the gel shows the
    // four most common and the note names the two inverted doubles.
    const legend = column.getByRole('list', { name: 'What a wrong colony gives' });
    const items = within(legend)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items.map((t) => t.split(' ')[0])).toEqual(['Empty', 'Reverse', 'Tandem', 'Dimer']);
    expect(column.getByText(/Also possible, not drawn/)).toHaveTextContent(
      'two inserts, head to head; two inserts, tail to tail',
    );
    // The best enzyme tells all four apart, and each lane that is cut is drawn.
    const picker = column.getByRole('combobox', { name: 'Check digest enzyme' });
    const options = within(picker)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options[0]).toMatch(/ \(tells all apart\)$/);
    const figure = column.getByRole('figure');
    for (const lane of ['Empty', 'Reverse', 'Tandem', 'Dimer']) {
      expect(figure).toHaveTextContent(lane);
    }
    // An enzyme that cuts the vector once and the insert not at all gives
    // the reversed clone the product's one band: the option and the legend
    // both say so.
    const vectorOnly = options.find((o) => /^[^:]+: [\d,]+ bp; same as reverse/.test(o));
    if (vectorOnly === undefined) throw new Error('no enzyme cuts the vector alone');
    fireEvent.change(picker, { target: { value: vectorOnly.split(':')[0] } });
    expect(legendItem(legend, 'Reverse')).toHaveTextContent('Same as the product.');
  });

  it('a dephosphorylated vector: no empty lane and no dimer, but the insert can still go in twice or turned', () => {
    const parts = [part('v', { ...backbone, dephosphorylated: true }), part('i', insert)];
    const column = renderBench(parts, undefined, ligationWrong(parts));
    expect(column.getByText(/cannot close on itself/)).not.toHaveTextContent(/checked alone/);
    const items = within(column.getByRole('list', { name: 'What a wrong colony gives' }))
      .getAllByRole('listitem')
      .map((li) => li.textContent.split(' ')[0]);
    expect(items).toEqual(['Reverse', 'Tandem', 'H-to-H', 'T-to-T']);
    expect(column.queryByText(/Also possible/)).toBeNull();
  });

  it('offers the clone check only where the panel can assemble (item 120)', () => {
    let checked = 0;
    const column = renderBench([part('v', backbone), part('i', insert)], () => {
      checked++;
    });
    fireEvent.click(column.getByRole('button', { name: 'Design check primers…' }));
    expect(checked).toBe(1);
    const without = renderBench([part('v', backbone), part('i', insert)]);
    expect(without.queryByRole('button', { name: 'Design check primers…' })).toBeNull();
  });

  it('offers no choice of vector with one part', () => {
    const column = renderBench([part('v', backbone)]);
    expect(column.queryByRole('combobox', { name: 'Vector to check against' })).toBeNull();
  });
});
