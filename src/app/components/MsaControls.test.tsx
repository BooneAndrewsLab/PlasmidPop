// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SeqDocument } from '@/core';

import { MsaControls } from './MsaControls';
import { MSA_CHAR_WIDTH, MSA_HEADER_HEIGHT, drawMsa, msaSize, visibleColumns } from './msaDraw';
import { summariseColumns } from '@/core';
import { readColours } from './alignmentStackDraw';

afterEach(cleanup);

const doc = SeqDocument.create({ name: 'target', sequence: 'ATGGCGTACGTTAGCCATTGACC' });
const two = [
  { name: 'one', sequence: 'ATGGCGTACGTTAGCCTTGACC' },
  { name: 'two', sequence: 'ATGGCGTACGTAGCCATTGACC' },
];

describe('MsaControls (#207)', () => {
  it('needs three sequences, counting the document when it is included', () => {
    render(<MsaControls doc={doc} records={two.slice(0, 1)} />);
    expect(screen.getByRole('button', { name: 'Align 2 together' })).toBeDisabled();
    expect(screen.getAllByText(/at least three/).length).toBeGreaterThan(0);
    render(<MsaControls doc={doc} records={two} />);
    expect(screen.getByRole('button', { name: 'Align 3 together' })).toBeEnabled();
  });

  it('aligns in the worker client and opens the window with a consensus and exports', async () => {
    render(<MsaControls doc={doc} records={two} />);
    fireEvent.click(screen.getByRole('button', { name: 'Align 3 together' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Multiple alignment of 3 sequences');
    expect(screen.getByRole('button', { name: 'Save aligned FASTA' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save Clustal' })).toBeEnabled();
    expect(screen.getByRole('img', { name: /consensus/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('leaves the document out when asked', () => {
    render(<MsaControls doc={doc} records={two} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include this document' }));
    expect(screen.getByRole('button', { name: /Align 2 together/ })).toBeDisabled();
  });
});

describe('drawing the alignment', () => {
  it('works out which columns are in view', () => {
    expect(visibleColumns(0, 168 + 9 * 10, 100)).toEqual({ first: 0, end: 11 });
    expect(visibleColumns(9 * 50, 168 + 90, 100).first).toBe(50);
    expect(visibleColumns(0, 5000, 20).end).toBe(20);
    expect(msaSize(10, 3)).toEqual({
      width: 168 + 10 * MSA_CHAR_WIDTH,
      height: MSA_HEADER_HEIGHT + 3 * 18,
    });
  });

  it('paints names, consensus and every shown letter', () => {
    const rows = ['AC-GT', 'ACTGT', 'ACTGA'];
    const texts: string[] = [];
    const calls: string[] = [];
    const g = new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (prop === 'fillText') return (t: string) => texts.push(t);
          if (prop === 'measureText') return () => ({ width: 5 });
          return () => {
            calls.push(prop);
          };
        },
        set: () => true,
      },
    ) as unknown as Parameters<typeof drawMsa>[0];
    const el = document.createElement('div');
    drawMsa(g, {
      names: ['a', 'b', 'c'],
      rows,
      summary: summariseColumns(rows),
      colours: readColours(el),
      shading: 'conservation',
      onAccent: '#fff',
      left: 0,
      top: 0,
      width: 400,
      height: 200,
    });
    expect(texts).toEqual(expect.arrayContaining(['a', 'b', 'c', 'Consensus', 'A', 'C', 'G', 'T']));
    expect(calls).toContain('fillRect');
  });
});
