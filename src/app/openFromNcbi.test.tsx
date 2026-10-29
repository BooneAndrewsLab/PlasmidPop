// @vitest-environment jsdom
import { readFileSync } from 'node:fs';

import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';

import {
  REQUEST_GAP_MS,
  efetchRegionUrl,
  efetchUrl,
  elinkRefSeqGeneUrl,
  esearchUrl,
  esummaryUrl,
  resetRequestGap,
} from '@/io';
import { getRepository } from '@/storage';

import { App } from './App';
import { checkAccessionInput, fetchAccessions, openFetched, openFromNcbi } from './openFromNcbi';
import { editorStore } from './state/editorStore';

// waitFor and findBy default to 1 s. These tests render the whole App and parse
// a GenBank record before the dialog closes, which can take longer on a loaded
// machine (issue #238); stay under the 5 s test timeout so a real hang still
// reports as the failed expectation.
configure({ asyncUtilTimeout: 4000 });

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

/** Opens the dialog on the accession search (the last mode used is remembered across tests). */
function openDialog(): void {
  fireEvent.click(screen.getByRole('button', { name: 'From NCBI…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Accession' }));
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

  it('keeps what it opens, and opens what a host fetched for its own purposes as scratch (item 110)', async () => {
    const gb = readFixture('L09137.gb');
    const fetched = await fetchAccessions(
      { nucleotide: ['L09137'], protein: [] },
      { fetch: () => Promise.resolve(new Response(gb)), wait: () => Promise.resolve() },
    );
    const [kept] = openFetched(fetched);
    expect(editorStore.documentState(kept)?.scratch).toBe(false);
    editorStore.closeDocument(kept);
    const [fetchedForPrimers] = openFetched(fetched, { scratch: true });
    expect(editorStore.documentState(fetchedForPrimers)?.scratch).toBe(true);
    // Then opened for its own sake, it is the user's.
    const [again] = openFetched(fetched);
    expect(again).toBe(fetchedForPrimers);
    expect(editorStore.documentState(again)?.scratch).toBe(false);
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
      /Only the accession numbers \(and the range\) are sent, to NCBI \(eutils\.ncbi\.nlm\.nih\.gov\), and nothing else leaves your browser\./,
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

/** NCBI's JSON answers for yeast HBT1 (Gene 851303), as seen 2026-10-27, trimmed. */
const HBT1 = {
  esearch: {
    esearchresult: { count: '1', retmax: '1', retstart: '0', idlist: ['851303'] },
  },
  esummary: {
    result: {
      uids: ['851303'],
      '851303': {
        uid: '851303',
        name: 'HBT1',
        description: 'Hbt1p',
        organism: {
          scientificname: 'Saccharomyces cerevisiae S288C',
          commonname: '',
          taxid: 559292,
        },
        chromosome: 'IV',
        otheraliases: 'YDL223C',
        genomicinfo: [
          {
            chrloc: 'IV',
            chraccver: 'NC_001136.10',
            chrstart: 60404,
            chrstop: 57264,
            exoncount: 1,
          },
        ],
      },
    },
  },
  elinkNone: { linksets: [{ dbfrom: 'gene', ids: ['851303'] }] },
};

const HBT1_REGION = {
  accession: 'NC_001136.10',
  start: 57065,
  stop: 60605,
  strand: 'reverse',
} as const;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

/** Answers each E-utility by its address; anything else is an unexpected request. */
function byEndpoint(table: Record<string, () => Response>): typeof answer {
  return (url) => {
    const found = Object.entries(table).find(
      ([prefix]) => url === prefix || url.startsWith(prefix),
    );
    return found === undefined
      ? Promise.reject(new Error(`unexpected request ${url}`))
      : Promise.resolve(found[1]());
  };
}

function geneMode(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Gene' }));
  return screen.getByRole('combobox', { name: 'Gene' });
}

function flank(label: RegExp, bp: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value: bp } });
}

describe('Open from NCBI, a gene by name (#299)', () => {
  it('looks the gene up, fetches its stretch of the chromosome with the flanks on its strand, and keeps the partial marks', async () => {
    answer = byEndpoint({
      [esearchUrl('HBT1*[sym] AND txid4932[orgn] AND alive[prop]')]: () => json(HBT1.esearch),
      [esummaryUrl(['851303'])]: () => json(HBT1.esummary),
      [elinkRefSeqGeneUrl('851303')]: () => json(HBT1.elinkNone),
      [efetchRegionUrl(HBT1_REGION)]: () =>
        new Response(readFixture('NC_001136.10_57065-60605_minus.gb')),
    });
    render(<App />);
    openDialog();
    const gene = geneMode();
    fireEvent.change(screen.getByRole('combobox', { name: 'Organism' }), {
      target: { value: '4932' },
    });
    fireEvent.change(gene, { target: { value: 'HBT1' } });
    flank(/Upstream/, '200');
    flank(/Downstream/, '200');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(requests.map(([url]) => urlOf(url))).toEqual([
      esearchUrl('HBT1*[sym] AND txid4932[orgn] AND alive[prop]'),
      esummaryUrl(['851303']),
      elinkRefSeqGeneUrl('851303'),
      efetchRegionUrl(HBT1_REGION),
    ]);
    const state = editorStore.getState();
    const doc = state.history?.present;
    expect(doc?.name).toBe('HBT1');
    expect(doc?.length).toBe(3541);
    expect(doc?.metadata.accession).toBe('NC_001136 REGION: complement(57065..60605)');
    expect(state.fileName).toBe('HBT1_NC_001136.10:57065-60605.gb');
    // The gene reads forward after its 200 bp upstream flank; RefSeq's own
    // partial marks on the gene and mRNA arrive and stay.
    const cds = doc?.features.all().find((f) => f.type === 'CDS');
    expect(cds?.strand).toBe('forward');
    expect(cds?.segments[0]).toMatchObject({ start: 200, end: 3341 });
    const g = doc?.features.all().find((f) => f.type === 'gene');
    expect(g?.segments[0]).toMatchObject({ partialStart: true, partialEnd: true });
    expect(state.warnings).toEqual([]);
  });

  it('fetches a reverse-strand gene as the plus strand when the option is off', async () => {
    const plus = { ...HBT1_REGION, strand: 'forward' } as const;
    answer = byEndpoint({
      [esearchUrl('HBT1*[sym] AND txid4932[orgn] AND alive[prop]')]: () => json(HBT1.esearch),
      [esummaryUrl(['851303'])]: () => json(HBT1.esummary),
      [elinkRefSeqGeneUrl('851303')]: () => json(HBT1.elinkNone),
      [efetchRegionUrl(plus)]: () => new Response(readFixture('NC_001136.10_57065-60605_minus.gb')),
    });
    render(<App />);
    openDialog();
    const gene = geneMode();
    fireEvent.change(screen.getByRole('combobox', { name: 'Organism' }), {
      target: { value: '4932' },
    });
    fireEvent.change(gene, { target: { value: 'HBT1' } });
    fireEvent.click(screen.getByRole('button', { name: '1 kb each side' }));
    flank(/Upstream/, '200');
    flank(/Downstream/, '200');
    fireEvent.click(screen.getByRole('checkbox', { name: /Reverse-complement/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(requests.map(([url]) => urlOf(url))).toContain(efetchRegionUrl(plus));
  });

  it('prefers the RefSeqGene record, cutting the window from it with partial marks, and says when the record ends short of a flank', async () => {
    const refSeqGene = [
      'LOCUS       NG_017013                100 bp    DNA     linear   PRI 01-JAN-2000',
      'DEFINITION  Homo sapiens tumor protein p53 (TP53), RefSeqGene on chromosome 17.',
      'ACCESSION   NG_017013',
      'VERSION     NG_017013.2',
      'FEATURES             Location/Qualifiers',
      '     gene            21..60',
      '                     /gene="TP53"',
      '     CDS             11..95',
      '                     /gene="TP53"',
      '                     /codon_start=1',
      'ORIGIN',
      '        1 acgtacgtac acgtacgtac acgtacgtac acgtacgtac acgtacgtac acgtacgtac',
      '       61 acgtacgtac acgtacgtac acgtacgtac acgtacgtac',
      '//',
      '',
    ].join('\n');
    const tp53 = {
      esearch: { esearchresult: { count: '1', idlist: ['7157'] } },
      esummary: {
        result: {
          uids: ['7157'],
          '7157': {
            name: 'TP53',
            description: 'tumor protein p53',
            organism: { scientificname: 'Homo sapiens', taxid: 9606 },
            chromosome: '17',
            genomicinfo: [{ chraccver: 'NC_000017.11', chrstart: 7687489, chrstop: 7668420 }],
          },
        },
      },
      elink: {
        linksets: [{ linksetdbs: [{ linkname: 'gene_nuccore_refseqgene', links: ['383209646'] }] }],
      },
    };
    answer = byEndpoint({
      [esearchUrl('TP53*[sym] AND txid9606[orgn] AND alive[prop]')]: () => json(tp53.esearch),
      [esummaryUrl(['7157'])]: () => json(tp53.esummary),
      [elinkRefSeqGeneUrl('7157')]: () => json(tp53.elink),
      [efetchUrl(['383209646'], 'nucleotide')]: () => new Response(refSeqGene),
    });
    render(<App />);
    openDialog();
    const gene = geneMode();
    fireEvent.change(screen.getByRole('combobox', { name: 'Organism' }), {
      target: { value: '9606' },
    });
    fireEvent.change(gene, { target: { value: 'TP53' } });
    flank(/Upstream/, '30');
    flank(/Downstream/, '30');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(requests).toHaveLength(4);
    const state = editorStore.getState();
    const doc = state.history?.present;
    // Bases 1..90: the gene (21..60) with 20 of the 30 bp upstream the record has, and 30 downstream.
    expect(doc?.name).toBe('TP53');
    expect(doc?.length).toBe(90);
    expect(doc?.metadata.accession).toBe('NG_017013 REGION: 1..90');
    expect(doc?.metadata.version).toBe('NG_017013.2');
    expect(state.fileName).toBe('TP53_NG_017013.2:1-90.gb');
    const g = doc?.features.all().find((f) => f.type === 'gene');
    expect(g?.segments[0]).toMatchObject({
      start: 20,
      end: 60,
      partialStart: false,
      partialEnd: false,
    });
    // The CDS ran to 95: cut at 90 and marked so, not silently shortened.
    const cds = doc?.features.all().find((f) => f.type === 'CDS');
    expect(cds?.segments[0]).toMatchObject({
      start: 10,
      end: 90,
      partialStart: false,
      partialEnd: true,
    });
    expect(state.warnings.map((w) => w.message)).toEqual([
      'NG_017013.2 ends there: the upstream flank is 20 bp, not 30.',
    ]);
  });

  it('opens a range typed as an accession, with flanks, and says when NCBI clipped one at the record end', async () => {
    // Asked 1531924-1531933 with 100 up and 1,000 down: chromosome IV ends at 1,531,933.
    const asked = {
      accession: 'NC_001136.10',
      start: 1531824,
      stop: 1532933,
      strand: 'forward',
    } as const;
    const clipped = [
      'LOCUS       NC_001136                110 bp    DNA     linear   CON 10-JUL-2026',
      'ACCESSION   NC_001136 REGION: 1531824..1531933',
      'VERSION     NC_001136.10',
      'ORIGIN',
      '        1 acgtacgtac acgtacgtac acgtacgtac acgtacgtac acgtacgtac acgtacgtac',
      '       61 acgtacgtac acgtacgtac acgtacgtac acgtacgtac acgtacgtac',
      '//',
      '',
    ].join('\n');
    answer = byEndpoint({ [efetchRegionUrl(asked)]: () => new Response(clipped) });
    render(<App />);
    openDialog();
    fireEvent.change(screen.getByRole('textbox', { name: 'Accession' }), {
      target: { value: 'NC_001136.10:1531924-1531933' },
    });
    flank(/Upstream/, '100');
    flank(/Downstream/, '1000');
    fireEvent.click(screen.getByRole('checkbox', { name: /Reverse-complement/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(requests.map(([url]) => urlOf(url))).toEqual([efetchRegionUrl(asked)]);
    const state = editorStore.getState();
    expect(state.history?.present.name).toBe('NC_001136.10:1531824-1531933');
    expect(state.history?.present.length).toBe(110);
    expect(state.fileName).toBe('NC_001136.10:1531824-1531933.gb');
    expect(state.warnings.map((w) => w.message)).toEqual([
      'NC_001136.10 ends there: the downstream flank is 0 bp, not 1,000.',
    ]);
  });

  it('refuses a window past 10 Mb before anything is sent', async () => {
    answer = byEndpoint({
      [esearchUrl('HBT1*[sym] AND txid4932[orgn] AND alive[prop]')]: () => json(HBT1.esearch),
      [esummaryUrl(['851303'])]: () => json(HBT1.esummary),
    });
    render(<App />);
    openDialog();
    const gene = geneMode();
    fireEvent.change(screen.getByRole('combobox', { name: 'Organism' }), {
      target: { value: '4932' },
    });
    fireEvent.change(gene, { target: { value: 'HBT1' } });
    flank(/Upstream/, '10000000');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /PlasmidPop opens sequences up to 10 Mb/,
    );
    expect(requests).toHaveLength(2);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
