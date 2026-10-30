// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import type * as Io from '@/io';
import { GENE_QUERY_DEBOUNCE_MS, type GeneHit, type GeneSearch } from '@/io';

import { NcbiSearch } from './NcbiSearch';

const fetchState = vi.hoisted(() => ({
  signal: null as AbortSignal | null,
  resolve: (): void => undefined,
  fetched: [] as unknown[],
}));

const lookups = vi.hoisted(() => ({
  calls: [] as { query: string; organism: string; signal: AbortSignal }[],
  answer: null as ((query: string) => GeneSearch) | null,
  pending: [] as { query: string; resolve: (found: GeneSearch) => void }[],
}));

vi.mock('../openFromNcbi', () => ({
  checkAccessionInput: (text: string) => ({ ok: true, accessions: [text] }),
  parseRegionInput: () => null,
  fetchAccessions: (_accessions: string[], opts: { signal: AbortSignal }) => {
    fetchState.signal = opts.signal;
    return new Promise<unknown>((resolve) => {
      fetchState.resolve = () => {
        resolve({ documents: [], warnings: [], source: { kind: 'accession' } });
      };
    });
  },
  fetchGeneFromNcbi: (
    gene: GeneHit,
    flanks: unknown,
    rc: boolean,
    record: string,
    opts: { signal: AbortSignal },
  ) => {
    fetchState.signal = opts.signal;
    return Promise.resolve({
      documents: [],
      warnings: [],
      source: { kind: 'gene', gene, flanks, rc, record },
    });
  },
  fetchRegionFromNcbi: () => Promise.reject(new Error('not in these tests')),
  openFetched: (fetched: unknown) => {
    fetchState.fetched.push(fetched);
    return [];
  },
}));

vi.mock('@/io', async (importOriginal) => ({
  ...(await importOriginal<typeof Io>()),
  searchGenes: (query: string, organism: string, opts: { signal: AbortSignal }) => {
    lookups.calls.push({ query, organism, signal: opts.signal });
    if (lookups.answer !== null) return Promise.resolve(lookups.answer(query));
    return new Promise<GeneSearch>((resolve) => {
      lookups.pending.push({ query, resolve });
    });
  },
}));

const noop = vi.fn();

function hit(symbol: string, id = symbol): GeneHit {
  return {
    id,
    symbol,
    fullName: `${symbol} full name`,
    organism: 'Homo sapiens',
    taxId: 9606,
    aliases: [],
    chromosome: '17',
    location: { accession: 'NC_000017.11', start: 100, end: 400, strand: 'forward' },
  };
}

function accessionMode(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Accession' }));
  return screen.getByRole('textbox', { name: 'Accession' });
}

function start(): void {
  fireEvent.change(accessionMode(), { target: { value: 'L09137' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
}

function geneMode(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Gene' }));
  return screen.getByRole('combobox', { name: 'Gene' });
}

beforeEach(() => {
  fetchState.signal = null;
  fetchState.fetched = [];
  lookups.calls = [];
  lookups.answer = null;
  lookups.pending = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NcbiSearch', () => {
  // First, before any submit: the mode last submitted is remembered for the next opening.
  it('opens on Gene with the Gene box focused, Accession out of reach until chosen, and each mode keeps its own strand option', () => {
    render(<NcbiSearch onOpened={noop} onCancel={noop} />);
    expect(screen.getByRole('button', { name: 'Gene' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('combobox', { name: 'Gene' })).toHaveFocus();
    expect(screen.queryByRole('textbox', { name: 'Accession' })).toBeNull();
    const orient = screen.getByRole('checkbox', { name: /Read a reverse-strand gene/ });
    expect(orient).toBeChecked();

    expect(accessionMode()).toHaveFocus();
    expect(screen.queryByRole('combobox', { name: 'Gene' })).toBeNull();
    const reverse = screen.getByRole('checkbox', { name: 'Reverse-complement' });
    expect(reverse).not.toBeChecked();
    fireEvent.click(reverse);
    expect(reverse).toBeChecked();

    geneMode();
    expect(screen.getByRole('checkbox', { name: /Read a reverse-strand gene/ })).toBeChecked();
    accessionMode();
    expect(screen.getByRole('checkbox', { name: 'Reverse-complement' })).toBeChecked();
  });

  it('keeps a fetch running when the host re-renders with new callbacks', () => {
    const { rerender } = render(<NcbiSearch onOpened={noop} onCancel={noop} />);
    start();
    rerender(<NcbiSearch onOpened={noop} onCancel={noop} />);
    expect(fetchState.signal?.aborted).toBe(false);
  });

  it('calls the latest onOpened when the fetch finishes', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<NcbiSearch onOpened={first} onCancel={noop} />);
    start();
    rerender(<NcbiSearch onOpened={second} onCancel={noop} />);
    await act(async () => {
      fetchState.resolve();
      await Promise.resolve();
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(fetchState.fetched).toHaveLength(1);
  });

  it('hands what was fetched to onFetched instead of opening it, when a host gives one', async () => {
    const onFetched = vi.fn();
    render(<NcbiSearch onOpened={noop} onCancel={noop} onFetched={onFetched} />);
    start();
    await act(async () => {
      fetchState.resolve();
      await Promise.resolve();
    });
    expect(onFetched).toHaveBeenCalledWith(
      expect.objectContaining({ source: { kind: 'accession' } }),
    );
    expect(fetchState.fetched).toHaveLength(0);
  });

  it('cancels a running fetch first, then the host on the next Cancel', () => {
    const onCancel = vi.fn();
    render(<NcbiSearch onOpened={noop} onCancel={onCancel} />);
    start();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetchState.signal?.aborted).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('scopes Escape to the form unless globalEscape is set', () => {
    const onCancel = vi.fn();
    const { rerender } = render(<NcbiSearch onOpened={noop} onCancel={onCancel} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(accessionMode(), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();

    onCancel.mockClear();
    rerender(<NcbiSearch globalEscape onOpened={noop} onCancel={onCancel} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe('NcbiSearch, gene lookup (#299)', () => {
  it('says what is sent before anything is, and sends nothing in accession mode or under two characters', () => {
    vi.useFakeTimers();
    render(<NcbiSearch onOpened={noop} onCancel={noop} />);
    accessionMode();
    expect(screen.getByText(/Only the accession numbers/)).toBeInTheDocument();
    const gene = geneMode();
    expect(
      screen.getByText(/As you type, what is in the Gene box and the organism go to NCBI/),
    ).toBeInTheDocument();
    fireEvent.change(gene, { target: { value: 'T' } });
    act(() => {
      vi.advanceTimersByTime(GENE_QUERY_DEBOUNCE_MS * 2);
    });
    expect(lookups.calls).toEqual([]);
  });

  it('looks the name up after a pause in typing, once, with the organism', () => {
    vi.useFakeTimers();
    lookups.answer = () => ({ hits: [hit('TP53')], count: 1 });
    render(<NcbiSearch onOpened={noop} onCancel={noop} />);
    const gene = geneMode();
    fireEvent.change(gene, { target: { value: 'TP' } });
    act(() => {
      vi.advanceTimersByTime(GENE_QUERY_DEBOUNCE_MS - 50);
    });
    fireEvent.change(gene, { target: { value: 'TP5' } });
    act(() => {
      vi.advanceTimersByTime(GENE_QUERY_DEBOUNCE_MS - 50);
    });
    expect(lookups.calls).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(lookups.calls).toHaveLength(1);
    expect(lookups.calls[0]).toMatchObject({ query: 'TP5', organism: '9606' });
  });

  it('cancels a lookup under way when the text changes again', async () => {
    vi.useFakeTimers();
    render(<NcbiSearch onOpened={noop} onCancel={noop} />);
    const gene = geneMode();
    fireEvent.change(gene, { target: { value: 'TP5' } });
    act(() => {
      vi.advanceTimersByTime(GENE_QUERY_DEBOUNCE_MS);
    });
    expect(lookups.calls).toHaveLength(1);
    const first = lookups.calls[0];
    fireEvent.change(gene, { target: { value: 'TP53' } });
    act(() => {
      vi.advanceTimersByTime(GENE_QUERY_DEBOUNCE_MS);
    });
    expect(first?.signal.aborted).toBe(true);
    expect(lookups.calls).toHaveLength(2);
    // The late answer to the first, were it to come, is not listed.
    await act(async () => {
      lookups.pending[0]?.resolve({ hits: [hit('TP5-STALE')], count: 1 });
      await Promise.resolve();
    });
    expect(screen.queryByRole('option', { name: /TP5-STALE/ })).toBeNull();
  });

  it('lists the matches and picks one with the keyboard, then opens it with the flanks typed', async () => {
    vi.useFakeTimers();
    lookups.answer = () => ({ hits: [hit('TP53'), hit('TP53BP1')], count: 2 });
    const onOpened = vi.fn();
    render(<NcbiSearch onOpened={onOpened} onCancel={noop} />);
    const gene = geneMode();
    fireEvent.change(gene, { target: { value: 'TP53' } });
    await act(async () => {
      vi.advanceTimersByTime(GENE_QUERY_DEBOUNCE_MS);
      await Promise.resolve();
    });
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('TP53 — TP53 full name'),
      expect.stringContaining('TP53BP1'),
    ]);
    expect(options[0]).toHaveTextContent('Homo sapiens, chromosome 17 · NC_000017.11:101-400 (+)');
    fireEvent.keyDown(gene, { key: 'ArrowDown' });
    fireEvent.keyDown(gene, { key: 'Enter' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(gene).toHaveValue('TP53BP1');

    fireEvent.click(screen.getByRole('button', { name: '1 kb each side' }));
    expect(screen.getByLabelText(/Upstream/)).toHaveValue('1000');
    fireEvent.change(screen.getByLabelText(/Downstream/), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onOpened).toHaveBeenCalledOnce();
    expect(fetchState.fetched[0]).toMatchObject({
      source: {
        kind: 'gene',
        gene: { symbol: 'TP53BP1' },
        flanks: { upstream: 1000, downstream: 250 },
        rc: true,
        record: 'refseqgene',
      },
    });
  });

  it('asks for a pick when several genes match the name typed, and takes the one exact match', async () => {
    vi.useFakeTimers();
    lookups.answer = (query) =>
      query === 'TP53'
        ? { hits: [hit('TP53'), hit('TP53BP1')], count: 2 }
        : { hits: [hit('TP53BP1'), hit('TP53BP2')], count: 2 };
    const onOpened = vi.fn();
    render(<NcbiSearch onOpened={onOpened} onCancel={noop} />);
    const gene = geneMode();
    fireEvent.change(gene, { target: { value: 'TP53B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      '2 genes match “TP53B” in Human; pick one from the list.',
    );
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(2);
    expect(onOpened).not.toHaveBeenCalled();

    fireEvent.change(gene, { target: { value: 'TP53' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onOpened).toHaveBeenCalledOnce();
    expect(fetchState.fetched[0]).toMatchObject({ source: { gene: { symbol: 'TP53' } } });
  });

  it('refuses a flank that is not a whole number of bases, before anything is sent', () => {
    render(<NcbiSearch onOpened={noop} onCancel={noop} />);
    geneMode();
    fireEvent.change(screen.getByLabelText(/Upstream/), { target: { value: '1 kb' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Flanks are whole numbers of bases.');
    expect(lookups.calls).toEqual([]);
  });

  it('closes the list on Escape before anything else, even with a document-wide Escape', async () => {
    vi.useFakeTimers();
    lookups.answer = () => ({ hits: [hit('TP53')], count: 1 });
    const onCancel = vi.fn();
    render(<NcbiSearch globalEscape onOpened={noop} onCancel={onCancel} />);
    const gene = geneMode();
    fireEvent.change(gene, { target: { value: 'TP53' } });
    await act(async () => {
      vi.advanceTimersByTime(GENE_QUERY_DEBOUNCE_MS);
      await Promise.resolve();
    });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('offers the chromosome record, off by default, says what it changes, and remembers it across openings (#326)', async () => {
    lookups.answer = () => ({ hits: [hit('ACACA')], count: 1 });
    const first = render(<NcbiSearch onOpened={noop} onCancel={noop} />);
    geneMode();
    const option = screen.getByRole('checkbox', {
      name: 'Use the chromosome record (all transcripts)',
    });
    expect(option).not.toBeChecked();
    expect(option).toHaveAccessibleDescription(
      /A gene with a RefSeqGene record is otherwise cut from it, which carries only its reference transcript\./,
    );
    fireEvent.click(option);
    expect(option).toBeChecked();
    // The strand option is its own, untouched.
    expect(screen.getByRole('checkbox', { name: /Read a reverse-strand gene/ })).toBeChecked();
    first.unmount();

    render(<NcbiSearch onOpened={noop} onCancel={noop} />);
    const gene = geneMode();
    const again = screen.getByRole('checkbox', {
      name: 'Use the chromosome record (all transcripts)',
    });
    expect(again).toBeChecked();
    fireEvent.change(gene, { target: { value: 'ACACA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchState.fetched[0]).toMatchObject({
      source: { gene: { symbol: 'ACACA' }, rc: true, record: 'chromosome' },
    });
    // Back to the default for the tests that follow.
    fireEvent.click(again);
  });
});
