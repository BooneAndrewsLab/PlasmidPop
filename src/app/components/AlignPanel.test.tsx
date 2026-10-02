// @vitest-environment jsdom
import {
  act,
  cleanup,
  renderHook,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import { type StrandedAlignment, SeqDocument, reverseComplement } from '@/core';
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
