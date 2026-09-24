// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { SeqDocument } from '@/core';
import { PlasmidPopDb, DocumentRepository } from '@/storage';

import { FormatMenu } from './components/FormatMenu';
import { ReadNotice } from './components/ReadNotice';
import { StatusBar } from './components/StatusBar';
import { openFile } from './openFile';
import { editorStore } from './state/editorStore';
import { PersistenceService } from './state/persistence';

/** Opening and keeping sequencing reads (#49). */

// jsdom's import.meta.url is not a file URL; tests run from the repo root.
const fixtures = join(process.cwd(), 'src/io/fixtures/abif');

function file(bytes: Uint8Array, name: string): File {
  return new File([bytes.slice()], name);
}

const read = SeqDocument.create({
  name: 'r1',
  sequence: 'ACGTACGTAC',
  read: { qualities: Uint8Array.from([40, 40, 40, 40, 40, 40, 40, 40, 10, 10]), trace: null },
});

describe('sequencing reads in the app', () => {
  afterEach(() => {
    act(() => {
      editorStore.closeAllDocuments();
      editorStore.dismissReadNotice();
    });
  });

  it('opens an AB1 file as a document with its read, named after the file', async () => {
    const bytes = new Uint8Array(readFileSync(join(fixtures, 'sanger.ab1')));
    await act(async () => {
      await openFile(file(bytes, 'clone3_M13F.ab1'));
    });
    const doc = editorStore.document;
    expect(doc?.name).toBe('clone3_M13F');
    expect(doc?.length).toBe(240);
    expect(doc?.read?.trace?.peaks.length).toBe(240);
  });

  it("lets the trace's height be set in the Format menu while a read with one is in front", async () => {
    render(<FormatMenu />);
    const open = (): void => {
      fireEvent.click(screen.getByRole('button', { name: 'Format' }));
    };
    act(() => {
      editorStore.openDocument(read, 'r1.fastq'); // qualities, no trace
    });
    open();
    // Listed, so it can be found, but not to be set without a trace to see.
    expect(screen.getByText('Trace')).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Hidden' })).toBeDisabled();
    open();
    const bytes = new Uint8Array(readFileSync(join(fixtures, 'sanger.ab1')));
    await act(async () => {
      await openFile(file(bytes, 'clone3_M13F.ab1'));
    });
    open();
    expect(screen.getByText('Trace')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Hidden' }));
    expect(editorStore.getState().traceSize).toBe('off');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Tall' }));
    expect(editorStore.getState().traceSize).toBe('tall');
    act(() => {
      editorStore.setTraceSize('short');
    });
  });

  it('opens a gzipped FASTQ, and says how many reads were not opened', async () => {
    const text = '@a\nACGT\n+\nIIII\n@b\nGG\n+\nII\n@c\nT\n+\nI\n';
    await act(async () => {
      await openFile(file(gzipSync(text), 'run.fastq.gz'));
    });
    expect(editorStore.getState().error).toBeNull();
    expect(editorStore.document?.name).toBe('a');
    expect(editorStore.document?.read?.qualities[0]).toBe(40);
    const warnings = editorStore.getState().warnings.map((w) => w.message);
    expect(warnings).toContainEqual(expect.stringMatching(/Only the first of 3 records/));
  });

  it('sets the read aside when an edit changes the bases, says so, and undo brings it back', () => {
    act(() => {
      editorStore.openDocument(read, 'r1.fastq');
    });
    render(<ReadNotice />);
    act(() => {
      editorStore.apply({ type: 'insert', position: 2, text: 'T' });
    });
    expect(editorStore.document?.read).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(/set aside\. Undo brings them back/);
    act(() => {
      editorStore.undo();
    });
    expect(editorStore.document?.read).not.toBeNull();
  });

  it('keeps the read through an edit that leaves the bases alone, without a notice', () => {
    act(() => {
      editorStore.openDocument(read, 'r1.fastq');
      editorStore.apply({ type: 'rename', name: 'clone 3' });
    });
    expect(editorStore.document?.read).not.toBeNull();
    expect(editorStore.getState().readNotice).toBeNull();
  });

  it('says a GenBank download leaves the read out', async () => {
    const service = new PersistenceService(
      new DocumentRepository(new PlasmidPopDb(`reads-${Date.now()}`)),
    );
    act(() => {
      editorStore.openDocument(read, null);
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const url = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    await act(async () => {
      await service.download();
    });
    expect(editorStore.getState().readNotice?.kind).toBe('downloaded');
    click.mockRestore();
    url.mockRestore();
  });

  it('shows the share of Q20 bases in the status bar', () => {
    act(() => {
      editorStore.openDocument(read, null);
    });
    render(<StatusBar doc={read} />);
    expect(screen.getByText('Read, 80% Q20+')).toBeInTheDocument();
  });
});
