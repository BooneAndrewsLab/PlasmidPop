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
import { GibsonPanel } from './GibsonPanel';

/**
 * The words of docs/tutorials/gibson.md and in-fusion.md as the Gibson panel
 * prints them, with the tutorials' own files open.
 */

const DIR = join(__dirname, '../../../docs/tutorials/files');
function tut(name: string): SeqDocument {
  const doc = parseGenBank(readFileSync(join(DIR, `${name}.gb`), 'utf8')).documents[0];
  if (doc === undefined) throw new Error(name);
  return doc;
}
function open(docs: readonly SeqDocument[]): void {
  act(() => {
    for (const d of docs) editorStore.openDocument(d);
    editorStore.setCloningReaction('gibson');
  });
  render(<GibsonPanel />);
}
function choose(label: string, startsWith: string): void {
  const el = screen.getByLabelText<HTMLSelectElement>(label);
  const option = [...el.options].find((o) => o.text.startsWith(startsWith));
  if (option === undefined) throw new Error(`${label}: no ${startsWith}`);
  act(() => {
    fireEvent.change(el, { target: { value: option.value } });
  });
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

describe('gibson.md and in-fusion.md as the Gibson panel shows them', () => {
  beforeAll(() => {
    setActiveEnzymeSet(BUNDLED_ENZYME_SET);
  });
  afterEach(() => {
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
      editorStore.restoreBench(DEFAULT_BENCH);
    });
  });

  it('gibson: the tube, the order, the junctions, the product, Assemble', () => {
    open(['GB-Vector', 'GB-Insert2', 'GB-Insert1'].map(tut));
    const tube = within(screen.getByRole('list', { name: 'Documents in the Gibson' }));
    expect(tube.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'GB-Vector1,506 bp',
      'GB-Insert2449 bp',
      'GB-Insert1508 bp',
    ]);
    expect(screen.getByText('3 parts join into a 2,379 bp circle, in this order:')).toBeTruthy();
    const order = within(screen.getByRole('list', { name: 'Gibson assembly order' }));
    expect(order.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '1GB-Vector1,506 bp',
      '✓28 bp overlap, Tm 61 °C',
      '2GB-Insert1508 bp',
      '✓30 bp overlap, Tm 65 °C',
      '3GB-Insert2449 bp',
      '✓closes: 26 bp overlap, Tm 65 °C',
    ]);
    expect(screen.getByLabelText('Product').textContent).toBe(
      'Product: 2,379 bp, circular · synthetic terminator, KanR, ori, synthetic promoter, synthDomainA, linker, +1 more',
    );
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Assemble by Gibson' }));
    });
    expect(editorStore.document?.name).toBe('GB-Vector+GB-Insert1+GB-Insert2 assembly');
    expect(editorStore.document?.length).toBe(2379);
  });

  it('gibson: after Assemble the product tab is left out of the tube as circular', () => {
    open(['GB-Vector', 'GB-Insert1', 'GB-Insert2'].map(tut));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Assemble by Gibson' }));
    });
    expect(screen.getByText('1 document left out')).toBeTruthy();
    expect(
      screen.getByText(/GB-Vector\+GB-Insert1\+GB-Insert2 assembly/, { selector: '.gg__dropped *' })
        .textContent,
    ).toContain('GB-Vector+GB-Insert1+GB-Insert2 assembly');
  });

  it('gibson: the mismatched insert gives the panel’s own message', () => {
    open(['GB-Vector', 'GB-Insert1', 'GB-Insert2', 'GB-bad-Insert2'].map(tut));
    act(() => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'GB-Insert2' }));
    });
    expect(document.querySelector('.panel__error')?.textContent).toBe(
      'Nothing follows GB-Insert1: no other part starts with its last 15 bases or more. 1 of 3 parts were never reached.',
    );
    expect(screen.queryByRole('button', { name: 'Assemble by Gibson' })).toBeNull();
  });

  it('in-fusion: the design lines, the product, the two notes', () => {
    const vector = tut('pIF-Vector');
    open([vector, ecoRvFragment(vector), tut('IF-gene')]);
    // The raw tabs are not a Gibson: the panel above says so and leaves the circle out.
    expect(document.querySelector('.panel__error')?.textContent).toBe(
      'Nothing follows pIF-Vector EcoRV fragment: no other part starts with its last 15 bases or more. 1 of 2 parts were never reached.',
    );
    expect(screen.getByText('1 document left out')).toBeTruthy();
    choose('Linearised vector', 'pIF-Vector EcoRV');
    choose('Insert from', 'IF-gene');
    expect(screen.getByLabelText<HTMLSelectElement>('Insert').selectedOptions[0]?.text).toBe(
      'synthProt (CDS), 1–603, 603 bp',
    );
    const lines = within(screen.getByRole('list', { name: 'Insert primers' })).getAllByRole(
      'listitem',
    );
    expect(lines.map((l) => l.textContent)).toEqual([
      'Forward37 nt: 15 of vector, 22 annealing at 60 °CATGACAGCGGCTGATatgtgtagcgagcgtatgcgttCopy',
      'Reverse40 nt: 15 of vector, 25 annealing at 60 °CGGGCCCCTTGCGGATttatggctgccaactgtatacgcacCopy',
    ]);
    expect(
      screen.getByText('Upper case is the vector’s end; the rest anneals to the template.'),
    ).toBeTruthy();
    const product = screen.getAllByLabelText('Product').at(-1);
    expect(product?.textContent).toBe(
      'Product: 2,049 bp, circular · KanR, ori, synthetic promoter, synthetic terminator, synthProt',
    );
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'NEBuilder HiFi' }));
    });
    expect(
      within(screen.getByRole('list', { name: 'Insert primers' }))
        .getAllByRole('listitem')
        .map((l) => l.textContent.slice(0, 40)),
    ).toEqual([
      'Forward42 nt: 20 of vector, 22 annealing',
      'Reverse45 nt: 20 of vector, 25 annealing',
    ]);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Open product' }));
    });
    expect(editorStore.document?.name).toBe(
      'pIF-Vector EcoRV fragment+IF-gene PCR product assembly',
    );
    expect(editorStore.document?.length).toBe(2049);
  });
});
