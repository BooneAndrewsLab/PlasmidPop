// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { type DocumentSummary, RECENT_FILES_LIMIT, REMOVAL_HOLD_MS } from '@/storage';

import { editorStore } from '../state/editorStore';
import { persistence } from '../state/persistence';
import { EmptyState } from './EmptyState';
import { RemovalNotice } from './RemovalNotice';

function row(id: string, over: Partial<DocumentSummary> = {}): DocumentSummary {
  return {
    id,
    name: id,
    fileName: `${id}.gb`,
    length: 100,
    topology: 'circular',
    alphabet: 'nucleotide',
    featureCount: 0,
    kind: 'file',
    updatedAt: Date.now() - 1000,
    ...over,
  };
}

const made = (id: string, parent: string, over: Partial<DocumentSummary> = {}) =>
  row(id, {
    kind: 'scratch',
    fileName: null,
    updatedAt: 5,
    parentChecksum: `cdseguid=${parent}`,
    parentName: parent,
    ...over,
  });

async function show(rows: DocumentSummary[]) {
  vi.spyOn(persistence, 'pruneScratch').mockResolvedValue(0);
  vi.spyOn(persistence, 'listStored').mockResolvedValue(rows);
  render(<EmptyState />);
  await act(() => Promise.resolve());
  await act(() => Promise.resolve());
}

async function browse(rows: DocumentSummary[]): Promise<HTMLElement> {
  await show(rows);
  fireEvent.click(screen.getByRole('button', { name: 'Browse all files…' }));
  return screen.getByRole('dialog', { name: 'All files' });
}

/** The names of the rows in a list, in order (a group is its heading). */
const names = (scope: HTMLElement): string[] =>
  within(scope)
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.recent__title-text')?.textContent ?? '');

afterEach(() => {
  vi.restoreAllMocks();
  editorStore.dismissRemovalNotice();
});

describe('Recent files is capped (item 111)', () => {
  it('lists the newest kept files up to the limit, with a way to the rest', async () => {
    const rows = Array.from({ length: RECENT_FILES_LIMIT + 3 }, (_, i) => row(`f${i}`));
    await show(rows);
    const recent = screen.getByRole('region', { name: 'Recent files' });
    expect(names(recent)).toEqual(rows.slice(0, RECENT_FILES_LIMIT).map((r) => r.id));
    expect(screen.getByRole('button', { name: 'Browse all files…' })).toBeInTheDocument();
  });

  it('offers the browse button even when everything is already on the page', async () => {
    await show([row('f1'), row('f2')]);
    expect(screen.getByRole('button', { name: 'Browse all files…' })).toBeInTheDocument();
  });

  it('offers no browse button while nothing is stored', async () => {
    await show([]);
    expect(screen.queryByRole('button', { name: 'Browse all files…' })).toBeNull();
  });

  it('offers it for unkept documents that Recent files does not show', async () => {
    await show([row('f1'), made('p1', 'A')]);
    expect(screen.getByRole('button', { name: 'Browse all files…' })).toBeInTheDocument();
  });
});

describe('the Browse all files panel (item 111)', () => {
  const rows = [
    row('pUC19', { fileName: 'puc19.gb', length: 2686, updatedAt: 3000 }),
    row('Insert', { fileName: 'PCR_product.fa', length: 900, updatedAt: 2000 }),
    row('pET28', { fileName: 'pet.gb', length: 5369, updatedAt: 1000 }),
    ...Array.from({ length: RECENT_FILES_LIMIT }, (_, i) => row(`x${i}`, { updatedAt: 10 })),
  ];

  it('lists everything stored, kept and unkept, newest first', async () => {
    const dialog = await browse([...rows, made('p1', 'A')]);
    expect(names(dialog).slice(0, 3)).toEqual(['pUC19', 'Insert', 'pET28']);
    expect(names(dialog)).toHaveLength(rows.length + 1);
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      `${(rows.length + 1).toString()} documents`,
    );
  });

  it('searches the name and the file name', async () => {
    const dialog = await browse(rows);
    const search = within(dialog).getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'pcr_prod' } });
    expect(names(dialog)).toEqual(['Insert']);
    fireEvent.change(search, { target: { value: 'pet' } });
    expect(names(dialog)).toEqual(['pET28']);
    fireEvent.change(search, { target: { value: 'nothing here' } });
    expect(within(dialog).getByText('No document matches.')).toBeInTheDocument();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(names(dialog)).toHaveLength(rows.length);
    // The first Escape cleared the search; the dialog is still there.
    expect(screen.getByRole('dialog', { name: 'All files' })).toBeInTheDocument();
  });

  it('sorts by update, name and size', async () => {
    const dialog = await browse(rows);
    const sort = within(dialog).getByLabelText('Sort by');
    fireEvent.change(sort, { target: { value: 'name' } });
    expect(names(dialog).slice(0, 3)).toEqual(['Insert', 'pET28', 'pUC19']);
    fireEvent.change(sort, { target: { value: 'size' } });
    expect(names(dialog).slice(0, 3)).toEqual(['pET28', 'pUC19', 'Insert']);
    fireEvent.change(sort, { target: { value: 'updated' } });
    expect(names(dialog)[0]).toBe('pUC19');
  });

  it('opens a document on click and shows the open badge', async () => {
    const openStored = vi.spyOn(persistence, 'openStored').mockResolvedValue();
    editorStore.openDocument(
      (await import('@/core')).SeqDocument.create({ name: 'pUC19', sequence: 'ACGT' }),
    );
    const id = editorStore.getState().documents.at(-1)?.documentId ?? '';
    const dialog = await browse([row(id, { name: 'pUC19' }), ...rows.slice(1)]);
    const item = within(dialog).getByText('pUC19').closest('li') as HTMLElement;
    expect(within(item).getByText('open')).toBeInTheDocument();
    fireEvent.click(within(item).getByRole('button', { name: /pUC19/ }));
    expect(openStored).toHaveBeenCalledWith(id);
    act(() => {
      editorStore.closeDocument(id);
    });
  });

  it('renames a document in the list', async () => {
    const rename = vi.spyOn(persistence, 'renameStored').mockResolvedValue();
    const dialog = await browse(rows);
    const item = within(dialog).getByText('Insert').closest('li') as HTMLElement;
    fireEvent.click(within(item).getByRole('button', { name: 'Rename' }));
    const input = within(item).getByLabelText('Document name');
    fireEvent.change(input, { target: { value: 'Insert 2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(rename).toHaveBeenCalledWith('Insert', 'Insert 2');
    // Escape in the name field cancels the rename, not the dialog.
    fireEvent.click(within(item).getByRole('button', { name: 'Rename' }));
    fireEvent.keyDown(within(item).getByLabelText('Document name'), { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'All files' })).toBeInTheDocument();
  });

  it('removes the ticked documents together, with an Undo', async () => {
    const remove = vi.spyOn(persistence, 'removeStoredWithUndo').mockResolvedValue(1);
    const dialog = await browse(rows);
    const removeButton = within(dialog).getByRole('button', { name: 'Remove selected' });
    expect(removeButton).toBeDisabled();
    fireEvent.click(within(dialog).getByLabelText('Select pUC19'));
    fireEvent.click(within(dialog).getByLabelText('Select pET28'));
    expect(within(dialog).getByRole('status')).toHaveTextContent('2 selected');
    fireEvent.click(removeButton);
    expect(remove).toHaveBeenCalledWith(['pUC19', 'pET28'], 'Removed 2 documents.');
    expect(within(dialog).getByRole('status')).not.toHaveTextContent('selected');
  });

  it('selects all that are shown, and only those', async () => {
    const remove = vi.spyOn(persistence, 'removeStoredWithUndo').mockResolvedValue(1);
    const dialog = await browse(rows);
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'p' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Select all shown' }));
    expect(within(dialog).getByRole('button', { name: 'Clear selection' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove selected' }));
    const ids = remove.mock.calls[0]?.[0] ?? [];
    // pUC19, pET28 and Insert (its file name has "p"), not the x rows.
    expect([...ids].sort()).toEqual(['Insert', 'pET28', 'pUC19']);
  });

  it('keeps the ticked unkept documents, and Keep stays off for kept ones', async () => {
    const keep = vi.spyOn(persistence, 'keepStored').mockResolvedValue();
    const dialog = await browse([...rows, made('p1', 'A')]);
    const keepButton = within(dialog).getByRole('button', { name: 'Keep selected' });
    fireEvent.click(within(dialog).getByLabelText('Select pUC19'));
    expect(keepButton).toBeDisabled();
    fireEvent.click(within(dialog).getByLabelText('Select p1'));
    fireEvent.click(keepButton);
    expect(keep).toHaveBeenCalledWith(['p1']);
  });

  it('closes with Close and with Escape', async () => {
    const dialog = await browse(rows);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Browse all files…' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('scratch products of one parent are one row (item 111)', () => {
  it('shows "3 products of AF025746" collapsed in Unkept, opening to the three', async () => {
    await show([
      made('p1', 'AF025746'),
      made('p2', 'AF025746'),
      made('p3', 'AF025746'),
      made('lone', 'Other'),
    ]);
    const unkept = screen.getByText('Unkept (4)').closest('details') as HTMLElement;
    const heading = within(unkept).getByText('3 products of AF025746');
    const group = heading.closest('details') as HTMLElement;
    expect(heading.closest('details')?.open).toBe(false);
    expect(
      within(group)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toHaveLength(3);
    // The one with a parent of its own stays a plain row.
    expect(within(unkept).getByText('lone')).toBeInTheDocument();
  });

  it('keeps and removes a whole group', async () => {
    const keep = vi.spyOn(persistence, 'keepStored').mockResolvedValue();
    const remove = vi.spyOn(persistence, 'removeStoredWithUndo').mockResolvedValue(1);
    await show([made('p1', 'A'), made('p2', 'A')]);
    const group = screen.getByText('2 products of A').closest('details') as HTMLElement;
    fireEvent.click(within(group).getByRole('button', { name: 'Keep all' }));
    expect(keep).toHaveBeenCalledWith(['p1', 'p2']);
    fireEvent.click(within(group).getByRole('button', { name: 'Remove all' }));
    expect(remove).toHaveBeenCalledWith(['p1', 'p2'], 'Removed 2 documents.');
  });

  it('groups in the browse panel too, ticks a group at once, and opens it when searching', async () => {
    const remove = vi.spyOn(persistence, 'removeStoredWithUndo').mockResolvedValue(1);
    const rows = [
      made('p1', 'A', { name: 'ligation 1' }),
      made('p2', 'A', { name: 'ligation 2' }),
      ...Array.from({ length: RECENT_FILES_LIMIT }, (_, i) => row(`f${i}`)),
    ];
    const dialog = await browse(rows);
    const heading = within(dialog).getByText('2 products of A');
    expect(heading.closest('details')?.open).toBe(false);
    fireEvent.click(within(dialog).getByLabelText('Select the 2 products of A'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove selected' }));
    expect(remove).toHaveBeenCalledWith(['p1', 'p2'], 'Removed 2 documents.');
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'ligation 1' } });
    // One match is no group: it is the row.
    expect(within(dialog).queryByText(/products of A/)).toBeNull();
    expect(within(dialog).getByText('ligation 1')).toBeInTheDocument();
  });
});

describe('the Undo toast (item 111)', () => {
  it('says what was removed and Undo takes it back', () => {
    const undo = vi.spyOn(persistence, 'undoRemoval').mockReturnValue(true);
    render(<RemovalNotice />);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => {
      editorStore.noteRemoval(7, 'Removed "pUC19".');
    });
    expect(screen.getByRole('status')).toHaveTextContent('Removed "pUC19".');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledWith(7);
  });

  it('stacks one toast per removal, each with its own Undo and Dismiss (#322)', () => {
    const undo = vi.spyOn(persistence, 'undoRemoval').mockReturnValue(true);
    render(<RemovalNotice />);
    act(() => {
      editorStore.noteRemoval(1, 'Removed "pUC19".');
      editorStore.noteRemoval(2, 'Removed 3 documents.');
    });
    const toasts = screen.getAllByRole('status');
    expect(toasts.map((t) => t.textContent)).toEqual([
      expect.stringContaining('Removed "pUC19".'),
      expect.stringContaining('Removed 3 documents.'),
    ]);
    const [first, second] = toasts as [HTMLElement, HTMLElement];
    fireEvent.click(within(first).getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledWith(1);
    fireEvent.click(within(second).getByRole('button', { name: 'Dismiss' }));
    expect(editorStore.getState().removalNotices.map((r) => r.key)).toEqual([1]);
  });

  it('gives each toast a decorative ring that carries the hold duration (#322)', () => {
    render(<RemovalNotice />);
    act(() => {
      editorStore.noteRemoval(1, 'Removed "pUC19".');
      editorStore.noteRemoval(2, 'Removed 3 documents.');
    });
    const rings = screen
      .getAllByRole('status')
      .map((t) => t.querySelector<SVGElement>('svg.undo-toast__ring'));
    expect(rings).toHaveLength(2);
    for (const ring of rings) {
      expect(ring?.getAttribute('aria-hidden')).toBe('true');
      expect(ring?.style.getPropertyValue('--undo-hold')).toBe(`${REMOVAL_HOLD_MS}ms`);
    }
  });

  it('folds the older removals past three into one row with Undo all (#322)', () => {
    const undo = vi.spyOn(persistence, 'undoRemoval').mockReturnValue(true);
    render(<RemovalNotice />);
    act(() => {
      for (let key = 1; key <= 6; key++) editorStore.noteRemoval(key, `Removed ${key}.`);
    });
    const rows = screen.getAllByRole('status');
    expect(rows).toHaveLength(4);
    const [fold, ...toasts] = rows as [HTMLElement, ...HTMLElement[]];
    expect(fold).toHaveTextContent('+3 earlier removals');
    expect(toasts.map((t) => t.textContent)).toEqual([
      expect.stringContaining('Removed 4.'),
      expect.stringContaining('Removed 5.'),
      expect.stringContaining('Removed 6.'),
    ]);
    expect(within(fold).queryByRole('button', { name: 'Dismiss' })).toBeNull();
    fireEvent.click(within(fold).getByRole('button', { name: 'Undo all' }));
    expect(undo.mock.calls).toEqual([[1], [2], [3]]);
  });

  it('says one earlier removal in the singular, and the row goes at none (#322)', () => {
    const undo = vi.spyOn(persistence, 'undoRemoval').mockReturnValue(true);
    render(<RemovalNotice />);
    act(() => {
      for (let key = 1; key <= 4; key++) editorStore.noteRemoval(key, `Removed ${key}.`);
    });
    const [fold] = screen.getAllByRole('status') as [HTMLElement, ...HTMLElement[]];
    expect(fold).toHaveTextContent('+1 earlier removal');
    expect(fold).not.toHaveTextContent('removals');
    fireEvent.click(within(fold).getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledWith(1);
    // Its time ends (or the Undo goes through): the row goes, three toasts stay.
    act(() => {
      editorStore.dismissRemovalNotice(1);
    });
    expect(screen.getAllByRole('status')).toHaveLength(3);
    expect(screen.queryByText(/earlier removal/)).toBeNull();
  });

  it('brings a folded removal back as a toast whose ring keeps its own time (#322)', () => {
    render(<RemovalNotice />);
    const start = Date.now();
    act(() => {
      editorStore.noteRemoval(1, 'Removed 1.', start - 4000);
      for (let key = 2; key <= 4; key++) editorStore.noteRemoval(key, `Removed ${key}.`);
    });
    // The row's ring follows the folded removal due soonest.
    const foldRing = screen
      .getAllByRole('status')[0]
      ?.querySelector<SVGElement>('svg.undo-toast__ring');
    expect(parseFloat(foldRing?.style.getPropertyValue('--undo-gone') ?? '')).toBeLessThanOrEqual(
      -4000,
    );
    act(() => {
      editorStore.dismissRemovalNotice(4);
    });
    const toasts = screen.getAllByRole('status');
    expect(toasts).toHaveLength(3);
    const [back] = toasts as [HTMLElement, ...HTMLElement[]];
    expect(back).toHaveTextContent('Removed 1.');
    const ring = back.querySelector<SVGElement>('svg.undo-toast__ring');
    expect(parseFloat(ring?.style.getPropertyValue('--undo-gone') ?? '')).toBeLessThanOrEqual(
      -4000,
    );
    expect(ring?.style.getPropertyValue('--undo-hold')).toBe(`${REMOVAL_HOLD_MS}ms`);
  });

  it('can be dismissed without undoing', () => {
    const undo = vi.spyOn(persistence, 'undoRemoval');
    render(<RemovalNotice />);
    act(() => {
      editorStore.noteRemoval(1, 'Removed 3 documents.');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(undo).not.toHaveBeenCalled();
  });

  it('refreshes the listing when it comes and goes', async () => {
    const list = vi.spyOn(persistence, 'listStored').mockResolvedValue([]);
    vi.spyOn(persistence, 'pruneScratch').mockResolvedValue(0);
    render(<EmptyState />);
    await act(() => Promise.resolve());
    await act(() => Promise.resolve());
    const before = list.mock.calls.length;
    await act(async () => {
      editorStore.noteRemoval(1, 'Removed.');
      await Promise.resolve();
    });
    await act(async () => {
      editorStore.dismissRemovalNotice();
      await Promise.resolve();
    });
    expect(list.mock.calls.length).toBe(before + 2);
  });
});
