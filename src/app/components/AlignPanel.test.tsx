// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type StrandedAlignment, SeqDocument, reverseComplement } from '@/core';
import { parseAbif } from '@/io';
import {
  AnalysisCancelledError,
  type LongRequestOptions,
  analysisClient,
} from '@/workers/analysisClient';

import { editorStore } from '../state/editorStore';
import { AlignPanel } from './AlignPanel';

const doc = SeqDocument.create({ name: 'target', sequence: 'TTTTACGTACGTGGCCAATTGGCCTTTT' });

function box(): HTMLElement {
  return screen.getByRole('textbox', { name: 'Sequence to align' });
}

function fileDrop(file: File) {
  return { dataTransfer: { files: [file], types: ['Files'] } };
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
    fireEvent.change(screen.getByRole('combobox', { name: '' }), { target: { value: 'local' } });
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    await waitFor(() => {
      expect(screen.getByText(/identity 100%/)).toBeInTheDocument();
    });
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
      fireEvent.change(screen.getByRole('combobox', { name: '' }), { target: { value: 'local' } });
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
      // The poor base is marked in the read's line.
      const poor = document.querySelectorAll('.alignment__q-low');
      expect([...poor].map((e) => e.textContent).join('')).toBe(middle[10]);
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
      fireEvent.change(screen.getByRole('combobox', { name: '' }), { target: { value: 'local' } });
      fireEvent.click(screen.getByRole('button', { name: 'Align' }));
      await waitFor(() => {
        expect(screen.getByText(/reverse complement/)).toBeInTheDocument();
      });
      expect(screen.getByRole('button', { name: /Mismatch at 41, Q40/ })).toBeInTheDocument();
      expect(
        [...document.querySelectorAll('.alignment__q-low')].map((e) => e.textContent).join(''),
      ).toBe(middle[10]);
    });

    it('counts, lists and shades differences from the threshold set (#56)', async () => {
      await alignDropped();
      expect(document.querySelectorAll('.alignment__q-low')).toHaveLength(1);
      // The Q10 base becomes confident at Q10, and the count follows at once.
      fireEvent.change(screen.getByRole('combobox', { name: 'Confident from' }), {
        target: { value: '10' },
      });
      expect(editorStore.getState().readConfidentQuality).toBe(10);
      expect(
        screen.getByText(/^2 differences at confident bases \(Q10\+\)\.$/),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Mismatch at 21, Q10/ })).toBeInTheDocument();
      expect(document.querySelectorAll('.alignment__q-low')).toHaveLength(0);
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

    it('forgets the qualities once the text is edited', async () => {
      await alignDropped();
      fireEvent.change(box(), { target: { value: `>read1\n${read}` } });
      expect(screen.queryByRole('checkbox', { name: 'Trim poor ends' })).toBeNull();
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
    fireEvent.change(screen.getByRole('combobox', { name: '' }), { target: { value: 'local' } });
    fireEvent.click(screen.getByRole('button', { name: 'Align' }));
    await waitFor(() => {
      expect(screen.getByText(/identity 100% over 700 columns/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Select aligned region in this document' }));
    expect(editorStore.getState().selection).toEqual({ start: 700, end: 1400 });
    // Numbered as the document is, round the origin: blocks of 60 from 701
    // reach 941, and the next begins at base 1 again.
    const starts = [...document.querySelectorAll('.alignment__block')].map((b) =>
      Number(b.textContent.trim().split(/\s+/)[0]),
    );
    expect(starts.slice(0, 7)).toEqual([701, 761, 821, 881, 941, 1, 61]);
  });

  describe('with an AB1 trace (#52)', () => {
    const bytes = new Uint8Array(
      readFileSync(join(process.cwd(), 'src/io/fixtures/abif/sanger.ab1')),
    );
    const called = parseAbif(bytes).documents[0]?.sequence.toString() ?? '';
    // The reference differs from the read at 200 (0-based), where the read is Q47.
    const reference = called.slice(0, 200) + (called[200] === 'A' ? 'C' : 'A') + called.slice(201);
    const refDoc = SeqDocument.create({ name: 'pRef', sequence: reference.replace(/N/g, 'A') });

    async function alignTrace(): Promise<void> {
      act(() => {
        editorStore.openDocument(refDoc);
      });
      render(<AlignPanel doc={refDoc} />);
      fireEvent.drop(box(), fileDrop(new File([bytes.slice()], 'clone3.ab1')));
      await waitFor(() => {
        expect(screen.getByText(/with base qualities/)).toBeInTheDocument();
      });
      fireEvent.change(screen.getByRole('combobox', { name: '' }), { target: { value: 'local' } });
      fireEvent.click(screen.getByRole('button', { name: 'Align' }));
      await waitFor(() => {
        expect(screen.getByText(/Local alignment/)).toBeInTheDocument();
      });
    }

    it('draws a trace under every block of the alignment, and hides it on request', async () => {
      await alignTrace();
      const blocks = document.querySelectorAll('.alignment__block').length;
      expect(blocks).toBeGreaterThan(0);
      expect(document.querySelectorAll('.alignment__trace')).toHaveLength(blocks);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Show the trace under the read' }));
      expect(document.querySelectorAll('.alignment__trace')).toHaveLength(0);
    });

    it('brings a picked difference’s block into view and marks it', async () => {
      await alignTrace();
      fireEvent.click(screen.getByRole('button', { name: /Mismatch at 201, Q47/ }));
      const marked = document.querySelector('.alignment__block--focus');
      expect(marked?.textContent).toMatch(/^\s*\d+/);
      // The block holds position 201.
      const first = Number((marked?.textContent ?? '').trim().split(/\s+/)[0]);
      expect(first).toBeLessThanOrEqual(201);
      expect(first + 60).toBeGreaterThan(201);
    });
  });
});
