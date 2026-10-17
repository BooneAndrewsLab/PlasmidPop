// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { readFileSync } from 'node:fs';

import { parseGenBank } from '@/io';
import { exportMapSvg } from '@/view/svg';

import { ExportFigureDialog } from './ExportFigureDialog';

function pbr322() {
  const doc = parseGenBank(readFileSync('src/io/fixtures/J01749.gb', 'utf8')).documents[0];
  if (doc === undefined) throw new Error('fixture');
  return doc;
}

function protein() {
  const doc = parseGenBank(readFileSync('src/io/fixtures/NP_000198.gp', 'utf8')).documents[0];
  if (doc === undefined) throw new Error('fixture');
  return doc;
}

/** The position each row starts at, as its number in the gutter. */
function rowNumbers(svg: string): number[] {
  return [...svg.matchAll(/text-anchor="end"[^>]*>([\d,]+)</g)].map((m) =>
    Number((m[1] ?? '').replace(/,/g, '')),
  );
}

function setup({
  doc = pbr322(),
  selection = null,
  basesPerRow = 60,
  rasterize = (svg: string) => Promise.resolve(new Blob([svg], { type: 'image/png' })),
}: {
  doc?: ReturnType<typeof pbr322>;
  selection?: { start: number; end: number } | null;
  basesPerRow?: number;
  rasterize?: (svg: string, scale: number) => Promise<Blob>;
} = {}) {
  const files: { name: string; text: string }[] = [];
  const pngs: { name: string; blob: Blob }[] = [];
  const calls: { svg: string; scale: number }[] = [];
  const onClose = vi.fn();
  render(
    <ExportFigureDialog
      doc={doc}
      selection={selection}
      basesPerRow={basesPerRow}
      format={{}}
      cutSites={[]}
      edits={null}
      gcWindow={null}
      showGc={false}
      stem="pBR322"
      onClose={onClose}
      download={(name, text) => files.push({ name, text })}
      downloadPng={(name, blob) => pngs.push({ name, blob })}
      rasterize={(svg, scale) => {
        calls.push({ svg, scale });
        return rasterize(svg, scale);
      }}
    />,
  );
  return { files, pngs, calls, onClose };
}

const exportButton = () => screen.getByRole('button', { name: 'Export' });
const radio = (name: string) => screen.getByRole('radio', { name });
const problem = () => screen.getByRole('alert');

/** Export as the sequence view rather than the map. */
const sequenceView = () => {
  fireEvent.click(radio('Sequence view'));
};

describe('ExportFigureDialog (#240)', () => {
  it('starts on the map, as SVG, with every row present and the scale greyed out', () => {
    setup();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Export figure');
    expect(radio('Map')).toHaveAttribute('aria-checked', 'true');
    expect(radio('SVG')).toHaveAttribute('aria-checked', 'true');
    // Nothing jumps (#241): the PNG's rows are there, disabled.
    expect(radio('2×')).toBeDisabled();
    expect(radio('White')).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Split into A4 pages' })).toBeDisabled();
    expect(screen.getByRole('img', { name: 'Preview of the exported map' })).toBeInTheDocument();
    expect(screen.getByText('SVG, 900 × 900 px')).toBeInTheDocument();
    expect(problem()).toBeEmptyDOMElement();
  });

  it('writes the map as SVG with the same figure options the PNG has', () => {
    const { files, onClose } = setup();
    fireEvent.click(exportButton());
    expect(files.map((f) => f.name)).toEqual(['pBR322_map.svg']);
    // Left alone, the options give the SVG the map export always wrote.
    expect(files[0]?.text).toBe(exportMapSvg(pbr322(), {}));
    expect(onClose).toHaveBeenCalled();
  });

  it('applies the text size, hidden feature types and background to the map SVG', () => {
    const { files } = setup();
    fireEvent.click(radio('Largest'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'CDS' }));
    fireEvent.click(radio('Transparent'));
    fireEvent.click(exportButton());
    const svg = files[0]?.text ?? '';
    expect(svg).toBe(
      exportMapSvg(pbr322(), {
        transparent: true,
        fontScale: 1.6,
        featureTypes: new Set(
          [
            ...new Set(
              pbr322()
                .features.all()
                .map((f) => f.type),
            ),
          ].filter((t) => t !== 'CDS'),
        ),
      }),
    );
    expect(svg).not.toContain('fill="#ffffff"');
  });

  it('rasterises the map at the chosen scale as PNG', async () => {
    const { calls, pngs, onClose } = setup();
    fireEvent.click(radio('PNG'));
    expect(radio('2×')).toBeEnabled();
    expect(screen.getByText('PNG, 1,800 × 1,800 pixels at 2×')).toBeInTheDocument();
    fireEvent.click(radio('4×'));
    fireEvent.click(exportButton());
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(calls[0]?.scale).toBe(4);
    expect(calls[0]?.svg).toContain('#ffffff');
    expect(pngs.map((f) => f.name)).toEqual(['pBR322_map.png']);
  });

  it('offers a protein only the sequence view', () => {
    setup({ doc: protein() });
    expect(radio('Map')).toBeDisabled();
    expect(radio('Map')).toHaveAttribute('title', 'A protein has no map');
    expect(radio('Sequence view')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('textbox', { name: 'Bases per row' })).toBeInTheDocument();
  });

  it('moves along a row with the arrow keys, stepping over a disabled choice', () => {
    setup();
    sequenceView();
    const whole = radio('Whole sequence');
    whole.focus();
    fireEvent.keyDown(whole, { key: 'ArrowRight' });
    // "Selection" is disabled with nothing selected, so the step lands on From–to.
    expect(radio('From–to')).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(radio('From–to'));
    fireEvent.keyDown(radio('From–to'), { key: 'ArrowRight' });
    expect(radio('Whole sequence')).toHaveAttribute('aria-checked', 'true');
  });

  describe('sequence view (#30)', () => {
    it('exports the whole sequence at the view’s bases per row', () => {
      const { files, onClose } = setup({ basesPerRow: 100 });
      sequenceView();
      expect(radio('Selection')).toBeDisabled();
      expect(radio('Whole sequence')).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('textbox', { name: 'Bases per row' })).toHaveValue('100');
      expect(screen.getByRole('img', { name: 'Preview of the first rows' })).toBeInTheDocument();
      fireEvent.click(exportButton());
      expect(files.map((f) => f.name)).toEqual(['pBR322_sequence.svg']);
      expect(rowNumbers(files[0]?.text ?? '')).toHaveLength(44);
      expect(onClose).toHaveBeenCalled();
    });

    it('starts from the selection when there is one, highlighted', () => {
      const { files } = setup({ selection: { start: 1000, end: 1050 } });
      sequenceView();
      expect(radio('Selection')).toHaveAttribute('aria-checked', 'true');
      fireEvent.click(exportButton());
      expect(files[0]?.name).toBe('pBR322_selection.svg');
      expect(rowNumbers(files[0]?.text ?? '')).toEqual([961, 1021]);
      expect(files[0]?.text).toContain('fill="rgba(27, 110, 140, 0.18)"');
    });

    it('keeps the range boxes in place, enabled only for From–to', () => {
      const { files } = setup({ basesPerRow: 50 });
      sequenceView();
      const from = screen.getByRole('textbox', { name: 'From base' });
      expect(from).toBeDisabled();
      fireEvent.click(radio('From–to'));
      expect(from).toBeEnabled();
      fireEvent.change(from, { target: { value: '4301' } });
      fireEvent.change(screen.getByRole('textbox', { name: 'To base' }), {
        target: { value: '75' },
      });
      fireEvent.click(exportButton());
      expect(files[0]?.name).toBe('pBR322_4301-75.svg');
      expect(rowNumbers(files[0]?.text ?? '')).toEqual([4301, 4351, 1, 51]);
      expect(files[0]?.text).toContain('bases 4,301–4,361, 1–100 of 4,361 bp');
    });

    it('says what is wrong beside the button and does not export', () => {
      const { files } = setup();
      sequenceView();
      fireEvent.change(screen.getByRole('textbox', { name: 'Bases per row' }), {
        target: { value: '500' },
      });
      expect(problem()).toHaveTextContent('Bases per row is a number from 10 to 200.');
      expect(exportButton()).toBeDisabled();
      fireEvent.change(screen.getByRole('textbox', { name: 'Bases per row' }), {
        target: { value: '60' },
      });
      expect(problem()).toBeEmptyDOMElement();
      fireEvent.click(radio('From–to'));
      fireEvent.change(screen.getByRole('textbox', { name: 'From base' }), {
        target: { value: '0' },
      });
      expect(problem()).toHaveTextContent('From and to are bases 1 to 4,361.');
      expect(exportButton()).toBeDisabled();
      expect(files).toEqual([]);
    });

    it('splits into A4 pages, one file each, saying how many first', () => {
      vi.useFakeTimers();
      try {
        const { files } = setup();
        sequenceView();
        fireEvent.click(screen.getByRole('checkbox', { name: 'Split into A4 pages' }));
        const note = screen.getByText(/pages, each downloaded as an SVG file of its own/);
        const n = Number(/^(\d+) pages/.exec(note.textContent)?.[1]);
        expect(n).toBeGreaterThan(1);
        expect(
          screen.getByText(`${String(n)} A4 pages of SVG, 794 × 1,123 px; the first 4 rows shown`),
        ).toBeInTheDocument();
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
      setup({ basesPerRow: 10 });
      sequenceView();
      fireEvent.click(screen.getByRole('checkbox', { name: 'Split into A4 pages' }));
      expect(problem()).toHaveTextContent(/more than the 40 downloaded at once/);
      expect(exportButton()).toBeDisabled();
    });
  });

  describe('sequence view as PNG (#236)', () => {
    const png = (basesPerRow = 60) => {
      const r = setup({ basesPerRow });
      sequenceView();
      fireEvent.click(radio('PNG'));
      return r;
    };

    it('rasterises one picture at the chosen scale', async () => {
      const { calls, pngs, onClose } = png();
      fireEvent.click(radio('1×'));
      expect(screen.getByText(/73 rows, PNG, 564 × 7,670 pixels at 1×/)).toBeInTheDocument();
      fireEvent.click(exportButton());
      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
      expect(pngs.map((f) => f.name)).toEqual(['pBR322_sequence.png']);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.scale).toBe(1);
      expect(calls[0]?.svg).toMatch(/<rect x="0" y="0"[^>]*fill="#ffffff"/);
    });

    it('passes the transparent background on to the drawing', async () => {
      const { calls, onClose } = png();
      fireEvent.click(radio('1×'));
      fireEvent.click(radio('Transparent'));
      fireEvent.click(exportButton());
      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
      expect(calls[0]?.svg).toContain('fill="rgba(0,0,0,0)"');
    });

    it('one PNG per A4 page, rasterised in turn', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        let running = 0;
        let most = 0;
        const { pngs, onClose } = setup({
          rasterize: async () => {
            running += 1;
            most = Math.max(most, running);
            await Promise.resolve();
            running -= 1;
            return new Blob(['x']);
          },
        });
        sequenceView();
        fireEvent.click(radio('PNG'));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Split into A4 pages' }));
        expect(
          screen.getByText(/pages, each downloaded as a PNG file of its own/),
        ).toBeInTheDocument();
        // A4 pages are well within what a browser draws, whatever the scale.
        expect(exportButton()).toBeEnabled();
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

    it('shows a failure of the drawing and stays open until something changes', async () => {
      const { pngs, onClose } = setup({
        rasterize: () => Promise.reject(new Error('Canvas is blank.')),
      });
      sequenceView();
      fireEvent.click(radio('PNG'));
      fireEvent.click(radio('1×'));
      fireEvent.click(exportButton());
      await waitFor(() => {
        expect(problem()).toHaveTextContent('Canvas is blank.');
      });
      expect(pngs).toEqual([]);
      expect(onClose).not.toHaveBeenCalled();
      expect(exportButton()).toBeEnabled();
      fireEvent.click(radio('Transparent'));
      expect(problem()).toBeEmptyDOMElement();
    });
  });

  describe('live size check (#243)', () => {
    it('disables Export at 4× on a long sequence, with the reason as an alert', () => {
      const { calls } = setup();
      sequenceView();
      fireEvent.click(radio('PNG'));
      fireEvent.click(radio('4×'));
      const alert = problem();
      expect(alert).toHaveTextContent(
        'At 4× the picture would be 2,256 × 30,680 pixels, more than a browser draws (16,384): choose 2× or less, about 120 or more bases per row or split into A4 pages.',
      );
      expect(alert).toHaveClass('panel__note--error');
      expect(exportButton()).toBeDisabled();
      fireEvent.click(exportButton());
      expect(calls).toEqual([]);
      // The help text is not what carries the error.
      expect(screen.getByText(/Whole rows, numbered as in the document/)).not.toHaveAttribute(
        'role',
      );
    });

    it('enables Export again once the scale is lowered, or the rows widened', () => {
      setup();
      sequenceView();
      fireEvent.click(radio('PNG'));
      fireEvent.click(radio('4×'));
      expect(exportButton()).toBeDisabled();
      fireEvent.click(radio('1×'));
      expect(problem()).toBeEmptyDOMElement();
      expect(exportButton()).toBeEnabled();
      fireEvent.click(radio('4×'));
      expect(exportButton()).toBeDisabled();
      fireEvent.change(screen.getByRole('textbox', { name: 'Bases per row' }), {
        target: { value: '200' },
      });
      expect(problem()).toBeEmptyDOMElement();
      expect(exportButton()).toBeEnabled();
    });

    it('checks the size as the file type changes, without drawing', () => {
      setup();
      sequenceView();
      fireEvent.click(radio('PNG'));
      fireEvent.click(radio('4×'));
      // 4x of the whole plasmid at 60 a row is over the limit; the SVG never is.
      expect(exportButton()).toBeDisabled();
      fireEvent.click(radio('SVG'));
      expect(exportButton()).toBeEnabled();
      expect(problem()).toBeEmptyDOMElement();
    });
  });
});
