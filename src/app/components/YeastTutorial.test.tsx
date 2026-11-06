// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, render, screen, within } from '@testing-library/react';

import {
  type SeqDocument,
  BUNDLED_ENZYME_SET,
  cuttableSites,
  digest,
  documentFromFragment,
  findCutSites,
  getEnzyme,
  setActiveEnzymeSet,
} from '@/core';
import { parseGenBank } from '@/io/genbank/parseGenBank';

import { DEFAULT_BENCH } from '../state/benchSettings';
import { editorStore } from '../state/editorStore';
import { primerCollection } from '../state/primerCollection';
import { Bench } from './Bench';

/**
 * The words of docs/tutorials/yeast-assembly.md as the Bench's Yeast assembly
 * panel prints them, with the tutorial's own files open, in the page's order.
 */

const DIR = join(__dirname, '../../../docs/tutorials/files');
function tut(name: string): SeqDocument {
  const doc = parseGenBank(readFileSync(join(DIR, `${name}.gb`), 'utf8')).documents[0];
  if (doc === undefined) throw new Error(name);
  return doc;
}
/** The Cloning tab's EcoRV digest and Open. */
function ecoRvFragment(vector: SeqDocument): SeqDocument {
  const enzyme = getEnzyme('EcoRV');
  const text = vector.sequence.toString();
  if (enzyme === undefined) throw new Error('no EcoRV');
  const [fragment] = digest(
    vector,
    cuttableSites(
      text,
      vector.topology,
      vector.methylation,
      findCutSites(text, vector.topology, [enzyme]),
      (x) => getEnzyme(x)?.site.length ?? 0,
    ),
  );
  if (fragment === undefined) throw new Error('no fragment');
  return documentFromFragment(fragment);
}
function open(...docs: readonly SeqDocument[]): void {
  act(() => {
    for (const d of docs) editorStore.openDocument(d);
  });
}
function choose(label: string, startsWith: string): void {
  const el = screen.getByLabelText<HTMLSelectElement>(label);
  const option = [...el.options].find((o) => o.text.startsWith(startsWith));
  if (option === undefined) throw new Error(`${label}: no ${startsWith}`);
  act(() => {
    fireEvent.change(el, { target: { value: option.value } });
  });
}
function tick(name: string): void {
  act(() => {
    fireEvent.click(screen.getByRole('checkbox', { name }));
  });
}
/** The Bench's reaction picker button. */
const reactionButton = (): HTMLElement =>
  within(screen.getByRole('group', { name: 'Reaction' })).getByRole('button', {
    name: 'Yeast assembly',
  });
const text = (el: Element | null | undefined): string | undefined => el?.textContent;
const order = (): string[] =>
  within(screen.getByRole('list', { name: 'Yeast assembly order' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent);
const warnings = (): string[] =>
  screen.queryByRole('list', { name: 'Assembly warnings' }) === null
    ? []
    : within(screen.getByRole('list', { name: 'Assembly warnings' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent);
const product = (): string | undefined => text(screen.getAllByLabelText('Product')[0]);
const overlap = (): HTMLInputElement => screen.getByRole('spinbutton', { name: /Overlap/ });

describe('yeast-assembly.md as the Bench shows it', () => {
  beforeAll(async () => {
    setActiveEnzymeSet(BUNDLED_ENZYME_SET);
    await primerCollection.load();
  });
  afterEach(() => {
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
      editorStore.clearShelf();
      editorStore.restoreBench(DEFAULT_BENCH);
    });
  });

  it('the five exercises in order', async () => {
    const circle = tut('YA-Vector');
    const fragment = ecoRvFragment(circle);

    // Exercise 1, steps 1 to 9: the vector, its fragment, insert 2 and then insert 1.
    open(circle, fragment, tut('YA-Insert2'), tut('YA-Insert1'));
    act(() => {
      editorStore.setCloningReaction('gibson');
    });
    render(<Bench />);
    act(() => {
      fireEvent.click(reactionButton());
    });
    const heading = screen.getByRole('heading', { name: /^Yeast assembly/ });
    expect(heading.textContent).toBe('Yeast assemblyin vivo, by homology');
    expect(reactionButton().getAttribute('aria-pressed')).toBe('true');
    const tube = within(screen.getByRole('list', { name: 'Documents in the yeast assembly' }));
    expect(tube.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'YA-Vector2,217 bp',
      'YA-Vector EcoRV fragment2,217 bp',
      'YA-Insert2460 bp',
      'YA-Insert1240 bp',
    ]);
    expect(screen.getByText('1 document left out')).toBeTruthy();
    // The default, before a vector is chosen: the order, no (vector) mark.
    expect(screen.getByLabelText<HTMLSelectElement>('Vector').selectedOptions[0]?.text).toBe(
      'none (all parts are inserts)',
    );
    choose('Vector', 'YA-Vector EcoRV');
    expect(overlap().value).toBe('40');
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Circular product' }).checked,
    ).toBe(true);
    expect(screen.getByText('3 parts join into a 2,797 bp circle, in this order:')).toBeTruthy();
    expect(order()).toEqual([
      '1YA-Vector EcoRV fragment (vector)2,217 bp',
      '✓40 bp overlap, 50% GC',
      '2YA-Insert1240 bp',
      '✓40 bp overlap, 55% GC',
      '3YA-Insert2460 bp',
      '✓closes: 40 bp overlap, 53% GC',
    ]);
    const rows = within(screen.getByRole('list', { name: 'Yeast assembly order' })).getAllByRole(
      'listitem',
    );
    expect(rows[1]?.getAttribute('data-tip')).toMatch(/^Shared: [ACGT]{40}$/);
    expect(product()).toBe(
      'Product: 2,797 bp, circular · URA3, CEN6, ARSH4, AmpR, ori, synthetic promoter, +5 more',
    );
    expect(warnings()).toEqual([]);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Assemble in yeast' }));
    });
    expect(editorStore.document?.name).toBe(
      'YA-Vector EcoRV fragment+YA-Insert1+YA-Insert2 assembly',
    );
    expect(editorStore.document?.length).toBe(2797);
    expect(editorStore.getState().sidebarTab).toBe('features');
    expect(
      [...(editorStore.document?.features ?? [])]
        .filter((f) => f.name.startsWith('homology'))
        .map((f) => f.name),
    ).toEqual(['homology 1', 'homology 2', 'homology 3']);
    // Close the assembly tab (step 1 of exercise 2).
    act(() => {
      editorStore.closeDocument();
    });

    // Exercise 2: the repeat file replaces insert 2; the Vector setting is kept.
    open(tut('YA-repeat-Insert2'));
    tick('YA-Insert2');
    expect(tube.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'YA-Vector2,217 bp',
      'YA-Vector EcoRV fragment2,217 bp',
      'YA-Insert2460 bp',
      'YA-Insert1240 bp',
      'YA-repeat-Insert2460 bp',
    ]);
    expect(screen.getByText('3 parts join into a 2,797 bp circle, in this order:')).toBeTruthy();
    expect(product()).toMatch(/^Product: 2,797 bp, circular/);
    expect(
      screen.getByText('The parts assemble, but the tube may also give something else:'),
    ).toBeTruthy();
    expect(warnings()).toEqual([
      'The homology joining YA-Insert1 to YA-repeat-Insert2 also occurs in YA-repeat-Insert2 at 361, where the cell could recombine instead and give a different construct.',
    ]);
    expect(screen.getByRole('button', { name: 'Assemble in yeast' })).toBeTruthy();
    tick('YA-repeat-Insert2');
    tick('YA-Insert2');
    expect(warnings()).toEqual([]);

    // Exercise 3: the short file at 40 bp, then at 25.
    open(tut('YA-short-Insert2'));
    tick('YA-Insert2');
    expect(document.querySelector('.panel__error')?.textContent).toBe(
      'Nothing follows YA-Insert1: no other part starts with its last 40 bases or more. 1 of 3 parts were never reached.',
    );
    expect(screen.queryByRole('button', { name: 'Assemble in yeast' })).toBeNull();
    expect(screen.queryByLabelText('Product')).toBeNull();
    act(() => {
      fireEvent.change(overlap(), { target: { value: '25' } });
    });
    expect(screen.getByText('3 parts join into a 2,797 bp circle, in this order:')).toBeTruthy();
    expect(order()).toEqual([
      '1YA-Vector EcoRV fragment (vector)2,217 bp',
      '✓40 bp overlap, 50% GC',
      '2YA-Insert1240 bp',
      '!25 bp overlap, 56% GC',
      '3YA-short-Insert2445 bp',
      '✓closes: 40 bp overlap, 53% GC',
    ]);
    expect(warnings()).toEqual([
      'Recombination falls off sharply below 30 bp of homology: homology 2 (YA-Insert1 to YA-short-Insert2), 25 bp.',
    ]);
    act(() => {
      fireEvent.change(overlap(), { target: { value: '40' } });
    });
    tick('YA-short-Insert2');
    tick('YA-Insert2');
    expect(screen.getByText('3 parts join into a 2,797 bp circle, in this order:')).toBeTruthy();

    // Exercise 4: leave the vector out, then untick Circular product.
    tick('YA-Vector EcoRV fragment');
    expect(screen.getByLabelText<HTMLSelectElement>('Vector').selectedOptions[0]?.text).toBe(
      'none (all parts are inserts)',
    );
    expect(document.querySelector('.panel__error')?.textContent).toBe(
      'Nothing follows YA-Insert2: no other part starts with its last 40 bases or more. 1 of 2 parts were never reached.',
    );
    tick('Circular product');
    expect(screen.getByText('2 parts join into a 660 bp molecule, in this order:')).toBeTruthy();
    expect(product()).toBe(
      'Product: 660 bp, linear · synthetic promoter, synthGene, synthetic terminator, homology 1',
    );
    expect(warnings()).toEqual([
      'The product is linear. A linear molecule with no telomere is lost from yeast; assemble it as a circle.',
      'No yeast selectable marker (URA3, LEU2, HIS3, TRP1, MET15, LYS2, ADE2, KanMX) is annotated on the product, so nothing selects the assembly.',
      'No ARS, CEN or 2-micron feature is annotated on the product, so it will not replicate in yeast.',
    ]);
    tick('YA-Vector EcoRV fragment');
    tick('Circular product');

    // Exercise 5: the gene, the designer, the two primers, Save primers, Open product.
    open(tut('YA-gene'));
    // The assembly above the designer sees a tab that shares no ends with the rest.
    expect(document.querySelector('.panel__error')?.textContent).toBe(
      'Nothing follows YA-Insert2: no other part starts with its last 40 bases or more. 1 of 4 parts were never reached.',
    );
    expect(screen.getByText('1 document left out')).toBeTruthy();
    expect(screen.getByText('Design insert primers (Yeast assembly)')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Kit' })).toBeNull();
    choose('Linearised vector', 'YA-Vector EcoRV');
    choose('Insert from', 'YA-gene');
    expect(screen.getByLabelText<HTMLSelectElement>('Insert').selectedOptions[0]?.text).toBe(
      'synthProt (CDS), 1–450, 450 bp',
    );
    expect(
      within(screen.getByRole('list', { name: 'Insert primers' }))
        .getAllByRole('listitem')
        .map((l) => l.textContent),
    ).toEqual([
      'Forward69 nt: 40 of vector, 29 annealing at 60 °CTGAAGCATTCGCCTGCCTCTCTAACTGTTGCTAGACCGATatgagcttcgatgtgtatacctacttcggCopy',
      'Reverse64 nt: 40 of vector, 24 annealing at 60 °CTGGACTTCCACAGGGCTCTCGACGGAATAAGAGAACCGATttagttcttcgcagcccttgttccCopy',
    ]);
    const products = screen.getAllByLabelText('Product');
    expect(text(products.at(-1))).toMatch(/^Product: 2,667 bp, circular/);
    expect(warnings().at(-1)).toBe(
      'Yeast assembly asks for 40 bases of homology, which both tails carry.',
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save primers' }));
      await Promise.resolve();
    });
    expect(await screen.findByText('Saved 2 primers to My primers.')).toBeTruthy();
    expect(primerCollection.getState().primers.map((p) => p.name)).toEqual(
      expect.arrayContaining(['YA-gene-YA-F', 'YA-gene-YA-R']),
    );
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Open product' }));
    });
    expect(editorStore.document?.name).toBe(
      'YA-Vector EcoRV fragment+YA-gene PCR product assembly',
    );
    expect(editorStore.document?.length).toBe(2667);
  });
});
