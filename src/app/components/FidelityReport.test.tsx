// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { parseFidelityCsv } from '@/core';

import { getRepository } from '@/storage';

import { editorStore } from '../state/editorStore';
import { persistence } from '../state/persistence';
import { FidelityReport } from './FidelityReport';

/** A table in the shape the published ones come in, counting only what is named. */
function csv(overhangs: readonly string[], pairs: Readonly<Record<string, number>>): string {
  const count = (a: string, b: string): number => pairs[`${a}/${b}`] ?? pairs[`${b}/${a}`] ?? 0;
  return [
    ['Overhang', ...overhangs].join(','),
    ...overhangs.map((row) => [row, ...overhangs.map((c) => count(row, c))].join(',')),
  ].join('\n');
}

// Two junctions, AAAA and AAAT, whose ends mis-join in a tenth of the
// ligations of the first.
const TEXT = csv(['AAAA', 'TTTT', 'AAAT', 'ATTT', 'GGCC'], {
  'AAAA/TTTT': 900,
  'AAAT/ATTT': 1000,
  'AAAA/ATTT': 100,
  'GGCC/GGCC': 500,
});
const TABLE = parseFidelityCsv(TEXT, 'T4-test.csv').table;

function file(text: string, name = 'T4-test.csv'): File {
  return new File([text], name, { type: 'text/csv' });
}

describe('FidelityReport (#68)', () => {
  afterEach(async () => {
    await persistence.forgetFidelityTable();
  });

  it('offers an import when there is no table, and scores the overhangs once there is', () => {
    const { rerender } = render(<FidelityReport overhangs={['AAAA', 'AAAT']} table={null} />);
    expect(screen.getByText(/score these overhangs by measured end-joining/)).toBeInTheDocument();
    rerender(<FidelityReport overhangs={['AAAA', 'AAAT']} table={TABLE} />);
    // 0.9 × 1000/1100 = 81.8 %.
    expect(screen.getByText(/Fidelity 82 %/)).toBeInTheDocument();
    expect(screen.getByText(/by T4-test, over 2 junctions/)).toBeInTheDocument();
    const worst = within(screen.getByRole('list', { name: 'Worst overhang pairs' }));
    expect(worst.getAllByRole('listitem')[0]?.textContent).toMatch(
      /AAAA \+ ATTT mis-joins in 10 % of its ligations/,
    );
  });

  it('says when nothing mis-joins, and which overhangs it could not score', () => {
    render(<FidelityReport overhangs={['GGCC', 'CCCC']} table={TABLE} />);
    expect(screen.getByText(/Fidelity 100 %/)).toBeInTheDocument();
    expect(screen.getByText(/No pair mis-joins in as much as 0.1 %/)).toBeInTheDocument();
    expect(screen.getByText(/Not scored: CCCC/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Worst overhang pairs' })).toBeNull();
  });

  it('imports a file, keeps it for the next session, and forgets it when asked', async () => {
    render(<FidelityReport overhangs={['AAAA', 'AAAT']} table={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Import a ligase fidelity table' }));
    const input = document.querySelector('input[type="file"]');
    if (input === null) throw new Error('no file input');
    await act(async () => {
      fireEvent.change(input, { target: { files: [file(TEXT)] } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // 900 + 1,000 + 100 + 500 ligations, each pair counted once.
    const said = await screen.findByText(/overhangs of/);
    expect(said.textContent).toContain('T4-test: 5 overhangs of 4 bases, 2,500 ligations counted');
    // It is in the store, so the panels see it, and in storage for next time.
    await waitFor(() => {
      expect(editorStore.getState().fidelityTable?.label).toBe('T4-test');
    });
    editorStore.setFidelityTable(null);
    await persistence.restoreFidelityTable();
    expect(editorStore.getState().fidelityTable?.counts.get('AAAA')?.get('TTTT')).toBe(900);

    // Forgetting it leaves the design rules on their own again.
    const { rerender } = render(
      <FidelityReport overhangs={['AAAA']} table={editorStore.getState().fidelityTable} />,
    );
    const [forget] = screen.getAllByRole('button', { name: 'forget this one' });
    if (forget === undefined) throw new Error('nothing to forget');
    fireEvent.click(forget);
    await waitFor(() => {
      expect(editorStore.getState().fidelityTable).toBeNull();
    });
    rerender(<FidelityReport overhangs={['AAAA']} table={null} />);
    expect(await getRepository().loadFidelityTable()).toBeNull();
  });

  it('says what is wrong with a file that is not a fidelity table', async () => {
    render(<FidelityReport overhangs={['AAAA']} table={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Import a ligase fidelity table' }));
    const input = document.querySelector('input[type="file"]');
    if (input === null) throw new Error('no file input');
    await act(async () => {
      fireEvent.change(input, { target: { files: [file('name,site\nEcoRI,GAATTC\n', 'e.csv')] } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(await screen.findByText(/not a ligation fidelity table/)).toBeInTheDocument();
    expect(editorStore.getState().fidelityTable).toBeNull();
  });
});
