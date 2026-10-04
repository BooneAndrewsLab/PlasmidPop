// @vitest-environment jsdom
import {
  act,
  cleanup,
  renderHook,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import {
  type StrandedAlignment,
  SeqDocument,
  createFeature,
  rangeSegment,
  reverseComplement,
} from '@/core';
import {
  AnalysisCancelledError,
  type LongRequestOptions,
  analysisClient,
} from '@/workers/analysisClient';

import { editorStore } from '../state/editorStore';
import type { PointerEvent } from 'react';
import type { ReadAlignment } from '../readAlignment';
import { AlignPanel } from './AlignPanel';
import { useAlignedRegionPointer } from './useAlignedRegionPointer';

const doc = SeqDocument.create({ name: 'target', sequence: 'TTTTACGTACGTGGCCAATTGGCCTTTT' });

function box(): HTMLElement {
  return screen.getByRole('textbox', { name: 'Sequence to align' });
}

function fileDrop(...files: File[]) {
  return { dataTransfer: { files, types: ['Files'] } };
}

describe('AlignPanel', () => {
  beforeEach(() => {
    act(() => {
      editorStore.openDocument(doc);
    });
  });
  afterEach(() => {
    act(() => {
      editorStore.closeDocument();
    });
  });

  it('puts the common path first and the rest in labelled groups (#107)', () => {
    render(<AlignPanel doc={doc} />);
    const align = screen.getByRole('button', { name: 'Align' });
    const choose = screen.getByRole('button', { name: 'Choose file…' });
    const options = screen.getByRole('group', { name: 'Options' });
    // Box, then Choose file, then Align, then the options: the tab order.
    const before = (a: Node, b: Node): boolean =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(box(), choose)).toBe(true);
    expect(before(choose, align)).toBe(true);
    expect(before(align, options)).toBe(true);
    // Every option is reachable inside its group, and named.
    expect(options).toContainElement(screen.getByRole('combobox', { name: 'Alignment mode' }));
    const selection = screen.getByRole('checkbox', { name: 'Against selection only' });
    expect(options).toContainElement(selection);
    expect(selection).toBeDisabled(); // nothing selected
    expect(screen.queryByRole('group', { name: 'Reads' })).toBeNull();
    expect(align).toBeDisabled(); // nothing to align yet
  });

  it('groups the read settings apart from the options (#107)', async () => {
    render(<AlignPanel doc={doc} />);
    const fastq = new File(['@r\nACGTACGTACGT\n+\nIIIIIIIIIIII\n'], 'r.fastq');
    fireEvent.drop(box(), fileDrop(fastq));
    const reads = await screen.findByRole('group', { name: 'Reads' });
    expect(reads).toContainElement(screen.getByRole('checkbox', { name: 'Trim poor ends' }));
    expect(reads).toContainElement(screen.getByRole('combobox', { name: 'Confident from' }));
    expect(reads).toContainElement(screen.getByRole('combobox', { name: 'Trim at' }));
    expect(screen.getByRole('group', { name: 'Options' })).toContainElement(
      screen.getByRole('combobox', { name: 'Alignment mode' }),
    );
  });

  it('puts the result in a group of its own under the options (#118)', async () => {
    render(<AlignPanel doc={doc} />);
    expect(screen.queryByRole('group', { name: 'Result' })).toBeNull();
    fireEvent.change(box(), { target: { value: 'GGCCAATTGGCC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    const result = await screen.findByRole('group', { name: 'Result' });
    const options = screen.getByRole('group', { name: 'Options' });
    expect(
      Boolean(options.compareDocumentPosition(result) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    expect(options).not.toContainElement(result);
    expect(result).toContainElement(screen.getByRole('button', { name: 'Large view' }));
    expect(result).toContainElement(screen.getByText(/identity 100%/));
  });

  it('offers every record of a multi-record FASTA and aligns the one chosen', async () => {
    render(<AlignPanel doc={doc} />);
    fireEvent.change(box(), { target: { value: '>one\nCCCCCCCC\n>two\nGGCCAATTGGCC\n' } });
    const picker = screen.getByRole('combobox', { name: 'Record to align' });
    expect(screen.getAllByRole('option', { name: /bp\)$/ }).map((o) => o.textContent)).toEqual([
      'one (8 bp)',
      'two (12 bp)',
    ]);
    expect(screen.getByText(/2 records; the one chosen is aligned/)).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: '1' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Alignment mode' }), {
      target: { value: 'local' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    await waitFor(() => {
      expect(screen.getByText(/identity 100%/)).toBeInTheDocument();
    });
  });

  it('opens the alignment in a large view that Esc closes, focus going back (#103)', async () => {
    render(<AlignPanel doc={doc} />);
    fireEvent.change(box(), { target: { value: 'GGCCAATTGGCC' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Alignment mode' }), {
      target: { value: 'local' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    await waitFor(() => {
      expect(screen.getByText(/identity 100%/)).toBeInTheDocument();
    });
    const open = screen.getByRole('button', { name: 'Large view' });
    open.focus();
    fireEvent.click(open);
    const dialog = screen.getByRole('dialog', { name: /Alignment of one sequence to target/ });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    // Nothing differs, so there is nothing to go to.
    expect(screen.getByRole('button', { name: 'Next difference' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(open).toHaveFocus();
  });

  it("switches the large view's display options with toggle buttons (#114)", async () => {
    render(<AlignPanel doc={doc} />);
    fireEvent.change(box(), { target: { value: 'GGCCAATTGGCC' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Alignment mode' }), {
      target: { value: 'local' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    await waitFor(() => {
      expect(screen.getByText(/identity 100%/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Large view' }));
    const features = screen.getByRole('button', { name: 'Features' });
    expect(features).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(features);
    expect(features).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(features);
    expect(features).toHaveAttribute('aria-pressed', 'true');
    const orfs = screen.getByRole('button', { name: 'ORFs' });
    expect(orfs).toHaveAttribute('aria-pressed', 'false');
    // No CDS in this document, so there are no amino acids to show.
    expect(screen.queryByRole('button', { name: 'Amino acids' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Features' })).toBeNull();
  });

  it('says per feature whether the read confirms it, differs in it or misses it (#120)', async () => {
    const featured = SeqDocument.create({
      name: 'target',
      sequence: 'TTTTACGTACGTGGCCAATTGGCCTTTT',
      features: [
        createFeature({ type: 'CDS', name: 'gfp', segments: [rangeSegment(12, 24)] }),
        createFeature({ type: 'promoter', name: 'pro', segments: [rangeSegment(4, 8)] }),
        createFeature({ type: 'terminator', name: 'term', segments: [rangeSegment(24, 28)] }),
      ],
    });
    render(<AlignPanel doc={featured} />);
    // Covers 8..24 of the document, with one base changed in the promoter-free part.
    fireEvent.change(box(), { target: { value: 'ACGTGGCCAATTGGCC' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Alignment mode' }), {
      target: { value: 'local' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    await waitFor(() => {
      expect(screen.getByText(/identity/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Large view' }));
    const verify = screen.getByLabelText('Verification of each feature');
    // One sentence for what is confirmed, then only the features that need a look.
    expect(
      within(verify).getByText('1 of 3 features confirmed by the read, forward strand only'),
    ).toBeVisible();
    const lines = within(verify)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(lines).toEqual(['pro: not covered', 'term: not covered']);
    // Every feature is in a table behind All features, one row each in document order.
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('table', { name: 'Feature verification' })).toBeNull();
    const all = within(dialog).getByRole('button', { name: 'All features' });
    fireEvent.click(all);
    expect(all).toHaveAttribute('aria-pressed', 'true');
    const table = within(dialog).getByRole('table', { name: 'Feature verification' });
    const text = (row: HTMLElement): string[] =>
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent.trim());
    const body = within(table).getAllByRole('row').slice(1);
    // Positions are 1-based and inclusive, as the ruler numbers them.
    expect(body.map(text)).toEqual([
      ['○ Not covered', 'pro', 'promoter', '5–8', '0', '', '0 of 4'],
      ['✓ Confirmed', 'gfp', 'CDS', '13–24', '1', 'forward only', '12 of 12'],
      ['○ Not covered', 'term', 'terminator', '25–28', '0', '', '0 of 4'],
    ]);
    // Problems first puts the confirmed feature last.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Problems first' }));
    expect(
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((r) => text(r)[1]),
    ).toEqual(['pro', 'term', 'gfp']);
    // A row's name is a button that shows the feature; the row is marked as the current one.
    fireEvent.click(within(table).getByRole('button', { name: 'gfp' }));
    expect(within(table).getByRole('button', { name: 'gfp' }).closest('tr')).toHaveAttribute(
      'aria-current',
      'true',
    );
    fireEvent.click(all);
    expect(within(dialog).queryByRole('table', { name: 'Feature verification' })).toBeNull();
    expect(all).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows one table at a time: the features or the differences (#120, #121)', async () => {
    const featured = SeqDocument.create({
      name: 'target',
      sequence: 'TTTTACGTACGTGGCCAATTGGCCTTTT',
      features: [createFeature({ type: 'CDS', name: 'gfp', segments: [rangeSegment(12, 24)] })],
    });
    render(<AlignPanel doc={featured} />);
    // One base of the CDS changed (G at 18 of the document read as C).
    fireEvent.change(box(), { target: { value: 'ACGTGGCCAACTGGCC' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Alignment mode' }), {
      target: { value: 'local' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    await waitFor(() => {
      expect(screen.getByText(/identity/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Large view' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'All features' }));
    const table = within(dialog).getByRole('table', { name: 'Feature verification' });
    expect(within(table).getByText('1 difference')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'List' }));
    expect(within(dialog).getByRole('table', { name: 'Differences' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('table', { name: 'Feature verification' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'All features' }));
    expect(within(dialog).queryByRole('table', { name: 'Differences' })).toBeNull();
    expect(within(dialog).getByRole('table', { name: 'Feature verification' })).toBeInTheDocument();
  });

  it('names at most five features needing a look, the rest behind "and N more" (#120)', async () => {
    const featured = SeqDocument.create({
      name: 'target',
      sequence: 'TTTTACGTACGTGGCCAATTGGCCTTTT',
      features: [
        ...[0, 1, 2, 3, 24, 25].map((at) =>
          createFeature({
            type: 'misc_feature',
            name: `m${at}`,
            segments: [rangeSegment(at, at + 1)],
          }),
        ),
        createFeature({ type: 'CDS', name: 'gfp', segments: [rangeSegment(12, 24)] }),
      ],
    });
    render(<AlignPanel doc={featured} />);
    // Covers 8..24, with the base at 17 changed inside gfp.
    fireEvent.change(box(), { target: { value: 'ACGTGGCCAACTGGCC' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Alignment mode' }), {
      target: { value: 'local' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    await waitFor(() => {
      expect(screen.getByText(/identity/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Large view' }));
    const verify = screen.getByLabelText('Verification of each feature');
    // Seven need a look: the one with a difference first, then three more, then a count.
    expect(
      within(verify)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([
      'gfp: 1 difference',
      'm0: not covered',
      'm1: not covered',
      'm2: not covered',
      'and 3 more',
    ]);
    fireEvent.click(within(verify).getByRole('button', { name: 'and 3 more' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Problems first' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const table = within(dialog).getByRole('table', { name: 'Feature verification' });
    expect(within(table).getAllByRole('row')).toHaveLength(8);
    expect(within(dialog).getByRole('button', { name: 'All features' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('lists the differences in a table that jumps to a row and copies as text (#121)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<AlignPanel doc={doc} />);
    fireEvent.change(box(), { target: { value: 'GGACAATTGGAC' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Alignment mode' }), {
      target: { value: 'local' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    await waitFor(() => {
      expect(screen.getByText(/identity/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Large view' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('table', { name: 'Differences' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'List' }));
    const table = within(dialog).getByRole('table', { name: 'Differences' });
    // The header row and the two differences, at positions 15 and 23 of the document.
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByRole('button', { name: '15' })).toBeInTheDocument();
    fireEvent.click(within(table).getByRole('button', { name: '23' }));
    expect(within(dialog).getByText('2 of 2')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = String(writeText.mock.calls[0]?.[0]);
    expect(text.split('\n')[0]).toBe(
      'Position\tChange\tSamples\tFeature\tQuality\tProtein effect\tNote',
    );
    expect(text.split('\n')).toHaveLength(3);
    fireEvent.click(within(dialog).getByRole('button', { name: 'List' }));
    expect(within(dialog).queryByRole('table', { name: 'Differences' })).toBeNull();
  });

  it('marks a column where samples disagree with each other and notes it in the list (#124)', async () => {
    const reference = 'GATTACAGCTTGACCGTAAGCTAGGCTTACGATCGATTGCAAGTCCGATGCATTGACCTA';
    const refDoc = SeqDocument.create({ name: 'pRef', sequence: reference });
    const at = (base: string): string => reference.slice(0, 20) + base + reference.slice(21);
    // Two reads differ from the document at base 21 in different ways, two share one change at 41.
    const shared = (s: string): string => s.slice(0, 40) + 'T' + s.slice(41);
    const fasta = `>a\n${shared(at('C'))}\n>b\n${shared(at('T'))}\n`;
    render(<AlignPanel doc={refDoc} />);
    fireEvent.drop(box(), fileDrop(new File([fasta], 'reads.fa')));
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Record to align' })).toBeInTheDocument();
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Alignment mode' }), {
      target: { value: 'local' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Record to align' }), {
      target: { value: '-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Align all' }));
    await waitFor(() => {
      expect(screen.getByText('2 reads')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Large view of all' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/1 column where samples disagree/)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'List' }));
    const table = within(dialog).getByRole('table', { name: 'Differences' });
    expect(within(table).getByText('samples disagree')).toBeVisible();
    expect(within(table).getByText('samples agree')).toBeVisible();
  });

  it('goes to a position and finds a motif in the large view, keys staying in the window (#125)', async () => {
    render(<AlignPanel doc={doc} />);
    fireEvent.change(box(), { target: { value: 'GGACAATTGGAC' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Alignment mode' }), {
      target: { value: 'local' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    await waitFor(() => {
      expect(screen.getByText(/identity/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Large view' }));
    const dialog = screen.getByRole('dialog');
    const leaked = vi.fn();
    window.addEventListener('keydown', leaked);
    // Ctrl+F is this window's Find, and does not reach the editor's handler on window.
    fireEvent.keyDown(document, { key: 'f', code: 'KeyF', ctrlKey: true });
    window.removeEventListener('keydown', leaked);
    expect(leaked).not.toHaveBeenCalled();
    const find = within(dialog).getByRole('group', { name: 'Find a motif' });
    const motif = within(find).getByLabelText('Motif');
    expect(motif).toHaveFocus();
    // GGCC in the document's GGCCAATTGGCC is at both ends; the sample has GGAC there.
    // The one sample is picked, so it is searched until the reference is chosen.
    expect(within(find).getByLabelText('In')).toHaveValue('0');
    fireEvent.change(within(find).getByLabelText('In'), { target: { value: 'ref' } });
    fireEvent.change(motif, { target: { value: 'ggcc' } });
    expect(within(find).getByText('1 of 2')).toBeInTheDocument();
    fireEvent.click(within(find).getByRole('button', { name: 'Next match' }));
    expect(within(find).getByText('2 of 2')).toBeInTheDocument();
    fireEvent.keyDown(motif, { key: 'Enter', shiftKey: true });
    expect(within(find).getByText('1 of 2')).toBeInTheDocument();
    // In the sample the motif is not there.
    fireEvent.change(within(find).getByLabelText('In'), { target: { value: '0' } });
    expect(within(find).getByText('No match')).toBeInTheDocument();
    fireEvent.change(motif, { target: { value: 'GG' } });
    expect(within(find).getByText(/At least 3 bases/)).toBeInTheDocument();
    fireEvent.change(motif, { target: { value: 'GGXX' } });
    expect(within(find).getByText(/IUPAC/)).toBeInTheDocument();
    // Ctrl+G swaps to Go to; a position past the end is said so.
    fireEvent.keyDown(document, { key: 'g', code: 'KeyG', ctrlKey: true });
    const goto = within(dialog).getByRole('group', { name: 'Go to a position' });
    const position = within(goto).getByLabelText('Position');
    fireEvent.change(position, { target: { value: '99' } });
    fireEvent.keyDown(position, { key: 'Enter' });
    expect(within(goto).getByText(/Past the end: the last position is 28/)).toBeInTheDocument();
    fireEvent.change(position, { target: { value: '5' } });
    fireEvent.keyDown(position, { key: 'Enter' });
    expect(within(goto).queryByText(/Past the end/)).toBeNull();
    // Esc closes the popover first and the window on the second.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(within(dialog).queryByRole('group', { name: 'Go to a position' })).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('exports the large view: copy as text and aligned FASTA, save as SVG, refuse what is too large (#126)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:alignment';
    });
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    render(<AlignPanel doc={doc} />);
    fireEvent.change(box(), { target: { value: 'GGACAATTGGAC' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Alignment mode' }), {
      target: { value: 'local' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    await waitFor(() => {
      expect(screen.getByText(/identity/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Large view' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('group', { name: 'Export the alignment' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
    const form = within(dialog).getByRole('group', { name: 'Export the alignment' });
    // The columns begin as those on screen (jsdom has no layout, so one); All takes every column.
    expect(within(form).getByLabelText('From column')).toHaveValue('1');
    expect(within(form).getByLabelText('To column')).toHaveValue('1');
    fireEvent.click(within(form).getByRole('button', { name: 'All 28' }));
    expect(within(form).getByLabelText('To column')).toHaveValue('28');

    // Text: the document's bases, a match line, the sample at its own numbering.
    fireEvent.click(within(form).getByRole('button', { name: 'As text' }));
    expect(writeText).toHaveBeenLastCalledWith(
      expect.stringContaining('TTTTACGTACGTGGCCAATTGGCCTTTT 28'),
    );
    const text = String(writeText.mock.lastCall?.[0]);
    expect(text).toMatch(/^target\s+1 TTTT/);
    expect(text.split('\n')[1]).toContain('||||');
    expect(within(form).getByText(/Copied the alignment, columns 1 to 28/)).toBeInTheDocument();
    // A narrower range, and aligned FASTA of exactly it.
    fireEvent.change(within(form).getByLabelText('From column'), { target: { value: '13' } });
    fireEvent.change(within(form).getByLabelText('To column'), { target: { value: '20' } });
    fireEvent.click(within(form).getByRole('button', { name: 'As aligned FASTA' }));
    expect(String(writeText.mock.lastCall?.[0])).toBe('>target\nGGCCAATT\n>Sequence\nGGACAATT\n');
    // Blocks of fewer than ten columns are refused, as is a range that is not one.
    fireEvent.change(within(form).getByLabelText('Columns per block'), { target: { value: '3' } });
    fireEvent.click(within(form).getByRole('button', { name: 'As text' }));
    expect(within(form).getByText('Blocks are 10 columns or more.')).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText('To column'), { target: { value: 'x' } });
    fireEvent.click(within(form).getByRole('button', { name: 'As aligned FASTA' }));
    expect(within(form).getByText('Columns are whole numbers.')).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText('From column'), { target: { value: '90' } });
    fireEvent.change(within(form).getByLabelText('To column'), { target: { value: '99' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save SVG' }));
    expect(within(form).getByText('Choose columns from 1 to 28.')).toBeInTheDocument();
    // On screen puts the visible columns back; All the whole alignment.
    fireEvent.click(within(form).getByRole('button', { name: 'On screen' }));
    expect(within(form).getByLabelText('To column')).toHaveValue('1');
    fireEvent.click(within(form).getByRole('button', { name: 'All 28' }));

    // SVG: a download of a vector file with the names and the columns asked for.
    fireEvent.click(within(form).getByRole('button', { name: 'Save SVG' }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(blobs[0]?.type).toContain('image/svg+xml');
    const svg = await blobs[0]?.text();
    expect(svg).toContain('<svg');
    expect(svg).toContain('target');
    expect(within(form).getByText('Saved target-alignment-1-28.svg.')).toBeInTheDocument();

    // Esc closes the popover first and the window on the second.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(within(dialog).queryByRole('group', { name: 'Export the alignment' })).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    click.mockRestore();
  });

  it("groups the large view's controls, counts differences and follows a rebound key (#119)", async () => {
    render(<AlignPanel doc={doc} />);
    // Two bases differ from the document's GGCCAATTGGCC, a run apart.
    fireEvent.change(box(), { target: { value: 'GGACAATTGGAC' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Alignment mode' }), {
      target: { value: 'local' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    await waitFor(() => {
      expect(screen.getByText(/identity/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Large view' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('group', { name: 'Differences' })).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Show' })).toBeInTheDocument();
    const counter = within(dialog).getByText('2 differences');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next difference' }));
    expect(counter).toHaveTextContent('1 of 2');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next difference' }));
    expect(counter).toHaveTextContent('2 of 2');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Previous difference' }));
    expect(counter).toHaveTextContent('1 of 2');
    // The one sample is already picked, so its region can be selected; no list repeats the rows.
    expect(within(dialog).queryByRole('combobox', { name: 'Sample' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Select in document' })).toBeEnabled();
    // Down on the alignment keeps the one sample: the pick stops at the ends.
    const alignment = within(dialog).getByLabelText(/Up and Down pick a sample/);
    fireEvent.keyDown(alignment, { key: 'ArrowDown' });
    expect(within(dialog).getByText(/: local, score/)).toBeInTheDocument();
    // The key is the one bound to Next change, wherever the user moved it.
    act(() => {
      editorStore.setKeyBinding('next-change', 'alt+KeyJ');
    });
    fireEvent.keyDown(document, { code: 'KeyN', altKey: true });
    expect(counter).toHaveTextContent('1 of 2');
    fireEvent.keyDown(document, { code: 'KeyJ', altKey: true });
    expect(counter).toHaveTextContent('2 of 2');
    act(() => {
      editorStore.resetKeyBindings();
    });
  });

  it('marks a difference reviewed and takes a sample base into the document (#123)', async () => {
    render(<AlignPanel doc={doc} />);
    // Two bases differ from the document's GGCCAATTGGCC: positions 15 and 23.
    fireEvent.change(box(), { target: { value: 'GGACAATTGGAC' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Alignment mode' }), {
      target: { value: 'local' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    await waitFor(() => {
      expect(screen.getByText(/identity/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Large view' }));
    let dialog = screen.getByRole('dialog');
    const counter = within(dialog).getByText('2 differences');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next difference' }));
    expect(counter).toHaveTextContent('1 of 2');
    const actions = within(dialog).getByRole('group', { name: 'This difference' });
    fireEvent.click(within(actions).getByRole('button', { name: 'Reviewed' }));
    expect(within(actions).getByRole('button', { name: 'Reviewed' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Skipped from now on: one stop left, and the stop just marked is no longer among them.
    expect(counter).toHaveTextContent('1 of 2 differences');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next difference' }));
    expect(counter).toHaveTextContent('1 of 1');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next difference' }));
    expect(counter).toHaveTextContent('1 of 1');
    // Take the sample's A at 23 into the document: one edit, undoable.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Take Sequence’s bases' }));
    expect(editorStore.document?.sequence.toString()).toBe('TTTTACGTACGTGGCCAATTGGACTTTT');
    expect(editorStore.getState().selection).toEqual({ start: 22, end: 23 });
    expect(within(dialog).getByRole('button', { name: 'Taken' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Next difference' })).toBeDisabled();
    expect(counter).toHaveTextContent('0 of 2 differences');
    // The list keeps both, noted, and its box takes the review mark off. (List is
    // remembered between openings, so it may be open already.)
    if (within(dialog).queryByRole('table', { name: 'Differences' }) === null)
      fireEvent.click(within(dialog).getByRole('button', { name: 'List' }));
    const table = within(dialog).getByRole('table', { name: 'Differences' });
    expect(within(table).getByText('reviewed')).toBeInTheDocument();
    expect(within(table).getByText('taken into the document')).toBeInTheDocument();
    expect(within(table).getByRole('checkbox', { name: 'Reviewed: 23' })).toBeDisabled();
    fireEvent.click(within(table).getByRole('checkbox', { name: 'Reviewed: 15' }));
    expect(counter).toHaveTextContent('1 of 2 differences');
    fireEvent.click(within(dialog).getByRole('button', { name: 'List' }));
    // The marks last as long as the result: closing and opening again finds them.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Large view' }));
    dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('1 of 2 differences')).toBeInTheDocument();
    // An edit the window did not make stops a further take: the positions may have moved.
    act(() => {
      editorStore.undo();
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next difference' }));
    const take = within(dialog).getByRole('button', { name: 'Take Sequence’s bases' });
    expect(take).toBeDisabled();
    expect(take).toHaveAttribute(
      'title',
      'The document has changed since; align again to take more',
    );
  });

  it("closes the large view's popovers on a click outside, and leaves its tables open", async () => {
    render(<AlignPanel doc={doc} />);
    fireEvent.change(box(), { target: { value: 'GGACAATTGGAC' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Alignment mode' }), {
      target: { value: 'local' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    await waitFor(() => {
      expect(screen.getByText(/identity/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Large view' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Go to' }));
    expect(within(dialog).getByRole('group', { name: 'Go to a position' })).toBeInTheDocument();
    // Inside the popover nothing closes.
    fireEvent.pointerDown(within(dialog).getByRole('group', { name: 'Go to a position' }));
    expect(within(dialog).getByRole('group', { name: 'Go to a position' })).toBeInTheDocument();
    fireEvent.pointerDown(within(dialog).getByRole('heading', { level: 2 }));
    expect(within(dialog).queryByRole('group', { name: 'Go to a position' })).toBeNull();
    // A table stays open on a click outside; its own button closes it.
    const list = within(dialog).getByRole('button', { name: 'List' });
    // The List setting is remembered between openings, so start from closed.
    if (within(dialog).queryByRole('table', { name: 'Differences' }) !== null)
      fireEvent.click(list);
    fireEvent.click(list);
    expect(within(dialog).getByRole('table', { name: 'Differences' })).toBeInTheDocument();
    fireEvent.pointerDown(within(dialog).getByRole('heading', { level: 2 }));
    expect(within(dialog).getByRole('table', { name: 'Differences' })).toBeInTheDocument();
    fireEvent.click(list);
    expect(within(dialog).queryByRole('table', { name: 'Differences' })).toBeNull();
  });

  it('starts in Local for a much shorter sequence, saying why, and keeps a mode picked by hand (#86)', () => {
    render(<AlignPanel doc={doc} />);
    const mode = (): HTMLElement => screen.getByRole('combobox', { name: 'Alignment mode' });
    expect(mode()).toHaveValue('global');
    // 12 of the document's 28 bases: under half.
    fireEvent.change(box(), { target: { value: 'GGCCAATTGGCC' } });
    expect(mode()).toHaveValue('local');
    expect(
      screen.getByText(/Local, since the sequence in the box is under half/),
    ).toBeInTheDocument();
    // As long as the document: back to Global, as nothing was picked.
    fireEvent.change(box(), { target: { value: doc.sequence.toString() } });
    expect(mode()).toHaveValue('global');
    expect(screen.queryByText(/Local, since/)).toBeNull();

    fireEvent.change(box(), { target: { value: 'GGCCAATTGGCC' } });
    fireEvent.change(mode(), { target: { value: 'global' } });
    expect(mode()).toHaveValue('global');
    expect(screen.queryByText(/Local, since/)).toBeNull();
    // Picked by hand, it stays whatever the box then holds.
    fireEvent.change(box(), { target: { value: 'GGCCAATT' } });
    expect(mode()).toHaveValue('global');
    fireEvent.change(box(), { target: { value: doc.sequence.toString() } });
    fireEvent.change(mode(), { target: { value: 'local' } });
    fireEvent.change(box(), { target: { value: `${doc.sequence.toString()}A` } });
    expect(mode()).toHaveValue('local');
  });

  it('reads a dropped file into the box and claims the drop', async () => {
    render(<AlignPanel doc={doc} />);
    const file = new File(['>read\nACGTACGT\n'], 'read.fa', { type: 'text/plain' });
    const event = fileDrop(file);
    const notCancelled = fireEvent.drop(box(), event);
    expect(notCancelled).toBe(false); // preventDefault: the app-wide handler leaves it alone
    await waitFor(() => {
      expect(box()).toHaveValue('>read\nACGTACGT\n');
    });
    expect(screen.getByText('From read.fa.')).toBeInTheDocument();
  });

  it('takes the records of several dropped files as the samples, naming each by its file', async () => {
    render(<AlignPanel doc={SeqDocument.create({ name: 'pRef', sequence: 'ACGTACGTAC' })} />);
    fireEvent.drop(
      box(),
      fileDrop(
        new File(['>a\nACGTACGT\n'], 'one.fa'),
        new File(['>b\nTTGGCCAA\n>c\nGGCCTTAA\n'], 'two.fa'),
      ),
    );
    await waitFor(() => {
      expect(screen.getByText(/2 files, 3 records/)).toBeInTheDocument();
    });
    expect(box()).toHaveValue('');
    // With the box empty, the batch is what is chosen and its button is live.
    expect(screen.getByRole('button', { name: 'Align all' })).toBeEnabled();
    expect(screen.getByRole('option', { name: 'b (two.fa) (8 bp)' })).toBeInTheDocument();
  });

  it('keeps the readable files and names one that cannot be read', async () => {
    render(<AlignPanel doc={SeqDocument.create({ name: 'pRef', sequence: 'ACGTACGTAC' })} />);
    fireEvent.drop(
      box(),
      fileDrop(
        new File(['>a\nACGTACGT\n'], 'one.fa'),
        new File(['>b\nTTGGCCAA\n'], 'two.fa'),
        new File(['%PDF-1.7 not a sequence'], 'paper.pdf'),
      ),
    );
    await waitFor(() => {
      expect(screen.getByText(/2 files, 2 records/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Could not read "paper.pdf"/)).toBeInTheDocument();
  });

  it('takes the sequence of another open tab as the sample', async () => {
    const other = SeqDocument.create({ name: 'pOther', sequence: 'TTGGCCAATT' });
    act(() => {
      editorStore.openDocument(other);
      editorStore.activateDocument(editorStore.getState().documents[0]?.documentId ?? '');
    });
    render(<AlignPanel doc={doc} />);
    const picker = screen.getByRole('combobox', { name: 'Open tab to align' });
    expect(screen.getAllByRole('option', { name: 'pOther' })).toHaveLength(1);
    fireEvent.change(picker, {
      target: { value: editorStore.getState().documents[1]?.documentId },
    });
    await waitFor(() => {
      expect(screen.getByText(/From the open tab pOther/)).toBeInTheDocument();
    });
    expect((box() as HTMLTextAreaElement).value).toContain('TTGGCCAATT');
  });

  it('says why a dropped file could not be read', async () => {
    render(<AlignPanel doc={doc} />);
    fireEvent.drop(box(), fileDrop(new File(['%PDF-1.7 not a sequence'], 'paper.pdf')));
    await waitFor(() => {
      expect(screen.getByText(/Could not read "paper.pdf"/)).toBeInTheDocument();
    });
    expect(box()).toHaveValue('');
  });

  it('leaves dragged text to the browser', () => {
    render(<AlignPanel doc={doc} />);
    const notCancelled = fireEvent.drop(box(), {
      dataTransfer: { files: [], types: ['text/plain'] },
    });
    expect(notCancelled).toBe(true);
  });

  it('shows the progress of a long alignment and cancels it', async () => {
    let long: LongRequestOptions = {};
    let reject: (e: unknown) => void = () => undefined;
    const spy = vi
      .spyOn(analysisClient, 'alignEitherStrand')
      .mockImplementation((_a, _b, _o, options = {}) => {
        long = options;
        return new Promise<StrandedAlignment>((_resolve, rej) => {
          reject = rej;
          options.signal?.addEventListener('abort', () => {
            rej(new AnalysisCancelledError());
          });
        });
      });
    render(<AlignPanel doc={doc} />);
    fireEvent.change(box(), { target: { value: 'ACGTACGT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    expect(screen.queryByRole('progressbar')).toBeNull(); // nothing until it first reports
    act(() => {
      long.onProgress?.(0.42);
    });
    expect(screen.getByRole('progressbar', { name: 'Alignment progress' })).toHaveValue(0.42);
    expect(screen.getByText('42%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(long.signal?.aborted).toBe(true);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Align' })).toBeEnabled();
    });
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(document.querySelector('.panel__error')).toBeNull(); // a cancel is not an error
    reject(null);
    spy.mockRestore();
  });

  describe('a result belongs to the input it was made from (#117)', () => {
    async function alignedOnce(text = 'GGCCAATTGGCC') {
      render(<AlignPanel doc={doc} />);
      fireEvent.change(box(), { target: { value: text } });
      fireEvent.change(screen.getByRole('combobox', { name: 'Alignment mode' }), {
        target: { value: 'local' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Align' }));
      await waitFor(() => {
        expect(screen.getByText(/identity 100%/)).toBeInTheDocument();
      });
    }

    it('clears the result when the box is edited', async () => {
      await alignedOnce();
      fireEvent.change(box(), { target: { value: 'GGCCAATTGGCCA' } });
      expect(screen.queryByText(/identity/)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Large view' })).toBeNull();
      expect(screen.queryByRole('group', { name: 'Result' })).toBeNull();
    });

    it('clears the result when a file is dropped', async () => {
      await alignedOnce();
      fireEvent.drop(box(), fileDrop(new File(['>f\nGGCCAATT\n'], 'f.fa')));
      await waitFor(() => {
        expect(screen.queryByText(/identity/)).toBeNull();
      });
    });

    it('clears the result when an open tab is chosen', async () => {
      const other = SeqDocument.create({ name: 'tab two', sequence: 'GGCCAATTGGCC' });
      act(() => {
        editorStore.openDocument(other);
        editorStore.activateDocument(editorStore.getState().documents[0]?.documentId ?? '');
      });
      render(<AlignPanel doc={doc} />);
      fireEvent.change(box(), { target: { value: 'GGCCAATTGGCC' } });
      fireEvent.click(screen.getByRole('button', { name: 'Align' }));
      await waitFor(() => {
        expect(screen.getByText(/identity 100%/)).toBeInTheDocument();
      });
      const tab = screen.getByRole('combobox', { name: 'Open tab to align' });
      fireEvent.change(tab, {
        target: { value: editorStore.getState().documents[1]?.documentId },
      });
      expect(screen.queryByText(/identity/)).toBeNull();
    });

    it('clears the result when another record is picked', async () => {
      render(<AlignPanel doc={doc} />);
      fireEvent.change(box(), { target: { value: '>one\nGGCCAATTGGCC\n>two\nCCCCCCCC\n' } });
      fireEvent.change(screen.getByRole('combobox', { name: 'Record to align' }), {
        target: { value: '0' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Align' }));
      await waitFor(() => {
        expect(screen.getByText(/score/)).toBeInTheDocument();
      });
      fireEvent.change(screen.getByRole('combobox', { name: 'Record to align' }), {
        target: { value: '1' },
      });
      expect(screen.queryByRole('button', { name: 'Large view' })).toBeNull();
    });

    it('marks the result stale, with its actions disabled, when the mode changes', async () => {
      await alignedOnce();
      expect(screen.getByRole('button', { name: 'Large view' })).toBeEnabled();
      expect(screen.queryByText(/Input changed, align again/)).toBeNull();
      fireEvent.change(screen.getByRole('combobox', { name: 'Alignment mode' }), {
        target: { value: 'global' },
      });
      expect(screen.getByText(/Input changed, align again/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Large view' })).toBeDisabled();
      expect(screen.getByText(/identity 100%/).closest('button')).toBeDisabled();
      // The mark sits in the Result group, under its header (#118).
      expect(screen.getByRole('group', { name: 'Result' })).toContainElement(
        screen.getByText(/Input changed, align again/),
      );
      // Aligning again makes it current.
      fireEvent.click(screen.getByRole('button', { name: 'Align' }));
      await waitFor(() => {
        expect(screen.queryByText(/Input changed, align again/)).toBeNull();
      });
      expect(screen.getByRole('button', { name: 'Large view' })).toBeEnabled();
    });

    it('marks the result stale when Against selection only changes', async () => {
      act(() => {
        editorStore.setSelection({ start: 4, end: 12 });
      });
      render(<AlignPanel doc={doc} />);
      fireEvent.change(box(), { target: { value: 'GGCCAATTGGCC' } });
      fireEvent.click(screen.getByRole('button', { name: 'Align' }));
      await waitFor(() => {
        expect(screen.getByText(/identity/)).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('checkbox', { name: 'Against selection only' }));
      expect(screen.getByText(/Input changed, align again/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Large view' })).toBeDisabled();
    });

    it('stops a running alignment when the input changes, and shows no result', async () => {
      let long: LongRequestOptions = {};
      const spy = vi
        .spyOn(analysisClient, 'alignEitherStrand')
        .mockImplementation((_a, _b, _o, options = {}) => {
          long = options;
          return new Promise<StrandedAlignment>((_resolve, rej) => {
            options.signal?.addEventListener('abort', () => {
              rej(new AnalysisCancelledError());
            });
          });
        });
      render(<AlignPanel doc={doc} />);
      fireEvent.change(box(), { target: { value: 'ACGTACGT' } });
      fireEvent.click(screen.getByRole('button', { name: 'Align' }));
      fireEvent.change(box(), { target: { value: 'ACGTACGTA' } });
      expect(long.signal?.aborted).toBe(true);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Align' })).toBeEnabled();
      });
      expect(screen.queryByText(/identity/)).toBeNull();
      spy.mockRestore();
    });
  });

  it('stops a running alignment when the panel goes away', () => {
    let long: LongRequestOptions = {};
    const spy = vi
      .spyOn(analysisClient, 'alignEitherStrand')
      .mockImplementation((_a, _b, _o, options = {}) => {
        long = options;
        return new Promise<StrandedAlignment>(() => undefined);
      });
    const view = render(<AlignPanel doc={doc} />);
    fireEvent.change(box(), { target: { value: 'ACGTACGT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    view.unmount();
    expect(long.signal?.aborted).toBe(true);
    spy.mockRestore();
  });

  describe('with a read’s qualities (#50)', () => {
    // 60 bases of reference; the read is 40 of them with a poor base at 10
    // that is also a mismatch, a confident mismatch at 30, and five poor
    // random bases at each end.
    const reference = 'GATTACAGCTTGACCGTAAGCTAGGCTTACGATCGATTGCAAGTCCGATGCATTGACCTA';
    const refDoc = SeqDocument.create({ name: 'pRef', sequence: reference });
    const middle = reference.slice(10, 50).split('');
    middle[10] = middle[10] === 'A' ? 'C' : 'A';
    middle[30] = middle[30] === 'G' ? 'T' : 'G';
    const read = `TTTTT${middle.join('')}GGGGG`;
    // Q2 at each end ('#'), Q10 at the poor base ('+'), Q40 elsewhere ('I').
    const quality = `#####${Array.from({ length: 40 }, (_, i) => (i === 10 ? '+' : 'I')).join('')}#####`;

    beforeEach(() => {
      act(() => {
        editorStore.openDocument(refDoc);
      });
    });

    async function alignDropped(): Promise<void> {
      render(<AlignPanel doc={refDoc} />);
      const fastq = new File([`@read1\n${read}\n+\n${quality}\n`], 'read1.fastq');
      fireEvent.drop(box(), fileDrop(fastq));
      await waitFor(() => {
        expect(screen.getByText('From read1.fastq, with base qualities.')).toBeInTheDocument();
      });
      // A read starts in Local by itself (#86).
      expect(screen.getByRole('combobox', { name: 'Alignment mode' })).toHaveValue('local');
      expect(
        screen.getByText(/Local, since the sequence in the box is a read/),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Align' }));
      await waitFor(() => {
        expect(screen.getByText(/Local alignment/)).toBeInTheDocument();
      });
    }

    it('trims the poor ends and says so', async () => {
      await alignDropped();
      expect(screen.getByRole('checkbox', { name: 'Trim poor ends' })).toBeChecked();
      expect(
        screen.getByText(/Trimmed 5 bases from the start of the read and 5 from the end/),
      ).toBeInTheDocument();
    });

    it('tells a confident difference from a doubtful one, and selects it', async () => {
      await alignDropped();
      expect(
        screen.getByText(/1 difference at confident bases \(Q20\+\), 1 at poor ones/),
      ).toBeInTheDocument();
      // The confident mismatch is reference base 41 (1-based).
      fireEvent.click(screen.getByRole('button', { name: /Mismatch at 41, Q40/ }));
      expect(editorStore.getState().selection).toEqual({ start: 40, end: 41 });
    });

    it('turns the qualities round with a read that aligns reversed', async () => {
      const rc = reverseComplement(read);
      const reversedQuality = quality.split('').reverse().join('');
      render(<AlignPanel doc={refDoc} />);
      fireEvent.drop(
        box(),
        fileDrop(new File([`@read1\n${rc}\n+\n${reversedQuality}\n`], 'read1.fastq')),
      );
      await waitFor(() => {
        expect(screen.getByText(/with base qualities/)).toBeInTheDocument();
      });
      fireEvent.change(screen.getByRole('combobox', { name: 'Alignment mode' }), {
        target: { value: 'local' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Align' }));
      await waitFor(() => {
        expect(screen.getByText(/reverse complement/)).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /Mismatch at 41, Q40/ })).toBeInTheDocument();
    });

    it('lets Next and Previous skip poor differences, the counter counting what is left (#122)', async () => {
      await alignDropped();
      fireEvent.click(screen.getByRole('button', { name: 'Large view' }));
      const dialog = screen.getByRole('dialog');
      const counter = within(dialog).getByText('2 differences');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Filter' }));
      const pop = within(dialog).getByRole('group', { name: 'Stop at differences' });
      const good = within(pop).getByRole('checkbox', { name: /Good quality only \(Q20/ });
      fireEvent.click(good);
      expect(counter).toHaveTextContent('1 of 2 differences');
      expect(within(dialog).getByRole('button', { name: 'Filter (on)' })).toBeInTheDocument();
      // Next goes to the confident one, and again to it: the poor one is skipped.
      fireEvent.click(within(dialog).getByRole('button', { name: 'Next difference' }));
      expect(counter).toHaveTextContent('1 of 1');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Next difference' }));
      expect(counter).toHaveTextContent('1 of 1');
      // The document is there, so where a difference falls can be asked.
      expect(
        within(pop).getByRole('combobox', { name: 'Stop at differences where' }),
      ).toBeEnabled();
      fireEvent.change(within(pop).getByRole('combobox', { name: 'Stop at differences where' }), {
        target: { value: 'cds' },
      });
      // pRef has no CDS: nothing to stop at, and the buttons say so.
      expect(within(dialog).getByRole('button', { name: 'Next difference' })).toBeDisabled();
      fireEvent.change(within(pop).getByRole('combobox', { name: 'Stop at differences where' }), {
        target: { value: 'any' },
      });
      // The filter is remembered between openings; put it back for the tests after.
      fireEvent.click(good);
      expect(within(dialog).getByRole('button', { name: 'Filter' })).toBeInTheDocument();
    });

    it('counts and lists differences from the threshold set (#56)', async () => {
      await alignDropped();
      // The Q10 base becomes confident at Q10, and the count follows at once.
      fireEvent.change(screen.getByRole('combobox', { name: 'Confident from' }), {
        target: { value: '10' },
      });
      expect(editorStore.getState().readConfidentQuality).toBe(10);
      expect(
        screen.getByText(/^2 differences at confident bases \(Q10\+\)\.$/),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Mismatch at 21, Q10/ })).toBeInTheDocument();
      // At Q50 even the Q40 bases are doubtful.
      fireEvent.change(screen.getByRole('combobox', { name: 'Confident from' }), {
        target: { value: '50' },
      });
      expect(screen.getByText(/No differences at confident bases \(Q50\+\)/)).toBeInTheDocument();
      act(() => {
        editorStore.setReadConfidentQuality(20);
      });
    });

    it('trims at the cutoff set (#56)', async () => {
      await alignDropped();
      // At 0.1% the Q10 base ten bases in costs more than those ten earn.
      fireEvent.change(screen.getByRole('combobox', { name: 'Trim at' }), {
        target: { value: '0.001' },
      });
      expect(editorStore.getState().readTrimCutoff).toBe(0.001);
      fireEvent.click(screen.getByRole('button', { name: 'Align' }));
      await waitFor(() => {
        expect(
          screen.getByText(/Trimmed 16 bases from the start of the read and 5 from the end/),
        ).toBeInTheDocument();
      });
      act(() => {
        editorStore.setReadTrimCutoff(0.05);
      });
    });

    describe('when the document is the read (#57)', () => {
      const qualities = Uint8Array.from(quality, (c) => c.charCodeAt(0) - 33);
      const readDoc = SeqDocument.create({
        name: 'read1',
        sequence: read,
        read: { qualities, trace: null },
      });
      const rcDoc = SeqDocument.create({
        name: 'read1rc',
        sequence: reverseComplement(read),
        read: { qualities: qualities.slice().reverse(), trace: null },
      });

      async function alignToBox(d: SeqDocument): Promise<void> {
        act(() => {
          editorStore.openDocument(d);
        });
        render(<AlignPanel doc={d} />);
        fireEvent.change(box(), { target: { value: `>pRef\n${reference}\n` } });
        fireEvent.change(screen.getByRole('combobox', { name: 'Alignment mode' }), {
          target: { value: 'local' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Align' }));
        await waitFor(() => {
          expect(screen.getByText(/Local alignment/)).toBeInTheDocument();
        });
      }

      it('aligns the document as the read, with its qualities, to the box', async () => {
        await alignToBox(readDoc);
        expect(
          screen.getByText(/read1 is a read: it is aligned to the sequence in the box/),
        ).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'This document is the read' })).toBeChecked();
        expect(
          screen.getByText(/Trimmed 5 bases from the start of the read and 5 from the end/),
        ).toBeInTheDocument();
        expect(
          screen.getByText(/1 difference at confident bases \(Q20\+\), 1 at poor ones/),
        ).toBeInTheDocument();
        // Named at its place in the read, which is the document, and in the reference.
        fireEvent.click(screen.getByRole('button', { name: /Mismatch at 36 \(pRef 41\), Q40/ }));
        expect(editorStore.getState().selection).toEqual({ start: 35, end: 36 });
        fireEvent.click(screen.getByRole('button', { name: /^(Global|Local) alignment/ }));
        expect(editorStore.getState().selection).toEqual({ start: 5, end: 45 });
      });

      it('finds a difference in a read that aligned reversed', async () => {
        await alignToBox(rcDoc);
        expect(screen.getByText(/reverse complement of this read/)).toBeInTheDocument();
        // Base 35 of the read is base 50 − 1 − 35 = 14 of its reverse complement.
        fireEvent.click(screen.getByRole('button', { name: /Mismatch at 15 \(pRef 41\), Q40/ }));
        expect(editorStore.getState().selection).toEqual({ start: 14, end: 15 });
        fireEvent.click(screen.getByRole('button', { name: /^(Global|Local) alignment/ }));
        expect(editorStore.getState().selection).toEqual({ start: 5, end: 45 });
      });

      it('aligns the other way round, without qualities, when told to', async () => {
        act(() => {
          editorStore.openDocument(readDoc);
        });
        render(<AlignPanel doc={readDoc} />);
        fireEvent.change(box(), { target: { value: `>pRef\n${reference}\n` } });
        fireEvent.click(screen.getByRole('checkbox', { name: 'This document is the read' }));
        expect(screen.getByText(/Align sequences to read1/)).toBeInTheDocument();
        expect(screen.queryByRole('checkbox', { name: 'Trim poor ends' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Align' }));
        await waitFor(() => {
          expect(screen.getByText(/Global alignment/)).toBeInTheDocument();
        });
        expect(document.querySelector('.read-summary')).toBeNull();
      });

      it('keeps the usual way round when the box holds a read of its own', async () => {
        act(() => {
          editorStore.openDocument(readDoc);
        });
        render(<AlignPanel doc={readDoc} />);
        fireEvent.drop(
          box(),
          fileDrop(new File([`@read2\n${read}\n+\n${quality}\n`], 'read2.fastq')),
        );
        await waitFor(() => {
          expect(screen.getByText(/with base qualities/)).toBeInTheDocument();
        });
        expect(screen.queryByRole('checkbox', { name: 'This document is the read' })).toBeNull();
        expect(screen.getByText(/Align sequences to read1/)).toBeInTheDocument();
      });
    });

    it('forgets the qualities once the text is edited', async () => {
      await alignDropped();
      fireEvent.change(box(), { target: { value: `>read1\n${read}` } });
      expect(screen.queryByRole('checkbox', { name: 'Trim poor ends' })).toBeNull();
    });
  });

  describe('every record at once (#59)', () => {
    const reference = 'GATTACAGCTTGACCGTAAGCTAGGCTTACGATCGATTGCAAGTCCGATGCATTGACCTA';
    const refDoc = SeqDocument.create({ name: 'pRef', sequence: reference });
    const fastq = [
      `@clone1\n${reference.slice(5, 45)}\n+\n${'I'.repeat(40)}`,
      `@clone2\n${reverseComplement(reference.slice(15, 55))}\n+\n${'I'.repeat(40)}`,
      `@clone3\nACGTACGT\n+\n${'#'.repeat(8)}`,
    ].join('\n');

    async function dropBatch(): Promise<void> {
      act(() => {
        editorStore.openDocument(refDoc);
      });
      render(<AlignPanel doc={refDoc} />);
      fireEvent.drop(box(), fileDrop(new File([fastq], 'plate.fastq')));
      await waitFor(() => {
        expect(
          screen.getByText(/3 records; the one chosen is aligned, or choose All records/),
        ).toBeInTheDocument();
      });
      fireEvent.change(screen.getByRole('combobox', { name: 'Alignment mode' }), {
        target: { value: 'local' },
      });
      fireEvent.change(screen.getByRole('combobox', { name: 'Record to align' }), {
        target: { value: '-1' },
      });
    }

    it('sorts and hides the samples of the large view, the keys and verdicts following the shown rows (#127)', async () => {
      const mutate = (seq: string, at: number): string =>
        seq.slice(0, at) + (seq[at] === 'A' ? 'C' : 'A') + seq.slice(at + 1);
      const reads = [
        ['zeta', reference.slice(5, 45)],
        ['alpha', mutate(reference.slice(15, 55), 20)],
        ['mid', reference.slice(0, 30)],
      ] as const;
      const text = reads.map(([n, q]) => `@${n}\n${q}\n+\n${'I'.repeat(q.length)}`).join('\n');
      act(() => {
        editorStore.openDocument(refDoc);
      });
      render(<AlignPanel doc={refDoc} />);
      fireEvent.drop(box(), fileDrop(new File([text], 'plate.fastq')));
      await waitFor(() => {
        expect(screen.getByRole('combobox', { name: 'Record to align' })).toBeInTheDocument();
      });
      fireEvent.change(screen.getByRole('combobox', { name: 'Alignment mode' }), {
        target: { value: 'local' },
      });
      fireEvent.change(screen.getByRole('combobox', { name: 'Record to align' }), {
        target: { value: '-1' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Align all' }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Large view of all' })).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Large view of all' }));
      const dialog = screen.getByRole('dialog');
      const alignment = within(dialog).getByLabelText(/Up and Down pick a sample/);
      /** The names top to bottom, by walking the picked row from the first to the last. */
      const order = (count = 3): string[] => {
        const names: string[] = [];
        for (let i = 0; i < 5; i++) fireEvent.keyDown(alignment, { key: 'ArrowUp' });
        for (let i = 0; i < count; i++) {
          names.push(/(zeta|alpha|mid): local, score/.exec(dialog.textContent)?.[1] ?? '?');
          fireEvent.keyDown(alignment, { key: 'ArrowDown' });
        }
        return names;
      };
      const sortBy = (value: string): void => {
        fireEvent.change(within(dialog).getByRole('combobox', { name: 'Sort samples by' }), {
          target: { value },
        });
      };
      fireEvent.click(within(dialog).getByRole('button', { name: 'Samples' }));
      expect(order()).toEqual(['zeta', 'alpha', 'mid']);
      sortBy('name');
      expect(order()).toEqual(['alpha', 'mid', 'zeta']);
      sortBy('identity');
      expect(order()).toEqual(['zeta', 'mid', 'alpha']);
      sortBy('position');
      expect(order()).toEqual(['mid', 'zeta', 'alpha']);
      sortBy('original');

      // The walk ended on the last row, alpha (the position sort's): hide it.
      expect(within(dialog).getByText(/No samples hidden/)).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Hide' }));
      expect(within(dialog).getByRole('button', { name: /Samples \(1 hidden\)/ })).toBeVisible();
      expect(dialog.textContent).toContain('1 hidden');
      // The pick went with it, and the rows are the two that remain.
      expect(within(dialog).queryByRole('button', { name: 'Hide' })).toBeNull();
      expect(order(2)).toEqual(['zeta', 'mid']);
      // Bring it back by name, to its place.
      fireEvent.click(within(dialog).getByRole('button', { name: 'Show alpha' }));
      expect(order(3)).toEqual(['zeta', 'alpha', 'mid']);
      // Hide two, and the one left cannot be hidden.
      fireEvent.click(within(dialog).getByRole('button', { name: 'Hide' }));
      fireEvent.keyDown(alignment, { key: 'ArrowUp' });
      fireEvent.keyDown(alignment, { key: 'ArrowUp' });
      fireEvent.keyDown(alignment, { key: 'ArrowUp' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Hide' }));
      expect(within(dialog).getByRole('button', { name: /Samples \(2 hidden\)/ })).toBeVisible();
      fireEvent.keyDown(alignment, { key: 'ArrowDown' });
      expect(within(dialog).queryByRole('button', { name: 'Hide' })).toBeNull();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Show all' }));
      expect(within(dialog).getByRole('button', { name: 'Samples' })).toBeVisible();
      expect(order(3)).toEqual(['zeta', 'alpha', 'mid']);
    });

    it('aligns them all, lists them, and shows the one picked', async () => {
      await dropBatch();
      fireEvent.click(screen.getByRole('button', { name: 'Align all' }));
      await waitFor(() => {
        expect(screen.getByText('3 reads')).toBeInTheDocument();
      });
      await waitFor(() => {
        expect(screen.getAllByRole('row')).toHaveLength(4);
      });
      expect(screen.getByText(/1 could not be aligned/)).toBeInTheDocument();
      expect(screen.getByText(/good enough quality/)).toBeInTheDocument();
      // A batch's list is its own group, named for more than one (#118).
      expect(screen.getByRole('group', { name: 'Results' })).toContainElement(
        screen.getByRole('button', { name: 'Large view of all' }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'clone2' }));
      // The picked read has no section of its own; the large view shows it.
      expect(screen.queryByText(/Local alignment of clone2/)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Large view of all' }));
      expect(screen.getByRole('dialog')).toHaveTextContent(/clone2: local, score/);
      fireEvent.keyDown(document, { key: 'Escape' });
      // Pointing at a row draws its region without selecting it (#108).
      act(() => {
        editorStore.setSelection({ start: 1, end: 2 });
      });
      const pick = screen.getByRole('button', { name: 'clone2' });
      fireEvent.pointerEnter(pick, { pointerType: 'mouse' });
      expect(editorStore.getState().preview?.items[0]?.range).toEqual({ start: 15, end: 55 });
      expect(editorStore.getState().selection).toEqual({ start: 1, end: 2 });
      fireEvent.pointerLeave(pick);
      expect(editorStore.getState().preview).toBeNull();
      // Clicking it selects the region.
      fireEvent.click(pick);
      expect(editorStore.getState().selection).toEqual({ start: 15, end: 55 });
    });

    it('shows its progress by reads, and cancels keeping what was done', async () => {
      let calls = 0;
      const spy = vi
        .spyOn(analysisClient, 'alignEitherStrand')
        .mockImplementation((_a, _b, _o, options = {}) => {
          calls++;
          return new Promise<StrandedAlignment>((_resolve, rej) => {
            options.signal?.addEventListener('abort', () => {
              rej(new AnalysisCancelledError());
            });
          });
        });
      await dropBatch();
      fireEvent.click(screen.getByRole('button', { name: 'Align all' }));
      expect(screen.getByRole('progressbar', { name: 'Alignment progress' })).toBeInTheDocument();
      expect(screen.getByText('0 of 3')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => {
        expect(screen.getByText(/cancelled after 0/)).toBeInTheDocument();
      });
      expect(calls).toBe(1);
      expect(screen.getByRole('button', { name: 'Align all' })).toBeEnabled();
      spy.mockRestore();
    });

    it('takes at most a plate of records, and says so', () => {
      render(<AlignPanel doc={doc} />);
      const many = Array.from({ length: 97 }, (_, i) => `>r${i}\nACGTACGT`).join('\n');
      fireEvent.change(box(), { target: { value: many } });
      expect(screen.queryByRole('option', { name: /All 97 records/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Align' })).toBeEnabled();
      expect(
        screen.getByText(/Aligning all takes at most 96 at a time \(a plate\)/),
      ).toBeInTheDocument();
    });
  });

  it('aligns a read through the origin of a circular document (#51)', async () => {
    let x = 11;
    let plasmid = '';
    for (let i = 0; i < 1000; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      plasmid += 'ACGT'.charAt((x >> 16) & 3);
    }
    const circle = SeqDocument.create({ name: 'pCirc', sequence: plasmid, topology: 'circular' });
    act(() => {
      editorStore.openDocument(circle);
    });
    render(<AlignPanel doc={circle} />);
    // 300 bases before the origin and 400 after it.
    fireEvent.change(box(), { target: { value: plasmid.slice(700) + plasmid.slice(0, 400) } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Alignment mode' }), {
      target: { value: 'local' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    await waitFor(() => {
      expect(screen.getByText(/identity 100% over 700 columns/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /^(Global|Local) alignment/ }));
    expect(editorStore.getState().selection).toEqual({ start: 700, end: 1400 });
    // Pointing at the heading draws the region in the views, through the origin,
    // and leaves the selection alone (#108).
    const heading = screen.getByRole('button', { name: /^(Global|Local) alignment/ });
    // It says what it does (#116).
    expect(heading).toHaveAttribute('title', expect.stringContaining('Show in document'));
    act(() => {
      editorStore.setSelection({ start: 5, end: 9 });
    });
    fireEvent.pointerEnter(heading, { pointerType: 'mouse' });
    expect(editorStore.getState().preview?.items).toEqual([
      expect.objectContaining({ range: { start: 700, end: 1400 } }),
    ]);
    expect(editorStore.getState().selection).toEqual({ start: 5, end: 9 });
    fireEvent.pointerLeave(heading);
    expect(editorStore.getState().preview).toBeNull();
    fireEvent.focus(heading);
    expect(editorStore.getState().preview).not.toBeNull();
    fireEvent.blur(heading);
    expect(editorStore.getState().preview).toBeNull();
    // A touch has no hover; and unmounting while pointed leaves nothing behind.
    fireEvent.pointerEnter(heading, { pointerType: 'touch' });
    expect(editorStore.getState().preview).toBeNull();
    fireEvent.focus(heading);
    expect(editorStore.getState().preview).not.toBeNull();
    // The alignment is read in the large view, not printed in the panel.
    expect(document.querySelector('pre')).toBeNull();
    expect(screen.getByRole('button', { name: 'Large view' })).toBeInTheDocument();
    // Unmounting while pointed leaves no highlight behind.
    cleanup();
    expect(editorStore.getState().preview).toBeNull();
  });
});

describe('useAlignedRegionPointer', () => {
  it('does not loop when the result is a new object on every render', () => {
    const base = {
      alignment: { startA: 2, endA: 8, startB: 0, endB: 6 },
      strand: 'forward',
      offset: 0,
      wrap: null,
      offsetB: 0,
      lengthB: 6,
      readLength: 6,
    };
    act(() => {
      editorStore.openDocument(doc);
    });
    const { result, rerender } = renderHook(() =>
      // A fresh object each render, as a batch row's result once was.
      useAlignedRegionPointer(JSON.parse(JSON.stringify(base)) as ReadAlignment, false, 28),
    );
    act(() => {
      result.current.handlers.onPointerEnter({ pointerType: 'mouse' } as PointerEvent<HTMLElement>);
    });
    rerender();
    expect(editorStore.getState().preview?.items[0]?.range).toEqual({ start: 2, end: 8 });
    cleanup();
    act(() => {
      editorStore.closeDocument();
    });
  });
});

describe('aligning two proteins (#95)', () => {
  // The first residues of human haemoglobin beta, and the same with two
  // substitutions: one conservative (V for I), one not (P for G).
  const HBB = 'MVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLS';
  const OTHER = 'MVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFVDLS';
  const protein = SeqDocument.create({ name: 'HBB', sequence: HBB, alphabet: 'protein' });

  afterEach(() => {
    act(() => {
      editorStore.closeAllDocuments();
    });
  });

  it('asks for residues, scores by BLOSUM62 and never turns the sequence over', async () => {
    act(() => {
      editorStore.openDocument(protein);
    });
    render(<AlignPanel doc={protein} />);
    expect(box()).toHaveAttribute('placeholder', expect.stringContaining('Paste residues'));
    fireEvent.change(box(), { target: { value: OTHER } });
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    const heading = await screen.findByText(/Global alignment/);
    // 49 of the 50 residues are the same; a protein has no reverse strand,
    // so nothing is said about one.
    expect(heading.textContent).toContain('identity 98%');
    expect(heading.textContent).not.toContain('reverse');
    // The conservative substitution is marked as one, not as a mismatch.
    expect(document.body.textContent).toContain(OTHER.slice(0, 40));
  });

  it('aligns a pasted protein FASTA record', async () => {
    act(() => {
      editorStore.openDocument(protein);
    });
    render(<AlignPanel doc={protein} />);
    fireEvent.change(box(), { target: { value: `>variant\n${OTHER}\n` } });
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    expect((await screen.findByText(/Global alignment/)).textContent).toContain('identity 98%');
  });
});
