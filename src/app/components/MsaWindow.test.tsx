// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { editorStore } from '../state/editorStore';
import { MsaWindow } from './MsaWindow';

afterEach(() => {
  cleanup();
  act(() => {
    editorStore.dismissMsa();
  });
});

const fasta =
  '>one\nATGGCGTACGTTAGCCTTGACC\n>two\nATGGCGTACGTAGCCATTGACC\n>three\nATGGCGTACGTTAGCCATTGACA\n';
const proteins =
  '>p1\nMKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQ\n>p2\nMKTAYIAKQRQISFVKSHFSRQLEERLGLIEVA\n>p3\nMKTAYIAKQRQISFVKSHFSRQLEERLGLIEAQ\n';

function open() {
  const view = render(<MsaWindow />);
  act(() => {
    editorStore.requestMsa();
  });
  return view;
}

function box(): HTMLElement {
  return screen.getByRole('textbox', { name: 'Sequences to align' });
}

describe('MsaWindow (#369)', () => {
  it('is up only while asked for, and needs three records before it aligns', () => {
    render(<MsaWindow />);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => {
      editorStore.requestMsa();
    });
    expect(screen.getByRole('dialog', { name: 'Multiple alignment' })).toBeInTheDocument();
    const align = screen.getByRole('button', { name: /^Align/ });
    expect(align).toBeDisabled();
    fireEvent.change(box(), { target: { value: '>a\nACGTACGTACGT\n>b\nACGTACGTACGA\n' } });
    expect(screen.getByRole('button', { name: 'Align 2 together' })).toBeDisabled();
    expect(screen.getByText(/at least three sequences: add records to the box\.$/)).toBeVisible();
    fireEvent.change(box(), { target: { value: fasta } });
    expect(screen.getByRole('button', { name: 'Align 3 together' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: '3 sequences' })).toBeVisible();
    expect(
      within(screen.getByRole('list', { name: /Sequences to align/ }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['one22 bp×', 'two22 bp×', 'three23 bp×']);
    expect(screen.getByRole('option', { name: 'Detected (nucleotide)' })).toBeInTheDocument();
    // One taken out: the box is the rest as FASTA, and two are not enough.
    fireEvent.click(screen.getByRole('button', { name: 'Remove two' }));
    expect(screen.getByRole('heading', { name: '2 sequences' })).toBeVisible();
    expect(box()).toHaveValue('>one\nATGGCGTACGTTAGCCTTGACC\n>three\nATGGCGTACGTTAGCCATTGACA\n');
    expect(screen.getByRole('button', { name: 'Align 2 together' })).toBeDisabled();
  });

  it('aligns the pasted records in the worker and shows the results window, back to the box on Close', async () => {
    open();
    fireEvent.change(box(), { target: { value: fasta } });
    fireEvent.click(screen.getByRole('button', { name: 'Align 3 together' }));
    const results = await screen.findByRole('dialog', {
      name: /Multiple alignment of 3 sequences/,
    });
    expect(results).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save aligned FASTA' })).toBeEnabled();
    fireEvent.click(within(results).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /of 3 sequences/ })).toBeNull();
    });
    // The box is still there with its records, for another run.
    expect(box()).toHaveValue(fasta);
    expect(screen.getByRole('button', { name: 'Align 3 together' })).toBeEnabled();
  });

  it('reads the alphabet from the letters, with no document to mislead it, and takes an override', async () => {
    open();
    fireEvent.change(box(), { target: { value: proteins } });
    expect(screen.getByText(/Scored as protein: the letters read as protein/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Align 3 together' }));
    const results = await screen.findByRole('dialog', { name: /of 3 proteins/ });
    fireEvent.click(within(results).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /of 3 proteins/ })).toBeNull();
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Alphabet of the records' }), {
      target: { value: 'nucleotide' },
    });
    expect(
      screen.getByText('Scored as nucleotide, as chosen; the letters read as protein.'),
    ).toBeVisible();
  });

  it('takes dropped files as the records, naming each by its file, and claims the drop', async () => {
    open();
    const notCancelled = fireEvent.drop(box(), {
      dataTransfer: {
        files: [
          new File(['>a\nACGTACGTAA\n'], 'one.fa'),
          new File(['>b\nACGTACGTAC\n>c\nACGTACGTAG\n'], 'two.fa'),
        ],
        types: ['Files'],
      },
    });
    expect(notCancelled).toBe(false);
    const heading = await screen.findByRole('heading', { name: /^3 sequences/ });
    expect(heading).toHaveTextContent('2 files, 3 records.');
    expect(
      within(screen.getByRole('list', { name: /Sequences to align/ }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['a10 bp · one.fa×', 'b10 bp · two.fa×', 'c10 bp · two.fa×']);
    // The box says the files were taken, and stays empty for the next paste.
    expect(box()).toHaveValue('');
    expect(box()).toHaveAttribute('placeholder', expect.stringMatching(/^The files were taken/));
    expect(screen.getByRole('button', { name: 'Align 3 together' })).toBeEnabled();
    // Taking one out keeps the set a set: the box stays empty, two are left.
    fireEvent.click(screen.getByRole('button', { name: 'Remove c' }));
    expect(screen.getByRole('heading', { name: /^2 sequences/ })).toBeVisible();
    expect(box()).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Align 2 together' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove a' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove b' }));
    expect(screen.queryByRole('list', { name: /Sequences to align/ })).toBeNull();
    expect(box()).toHaveAttribute('placeholder', expect.stringMatching(/^Paste FASTA/));
  });

  it('names a file it cannot read and keeps the rest', async () => {
    open();
    fireEvent.drop(box(), {
      dataTransfer: {
        files: [new File([fasta], 'reads.fa'), new File(['%PDF-1.7 no'], 'paper.pdf')],
        types: ['Files'],
      },
    });
    await waitFor(() => {
      expect(screen.getByText(/Could not read "paper\.pdf"/)).toBeVisible();
    });
    expect(screen.getByRole('heading', { name: /^3 sequences/ })).toBeVisible();
  });

  it('closes on Escape and on Close, but leaves Escape to the results window while that is up', async () => {
    open();
    fireEvent.change(box(), { target: { value: fasta } });
    fireEvent.click(screen.getByRole('button', { name: 'Align 3 together' }));
    await screen.findByRole('dialog', { name: /of 3 sequences/ });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /of 3 sequences/ })).toBeNull();
    });
    expect(screen.getByRole('dialog', { name: 'Multiple alignment' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(editorStore.getState().msaDialog).toBe(false);
  });
});
