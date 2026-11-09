// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import type * as SaveFile from '../saveFile';

import { type SeqDocument } from '@/core';
import { parseGenBank, readZip } from '@/io';
import { U49845, ggDestination, ggGene, ifGene, linearVector, pUC19 } from '@/test/cloningFixtures';
import { AnalysisCancelledError, analysisClient } from '@/workers/analysisClient';

import { batchSession } from '../batchSession';
import { rememberWorkspacePage } from '../primerWorkspace';
import { downloadBlob, downloadText } from '../saveFile';
import { editorStore } from '../state/editorStore';
import { forgetPanels } from '../state/panelMemory';
import { PrimerWorkspace } from './PrimerWorkspace';

vi.mock('../saveFile', async (importOriginal) => ({
  ...(await importOriginal<typeof SaveFile>()),
  downloadText: vi.fn(),
  downloadBlob: vi.fn(),
}));

/**
 * The Batch page's cloning methods end to end (#360, item 141, packet 6),
 * with the real engine run in-thread: paste, run, results, and each action.
 * Nothing here looks at the page in a browser.
 */

/** The vector in front, with the tabs the rows take their inserts from open behind it. */
function open(vector: SeqDocument, inserts: readonly SeqDocument[]) {
  act(() => {
    for (const d of inserts) editorStore.openDocument(d);
    const id = editorStore.openDocument(vector);
    rememberWorkspacePage(id, 'batch');
    editorStore.setWorkspace('primers');
  });
  return render(<PrimerWorkspace doc={vector} />);
}

function method(label: string): void {
  act(() => {
    fireEvent.change(screen.getByRole('combobox', { name: 'Method' }), {
      target: { value: label },
    });
  });
}

function paste(text: string): void {
  act(() => {
    fireEvent.change(screen.getByRole('textbox', { name: 'Rows' }), { target: { value: text } });
  });
}

async function until(click: HTMLElement | null, done: () => void): Promise<void> {
  await act(async () => {
    if (click !== null) fireEvent.click(click);
    await vi.waitFor(done, { timeout: 30000 });
  });
}

const rows = (): HTMLElement[] =>
  within(screen.getByRole('grid', { name: 'Batch results' }))
    .getAllByRole('row')
    .slice(1);

/** The results table's nth body row. */
function row(n: number): HTMLElement {
  const r = rows()[n];
  if (r === undefined) throw new Error(`No result row ${n}`);
  return r;
}

const button = (name: string | RegExp): HTMLElement => screen.getByRole('button', { name });

/** Runs the pasted rows and waits for the summary line. */
async function design(count: number, summary: RegExp): Promise<void> {
  await until(button(`Design ${count} ${count === 1 ? 'row' : 'rows'}`), () => {
    expect(screen.getByText(summary)).toBeInTheDocument();
  });
}

function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(new Uint8Array(reader.result));
      else reject(new Error('not bytes'));
    };
    reader.onerror = () => {
      reject(new Error('unreadable'));
    };
    reader.readAsArrayBuffer(blob);
  });
}

/** The ZIP the page handed to the download. */
async function downloadedZip() {
  const [name, blob] = vi.mocked(downloadBlob).mock.calls.at(-1) ?? [];
  if (typeof name !== 'string' || !(blob instanceof Blob)) throw new Error('nothing downloaded');
  return { name, ...readZip(await bytesOf(blob)) };
}

const RESTRICTION_ROWS = `name,template,region\nAXL2,${U49845.name},687-836\nREV,${U49845.name},3300-3450`;
const GG_ROWS = `name,template\nggA,${ggGene.name}\nggB,${ggGene.name}`;
const HOMOLOGY_ROWS = `name,template\nifA,${ifGene.name}\nifB,${ifGene.name}`;

beforeEach(() => {
  batchSession.forget();
  vi.mocked(downloadText).mockClear();
  vi.mocked(downloadBlob).mockClear();
});

afterEach(() => {
  act(() => {
    editorStore.closeDocument();
  });
  forgetPanels();
});

describe('the Batch page, cloning methods (#360, item 141)', { timeout: 60_000 }, () => {
  it('offers the methods, and the recipe’s own controls and columns', () => {
    open(pUC19, [U49845]);
    const select = screen.getByRole('combobox', { name: 'Method' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Primer pairs', 'Restriction sites', 'Golden Gate part', 'Homology ends']);
    // Primer pairs, as it was: the scan helper, no vector.
    expect(screen.getByText('Generate scan rows…')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Vector' })).toBeNull();

    method('restriction');
    expect(screen.queryByText('Generate scan rows…')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Vector' })).toHaveValue(pUC19.name);
    expect(screen.getByRole('textbox', { name: '5′ enzyme' })).toHaveValue('EcoRI');
    expect(screen.getByRole('textbox', { name: '3′ enzyme' })).toHaveValue('BamHI');
    expect(
      screen.getByText(/Columns read: name, template, region, sequence, enzyme/),
    ).toBeVisible();

    method('golden-gate');
    expect(screen.getByRole('combobox', { name: 'Enzyme' })).toHaveValue('BsaI');
    expect(screen.getByText(/include_start, include_stop, tm/)).toBeVisible();

    method('homology');
    expect(screen.getByRole('combobox', { name: 'Kit' })).toHaveValue('in-fusion');
    expect(screen.queryByRole('textbox', { name: 'Homology in bp' })).toBeNull();
    act(() => {
      fireEvent.change(screen.getByRole('combobox', { name: 'Kit' }), {
        target: { value: 'yeast' },
      });
    });
    expect(screen.getByRole('textbox', { name: 'Homology in bp' })).toHaveValue('40');
    expect(screen.getByText(/The vector must be linear/)).toBeInTheDocument();
  });

  it('warns, before the run, of the columns the method does not read', () => {
    open(pUC19, [U49845]);
    method('homology');
    paste(`name,template,tm,size,kit\nA,${U49845.name},60,500,yeast`);
    expect(
      screen.getByText(/Not read by this method, and ignored: tm, size\./),
    ).toBeInTheDocument();
    method('restriction');
    expect(
      screen.getByText(/Not read by this method, and ignored: size, kit\./),
    ).toBeInTheDocument();
  });

  it('designs restriction rows, then saves, orders, zips and writes the protocol', async () => {
    open(pUC19, [U49845]);
    method('restriction');
    // A row can be read and still not be designed: an enzyme that is not in the set.
    paste(
      `name,template,region,enzyme\n${RESTRICTION_ROWS.split('\n')
        .slice(1)
        .map((l) => `${l},`)
        .join('\n')}\nbroken,${U49845.name},1-100,Nope/BamHI`,
    );
    await design(3, /2 rows designed, 1 failed\./);
    expect(rows()).toHaveLength(3);
    const first = within(row(0));
    expect(first.getByText('AXL2')).toBeInTheDocument();
    // A failed row says why, and the others went on.
    expect(within(row(2)).getByText('failed')).toBeInTheDocument();
    expect(within(row(2)).getByText('Nope is not in the enzyme set.')).toBeVisible();

    // The detail: the oligos in their parts and the construct's size.
    act(() => {
      fireEvent.click(row(0));
    });
    const detail = within(screen.getByRole('complementary', { name: 'Row AXL2' }));
    expect(detail.getByText(/construct [\d,]+ bp/)).toBeInTheDocument();
    expect(detail.getByText('→ Forward')).toBeInTheDocument();
    expect(document.querySelector('[data-tip="recognition site"]')).not.toBeNull();
    expect(detail.getByText(/not drawn on the map/i)).toBeInTheDocument();
    expect(editorStore.getState().preview?.items ?? []).toHaveLength(0);

    await until(button('Save all to My primers'), () => {
      expect(screen.getByText('Saved 4 primers to My primers.')).toBeInTheDocument();
    });

    act(() => {
      fireEvent.click(button('Order sheet…'));
    });
    expect(screen.getByRole('dialog', { name: 'Order sheet' })).toBeInTheDocument();
    expect(screen.getByText(/4 oligos on 1 plate/)).toBeInTheDocument();
    act(() => {
      fireEvent.click(button('Download CSV'));
    });
    const sheet = String(vi.mocked(downloadText).mock.calls[0]?.[1]).trimEnd().split('\r\n');
    expect(sheet.slice(1).map((l) => l.split(',')[2])).toEqual([
      'AXL2 fwd',
      'AXL2 rev',
      'REV fwd',
      'REV rev',
    ]);

    await until(button('Download constructs'), () => {
      expect(screen.getByText('Downloaded 2 constructs as one ZIP.')).toBeInTheDocument();
    });
    const zip = await downloadedZip();
    expect(zip.name).toBe(`${pUC19.name}_constructs.zip`);
    expect(zip.entries.map((e) => e.path)).toEqual(['AXL2.gb', 'REV.gb']);
    const back = parseGenBank(new TextDecoder().decode(zip.entries[0]?.data)).documents[0];
    expect(back?.topology).toBe('circular');
    expect(back?.length).toBeGreaterThan(pUC19.length);

    vi.mocked(downloadText).mockClear();
    act(() => {
      fireEvent.click(button('Protocol…'));
    });
    await until(button('Download Markdown'), () => {
      expect(downloadText).toHaveBeenCalled();
    });
    const [file, md] = vi.mocked(downloadText).mock.calls[0] ?? [];
    expect(file).toBe('batch_protocol.md');
    const text = String(md);
    expect(text.match(/^## Oligos to order$/gm)).toHaveLength(1);
    expect(text).toContain('4 oligos for 2 constructs.');
    expect(text).toContain('## Construct 1: AXL2');
    expect(text).toContain('## Construct 2: REV');
    expect(text).toContain('| AXL2 fwd |');
    expect(text).toContain('Digest');
  });

  it('designs Golden Gate rows with the destination’s overhangs, once, and writes an HTML protocol', async () => {
    open(ggDestination, [ggGene]);
    method('golden-gate');
    paste(GG_ROWS);
    await design(2, /2 rows designed\./);
    expect(
      screen.getByText(/Every part carries the destination’s overhangs, [ACGT]{4} and [ACGT]{4}\./),
    ).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
    act(() => {
      fireEvent.click(button('Protocol…'));
    });
    await until(button('Download HTML'), () => {
      expect(downloadText).toHaveBeenCalled();
    });
    const [file, html] = vi.mocked(downloadText).mock.calls[0] ?? [];
    expect(file).toBe('batch_protocol.html');
    expect(String(html)).toContain('<title>Batch protocol</title>');
    expect(String(html).match(/<h2>Oligos to order<\/h2>/g)).toHaveLength(1);
    expect(String(html)).toContain('Golden Gate');
  });

  it.each([
    ['in-fusion', 'In-Fusion'],
    ['nebuilder', 'NEBuilder HiFi'],
    ['yeast', 'Yeast assembly'],
  ] as const)('designs homology rows with %s on a linear vector', async (kit, name) => {
    open(linearVector(), [ifGene]);
    method('homology');
    act(() => {
      fireEvent.change(screen.getByRole('combobox', { name: 'Kit' }), { target: { value: kit } });
    });
    paste(HOMOLOGY_ROWS);
    await design(2, /2 rows designed\./);
    act(() => {
      fireEvent.click(row(0));
    });
    expect(
      within(screen.getByRole('complementary', { name: 'Row ifA' })).getByText(
        new RegExp(`${name} · construct`),
      ),
    ).toBeInTheDocument();
    // The vector's end is the tail, upper case, in its own part.
    expect(document.querySelector('[data-tip="the vector\'s end"]')).not.toBeNull();
    expect(document.querySelector('[data-tip="anneals to the insert"]')).not.toBeNull();
  });

  it('says once why a vector cannot take the recipe, and designs no row', async () => {
    // pUC19 is a circle: a kit's homology needs a linear vector.
    open(pUC19, [ifGene]);
    method('homology');
    paste(`name,template\na,${ifGene.name}\nb,${ifGene.name}\nc,${ifGene.name}`);
    await until(button('Design 3 rows'), () => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent(
      `${pUC19.name} is circular, so it has no ends`,
    );
    expect(screen.queryByRole('grid', { name: 'Batch results' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save all to My primers' })).toBeNull();
  });

  it('opens the construct of a row, and all of them up to a dozen', async () => {
    open(linearVector(), [ifGene]);
    method('homology');
    paste(HOMOLOGY_ROWS);
    await design(2, /2 rows designed\./);
    const before = editorStore.getState().documents.length;
    act(() => {
      fireEvent.click(row(1));
    });
    act(() => {
      fireEvent.click(button('Open product'));
    });
    expect(editorStore.getState().documents.length).toBe(before + 1);
    expect(editorStore.getState().scratch).toBe(true);
  });

  it('opens every construct with Open all', async () => {
    open(linearVector(), [ifGene]);
    method('homology');
    paste(HOMOLOGY_ROWS);
    await design(2, /2 rows designed\./);
    const before = editorStore.getState().documents.length;
    act(() => {
      fireEvent.click(button('Open all constructs'));
    });
    expect(editorStore.getState().documents.length).toBe(before + 2);
  });

  it('never opens a wall of tabs: Open all is off above twelve, and says why', async () => {
    open(linearVector(), [ifGene]);
    method('homology');
    paste(
      `name,template\n${Array.from({ length: 13 }, (_, i) => `r${i},${ifGene.name}`).join('\n')}`,
    );
    await design(13, /13 rows designed\./);
    expect(button('Open all constructs')).toBeDisabled();
    expect(screen.getByText(/Open all is limited to 12 constructs/)).toBeInTheDocument();
    // The zip is not capped.
    expect(button('Download constructs')).toBeEnabled();
  });

  it('cancels, keeping the rows done', async () => {
    const real = analysisClient.designCloning.bind(analysisClient);
    let calls = 0;
    const spy = vi.spyOn(analysisClient, 'designCloning').mockImplementation((request, long) =>
      ++calls === 1
        ? real(request, long)
        : new Promise((_, reject) => {
            long?.signal?.addEventListener('abort', () => {
              reject(new AnalysisCancelledError());
            });
          }),
    );
    try {
      open(linearVector(), [ifGene]);
      method('homology');
      paste(`name,template\na,${ifGene.name}\nb,${ifGene.name}\nc,${ifGene.name}`);
      await until(button('Design 3 rows'), () => {
        expect(screen.getByText('Designing: 1 of 3 rows.')).toBeInTheDocument();
      });
      await until(button('Cancel'), () => {
        expect(
          screen.getByText('Cancelled: 1 of 3 rows were done and are kept.'),
        ).toBeInTheDocument();
      });
      expect(rows()).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('clears the results when the method changes, and the badge stops counting them (#429)', async () => {
    open(linearVector(), [ifGene]);
    method('homology');
    paste(HOMOLOGY_ROWS);
    await design(2, /2 rows designed\./);
    expect(screen.getByRole('tab', { name: /^Batch/ })).toHaveTextContent('2');
    method('primers');
    expect(screen.queryByRole('grid', { name: 'Batch results' })).toBeNull();
    expect(screen.getByRole('tab', { name: /^Batch/ })).not.toHaveTextContent('2');
    method('homology');
    expect(screen.queryByRole('grid', { name: 'Batch results' })).toBeNull();
    expect(screen.queryByTestId('batch-run-caption')).toBeNull();
  });
});
