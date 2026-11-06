// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { act, fireEvent, render, screen, within } from '@testing-library/react';

import {
  BLUNT_END,
  SeqDocument,
  createFeature,
  describeLineage,
  lineageOf,
  rangeSegment,
} from '@/core';
import { getRepository } from '@/storage';

import { analytics } from '../analytics';
import { DEFAULT_BENCH, normalizeBenchSettings } from '../state/benchSettings';
import { editorStore } from '../state/editorStore';
import { primerCollection } from '../state/primerCollection';
import { YeastAssemblyPanel } from './YeastAssemblyPanel';

function filler(length: number, seed: number): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

// Two 40 bp homologies, one at each junction of a vector and one insert; the
// bodies are unrelated filler so no other repeat comes into it.
const A = filler(40, 101);
const B = filler(40, 202);
const vectorBody = filler(300, 303);
const insertBody = filler(200, 404);

const at = (start: number, end: number, type: string, name: string) =>
  createFeature({ type, name, segments: [rangeSegment(start, end)] });

/** A vector with what yeast needs of one: a marker, a centromere, an E. coli origin and resistance. */
const vector = SeqDocument.create({
  name: 'pVec',
  topology: 'linear',
  sequence: A + vectorBody + B,
  features: [
    at(60, 100, 'CDS', 'URA3'),
    at(110, 150, 'centromere', 'CEN6'),
    at(160, 200, 'rep_origin', 'ori'),
    at(210, 250, 'CDS', 'AmpR'),
  ],
});
const insert = SeqDocument.create({
  name: 'gene',
  topology: 'linear',
  sequence: B + insertBody + A,
});

function open(...docs: readonly SeqDocument[]): readonly string[] {
  act(() => {
    for (const d of docs) editorStore.openDocument(d);
  });
  return editorStore.getState().documents.map((d) => d.documentId);
}

const order = (): readonly (string | null)[] =>
  within(screen.getByRole('list', { name: 'Yeast assembly order' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent);

const overlapField = (): HTMLInputElement => screen.getByRole('spinbutton', { name: /Overlap/ });

describe('YeastAssemblyPanel', () => {
  beforeEach(async () => {
    await primerCollection.load();
    await primerCollection.remove(primerCollection.getState().primers.map((p) => p.id));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
      editorStore.clearShelf();
      editorStore.restoreBench(DEFAULT_BENCH);
    });
  });

  it('asks for the parts when none are open', () => {
    render(<YeastAssemblyPanel />);
    expect(screen.getByText(/Open the linearised vector and the inserts/)).toBeInTheDocument();
  });

  it('lists the junctions by bp and GC, never by Tm', () => {
    open(vector, insert);
    render(<YeastAssemblyPanel />);
    const rows = order();
    expect(rows).toEqual([
      '1pVec380 bp',
      expect.stringMatching(/^✓40 bp overlap, \d+% GC$/),
      '2gene280 bp',
      expect.stringMatching(/^✓closes: 40 bp overlap, \d+% GC$/),
    ]);
    expect(screen.queryByText(/Tm/)).toBeNull();
    expect(screen.getByText(/2 parts join into a 580 bp circle/)).toBeInTheDocument();
    // The shared bases are the tooltip, as in the Gibson panel.
    const first = within(screen.getByRole('list', { name: 'Yeast assembly order' })).getAllByRole(
      'listitem',
    )[1];
    expect(first).toHaveAttribute('data-tip', `Shared: ${B.toUpperCase()}`);
  });

  it('names the vector from a select of the parts in the tube', () => {
    const ids = open(vector, insert);
    render(<YeastAssemblyPanel />);
    const select = screen.getByRole('combobox', { name: /Vector/ });
    expect(select).toHaveValue('');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['none (all parts are inserts)', 'pVec', 'gene']);
    // None named: every part is an insert, which is plain TAR.
    expect(order().join()).not.toContain('(vector)');

    fireEvent.change(select, { target: { value: ids[0] } });
    expect(editorStore.getState().bench.yeast.vectorId).toBe(ids[0]);
    expect(order()[0]).toBe('1pVec (vector)380 bp');
    expect(order()[2]).toBe('2gene280 bp');

    // A vector ticked out of the tube is no vector any more.
    fireEvent.click(
      within(screen.getByRole('list', { name: 'Documents in the yeast assembly' })).getByRole(
        'checkbox',
        { name: 'pVec' },
      ),
    );
    expect(select).toHaveValue('');
    expect(within(select).queryByRole('option', { name: 'pVec' })).toBeNull();
  });

  it('holds the overlap to 20-80 bp, starting at 40', () => {
    open(vector, insert);
    render(<YeastAssemblyPanel />);
    const field = overlapField();
    expect(field).toHaveValue(40);
    expect(field).toHaveAttribute('min', '20');
    expect(field).toHaveAttribute('max', '80');

    fireEvent.change(field, { target: { value: '200' } });
    fireEvent.blur(field);
    expect(editorStore.getState().bench.yeast.minOverlap).toBe(80);
    expect(field).toHaveValue(80);

    fireEvent.change(field, { target: { value: '5' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(editorStore.getState().bench.yeast.minOverlap).toBe(20);
    expect(field).toHaveValue(20);

    // Something that is not a number puts back what was there.
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.blur(field);
    expect(field).toHaveValue(20);

    // A value in range is taken as it is typed, so 25 can be typed through the 2.
    fireEvent.change(field, { target: { value: '2' } });
    expect(editorStore.getState().bench.yeast.minOverlap).toBe(20);
    fireEvent.change(field, { target: { value: '25' } });
    expect(editorStore.getState().bench.yeast.minOverlap).toBe(25);
  });

  it('refuses junctions that are shorter than the overlap asked for', () => {
    open(vector, insert);
    render(<YeastAssemblyPanel />);
    fireEvent.change(overlapField(), { target: { value: '60' } });
    expect(screen.queryByRole('list', { name: 'Yeast assembly order' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assemble in yeast' })).toBeNull();
    expect(document.querySelector('.panel__error')?.textContent).not.toBe('');
  });

  it('says nothing is wrong with a design that has what yeast needs', () => {
    open(vector, insert);
    render(<YeastAssemblyPanel />);
    expect(screen.queryByRole('list', { name: 'Assembly warnings' })).toBeNull();
  });

  it('warns that nothing selects or keeps a product with no marker or origin', () => {
    const bare = SeqDocument.create({
      name: 'pBare',
      topology: 'linear',
      sequence: A + vectorBody + B,
    });
    open(bare, insert);
    render(<YeastAssemblyPanel />);
    const warnings = within(screen.getByRole('list', { name: 'Assembly warnings' }));
    expect(warnings.getByText(/No yeast selectable marker/)).toBeInTheDocument();
    expect(warnings.getByText(/No ARS, CEN or 2-micron feature/)).toBeInTheDocument();
    expect(warnings.getAllByText(/Detect features on the product first/)).toHaveLength(2);
  });

  it('warns when a junction’s homology also lies in the vector', () => {
    const repeating = SeqDocument.create({
      name: 'pRep',
      topology: 'linear',
      sequence: A + vectorBody.slice(0, 100) + B + vectorBody.slice(100) + B,
      features: vector.features,
    });
    const ids = open(repeating, insert);
    render(<YeastAssemblyPanel />);
    fireEvent.change(screen.getByRole('combobox', { name: /Vector/ }), {
      target: { value: ids[0] },
    });
    const warnings = within(screen.getByRole('list', { name: 'Assembly warnings' }));
    expect(
      warnings.getByText(/also occurs in the vector pRep at \d+.*recombine instead/),
    ).toBeInTheDocument();
  });

  it('warns about a short junction and marks its row', () => {
    const short = 25;
    const vec = SeqDocument.create({
      name: 'pShort',
      topology: 'linear',
      sequence: A.slice(0, short) + vectorBody + B.slice(0, short),
      features: vector.features,
    });
    const ins = SeqDocument.create({
      name: 'geneShort',
      topology: 'linear',
      sequence: B.slice(0, short) + insertBody + A.slice(0, short),
    });
    open(vec, ins);
    render(<YeastAssemblyPanel />);
    fireEvent.change(overlapField(), { target: { value: '20' } });
    expect(screen.getByText(/Recombination falls off sharply below 30 bp/)).toBeInTheDocument();
    const rows = within(screen.getByRole('list', { name: 'Yeast assembly order' })).getAllByRole(
      'listitem',
    );
    expect(rows[1]).toHaveClass('junction--weak');
    expect(rows[1]).toHaveTextContent('25 bp overlap');
  });

  it('says plainly that a linear product is lost, when Circular product is off', () => {
    open(vector, insert);
    render(<YeastAssemblyPanel />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Circular product' }));
    expect(editorStore.getState().bench.yeast.circular).toBe(false);
    expect(screen.getByText(/The product is linear\. A linear molecule/)).toBeInTheDocument();
    expect(screen.getByText(/into a 620 bp molecule/)).toBeInTheDocument();
  });

  it('opens the product with its homology marked and how it was made recorded', () => {
    const track = vi.spyOn(analytics, 'track');
    const ids = open(vector, insert);
    render(<YeastAssemblyPanel />);
    fireEvent.change(screen.getByRole('combobox', { name: /Vector/ }), {
      target: { value: ids[0] },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name of the yeast assembly product' }), {
      target: { value: 'pYeast' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Assemble in yeast' }));

    const product = editorStore.document;
    expect(product?.name).toBe('pYeast');
    expect(product?.isCircular).toBe(true);
    // Seamless: each shared stretch is in the product once.
    expect(product?.sequence.toString()).toBe(A + vectorBody + B + insertBody);
    expect(
      product?.features
        .all()
        .filter((f) => /^homology \d+$/.test(f.name))
        .map((f) => f.name),
    ).toEqual(['homology 1', 'homology 2']);
    expect(product == null ? '' : describeLineage(lineageOf(product))).toMatch(
      /Assembled in yeast by homologous recombination of 2 parts/,
    );
    expect(track).toHaveBeenCalledWith('cloning', 'yeast');
    // The name field is cleared for the next product.
    expect(editorStore.getState().bench.yeast.name).toBe('');
  });

  it('takes a part off the shelf as well as an open document', () => {
    open(vector);
    act(() => {
      editorStore.addToShelf({
        sequence: insert.sequence.toString(),
        features: [],
        range: { start: 0, end: insert.length },
        left: BLUNT_END,
        right: BLUNT_END,
        source: 'gene cassette',
      });
    });
    render(<YeastAssemblyPanel />);
    const tube = screen.getByRole('list', { name: 'Documents in the yeast assembly' });
    expect(within(tube).getByRole('checkbox', { name: 'gene cassette fragment' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Assemble in yeast' }));
    expect(editorStore.document?.sequence.toString()).toBe(A + vectorBody + B + insertBody);
  });

  describe('the tail primers', () => {
    const vec = SeqDocument.create({
      name: 'pCut',
      topology: 'linear',
      sequence: filler(2000, 31),
    });
    const template = SeqDocument.create({
      name: 'YA-gene',
      topology: 'linear',
      sequence: filler(1500, 77),
    });

    function design(): void {
      open(vec, template);
      render(<YeastAssemblyPanel />);
      const designer = screen.getByText('Design insert primers (Yeast assembly)');
      act(() => {
        designer.closest('details')?.setAttribute('open', '');
      });
      const ids = editorStore.getState().documents.map((d) => d.documentId);
      // The picker named "Linearised vector" is the designer's; the panel's own is "Vector".
      fireEvent.change(screen.getByLabelText('Linearised vector'), { target: { value: ids[0] } });
      fireEvent.change(screen.getByLabelText('Insert from'), { target: { value: ids[1] } });
      fireEvent.change(screen.getByLabelText('Insert'), { target: { value: 'whole' } });
    }

    it('designs 40 bases of vector on each, whatever the Gibson designer was left at', () => {
      act(() => {
        editorStore.updateBench('overlap', { kit: 'nebuilder' });
      });
      design();
      const primers = within(screen.getByRole('list', { name: 'Insert primers' }));
      expect(primers.getAllByText(/40 of vector/)).toHaveLength(2);
      // The kit is the reaction's, so there is no choice of kit to make here.
      expect(screen.queryByRole('group', { name: 'Kit' })).toBeNull();
      expect(screen.getByLabelText('Product')).toHaveTextContent('3,500 bp, circular');
      expect(editorStore.getState().bench.overlap.kit).toBe('nebuilder');
    });

    it('keeps the pair in My primers as <part>-YA-F and -R', async () => {
      const track = vi.spyOn(analytics, 'track');
      design();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Save primers' }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(await screen.findByText('Saved 2 primers to My primers.')).toBeTruthy();
      const stored = await getRepository().loadPrimers();
      expect(stored.map((p) => p.name)).toEqual(['YA-gene-YA-F', 'YA-gene-YA-R']);
      expect(stored[0]?.notes).toMatch(/Yeast assembly, forward tail primer for YA-gene/);
      expect(track).toHaveBeenCalledWith('cloning', 'yeast-oligos');
    });
  });
});

describe('the yeast settings the Bench remembers', () => {
  it('start at 40 bp, circular, no vector', () => {
    expect(DEFAULT_BENCH.yeast).toEqual({
      excluded: [],
      minOverlap: 40,
      circular: true,
      vectorId: '',
      name: '',
    });
  });

  it('are read back field by field, the overlap held to 20-80', () => {
    expect(
      normalizeBenchSettings({
        reaction: 'yeast',
        yeast: {
          excluded: ['a', 3],
          minOverlap: 500,
          circular: false,
          vectorId: 'tab-1',
          name: 'p',
        },
      }),
    ).toMatchObject({
      reaction: 'yeast',
      yeast: { excluded: ['a'], minOverlap: 80, circular: false, vectorId: 'tab-1', name: 'p' },
    });
    expect(normalizeBenchSettings({ yeast: { minOverlap: 3 } }).yeast.minOverlap).toBe(20);
    expect(normalizeBenchSettings({ yeast: { minOverlap: 'many' } }).yeast).toEqual(
      DEFAULT_BENCH.yeast,
    );
    expect(normalizeBenchSettings({ overlap: { kit: 'yeast' } }).overlap.kit).toBe('yeast');
  });
});
