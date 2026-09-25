// @vitest-environment jsdom
import { readFileSync } from 'node:fs';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { efetchUrl, resetRequestGap } from '@/io';
import { getRepository } from '@/storage';

import { App } from './App';
import { checkAccessionInput } from './openFromNcbi';
import { editorStore } from './state/editorStore';

/** A committed NCBI record (the jsdom URL cannot resolve `@/test/fixtures`' file URL). */
function readFixture(name: string): string {
  return readFileSync(`src/io/fixtures/${name}`, 'utf8');
}

type FetchArgs = Parameters<typeof globalThis.fetch>;

function urlOf(input: FetchArgs[0]): string {
  return input instanceof Request ? input.url : input.toString();
}

/** Stands in for the network: no test reaches NCBI. */
let requests: FetchArgs[] = [];
let answer: (url: string, init?: RequestInit) => Promise<Response>;

beforeEach(() => {
  requests = [];
  resetRequestGap();
  answer = () => Promise.reject(new Error('no answer set'));
  vi.stubGlobal('fetch', (...args: FetchArgs) => {
    requests.push(args);
    const [url, init] = args;
    return answer(urlOf(url), init);
  });
  getRepository().setLastDocumentId(null);
  getRepository().setOpenDocumentIds([]);
  act(() => {
    editorStore.closeAllDocuments();
    editorStore.dismissNcbi();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function openDialog(): void {
  fireEvent.click(screen.getByRole('button', { name: 'From NCBI…' }));
}

function type(text: string): void {
  fireEvent.change(screen.getByRole('textbox', { name: 'Accession' }), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
}

describe('checkAccessionInput', () => {
  it('passes nucleotide accessions and refuses the rest with a reason', () => {
    expect(checkAccessionInput('L09137 nc_001422')).toEqual({
      ok: true,
      accessions: ['L09137', 'NC_001422'],
    });
    expect(checkAccessionInput('')).toEqual({ ok: false, message: 'Type an accession number.' });
    expect(checkAccessionInput('pUC19')).toMatchObject({
      ok: false,
      message: expect.stringContaining('“pUC19” is not an accession number') as unknown,
    });
    expect(checkAccessionInput('NP_000508')).toEqual({
      ok: false,
      message: 'NP_000508 is a protein accession. PlasmidPop opens nucleotide records only.',
    });
    const many = Array.from({ length: 21 }, (_, i) => `L${(10000 + i).toString()}`).join(' ');
    expect(checkAccessionInput(many)).toEqual({
      ok: false,
      message: 'At most 20 accessions at a time.',
    });
  });
});

describe('Open from NCBI', () => {
  it('says what is sent, and sends nothing until asked', () => {
    render(<App />);
    openDialog();
    const dialog = screen.getByRole('dialog', { name: 'Open from NCBI' });
    expect(dialog).toHaveAccessibleDescription(
      /Only the accession numbers are sent, to NCBI \(eutils\.ncbi\.nlm\.nih\.gov\), and nothing else leaves your browser\./,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(requests).toEqual([]);
  });

  it('opens the record in a tab, named as NCBI names it', async () => {
    answer = () => Promise.resolve(new Response(readFixture('L09137.gb')));
    render(<App />);
    openDialog();
    type('l09137');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(requests.map(([url]) => urlOf(url))).toEqual([efetchUrl(['L09137'])]);
    const state = editorStore.getState();
    expect(state.documents).toHaveLength(1);
    expect(state.history?.present.name).toBe('SYNPUC19CV');
    expect(state.history?.present.length).toBe(2686);
    expect(state.fileName).toBe('L09137.gb');
    // Nothing on the user's disk stands behind it, so no working copy is forked.
    expect(state.documents[0]?.origin).toBeNull();
  });

  it('opens several at once, one tab each, and names the ones NCBI lacks', async () => {
    answer = () =>
      Promise.resolve(new Response(readFixture('L09137.gb') + readFixture('NC_001422.1.gb')));
    render(<App />);
    openDialog();
    type('L09137, NC_001422 AB999999');
    await waitFor(() => {
      expect(editorStore.getState().documents).toHaveLength(2);
    });
    const state = editorStore.getState();
    expect(state.history?.present.name).toBe('NC_001422');
    expect(state.warnings.map((w) => w.message)).toContain(
      'NCBI has no nucleotide record AB999999.',
    );
  });

  it('keeps the dialog open with the reason when nothing is found', async () => {
    answer = () => Promise.resolve(new Response('+Error%3A', { status: 400 }));
    render(<App />);
    openDialog();
    type('AB999999');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'NCBI has no nucleotide record AB999999.',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(editorStore.getState().documents).toHaveLength(0);
  });

  it('refuses what is not a nucleotide accession without sending it', () => {
    render(<App />);
    openDialog();
    type('NP_000508');
    expect(screen.getByRole('alert')).toHaveTextContent('protein accession');
    type('my plasmid');
    expect(screen.getByRole('alert')).toHaveTextContent('is not an accession number');
    expect(requests).toEqual([]);
  });

  it('Cancel stops a fetch under way, then closes', async () => {
    let aborted = false;
    answer = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    render(<App />);
    openDialog();
    type('L09137');
    expect(await screen.findByRole('status')).toHaveTextContent('Fetching from NCBI');
    expect(screen.getByRole('button', { name: 'Open' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(aborted).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();
    await act(() => Promise.resolve());
    expect(screen.queryByRole('alert')).toBeNull(); // a cancel is not an error
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(editorStore.getState().documents).toHaveLength(0);
  });

  it('is on the File menu once a document is open', async () => {
    answer = () => Promise.resolve(new Response(readFixture('L09137.gb')));
    render(<App />);
    openDialog();
    type('L09137');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open from NCBI…' }));
    expect(screen.getByRole('dialog', { name: 'Open from NCBI' })).toBeInTheDocument();
  });
});
