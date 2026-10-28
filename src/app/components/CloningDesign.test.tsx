// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { SeqDocument, createFeature, rangeSegment } from '@/core';
import { GENE_QUERY_DEBOUNCE_MS, type GeneHit } from '@/io';
import type * as Io from '@/io';
import { parseGenBank } from '@/io';
import L09137 from '@/io/fixtures/L09137.gb?raw';
import U49845_GB from '@/io/fixtures/U49845.gb?raw';

import type * as FromNcbi from '../openFromNcbi';
import { recallWorkspace, rememberWorkspacePage } from '../primerWorkspace';
import { editorStore } from '../state/editorStore';
import { forgetPanels } from '../state/panelMemory';
import type * as Collection from '../state/primerCollection';
import { savePrimers } from '../state/primerCollection';
import { PrimerWorkspace } from './PrimerWorkspace';

/** What a gene fetch comes back with: a record with one CDS, the insert to offer. */
const fetched = vi.hoisted(() => ({ calls: 0 }));

vi.mock('../openFromNcbi', async (importOriginal) => ({
  ...(await importOriginal<typeof FromNcbi>()),
  fetchGeneFromNcbi: (gene: GeneHit) => {
    fetched.calls += 1;
    const record = parseGenBank(U49845_GB).documents[0];
    if (record === undefined) throw new Error('no record');
    const doc = SeqDocument.create({
      name: `${gene.symbol} (NM_001179927.3)`,
      sequence: record.sequence.toString(),
      features: [
        createFeature({ type: 'gene', name: gene.symbol, segments: [rangeSegment(600, 3200)] }),
        createFeature({ type: 'CDS', name: gene.symbol, segments: [rangeSegment(686, 3158)] }),
      ],
    });
    return Promise.resolve({
      documents: [doc],
      warnings: [],
      source: { kind: 'gene', gene, flanks: { upstream: 0, downstream: 0 }, rc: true },
      fileName: () => `${gene.symbol}.gb`,
    });
  },
}));

vi.mock('@/io', async (importOriginal) => ({
  ...(await importOriginal<typeof Io>()),
  searchGenes: () =>
    Promise.resolve({
      hits: [
        {
          id: '850504',
          symbol: 'ACT1',
          fullName: 'actin',
          organism: 'Saccharomyces cerevisiae S288C',
          taxId: 559292,
          aliases: [],
          chromosome: 'VI',
          location: { accession: 'NC_001138.5', start: 54695, end: 56322, strand: 'reverse' },
        },
      ],
      count: 1,
    }),
}));

vi.mock('../state/primerCollection', async (importOriginal) => ({
  ...(await importOriginal<typeof Collection>()),
  savePrimers: vi.fn((drafts: readonly { name: string; sequence: string }[]) =>
    Promise.resolve({
      added: drafts.map((d, i) => ({ ...d, id: i.toString(), notes: '' })),
      duplicates: 0,
      empty: 0,
    }),
  ),
}));

const saved = vi.mocked(savePrimers);

function fixture(text: string): SeqDocument {
  const doc = parseGenBank(text).documents[0];
  if (doc === undefined) throw new Error('no record');
  return doc;
}

const pUC19 = fixture(L09137);
const U49845 = fixture(U49845_GB);
/** pUC19's polylinker, as the engine tests select it. */
const MCS = { start: 395, end: 452 };

/**
 * Opens the insert's tab first and the vector in front, with the workspace
 * on Design in cloning mode and the MCS selected.
 */
function setup(layout: 'split' | 'phone' = 'split'): { vectorId: string; insertId: string } {
  let insertId = '';
  let vectorId = '';
  act(() => {
    insertId = editorStore.openDocument(U49845);
    vectorId = editorStore.openDocument(pUC19);
    rememberWorkspacePage(vectorId, 'design');
    editorStore.setPrimerWorkspace(true);
    editorStore.setSelection(MCS);
  });
  render(<PrimerWorkspace doc={pUC19} layout={layout} />);
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: 'Clone an insert into this plasmid' }));
  });
  return { vectorId, insertId };
}

function insertSelect(): HTMLSelectElement {
  return screen.getByRole('combobox', {
    name: 'Insert: a feature or selection of another tab',
  });
}

/** Chooses the AXL2 CDS (named Axl2p, after its product) of the other tab, and waits for the scans and the pair table. */
async function chooseAxl2(): Promise<HTMLElement> {
  const option = within(insertSelect())
    .getAllByRole('option')
    .find((o) => o.textContent.startsWith('Axl2p (CDS)'));
  if (option === undefined) throw new Error('Axl2p is not offered');
  act(() => {
    fireEvent.change(insertSelect(), { target: { value: (option as HTMLOptionElement).value } });
  });
  return screen.findByRole('grid', { name: 'Enzyme pairs' }, { timeout: 15000 });
}

function designButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /^Design primers/ });
}

/** The element, or a plain failure when the test's premise does not hold. */
function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

function pairRows(grid: HTMLElement): HTMLElement[] {
  return within(grid)
    .getAllByRole('row')
    .slice(1)
    .filter((r) => r.getAttribute('data-row') !== null);
}

/** "EcoRI · BamHI" of a pair row. */
function enzymesOf(row: HTMLElement): string {
  return (within(row).getAllByRole('cell')[0]?.textContent ?? '').replace(/^[◉○]\s*/, '').trim();
}

afterEach(() => {
  forgetPanels();
  saved.mockClear();
  fetched.calls = 0;
  act(() => {
    while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
  });
});

describe('the Design page’s cloning mode (#303)', () => {
  it('remembers the mode and gates Design with the reason, step by step', async () => {
    const { vectorId } = setup();
    expect(recallWorkspace(vectorId).mode).toBe('cloning');
    expect(screen.getByRole('heading', { name: 'Where on the vector' })).toBeInTheDocument();
    // The region is the selection, the MCS.
    expect(screen.getByText('396–452')).toBeInTheDocument();
    expect(designButton()).toBeDisabled();
    expect(screen.getByText('Choose an insert')).toBeInTheDocument();
    expect(screen.getByText(/Pairs are suggested once an insert is chosen/)).toBeInTheDocument();

    const grid = await chooseAxl2();
    expect(screen.getByText(/^Axl2p$/)).toBeInTheDocument();
    expect(screen.getByText(/Internal sites:/)).toBeInTheDocument();
    expect(designButton()).toBeDisabled();
    expect(screen.getByText('Choose two enzymes')).toBeInTheDocument();

    const rows = pairRows(grid);
    expect(rows.length).toBeGreaterThan(1);
    // Usable pairs first: the first row has no reason, a greyed one has.
    expect(within(must(rows[0], 'a row')).getAllByRole('cell')[6]).toHaveTextContent('—');
    const off = rows.find((r) => r.classList.contains('ez--off'));
    expect(off).toBeDefined();
    expect(within(must(off, 'an excluded row')).getAllByRole('cell')[6]?.textContent).not.toBe('—');
    expect(screen.getByRole('button', { name: /more excluded pairs/ })).toBeInTheDocument();

    act(() => {
      fireEvent.click(must(rows[0], 'a row'));
    });
    const pair = enzymesOf(must(rows[0], 'a row'));
    expect(rows[0]).toHaveAttribute('aria-selected', 'true');
    expect(designButton()).toBeEnabled();
    expect(designButton()).toHaveTextContent(`for Axl2p into ${pUC19.name} at ${pair}`);
    // The map shows the two picked sites.
    expect(editorStore.getState().preview?.items.map((s) => s.id)).toEqual([
      'primers:cut-0',
      'primers:cut-1',
    ]);
  });

  it('keeps a picked pair the region no longer holds and says why (decision 8)', async () => {
    setup();
    const grid = await chooseAxl2();
    const first = must(pairRows(grid)[0], 'a row');
    act(() => {
      fireEvent.click(first);
    });
    const pair = enzymesOf(first);
    // A region with none of the polylinker's sites.
    act(() => {
      editorStore.setSelection({ start: 1000, end: 1100 });
    });
    const note = await screen.findByRole('status', {}, { timeout: 15000 });
    expect(note).toHaveTextContent(`Picked ${pair}, no longer usable:`);
    expect(note).toHaveTextContent('outside the region');
    expect(note).toHaveTextContent('Design will warn.');
    expect(designButton()).toBeEnabled();
  });

  it('lets any two enzymes be picked, and says what the table excluded them for', async () => {
    setup();
    await chooseAxl2();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Any two enzymes…' }));
    });
    const forward = screen.getByRole('combobox', { name: 'Enzyme at the insert’s 5′ end' });
    act(() => {
      fireEvent.change(forward, { target: { value: 'EcoRI' } });
    });
    // One enzyme so far: the same end twice, which the table lists as not directional.
    expect(screen.getByRole('status')).toHaveTextContent('EcoRI · EcoRI');
    expect(screen.getByRole('status')).toHaveTextContent('same end twice');
    const reverse = screen.getByRole('combobox', { name: 'Enzyme at the insert’s 3′ end' });
    act(() => {
      fireEvent.change(reverse, { target: { value: 'HindIII' } });
    });
    expect(designButton()).toHaveTextContent('at EcoRI · HindIII');
    expect(designButton()).toBeEnabled();
  });

  it('designs, tells the oligos’ parts apart on Results, simulates and saves', async () => {
    const { vectorId } = setup();
    const grid = await chooseAxl2();
    const first = must(pairRows(grid)[0], 'a row');
    act(() => {
      fireEvent.click(first);
    });
    const pair = enzymesOf(first);
    const [fwdEnzyme] = pair.split(' · ');
    act(() => {
      fireEvent.click(designButton());
    });
    expect(screen.getByRole('tab', { name: /^Results/ })).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByText(`Cloning primers · Axl2p (${U49845.name}) into ${pUC19.name} 396–452`),
    ).toBeInTheDocument();
    const results = screen.getByRole('grid', { name: 'Cloning pairs' });
    const rows = within(results).getAllByRole('row').slice(1);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.length).toBeLessThanOrEqual(6);
    const cells = within(must(rows[0], 'a row')).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent(pair);
    // The forward oligo: padding and site in lower case, the site labelled, the annealing part upper.
    const oligo = must(cells[2], 'the forward oligo cell');
    const site = oligo.querySelector('.oligo__site');
    expect(site?.getAttribute('aria-label')).toMatch(
      new RegExp(`^${fwdEnzyme ?? ''} site [acgt]+$`),
    );
    expect(site?.textContent).toMatch(/^[acgt]+$/);
    expect(oligo.querySelector('.oligo__pad')?.textContent).toMatch(/^[acgt]+$/);
    expect(oligo.querySelector('.oligo__ann')?.textContent).toMatch(/^[ACGT]{15,}$/);
    expect(oligo.textContent).toMatch(/^[acgt]+[ACGT]+$/);
    // Tm of the annealing part and the PCR length with the tails.
    expect(cells[4]?.textContent).toMatch(/^\d\d\.\d$/);
    expect(Number(cells[8]?.textContent.replace(/,/g, ''))).toBeGreaterThan(3158 - 686);

    // The picked pair is row 1 and selected, with its detail and product.
    expect(rows[0]).toHaveAttribute('aria-selected', 'true');
    const detail = within(screen.getByRole('complementary', { name: 'Pair 1' }));
    expect(detail.getByText('5′ end')).toBeInTheDocument();
    expect(detail.getByText('3′ end')).toBeInTheDocument();
    expect(detail.getAllByText(/^vector cut once, at \d/)).toHaveLength(2);
    expect(detail.getByText('Simulated product')).toBeInTheDocument();
    expect(
      detail.getByRole('img', { name: `Map strip of ${pUC19.name}-Axl2p` }),
    ).toBeInTheDocument();
    expect(detail.getByRole('link', { name: 'Check specificity…' })).toHaveAttribute(
      'href',
      expect.stringContaining('PRIMER_LEFT_INPUT='),
    );

    // Save both: named after the insert and the enzymes (`cloningPrimerNames`).
    act(() => {
      fireEvent.click(detail.getByRole('button', { name: 'Save both' }));
    });
    const [rev] = pair.split(' · ').slice(1);
    expect(saved).toHaveBeenCalledOnce();
    expect(saved.mock.calls[0]?.[0].map((d) => d.name)).toEqual([
      `Axl2p-F-${fwdEnzyme ?? ''}`,
      `Axl2p-R-${rev ?? ''}`,
    ]);

    // Simulate opens the product as a new document, named vector-insert.
    const before = editorStore.getState().documents.length;
    act(() => {
      fireEvent.click(detail.getByRole('button', { name: 'Simulate' }));
    });
    const state = editorStore.getState();
    expect(state.documents.length).toBe(before + 1);
    expect(state.documentId).not.toBe(vectorId);
    const product = state.documents.find((d) => d.documentId === state.documentId)?.history.present;
    expect(product?.name).toBe(`${pUC19.name}-Axl2p`);
    expect(product?.topology).toBe('circular');
    expect(product?.length).toBeGreaterThan(pUC19.length);
    expect(state.sidebarTab).toBe('features');
  });

  it('lists the pairs as rows on a phone, the selected one opened out with its product', async () => {
    setup('phone');
    const grid = await chooseAxl2();
    act(() => {
      fireEvent.click(must(pairRows(grid)[0], 'a row'));
    });
    act(() => {
      fireEvent.click(designButton());
    });
    const list = screen.getByRole('list', { name: 'Cloning pairs' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // The picked pair is open, with the product drawn small under it.
    const first = must(rows[0], 'a row');
    expect(within(first).getByRole('button', { expanded: true })).toHaveTextContent('#1');
    expect(within(first).getByRole('complementary', { name: 'Pair 1' })).toBeInTheDocument();
    expect(within(first).getByText('Simulated product')).toBeInTheDocument();
    // Closing it again keeps the list.
    act(() => {
      fireEvent.click(within(first).getByRole('button', { expanded: true }));
    });
    expect(within(first).queryByRole('complementary')).toBeNull();
    expect(screen.getByRole('list', { name: 'Cloning pairs' })).toBeInTheDocument();
  });

  it('takes a gene fetched from NCBI as the insert and stays on the vector', async () => {
    vi.useFakeTimers();
    try {
      const { vectorId } = setup();
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Gene from NCBI…' }));
      });
      const gene = screen.getByRole('combobox', { name: 'Gene' });
      fireEvent.change(gene, { target: { value: 'ACT1' } });
      await act(async () => {
        vi.advanceTimersByTime(GENE_QUERY_DEBOUNCE_MS);
        await Promise.resolve();
      });
      fireEvent.keyDown(gene, { key: 'ArrowDown' });
      fireEvent.keyDown(gene, { key: 'Enter' });
      fireEvent.click(screen.getByRole('button', { name: 'Open' }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(fetched.calls).toBe(1);
      const state = editorStore.getState();
      // The gene is a tab of its own; the workspace is still on the vector.
      expect(state.documents.length).toBe(3);
      expect(state.documentId).toBe(vectorId);
      expect(state.documents.some((d) => d.history.present.name === 'ACT1 (NM_001179927.3)')).toBe(
        true,
      );
      expect(screen.getByRole('status')).toHaveTextContent(
        'Fetched ACT1 (NM_001179927.3) and opened it as a tab; its ACT1 feature is the insert.',
      );
      expect(screen.getByText(/^ACT1$/)).toBeInTheDocument();
      expect(screen.getByText('687–3,158')).toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'Gene' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
