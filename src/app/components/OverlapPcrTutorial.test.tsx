// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { type SeqDocument, BUNDLED_ENZYME_SET, setActiveEnzymeSet } from '@/core';
import { parseGenBank } from '@/io/genbank/parseGenBank';

import { DEFAULT_BENCH } from '../state/benchSettings';
import { editorStore } from '../state/editorStore';
import { SoePanel } from './SoePanel';

/**
 * The words of docs/tutorials/overlap-pcr.md as the Overlap PCR panel prints
 * them, with the tutorial's own files open in the order the page names.
 */

const DIR = join(__dirname, '../../../docs/tutorials/files');
function tut(name: string): SeqDocument {
  const doc = parseGenBank(readFileSync(join(DIR, `${name}.gb`), 'utf8')).documents[0];
  if (doc === undefined) throw new Error(name);
  return doc;
}
function from(slot: number, name: string): void {
  const el = screen.getByLabelText<HTMLSelectElement>(`Fragment ${slot} from`);
  const option = [...el.options].find((o) => o.text === name);
  if (option === undefined) throw new Error(`no tab ${name}`);
  act(() => {
    fireEvent.change(el, { target: { value: option.value } });
  });
}
const texts = (label: string): (string | null)[] =>
  within(screen.getByLabelText(label))
    .getAllByRole('listitem')
    .map((li) => li.textContent);

function setUp(): void {
  act(() => {
    for (const n of ['OE-Tag', 'OE-Promoter', 'OE-Gene', 'OE-bad-Tag'])
      editorStore.openDocument(tut(n));
    editorStore.setCloningReaction('soe');
  });
  render(<SoePanel />);
  from(1, 'OE-Promoter');
  from(2, 'OE-Gene');
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: 'Add fragment' }));
  });
  from(3, 'OE-Tag');
  act(() => {
    fireEvent.change(screen.getByLabelText('Name of the fused product'), {
      target: { value: 'Promoter-Gene-Tag' },
    });
  });
}

describe('overlap-pcr.md as the Overlap PCR panel shows it', () => {
  beforeAll(() => {
    setActiveEnzymeSet(BUNDLED_ENZYME_SET);
  });
  afterEach(() => {
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
      editorStore.restoreBench(DEFAULT_BENCH);
    });
  });

  it('asks for a tab before anything is chosen, then offers the feature of each tab first', () => {
    act(() => {
      for (const n of ['OE-Tag', 'OE-Promoter', 'OE-Gene']) editorStore.openDocument(tut(n));
      editorStore.setCloningReaction('soe');
    });
    render(<SoePanel />);
    expect(screen.getByText(/Choose a tab, and the part of it to use/)).toBeTruthy();
    from(1, 'OE-Promoter');
    from(2, 'OE-Gene');
    expect(
      screen.getByLabelText<HTMLSelectElement>('Fragment 1 part').selectedOptions[0]?.text,
    ).toBe('synthetic promoter (promoter), 41–200, 160 bp');
    expect(
      screen.getByLabelText<HTMLSelectElement>('Fragment 2 part').selectedOptions[0]?.text,
    ).toBe('synthGene (CDS), 51–590, 540 bp');
  });

  it('the six primers, the two overlaps, the first round, the product', () => {
    setUp();
    expect(texts('Overlap-extension primers')).toEqual([
      'Promoter-Gene-Tag F124 nt, forward, outer at 60 °CctaccaaagccacggctagaaaggCopy',
      'Promoter-Gene-Tag R149 nt, reverse: 19 of the neighbour, 30 annealing at 57 °CCCTCCAAATGATCTATCATaggcttctaagataagtcaggttagttagtCopy',
      'Promoter-Gene-Tag F246 nt, forward: 19 of the neighbour, 27 annealing at 61 °CTGACTTATCTTAGAAGCCTatgatagatcatttggagggctgtggcCopy',
      'Promoter-Gene-Tag R237 nt, reverse: 10 of the neighbour, 27 annealing at 60 °CCGCTGCCCATgctgcaaaaggacgatggaaacttagaCopy',
      'Promoter-Gene-Tag F328 nt, forward: 10 of the neighbour, 18 annealing at 67 °CCTTTTGCAGCatgggcagcggcagcggcCopy',
      'Promoter-Gene-Tag R321 nt, reverse, outer at 61 °CttaagacctcgtcctcgcccgCopy',
    ]);
    expect(
      screen.getByText(
        'Upper case is the neighbour’s end the tail carries; the rest anneals to the fragment’s own template.',
      ),
    ).toBeTruthy();
    expect(texts('Overlaps')).toEqual([
      'Junction 1: 38 bp overlap, Tm 61 °C (TGACTTATCTTAGAAGCCTATGATAGATCATTTGGAGG)',
      'Junction 2: 20 bp overlap, Tm 61 °C (CTTTTGCAGCATGGGCAGCG)',
    ]);
    expect(screen.getByLabelText('First-round products').textContent).toBe(
      'First round: 179 bp, 569 bp, 79 bp. Fused: 769 bp.',
    );
    expect(screen.getByLabelText('Product').textContent).toBe(
      'Product: 769 bp, linear · synthetic promoter, synthGene, synthTag',
    );
    expect(screen.queryByLabelText('Assembly warnings')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save primers' })).toBeTruthy();
  });

  it('Overlap Tm 65 °C and 52 °C change the overlaps, not the product', () => {
    setUp();
    const tm = screen.getByDisplayValue('60 °C (default)');
    act(() => {
      fireEvent.change(tm, { target: { value: '65' } });
    });
    expect(texts('Overlaps').map((t) => t?.slice(0, 36))).toEqual([
      'Junction 1: 40 bp overlap, Tm 62 °C ',
      'Junction 2: 23 bp overlap, Tm 65 °C ',
    ]);
    expect(screen.getByLabelText('First-round products').textContent).toBe(
      'First round: 180 bp, 571 bp, 81 bp. Fused: 769 bp.',
    );
    act(() => {
      fireEvent.change(tm, { target: { value: '52' } });
    });
    expect(texts('Overlaps').map((t) => t?.slice(0, 36))).toEqual([
      'Junction 1: 28 bp overlap, Tm 52 °C ',
      'Junction 2: 18 bp overlap, Tm 57 °C ',
    ]);
    expect(screen.getByLabelText('First-round products').textContent).toBe(
      'First round: 174 bp, 563 bp, 78 bp. Fused: 769 bp.',
    );
    expect(screen.getByLabelText('Product').textContent).toContain('Product: 769 bp, linear');
  });

  it('Open product opens a 769 bp linear document with the name typed', () => {
    setUp();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Open product' }));
    });
    expect(editorStore.document?.name).toBe('Promoter-Gene-Tag');
    expect(editorStore.document?.length).toBe(769);
    expect(editorStore.document?.topology).toBe('linear');
  });

  it('the tag a base off: the panel still fuses, 770 bp, and warns', () => {
    setUp();
    from(3, 'OE-bad-Tag');
    expect(
      screen.getByText('The parts assemble, but the tube may also give something else:'),
    ).toBeTruthy();
    expect(texts('Assembly warnings')).toEqual([
      'synthGene runs into synthTag at junction 2 out of frame: the fusion shifts the reading frame of synthTag.',
    ]);
    expect(screen.getByLabelText('Product').textContent).toBe(
      'Product: 770 bp, linear · synthetic promoter, synthGene, synthTag',
    );
  });
});
