// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';

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
});
