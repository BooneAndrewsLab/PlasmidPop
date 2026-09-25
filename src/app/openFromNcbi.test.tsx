// @vitest-environment jsdom
import { readFileSync } from 'node:fs';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { REQUEST_GAP_MS, efetchUrl, resetRequestGap } from '@/io';
import { getRepository } from '@/storage';

import { App } from './App';
import { checkAccessionInput, openFromNcbi } from './openFromNcbi';
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
  it('sorts nucleotide from protein accessions and refuses the rest with a reason', () => {
    expect(checkAccessionInput('L09137 np_000509 nc_001422')).toEqual({
      ok: true,
      accessions: { nucleotide: ['L09137', 'NC_001422'], protein: ['NP_000509'] },
    });
    expect(checkAccessionInput('')).toEqual({ ok: false, message: 'Type an accession number.' });
    expect(checkAccessionInput('pUC19')).toMatchObject({
      ok: false,
      message: expect.stringContaining('“pUC19” is not an accession number') as unknown,
    });
    const many = [
      ...Array.from({ length: 11 }, (_, i) => `L${(10000 + i).toString()}`),
      ...Array.from({ length: 10 }, (_, i) => `NP_${(100000 + i).toString()}`),
    ].join(' ');
    expect(checkAccessionInput(many)).toEqual({
      ok: false,
      message: 'At most 20 accessions at a time.',
    });
  });
});

describe('openFromNcbi', () => {
  it('opens what came back when the other request fails, naming why, and counts bytes across both', async () => {
    const gb = readFixture('L09137.gb');
    const progress: number[] = [];
    const ids = await openFromNcbi(
      { nucleotide: ['L09137'], protein: ['NP_000509'] },
      {
        fetch: (input) =>
          new URL(urlOf(input)).searchParams.get('db') === 'protein'
            ? Promise.reject(new TypeError('Failed to fetch'))
            : Promise.resolve(new Response(gb)),
        wait: () => Promise.resolve(),
        online: () => true,
        onProgress: (bytes) => progress.push(bytes),
      },
    );
    expect(ids).toHaveLength(1);
    const state = editorStore.getState();
    expect(state.history?.present.name).toBe('SYNPUC19CV');
    expect(state.warnings.map((w) => w.message)).toContainEqual(
      expect.stringMatching(/^NP_000509 not opened: Could not reach NCBI/),
    );
    expect(progress[progress.length - 1]).toBe(new TextEncoder().encode(gb).length);
  });

  it('counts the bytes of the second request on top of the first', async () => {
    const gb = readFixture('L09137.gb');
    const gp = readFixture('NP_000509.gp');
    const progress: number[] = [];
    await openFromNcbi(
      { nucleotide: ['L09137'], protein: ['NP_000509'] },
      {
        fetch: (input) =>
          Promise.resolve(
            new Response(new URL(urlOf(input)).searchParams.get('db') === 'protein' ? gp : gb),
          ),
        wait: () => Promise.resolve(),
        online: () => true,
        onProgress: (bytes) => progress.push(bytes),
      },
    );
    const size = (t: string) => new TextEncoder().encode(t).length;
    expect(progress[progress.length - 1]).toBe(size(gb) + size(gp));
    expect(editorStore.getState().documents).toHaveLength(2);
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
    expect(requests.map(([url]) => urlOf(url))).toEqual([efetchUrl(['L09137'], 'nucleotide')]);
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

  it('opens a protein accession as a protein document, from GenPept', async () => {
    answer = () => Promise.resolve(new Response(readFixture('NP_000509.gp')));
    render(<App />);
    openDialog();
    type('NP_000509');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(requests.map(([url]) => urlOf(url))).toEqual([efetchUrl(['NP_000509'], 'protein')]);
    const state = editorStore.getState();
    expect(state.history?.present.alphabet).toBe('protein');
    expect(state.history?.present.length).toBe(147);
    expect(state.fileName).toBe('NP_000509.gp');
    expect(state.documents[0]?.origin).toBeNull();
  });

  it('asks each database for its own accessions, spaced, and names what either lacks', async () => {
    const times: number[] = [];
    answer = (url) => {
      times.push(Date.now());
      return Promise.resolve(
        new Response(
          new URL(url).searchParams.get('db') === 'protein'
            ? readFixture('NP_000509.gp')
            : readFixture('L09137.gb'),
        ),
      );
    };
    render(<App />);
    openDialog();
    type('NP_000509 L09137 XP_000001 AB999999');
    await waitFor(
      () => {
        expect(editorStore.getState().documents).toHaveLength(2);
      },
      { timeout: 3000 },
    );
    expect(requests.map(([url]) => urlOf(url))).toEqual([
      efetchUrl(['L09137', 'AB999999'], 'nucleotide'),
      efetchUrl(['NP_000509', 'XP_000001'], 'protein'),
    ]);
    const [first = 0, second = 0] = times;
    expect(second - first).toBeGreaterThanOrEqual(REQUEST_GAP_MS - 5);
    const state = editorStore.getState();
    // Nucleotide records first, then proteins: the protein is in front.
    expect(state.history?.present.alphabet).toBe('protein');
    expect(state.warnings.map((w) => w.message)).toContain(
      'NCBI has no nucleotide record AB999999 and no protein record XP_000001.',
    );
  });

  it('opens one kind when the other kind has none, and says so', async () => {
    answer = (url) =>
      Promise.resolve(
        new URL(url).searchParams.get('db') === 'protein'
          ? new Response('+Error%3A', { status: 400 })
          : new Response(readFixture('L09137.gb')),
      );
    render(<App />);
    openDialog();
    type('L09137 XP_000001');
    await waitFor(
      () => {
        expect(editorStore.getState().documents).toHaveLength(1);
      },
      { timeout: 3000 },
    );
    expect(editorStore.getState().warnings.map((w) => w.message)).toContain(
      'NCBI has no protein record XP_000001.',
    );
  });

  it('says of both kinds when neither is found', async () => {
    answer = () => Promise.resolve(new Response('+Error%3A', { status: 400 }));
    render(<App />);
    openDialog();
    type('AB999999 XP_000001');
    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent(
      'NCBI has no nucleotide record AB999999 and no protein record XP_000001.',
    );
    expect(editorStore.getState().documents).toHaveLength(0);
  });

  it('refuses what is not an accession without sending it', () => {
    render(<App />);
    openDialog();
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
