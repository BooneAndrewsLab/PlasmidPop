// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SeqDocument, createFeature, rangeSegment } from '@/core';

import { editorStore } from '../state/editorStore';
import { VerifyClonesDialog } from './VerifyClonesDialog';

function bases(n: number, seed: number): string {
  let s = seed;
  let out = '';
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((s >> 16) & 3);
  }
  return out;
}

const SEQ = bases(1200, 21);

function construct(): SeqDocument {
  return SeqDocument.create({
    name: 'pTest',
    sequence: SEQ,
    topology: 'circular',
    features: [createFeature({ type: 'CDS', name: 'bla', segments: [rangeSegment(100, 400)] })],
  });
}

function fasta(name: string, text: string): File {
  return new File([`>${name}\n${text}\n`], `${name}.fa`, { type: 'text/plain' });
}

async function addFiles(files: File[]): Promise<void> {
  const input = document.querySelector('input[type="file"]');
  if (input === null) throw new Error('no file input');
  await act(async () => {
    fireEvent.change(input, { target: { files } });
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe('Verify clones dialog (#218)', () => {
  beforeEach(() => {
    editorStore.openDocument(construct());
    editorStore.requestVerifyClones();
  });
  afterEach(() => {
    cleanup();
    editorStore.dismissVerifyClones();
    editorStore.dismissComparison();
  });

  it('checks a plate, says what each clone is, and exports CSV', async () => {
    render(<VerifyClonesDialog />);
    const bad = SEQ.slice(0, 200) + (SEQ.charAt(200) === 'A' ? 'C' : 'A') + SEQ.slice(201);
    await addFiles([fasta('good', SEQ), fasta('bad', bad), fasta('junk', bases(1200, 3))]);
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    const table = await screen.findByRole('table', {}, { timeout: 10000 });
    await within(table).findByText('Wrong construct', {}, { timeout: 10000 });
    expect(within(table).getByText('Matches')).toBeTruthy();
    expect(within(table).getByText('Differs inside a feature')).toBeTruthy();
    expect(within(table).getByText(/base change in CDS bla/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy();
  });

  it('opens the comparison from a row', async () => {
    render(<VerifyClonesDialog />);
    await addFiles([fasta('good', SEQ)]);
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    const row = await screen.findByRole('button', { name: 'good.fa' }, { timeout: 10000 });
    fireEvent.click(row);
    expect(editorStore.getState().comparison?.stage).toBe('review');
  });

  it('reports a file with no DNA and asks for a construct first', async () => {
    render(<VerifyClonesDialog />);
    await addFiles([new File(['hello'], 'x.txt')]);
    expect(screen.getByRole('alert').textContent).toMatch(/x\.txt/);
    expect(screen.getByRole('button', { name: 'Verify' })).toHaveProperty('disabled', true);
  });
});
