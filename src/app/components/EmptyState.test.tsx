// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { type DocumentSummary, SCRATCH_LIFETIME_DAYS } from '@/storage';

import { onOpenGuide } from '../help/openGuide';
import { persistence } from '../state/persistence';
import { EmptyState } from './EmptyState';

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
  it('puts the cloning tutorials and the user guide on the landing page', async () => {
    const listed = Promise.resolve([]);
    vi.spyOn(persistence, 'listStored').mockReturnValue(listed);
    vi.spyOn(persistence, 'pruneScratch').mockResolvedValue(0);
    const opened: string[] = [];
    const off = onOpenGuide((id) => opened.push(id));
    render(<EmptyState />);
    await act(() => listed);
    const tutorials = screen.getByRole('link', { name: 'Cloning tutorials' });
    expect(tutorials.getAttribute('href')).toBe(`${import.meta.env.BASE_URL}tutorials/`);
    expect(tutorials.getAttribute('target')).toBe('_blank');
    fireEvent.click(screen.getByRole('button', { name: 'User guide' }));
    off();
    expect(opened).toEqual(['01-getting-started']);
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

  it('asks to open a file rather than to drop one, and folds the prose away', async () => {
    answer(['(pointer: coarse)', '(max-width: 600px)']);
    await renderEmpty();
    expect(screen.getByText('Open a GenBank, FASTA or SnapGene file.')).toBeInTheDocument();
    expect(screen.queryByText(/^Drop a GenBank/)).toBeNull();
    const more = screen.getByText('Other ways in, and your data').closest('details');
    expect(more).not.toBeNull();
    expect(more).toContainElement(screen.getByRole('link', { name: 'MIT licence' }));
  });

  it('keeps the drop wording and the open prose on a mouse', async () => {
    answer([]);
    await renderEmpty();
    expect(screen.getByText(/^Drop a GenBank/)).toBeInTheDocument();
    expect(screen.queryByText('Other ways in, and your data')).toBeNull();
  });
});
