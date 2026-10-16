// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { readFileSync } from 'node:fs';

import { parseGenBank } from '@/io';

import { ExportSequenceDialog } from './ExportSequenceDialog';

function pbr322() {
  const doc = parseGenBank(readFileSync('src/io/fixtures/J01749.gb', 'utf8')).documents[0];
  if (doc === undefined) throw new Error('fixture');
  return doc;
}

/** The position each row starts at, as its number in the gutter. */
function rowNumbers(svg: string): number[] {
  return [...svg.matchAll(/text-anchor="end"[^>]*>([\d,]+)</g)].map((m) =>
    Number((m[1] ?? '').replace(/,/g, '')),
  );
}

function setup(selection: { start: number; end: number } | null = null, basesPerRow = 60) {
  const files: { name: string; text: string }[] = [];
  const onClose = vi.fn();
  render(
    <ExportSequenceDialog
      doc={pbr322()}
      selection={selection}
      basesPerRow={basesPerRow}
      format={{}}
      stem="pBR322"
      onClose={onClose}
      download={(name, text) => files.push({ name, text })}
    />,
  );
  return { files, onClose };
}

const exportButton = () => screen.getByRole('button', { name: 'Export' });

describe('ExportSequenceDialog (#30)', () => {
  it('exports the whole sequence at the view’s bases per row', () => {
    const { files, onClose } = setup(null, 100);
    expect(screen.getByRole('button', { name: 'Selection' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Whole sequence' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('textbox', { name: 'Bases per row' })).toHaveValue('100');
    fireEvent.click(exportButton());
    expect(files.map((f) => f.name)).toEqual(['pBR322_sequence.svg']);
    expect(rowNumbers(files[0]?.text ?? '')).toHaveLength(44);
    expect(onClose).toHaveBeenCalled();
  });

  it('starts from the selection when there is one, highlighted', () => {
    const { files } = setup({ start: 1000, end: 1050 });
    expect(screen.getByRole('button', { name: 'Selection' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(exportButton());
    expect(files[0]?.name).toBe('pBR322_selection.svg');
    expect(rowNumbers(files[0]?.text ?? '')).toEqual([961, 1021]);
    expect(files[0]?.text).toContain('fill="rgba(27, 110, 140, 0.18)"');
  });

  it('exports a from–to range through the origin, 1-based in the boxes', () => {
    const { files } = setup(null, 50);
    fireEvent.click(screen.getByRole('button', { name: 'From–to' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'From base' }), {
      target: { value: '4301' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'To base' }), {
      target: { value: '75' },
    });
    fireEvent.click(exportButton());
    expect(files[0]?.name).toBe('pBR322_4301-75.svg');
    expect(rowNumbers(files[0]?.text ?? '')).toEqual([4301, 4351, 1, 51]);
    expect(files[0]?.text).toContain('bases 4,301–4,361, 1–100 of 4,361 bp');
  });

  it('says what is wrong and does not export', () => {
    const { files } = setup();
    fireEvent.change(screen.getByRole('textbox', { name: 'Bases per row' }), {
      target: { value: '500' },
    });
    expect(screen.getByText('Bases per row is a number from 10 to 200.')).toBeInTheDocument();
    expect(exportButton()).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Bases per row' }), {
      target: { value: '60' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'From–to' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'From base' }), {
      target: { value: '0' },
    });
    expect(screen.getByText('From and to are bases 1 to 4,361.')).toBeInTheDocument();
    expect(exportButton()).toBeDisabled();
    expect(files).toEqual([]);
  });

  it('splits into A4 pages, one file each, saying how many first', () => {
    vi.useFakeTimers();
    try {
      const { files } = setup();
      fireEvent.click(screen.getByRole('checkbox', { name: 'Split into A4 pages' }));
      const note = screen.getByText(/pages, each downloaded as an SVG file of its own/);
      const n = Number(/^(\d+) pages/.exec(note.textContent)?.[1]);
      expect(n).toBeGreaterThan(1);
      fireEvent.click(exportButton());
      vi.runAllTimers();
      expect(files.map((f) => f.name)).toEqual(
        Array.from(
          { length: n },
          (_, i) => `pBR322_sequence_p${String(i + 1).padStart(2, '0')}.svg`,
        ),
      );
      expect(files.every((f) => f.text.includes('width="210mm" height="297mm"'))).toBe(true);
      expect(files.flatMap((f) => rowNumbers(f.text))).toEqual(
        Array.from({ length: 73 }, (_, i) => 1 + i * 60),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses more pages than it downloads at once', () => {
    setup(null, 10);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Split into A4 pages' }));
    expect(screen.getByText(/more than the 40 downloaded at once/)).toBeInTheDocument();
    expect(exportButton()).toBeDisabled();
  });

  describe('as PNG (#236)', () => {
    function setupPng(rasterize: (svg: string, scale: number) => Promise<Blob>, perRow = 60) {
      const pngs: { name: string; blob: Blob }[] = [];
      const onClose = vi.fn();
      render(
        <ExportSequenceDialog
          doc={pbr322()}
          selection={null}
          basesPerRow={perRow}
          format={{}}
          stem="pBR322"
          onClose={onClose}
          download={() => undefined}
          downloadPng={(name, blob) => pngs.push({ name, blob })}
          rasterize={rasterize}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'PNG' }));
      return { pngs, onClose };
    }

    it('rasterises one picture at the chosen scale', async () => {
      const calls: { svg: string; scale: number }[] = [];
      const { pngs, onClose } = setupPng((svg, scale) => {
        calls.push({ svg, scale });
        return Promise.resolve(new Blob(['x'], { type: 'image/png' }));
      });
      expect(screen.getByRole('heading')).toHaveTextContent('Export sequence view as PNG');
      fireEvent.click(screen.getByRole('button', { name: '1×' }));
      fireEvent.click(exportButton());
      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
      expect(pngs.map((f) => f.name)).toEqual(['pBR322_sequence.png']);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.scale).toBe(1);
      expect(calls[0]?.svg).toContain('<svg');
    });

    it('keeps the white background by default', async () => {
      const svgs: string[] = [];
      const { onClose } = setupPng((svg) => {
        svgs.push(svg);
        return Promise.resolve(new Blob(['x']));
      });
      fireEvent.click(exportButton());
      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
      expect(svgs[0]).toMatch(/<rect x="0" y="0"[^>]*fill="#ffffff"/);
    });

    it('passes the transparent background on to the drawing', async () => {
      const svgs: string[] = [];
      const { onClose } = setupPng((svg) => {
        svgs.push(svg);
        return Promise.resolve(new Blob(['x']));
      });
      fireEvent.click(screen.getByRole('button', { name: 'Transparent' }));
      fireEvent.click(exportButton());
      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
      expect(svgs[0]).toContain('fill="rgba(0,0,0,0)"');
    });

    it('one PNG per A4 page, rasterised in turn', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let running = 0;
        let most = 0;
        const { pngs, onClose } = setupPng(async () => {
          running += 1;
          most = Math.max(most, running);
          await Promise.resolve();
          running -= 1;
          return new Blob(['x']);
        });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Split into A4 pages' }));
        expect(
          screen.getByText(/pages, each downloaded as a PNG file of its own/),
        ).toBeInTheDocument();
        fireEvent.click(exportButton());
        await waitFor(() => {
          expect(onClose).toHaveBeenCalled();
        });
        vi.runAllTimers();
        expect(pngs).toHaveLength(9);
        expect(pngs[0]?.name).toBe('pBR322_sequence_p01.png');
        expect(pngs[8]?.name).toBe('pBR322_sequence_p09.png');
        expect(most).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('refuses a picture too large to draw, without rasterising', () => {
      const rasterize = vi.fn(() => Promise.resolve(new Blob(['x'])));
      const { pngs } = setupPng(rasterize);
      fireEvent.click(screen.getByRole('button', { name: '4×' }));
      fireEvent.click(exportButton());
      expect(
        screen.getByText(/the picture would be .* Try more bases per row/),
      ).toBeInTheDocument();
      expect(rasterize).not.toHaveBeenCalled();
      expect(pngs).toEqual([]);
      expect(exportButton()).toBeEnabled();
    });

    it('shows a failure of the drawing and stays open', async () => {
      const { pngs, onClose } = setupPng(() => Promise.reject(new Error('Canvas is blank.')));
      fireEvent.click(exportButton());
      expect(await screen.findByText('Canvas is blank.')).toBeInTheDocument();
      expect(pngs).toEqual([]);
      expect(onClose).not.toHaveBeenCalled();
      expect(exportButton()).toBeEnabled();
    });
  });
});
