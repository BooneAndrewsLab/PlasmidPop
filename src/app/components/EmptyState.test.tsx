// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { type DocumentSummary, SCRATCH_LIFETIME_DAYS } from '@/storage';

import { analytics } from '../analytics';
import { onOpenGuide } from '../help/openGuide';
import { editorStore } from '../state/editorStore';
import { persistence } from '../state/persistence';
import { EXAMPLES } from '../examples';
import { openExample } from '../openFile';
import { EmptyState } from './EmptyState';

vi.mock('../openFile', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  openExample: vi.fn(() => null),
}));

describe('EmptyState licence line', () => {
  it('names the MIT licence and links to LICENSE and the source', async () => {
    // Settle the recent-files listing inside the test: left to resolve on its
    // own, a loaded machine lands its setState after jsdom is torn down.
    const listed = Promise.resolve([]);
    vi.spyOn(persistence, 'listStored').mockReturnValue(listed);
    vi.spyOn(persistence, 'pruneScratch').mockResolvedValue(0);
    render(<EmptyState />);
    await act(() => listed);
    const licence = screen.getByRole('link', { name: 'MIT licence' });
    expect(licence.getAttribute('href')).toBe(
      'https://github.com/BooneAndrewsLab/PlasmidPop/blob/main/LICENSE',
    );
    const source = screen.getByRole('link', { name: 'source is on GitHub' });
    expect(source.getAttribute('href')).toBe('https://github.com/BooneAndrewsLab/PlasmidPop');
    expect(licence.closest('p')?.textContent).toContain(
      'Free and open source under the MIT licence',
    );
  });
});

describe('EmptyState start buttons', () => {
  it('puts the tutorials and the user guide on the landing page', async () => {
    const listed = Promise.resolve([]);
    vi.spyOn(persistence, 'listStored').mockReturnValue(listed);
    vi.spyOn(persistence, 'pruneScratch').mockResolvedValue(0);
    const opened: string[] = [];
    const off = onOpenGuide((id) => opened.push(id));
    render(<EmptyState />);
    await act(() => listed);
    const tutorials = screen.getByRole('link', { name: 'Tutorials' });
    expect(tutorials.getAttribute('href')).toBe(`${import.meta.env.BASE_URL}tutorials/`);
    expect(tutorials.getAttribute('target')).toBe('_blank');
    fireEvent.click(screen.getByRole('button', { name: 'User guide' }));
    off();
    expect(opened).toEqual(['01-getting-started']);
  });

  it('reports a click on Tutorials as a coarse help event and still opens the page (#433)', async () => {
    const listed = Promise.resolve([]);
    vi.spyOn(persistence, 'listStored').mockReturnValue(listed);
    vi.spyOn(persistence, 'pruneScratch').mockResolvedValue(0);
    const once = vi.spyOn(analytics, 'trackOnce').mockImplementation(() => undefined);
    render(<EmptyState />);
    await act(() => listed);
    const tutorials = screen.getByRole('link', { name: 'Tutorials' });
    fireEvent.click(tutorials);
    expect(once).toHaveBeenCalledTimes(1);
    expect(once).toHaveBeenCalledWith('help', 'tutorials');
    expect(tutorials.getAttribute('href')).toBe(`${import.meta.env.BASE_URL}tutorials/`);
    expect(tutorials.getAttribute('target')).toBe('_blank');
    once.mockRestore();
  });

  it('offers the multiple alignment window, which needs no document (#369)', async () => {
    const listed = Promise.resolve([]);
    vi.spyOn(persistence, 'listStored').mockReturnValue(listed);
    vi.spyOn(persistence, 'pruneScratch').mockResolvedValue(0);
    render(<EmptyState />);
    await act(() => listed);
    fireEvent.click(screen.getByRole('button', { name: 'Align several' }));
    expect(editorStore.getState().msaDialog).toBe(true);
    act(() => {
      editorStore.dismissMsa();
    });
  });
});

const DAY = 24 * 60 * 60 * 1000;

function row(id: string, kind: 'file' | 'scratch', ageDays = 0): DocumentSummary {
  return {
    id,
    name: id,
    fileName: kind === 'file' ? `${id}.gb` : null,
    length: 100,
    topology: 'circular',
    alphabet: 'nucleotide',
    featureCount: 0,
    kind,
    updatedAt: Date.now() - ageDays * DAY,
  };
}

async function renderListing(rows: DocumentSummary[]) {
  const order: string[] = [];
  const prune = vi.spyOn(persistence, 'pruneScratch').mockImplementation(() => {
    order.push('prune');
    return Promise.resolve(0);
  });
  const list = vi.spyOn(persistence, 'listStored').mockImplementation(() => {
    order.push('list');
    return Promise.resolve(rows);
  });
  render(<EmptyState />);
  await act(() => Promise.resolve());
  await act(() => Promise.resolve());
  return { order, prune, list };
}

describe('EmptyState, Recent files and Unkept (item 110)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes scratch documents past their time before it lists anything', async () => {
    const { order } = await renderListing([]);
    expect(order).toEqual(['prune', 'list']);
  });

  it('lists kept documents under Recent files and scratch ones apart, collapsed', async () => {
    await renderListing([row('pKept', 'file'), row('pMade', 'scratch')]);
    const recent = screen.getByRole('region', { name: 'Recent files' });
    expect(within(recent).getByText('pKept')).toBeInTheDocument();
    expect(within(recent).queryByText('pMade')).toBeNull();
    const unkept = screen.getByText('Unkept (1)').closest('details');
    expect(unkept).not.toBeNull();
    expect(unkept?.open).toBe(false);
    expect(within(unkept as HTMLElement).getByText('pMade')).toBeInTheDocument();
    expect(within(unkept as HTMLElement).queryByText('pKept')).toBeNull();
  });

  it('shows Unkept without a Recent files section when nothing is kept, and neither when empty', async () => {
    await renderListing([row('pMade', 'scratch')]);
    expect(screen.queryByRole('region', { name: 'Recent files' })).toBeNull();
    expect(screen.getByText('Unkept (1)')).toBeInTheDocument();
  });

  it('shows no Unkept section when every document is kept', async () => {
    await renderListing([row('pKept', 'file')]);
    expect(screen.queryByText(/Unkept/)).toBeNull();
  });

  it('keeps one row, keeps all, and removes one', async () => {
    const keep = vi.spyOn(persistence, 'keepStored').mockResolvedValue();
    const remove = vi.spyOn(persistence, 'removeStoredWithUndo').mockResolvedValue(1);
    await renderListing([row('pA', 'scratch'), row('pB', 'scratch')]);
    const unkept = screen.getByText('Unkept (2)').closest('details') as HTMLElement;
    const item = within(unkept).getByText('pA').closest('li') as HTMLElement;
    fireEvent.click(within(item).getByRole('button', { name: 'Keep' }));
    expect(keep).toHaveBeenLastCalledWith(['pA']);
    fireEvent.click(within(item).getByRole('button', { name: 'Remove' }));
    expect(remove).toHaveBeenCalledWith(['pA'], 'Removed "pA".');
    fireEvent.click(within(unkept).getByRole('button', { name: 'Keep all' }));
    expect(keep).toHaveBeenLastCalledWith(['pA', 'pB']);
  });

  it('opens an unkept row from the list', async () => {
    const openStored = vi.spyOn(persistence, 'openStored').mockResolvedValue();
    await renderListing([row('pA', 'scratch')]);
    fireEvent.click(screen.getByRole('button', { name: /pA/ }));
    expect(openStored).toHaveBeenCalledWith('pA');
  });

  it('warns about unkept documents due within the week, with a way to keep them', async () => {
    const keep = vi.spyOn(persistence, 'keepStored').mockResolvedValue();
    await renderListing([
      row('pOld', 'scratch', SCRATCH_LIFETIME_DAYS - 3),
      row('pNew', 'scratch', 1),
    ]);
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('1 unkept document will be removed from this browser');
    fireEvent.click(within(notice).getByRole('button', { name: 'Keep it' }));
    expect(keep).toHaveBeenCalledWith(['pOld']);
  });

  it('says nothing when none is near its time', async () => {
    await renderListing([row('pNew', 'scratch', 1), row('pKept', 'file', 365)]);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('EmptyState on a touch phone', () => {
  const real = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  afterEach(() => {
    if (real === undefined) Reflect.deleteProperty(window, 'matchMedia');
    else Object.defineProperty(window, 'matchMedia', real);
  });
  const answer = (matching: readonly string[]): void => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string): MediaQueryList =>
        ({
          matches: matching.includes(query),
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    });
  };
  const renderEmpty = async (): Promise<void> => {
    const listed = Promise.resolve([]);
    vi.spyOn(persistence, 'listStored').mockReturnValue(listed);
    vi.spyOn(persistence, 'pruneScratch').mockResolvedValue(0);
    render(<EmptyState />);
    await act(() => listed);
  };

  it('asks to open a file rather than to drop one, with no folded other-ways-in details', async () => {
    answer(['(pointer: coarse)', '(max-width: 600px)']);
    await renderEmpty();
    expect(screen.getByText('Open a GenBank, FASTA or SnapGene file.')).toBeInTheDocument();
    expect(screen.queryByText(/^Drop a GenBank/)).toBeNull();
    expect(screen.queryByText(/Other ways in/)).toBeNull();
    const privacy = screen.getByText('Your data stays in your browser').closest('details');
    expect(privacy).not.toBeNull();
    expect(privacy).not.toHaveAttribute('open');
  });
});

describe('EmptyState other ways in', () => {
  const renderEmpty = async (): Promise<void> => {
    const listed = Promise.resolve([]);
    vi.spyOn(persistence, 'listStored').mockReturnValue(listed);
    vi.spyOn(persistence, 'pruneScratch').mockResolvedValue(0);
    render(<EmptyState />);
    await act(() => listed);
  };

  it('keeps the drop wording and has no other-ways-in details on a mouse', async () => {
    await renderEmpty();
    expect(screen.getByText(/^Drop a GenBank/)).toBeInTheDocument();
    expect(screen.queryByText(/Other ways in/)).toBeNull();
  });

  it('shows the paste line under the four buttons', async () => {
    await renderEmpty();
    expect(
      screen.getByText('Or paste a sequence, GenBank or FASTA record here (Ctrl+V).'),
    ).toBeInTheDocument();
  });

  it('keeps the privacy wording unchanged in a details that starts collapsed', async () => {
    await renderEmpty();
    const privacy = screen.getByText('Your data stays in your browser').closest('details');
    expect(privacy).not.toBeNull();
    expect(privacy).not.toHaveAttribute('open');
    expect(privacy?.textContent).toContain(
      'Everything stays in your browser: documents are kept here as you work and never uploaded, and no file on your disk is written to. Opening from NCBI sends NCBI the accession numbers you type, and nothing else. Download the ones you want as files. Your browser may ask whether PlasmidPop can keep its data; saying yes protects your documents when disk space runs low.',
    );
    const licence = screen.getByRole('link', { name: 'MIT licence' }).closest('p');
    expect(licence?.textContent).toBe(
      'Free and open source under the MIT licence; the source is on GitHub.',
    );
    expect(privacy).not.toContainElement(licence);
  });

  it('makes Open example the primary button and the others plain', async () => {
    await renderEmpty();
    const example = screen.getByRole('button', { name: /^Open example: pBR322/ });
    expect(example).toHaveClass('button', 'button--primary');
    expect(example.textContent).toBe('Open example');
    for (const name of ['New sequence', 'From NCBI', 'Align several']) {
      const b = screen.getByRole('button', { name });
      expect(b).toHaveClass('button');
      expect(b).not.toHaveClass('button--primary');
    }
    expect(screen.getByRole('link', { name: 'Tutorials' })).not.toHaveClass('button--primary');
  });

  it('opens the bundled example from its button', async () => {
    await renderEmpty();
    fireEvent.click(screen.getByRole('button', { name: /^Open example: pBR322/ }));
    expect(openExample).toHaveBeenCalledWith(EXAMPLES[0]);
  });

  it('starts a new sequence from its button', async () => {
    await renderEmpty();
    const request = vi.spyOn(editorStore, 'requestNewDocument').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'New sequence' }));
    expect(request).toHaveBeenCalledTimes(1);
    request.mockRestore();
  });

  it('opens the NCBI dialog from From NCBI', async () => {
    await renderEmpty();
    fireEvent.click(screen.getByRole('button', { name: 'From NCBI' }));
    expect(editorStore.getState().ncbiDialog).toBe(true);
    act(() => {
      editorStore.dismissNcbi();
    });
    expect(editorStore.getState().ncbiDialog).toBe(false);
  });

  it('leaves out Open example when there is no example', async () => {
    const mutable = EXAMPLES as unknown as unknown[];
    const saved = mutable.splice(0, mutable.length);
    try {
      await renderEmpty();
      expect(screen.queryByRole('button', { name: /^Open example/ })).toBeNull();
      expect(screen.getByRole('button', { name: 'New sequence' })).toBeInTheDocument();
    } finally {
      mutable.push(...saved);
    }
  });
});
