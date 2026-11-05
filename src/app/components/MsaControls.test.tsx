// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SeqDocument } from '@/core';

import { MsaControls } from './MsaControls';
import { SELECTION_GUIDE_ALPHA } from './alignmentStackDraw';
import {
  MSA_CHAR_WIDTH,
  MSA_CONSENSUS_ROW,
  MSA_HEADER_HEIGHT,
  MSA_RULER_HEIGHT,
  drawMsa,
  msaSize,
  visibleColumns,
} from './msaDraw';
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

describe('MsaControls alphabet and document (#369)', () => {
  const protein = [
    { name: 'p1', sequence: 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQ' },
    { name: 'p2', sequence: 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVA' },
    { name: 'p3', sequence: 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEAQ' },
  ];

  it('says the document is included, and that the letters read as bases', () => {
    render(<MsaControls doc={doc} records={two} />);
    expect(screen.getByText('target is included as one more sequence.')).toBeInTheDocument();
    expect(screen.getByText(/the letters read as nucleotide/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Detected (nucleotide)' })).toBeInTheDocument();
  });

  it('leaves a nucleotide document out of protein records and says why', () => {
    render(<MsaControls doc={doc} records={protein} />);
    expect(
      screen.getByText(/target is not included\. It is a nucleotide document/),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Include this document' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Include this document' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Align 3 together' })).toBeEnabled();
  });

  it('says so when the document is unticked', () => {
    render(<MsaControls doc={doc} records={two} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include this document' }));
    expect(screen.getByText('target is not included (unticked).')).toBeInTheDocument();
  });

  it('refuses a mixed set until the user chooses', () => {
    render(<MsaControls doc={doc} records={[...two, protein[0] as (typeof two)[0]]} />);
    expect(screen.getByRole('button', { name: /Align/ })).toBeDisabled();
    expect(screen.getAllByText(/records are mixed/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole('combobox', { name: 'Alphabet of the records' }), {
      target: { value: 'nucleotide' },
    });
    expect(screen.getByText(/Scored as nucleotide, as chosen/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Align/ })).toBeEnabled();
  });

  it('aligns protein records as protein under a nucleotide document', async () => {
    render(<MsaControls doc={doc} records={protein} />);
    fireEvent.click(screen.getByRole('button', { name: 'Align 3 together' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Multiple alignment of 3 proteins');
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

  it('shades the selected columns faintly on every row, clipped below the ruler (#371)', () => {
    const rows = ['AC-GT', 'ACTGT', 'ACTGA'];
    const guides: string[] = [];
    const clips: string[] = [];
    let alpha = 1;
    let pending = '';
    const g = new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (prop === 'measureText') return () => ({ width: 5 });
          if (prop === 'rect') {
            return (x: number, y: number, w: number, h: number) => {
              pending = `${x},${y},${w},${h}`;
            };
          }
          if (prop === 'clip') return () => clips.push(pending);
          if (prop === 'fillRect') {
            return (x: number, y: number, w: number, h: number) => {
              if (alpha === SELECTION_GUIDE_ALPHA) guides.push(`${x},${y},${w},${h}`);
            };
          }
          return () => undefined;
        },
        set: (_t, prop: string, value: unknown) => {
          if (prop === 'globalAlpha') alpha = value as number;
          return true;
        },
      },
    ) as unknown as Parameters<typeof drawMsa>[0];
    const el = document.createElement('div');
    const base = {
      names: ['a', 'b', 'c'],
      rows,
      summary: summariseColumns(rows),
      colours: readColours(el),
      shading: 'conservation' as const,
      onAccent: '#fff',
      left: 0,
      top: 0,
      width: 400,
      height: 200,
    };
    drawMsa(g, base);
    drawMsa(g, { ...base, selection: null });
    expect(guides).toEqual([]);
    // A one-column selection on the middle row: the band runs from the consensus row down.
    drawMsa(g, { ...base, selection: { row: 1, start: 2, end: 3 } });
    expect(guides).toEqual([
      `${168 + 2 * MSA_CHAR_WIDTH},${MSA_RULER_HEIGHT},${MSA_CHAR_WIDTH},200`,
    ]);
    expect(SELECTION_GUIDE_ALPHA).toBeLessThan(0.16);
    expect(clips).toContain(`168,${MSA_RULER_HEIGHT},232,${200 - MSA_RULER_HEIGHT}`);
    // The same on the consensus row; out of view, none.
    guides.length = 0;
    drawMsa(g, { ...base, selection: { row: MSA_CONSENSUS_ROW, start: 0, end: 2 } });
    expect(guides).toHaveLength(1);
    guides.length = 0;
    drawMsa(g, { ...base, left: 10_000, selection: { row: 1, start: 0, end: 1 } });
    expect(guides).toEqual([]);
  });
});
