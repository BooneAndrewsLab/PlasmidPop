// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import type * as SaveFile from '../saveFile';

import { DEFAULT_PRIMER_CRITERIA, createFeature, rangeSegment, SeqDocument } from '@/core';

import { U49845, pUC19 } from '@/test/cloningFixtures';
import { AnalysisCancelledError, analysisClient } from '@/workers/analysisClient';

import { batchSession } from '../batchSession';
import { downloadText } from '../saveFile';
import { rememberWorkspacePage } from '../primerWorkspace';
import { editorStore } from '../state/editorStore';
import { forgetPanels } from '../state/panelMemory';
import { PrimerWorkspace } from './PrimerWorkspace';

vi.mock('../saveFile', async (importOriginal) => ({
  ...(await importOriginal<typeof SaveFile>()),
  downloadText: vi.fn(),
}));

// The same fixed 600-bp pseudo-random template the workspace tests use.
function template(): string {
  let x = 12345;
  let out = '';
  for (let i = 0; i < 600; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

const doc = SeqDocument.create({ sequence: template(), name: 'tpl' });

/** A plasmid with a short CDS, MKPGF and a stop, for the scan helper. */
const gene = SeqDocument.create({
  sequence: `ATGAAACCCGGGTTTTAA${'GATC'.repeat(10)}`,
  name: 'gene',
}).addFeature(createFeature({ type: 'CDS', name: 'orf', segments: [rangeSegment(0, 18)] }));

function open(d: SeqDocument = doc) {
  act(() => {
    const id = editorStore.openDocument(d);
    rememberWorkspacePage(id, 'batch');
    editorStore.setWorkspace('primers');
  });
  return render(<PrimerWorkspace doc={d} />);
}

function paste(text: string): void {
  act(() => {
    fireEvent.change(screen.getByRole('textbox', { name: 'Rows' }), { target: { value: text } });
  });
}

/** Clicks, and waits inside `act` for what a worker answer writes to the session. */
async function until(click: HTMLElement | null, done: () => void): Promise<void> {
  await act(async () => {
    if (click !== null) fireEvent.click(click);
    await vi.waitFor(done, { timeout: 20000 });
  });
}

const rows = (): HTMLElement[] =>
  within(screen.getByRole('grid', { name: 'Batch results' }))
    .getAllByRole('row')
    .slice(1);

/** What the rows box holds. */
function rowsText(): string {
  const box = screen.getByRole('textbox', { name: 'Rows' });
  if (!(box instanceof HTMLTextAreaElement)) throw new Error('The rows box is not a textarea');
  return box.value;
}

/** The results table's nth body row. */
function row(n: number): HTMLElement {
  const r = rows()[n];
  if (r === undefined) throw new Error(`No result row ${n}`);
  return r;
}

const GOOD = 'name,region\nA,100-250\nB,300-450';

beforeEach(() => {
  batchSession.forget();
  editorStore.setPrimerCriteria(DEFAULT_PRIMER_CRITERIA);
});

afterEach(() => {
  act(() => {
    editorStore.closeDocument();
  });
  forgetPanels();
});

describe('the Batch page (#358, item 141)', { timeout: 60_000 }, () => {
  it('validates a paste, lists the bad rows with their lines and runs the rest', async () => {
    open();
    paste(`${GOOD}\nbad,9000-9100\nA,10-20`);
    expect(screen.getByText(/2 rows ready, 2 rows with a problem and not run/)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Rows with a problem' });
    expect(within(list).getByText(/Line 4 \(bad\):/)).toBeInTheDocument();
    expect(within(list).getByText(/Line 5 \(A\):.*already used on line 2/)).toBeInTheDocument();
    await until(screen.getByRole('button', { name: 'Design 2 rows' }), () => {
      expect(screen.getByText('2 rows designed.')).toBeInTheDocument();
    });
    expect(rows()).toHaveLength(2);
    expect(within(row(0)).getByText('A')).toBeInTheDocument();
  });

  it('says the limit and counts the rows past it as the validation does', () => {
    open();
    const many = Array.from({ length: 100 }, (_, i) => `r${i},100-250`).join('\n');
    paste(`name,region\n${many}`);
    expect(screen.getByText(/Up to 96 rows are designed at once/)).toBeInTheDocument();
    expect(screen.getByText(/96 rows ready.*4 rows past the limit of 96/)).toBeInTheDocument();
  });

  it('continues past a failed row, then saves every designed oligo to My primers', async () => {
    open();
    // No pair can flank a 4-base region at the end of the template.
    paste('name,region\nA,100-250\nbroken,597-600\nB,300-450');
    await until(screen.getByRole('button', { name: 'Design 3 rows' }), () => {
      expect(screen.getByText(/designed, 1 failed\./)).toBeInTheDocument();
    });
    expect(rows()).toHaveLength(3);
    expect(within(row(1)).getByText('failed')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Pool check' })).toHaveTextContent('4 oligos');
    expect(screen.getByText(/only matters if they share a tube/)).toBeInTheDocument();
    await until(screen.getByRole('button', { name: 'Save all to My primers' }), () => {
      expect(screen.getByText('Saved 4 primers to My primers.')).toBeInTheDocument();
    });
  });

  it('opens an order sheet of the designed oligos and downloads it', async () => {
    open();
    paste(GOOD);
    expect(screen.queryByRole('button', { name: 'Order sheet…' })).toBeNull();
    await until(screen.getByRole('button', { name: 'Design 2 rows' }), () => {
      expect(screen.getByText('2 rows designed.')).toBeInTheDocument();
    });
    vi.mocked(downloadText).mockClear();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Order sheet…' }));
    });
    expect(screen.getByRole('dialog', { name: 'Order sheet' })).toBeInTheDocument();
    expect(screen.getByText(/4 oligos on 1 plate/)).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    });
    const [name, text] = vi.mocked(downloadText).mock.calls[0] ?? [];
    expect(name).toBe('order-sheet.csv');
    const lines = String(text).trimEnd().split('\r\n');
    expect(lines[0]).toBe('plate,well,name,sequence,length,scale,purification,notes');
    expect(lines).toHaveLength(5);
    expect(lines.slice(1).map((l) => l.split(',').slice(0, 3).join(','))).toEqual([
      '1,A1,A fwd',
      '1,A2,A rev',
      '1,A3,B fwd',
      '1,A4,B rev',
    ]);
  });

  it('selecting a row shows its detail and draws it on the map', async () => {
    open();
    paste(GOOD);
    await until(screen.getByRole('button', { name: 'Design 2 rows' }), () => {
      expect(screen.getByText('2 rows designed.')).toBeInTheDocument();
    });
    expect(editorStore.getState().preview?.items ?? []).toHaveLength(0);
    act(() => {
      fireEvent.click(row(0));
    });
    expect(screen.getByRole('complementary', { name: 'Row A' })).toBeInTheDocument();
    const ids = editorStore.getState().preview?.items.map((i) => i.id);
    expect(ids).toContain('primers:forward');
  });

  it('sorts by a column', async () => {
    open();
    paste('name,region\nB,300-450\nA,100-250');
    await until(screen.getByRole('button', { name: 'Design 2 rows' }), () => {
      expect(screen.getByText('2 rows designed.')).toBeInTheDocument();
    });
    const names = (): string[] =>
      rows().map((r) => within(r).getAllByRole('cell')[2]?.textContent ?? '');
    expect(names()).toEqual(['B', 'A']);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /^Name/ }));
    });
    expect(names()).toEqual(['A', 'B']);
  });

  it('cancels, keeping the rows done', async () => {
    // The first row is designed; the second waits until the signal stops it, as the worker does.
    const real = analysisClient.designPrimers.bind(analysisClient);
    const spy = vi
      .spyOn(analysisClient, 'designPrimers')
      .mockImplementation((seq, topology, target, options, long) =>
        target.start === 99
          ? real(seq, topology, target, options, long)
          : new Promise((_, reject) => {
              long?.signal?.addEventListener('abort', () => {
                reject(new AnalysisCancelledError());
              });
            }),
      );
    try {
      open();
      paste('name,region\nA,100-250\nB,300-450\nC,50-200');
      await until(screen.getByRole('button', { name: 'Design 3 rows' }), () => {
        expect(screen.getByText('Designing: 1 of 3 rows.')).toBeInTheDocument();
      });
      await until(screen.getByRole('button', { name: 'Cancel' }), () => {
        expect(
          screen.getByText('Cancelled: 1 of 3 rows were done and are kept.'),
        ).toBeInTheDocument();
      });
      expect(rows()).toHaveLength(1);
      expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('generates scan rows for a CDS and fills the table', () => {
    open(gene);
    act(() => {
      fireEvent.click(screen.getByText('Generate scan rows…'));
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    });
    const text = rowsText();
    expect(text).toContain('orf_K2A');
    expect(text).toContain('GCC');
    expect(
      screen.getByText(/5 rows for orf replaced the table; 1 codon left out/),
    ).toBeInTheDocument();
    expect(screen.getByText(/5 rows ready/)).toBeInTheDocument();
  });

  it('keeps the table, the run and the badge across a page switch', async () => {
    open();
    paste(GOOD);
    await until(screen.getByRole('button', { name: 'Design 2 rows' }), () => {
      expect(screen.getByText('2 rows designed.')).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: /^Batch/ })).toHaveTextContent('2');
    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /^Check/ }));
    });
    expect(screen.queryByRole('textbox', { name: 'Rows' })).toBeNull();
    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /^Batch/ }));
    });
    expect(rowsText()).toBe(GOOD);
    expect(rows()).toHaveLength(2);
  });

  it('opens the product of a mutagenesis row as a scratch tab', async () => {
    open(gene);
    paste('name,region,change\nM1L,1-3,CTG');
    await until(screen.getByRole('button', { name: 'Design 1 row' }), () => {
      expect(screen.getByText(/1 row designed/)).toBeInTheDocument();
    });
    act(() => {
      fireEvent.click(row(0));
    });
    const before = editorStore.getState().documents.length;
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Open product' }));
    });
    expect(editorStore.getState().documents.length).toBe(before + 1);
  });

  it('reads an uploaded table into the box', async () => {
    open();
    const file = new File([GOOD], 'rows.csv', { type: 'text/csv' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Table file'), { target: { files: [file] } });
      await vi.waitFor(() => {
        expect(screen.getByText('Read rows.csv.')).toBeInTheDocument();
      });
    });
    expect(rowsText()).toBe(GOOD);
    expect(screen.getByText(/2 rows ready/)).toBeInTheDocument();
  });

  it('says why a table with no header cannot be read', () => {
    open();
    paste('just one line of nothing useful');
    expect(screen.getByText(/column/i, { selector: '.panel__error' })).toBeInTheDocument();
  });

  it('labels the results with what the run used, and says when the settings have moved on', async () => {
    act(() => {
      editorStore.openDocument(U49845);
      const id = editorStore.openDocument(pUC19);
      rememberWorkspacePage(id, 'batch');
      editorStore.setWorkspace('primers');
    });
    render(<PrimerWorkspace doc={pUC19} />);
    const select = (label: string, value: string): void => {
      act(() => {
        fireEvent.change(screen.getByRole('combobox', { name: label }), { target: { value } });
      });
    };
    const caption = (): HTMLElement => screen.getByTestId('batch-run-caption');
    select('Method', 'restriction');
    paste(`name,template,region\nAXL2,${U49845.name},687-836`);
    await until(screen.getByRole('button', { name: 'Design 1 row' }), () => {
      expect(screen.getByText(/1 row designed/)).toBeInTheDocument();
    });
    expect(caption()).toHaveTextContent(`Restriction sites into ${pUC19.name} (EcoRI/BamHI)`);
    expect(caption()).not.toHaveTextContent('Settings have changed');

    select('Method', 'homology');
    expect(caption()).toHaveTextContent(`Restriction sites into ${pUC19.name} (EcoRI/BamHI)`);
    expect(caption()).toHaveTextContent(
      'Settings have changed since this run; Design again to use them.',
    );
    expect(rows()).toHaveLength(1);

    select('Method', 'restriction');
    expect(caption()).not.toHaveTextContent('Settings have changed');

    act(() => {
      fireEvent.change(screen.getByRole('textbox', { name: '5′ enzyme' }), {
        target: { value: 'XbaI' },
      });
    });
    expect(caption()).toHaveTextContent('Settings have changed');
    await until(screen.getByRole('button', { name: 'Design 1 row' }), () => {
      expect(caption()).toHaveTextContent(`Restriction sites into ${pUC19.name} (XbaI/BamHI)`);
    });
    expect(caption()).not.toHaveTextContent('Settings have changed');
  });

  it('says when the run used changed primer settings, and when they have moved since (#428)', async () => {
    open();
    paste(GOOD);
    const caption = (): HTMLElement => screen.getByTestId('batch-run-caption');
    await until(screen.getByRole('button', { name: 'Design 2 rows' }), () => {
      expect(screen.getByText('2 rows designed.')).toBeInTheDocument();
    });
    expect(caption()).toHaveTextContent('Primer pairs on tpl');
    expect(caption()).not.toHaveTextContent('changed primer settings');
    expect(caption()).not.toHaveTextContent('Settings have changed');

    act(() => {
      editorStore.setPrimerCriteria({ ...DEFAULT_PRIMER_CRITERIA, dimerDg: -2.5 });
    });
    expect(caption()).toHaveTextContent('Settings have changed since this run');
    expect(caption()).not.toHaveTextContent('changed primer settings');
    await until(screen.getByRole('button', { name: 'Design 2 rows' }), () => {
      expect(caption()).toHaveTextContent(
        'Primer pairs on tpl; changed primer settings: Dimer ΔG −2.5',
      );
    });
    expect(caption()).not.toHaveTextContent('Settings have changed');

    act(() => {
      editorStore.setPrimerCriteria(DEFAULT_PRIMER_CRITERIA);
    });
    expect(caption()).toHaveTextContent('Settings have changed since this run');
  });
});
