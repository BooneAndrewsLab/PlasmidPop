import {
  ESEARCH_URL,
  ESUMMARY_URL,
  MAX_RECORD_BP,
  NcbiError,
  REQUEST_GAP_MS,
  efetchRegionUrl,
  elinkRefSeqGeneUrl,
  esearchUrl,
  esummaryUrl,
  geneHit,
  geneSearchTerm,
  geneWindow,
  organismTerm,
  rankHits,
  refSeqGeneUid,
  regionOf,
  resetRequestGap,
  searchGenes,
} from './index';
import type { GeneHit, GeneLocation } from './gene';

/** TP53 as esummary places it (0-based, reverse: chrstart > chrstop), checked 2026-10-27. */
const TP53_ROW = {
  uid: '7157',
  name: 'TP53',
  description: 'tumor protein p53',
  organism: { scientificname: 'Homo sapiens', commonname: 'human', taxid: 9606 },
  chromosome: '17',
  otheraliases: 'BCC7, BMFS5, LFS1, P53, TRP53',
  genomicinfo: [
    { chrloc: '17', chraccver: 'NC_000017.11', chrstart: 7687489, chrstop: 7668420, exoncount: 13 },
  ],
};

/** HBT1 (yeast), forward in esummary's terms? No: also reverse; and a forward one made up from it. */
const HBT1_ROW = {
  uid: '851303',
  name: 'HBT1',
  description: 'Hbt1p',
  organism: { scientificname: 'Saccharomyces cerevisiae S288C', commonname: '', taxid: 559292 },
  chromosome: 'IV',
  otheraliases: 'YDL223C',
  genomicinfo: [{ chrloc: 'IV', chraccver: 'NC_001136.10', chrstart: 60404, chrstop: 57264 }],
};

const FORWARD: GeneLocation = {
  accession: 'NC_000001.11',
  start: 1000,
  end: 1300,
  strand: 'forward',
};
const REVERSE: GeneLocation = {
  accession: 'NC_000001.11',
  start: 1000,
  end: 1300,
  strand: 'reverse',
};

function params(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams);
}

describe('search terms', () => {
  it('turns a taxonomy id or a name into an organism term, and drops Entrez syntax', () => {
    expect(organismTerm('9606')).toBe('txid9606[orgn]');
    expect(organismTerm('Homo sapiens')).toBe('"Homo sapiens"[orgn]');
    expect(organismTerm('  ')).toBe('');
    expect(organismTerm('x[orgn] OR "y"')).toBe('"x orgn OR y"[orgn]');
  });

  it('matches the symbol as a prefix, within the organism, among current genes', () => {
    expect(geneSearchTerm('TP5', '9606')).toBe('TP5*[sym] AND txid9606[orgn] AND alive[prop]');
    expect(geneSearchTerm('lacZ', '')).toBe('lacZ*[sym] AND alive[prop]');
    expect(geneSearchTerm('tumor protein', '9606')).toBe(
      '"tumor protein"[sym] AND txid9606[orgn] AND alive[prop]',
    );
  });

  it('sends nothing for fewer than two characters', () => {
    expect(geneSearchTerm('T', '9606')).toBeNull();
    expect(geneSearchTerm(' * ', '9606')).toBeNull();
    expect(geneSearchTerm('', '')).toBeNull();
  });
});

describe('E-utility addresses', () => {
  it('ask Gene for ids, then rows, with the tool named and nothing else', () => {
    expect(params(esearchUrl('TP5*[sym]'))).toEqual({
      db: 'gene',
      term: 'TP5*[sym]',
      retmax: '10',
      retmode: 'json',
      tool: 'PlasmidPop',
    });
    expect(esearchUrl('x').startsWith(ESEARCH_URL)).toBe(true);
    expect(params(esummaryUrl(['7157', '7158']))).toEqual({
      db: 'gene',
      id: '7157,7158',
      retmode: 'json',
      tool: 'PlasmidPop',
    });
    expect(esummaryUrl(['1']).startsWith(ESUMMARY_URL)).toBe(true);
    expect(params(elinkRefSeqGeneUrl('7157'))).toEqual({
      dbfrom: 'gene',
      db: 'nuccore',
      id: '7157',
      linkname: 'gene_nuccore_refseqgene',
      retmode: 'json',
      tool: 'PlasmidPop',
    });
  });

  it('maps a region to efetch per strand, 1-based and inclusive', () => {
    expect(
      params(
        efetchRegionUrl({
          accession: 'NC_000017.11',
          start: 7668421,
          stop: 7687490,
          strand: 'forward',
        }),
      ),
    ).toEqual({
      db: 'nuccore',
      id: 'NC_000017.11',
      seq_start: '7668421',
      seq_stop: '7687490',
      strand: '1',
      rettype: 'gbwithparts',
      retmode: 'text',
      tool: 'PlasmidPop',
    });
    expect(
      params(
        efetchRegionUrl({
          accession: 'NC_000017.11',
          start: 7668421,
          stop: 7687490,
          strand: 'reverse',
        }),
      )['strand'],
    ).toBe('2');
    // [0, 10) is bases 1 to 10.
    expect(regionOf('X', 0, 10)).toEqual({ accession: 'X', start: 1, stop: 10, strand: 'forward' });
  });
});

describe('geneHit', () => {
  it('reads an esummary row, turning 0-based inclusive placement into [start, end)', () => {
    const tp53 = geneHit('7157', TP53_ROW);
    expect(tp53).toEqual<GeneHit>({
      id: '7157',
      symbol: 'TP53',
      fullName: 'tumor protein p53',
      organism: 'Homo sapiens',
      taxId: 9606,
      aliases: ['BCC7', 'BMFS5', 'LFS1', 'P53', 'TRP53'],
      chromosome: '17',
      // GenBank: complement(7668421..7687490).
      location: { accession: 'NC_000017.11', start: 7668420, end: 7687490, strand: 'reverse' },
    });
    const hbt1 = geneHit('851303', HBT1_ROW);
    expect(hbt1?.location).toEqual({
      accession: 'NC_001136.10',
      start: 57264,
      end: 60405,
      strand: 'reverse',
    });
  });

  it('reads a forward gene, one without a placement, and refuses an error row', () => {
    const forward = geneHit('1', {
      ...TP53_ROW,
      genomicinfo: [{ chraccver: 'NC_1.1', chrstart: 10, chrstop: 19 }],
    });
    expect(forward?.location).toEqual({
      accession: 'NC_1.1',
      start: 10,
      end: 20,
      strand: 'forward',
    });
    expect(geneHit('2', { name: 'X', genomicinfo: [] })?.location).toBeNull();
    expect(geneHit('2', { name: 'X', otheraliases: '' })?.aliases).toEqual([]);
    expect(geneHit('3', { error: 'cannot get document summary' })).toBeNull();
    expect(geneHit('4', 'nonsense')).toBeNull();
  });
});

describe('rankHits', () => {
  it('puts exact symbol matches first and keeps the rest in order', () => {
    const hits = [
      geneHit('1', { ...TP53_ROW, name: 'TP53BP1' }),
      geneHit('2', { ...TP53_ROW, name: 'TP53' }),
      geneHit('3', { ...TP53_ROW, name: 'TP53I3' }),
    ].filter((h) => h !== null);
    expect(rankHits(hits, 'tp53').map((h) => h.symbol)).toEqual(['TP53', 'TP53BP1', 'TP53I3']);
    expect(rankHits(hits, 'TP53B').map((h) => h.symbol)).toEqual(['TP53BP1', 'TP53', 'TP53I3']);
  });
});

describe('geneWindow', () => {
  it('adds the flanks along the gene: upstream is before a forward gene, after a reverse one', () => {
    const f = geneWindow(FORWARD, { upstream: 100, downstream: 50 }, false);
    expect(f.region).toEqual({
      accession: 'NC_000001.11',
      start: 901,
      stop: 1350,
      strand: 'forward',
    });
    expect(f.gene).toEqual({ start: 100, end: 400 });
    expect(f.cut).toEqual({ upstream: 0, downstream: 0 });

    const r = geneWindow(REVERSE, { upstream: 100, downstream: 50 }, false);
    expect(r.region).toEqual({
      accession: 'NC_000001.11',
      start: 951,
      stop: 1400,
      strand: 'forward',
    });
    expect(r.gene).toEqual({ start: 50, end: 350 });
  });

  it('fetches a reverse gene as the minus strand when asked, with the gene placed in the flipped window', () => {
    const r = geneWindow(REVERSE, { upstream: 100, downstream: 50 }, true);
    expect(r.region.strand).toBe('reverse');
    expect(r.region).toMatchObject({ start: 951, stop: 1400 });
    // 450 bp window, flipped: 100 bp upstream flank, then the 300 bp gene.
    expect(r.gene).toEqual({ start: 100, end: 400 });
    // A forward gene is never flipped.
    expect(geneWindow(FORWARD, { upstream: 0, downstream: 0 }, true).region.strand).toBe('forward');
  });

  it('clamps at the start of the record and says how much of which flank was cut', () => {
    const near = { ...FORWARD, start: 30, end: 130 };
    const f = geneWindow(near, { upstream: 100, downstream: 10 }, false);
    expect(f.region).toMatchObject({ start: 1, stop: 140 });
    expect(f.cut).toEqual({ upstream: 70, downstream: 0 });
    expect(f.gene).toEqual({ start: 30, end: 130 });
    // For a reverse gene the low end is its downstream side.
    const r = geneWindow({ ...near, strand: 'reverse' }, { upstream: 10, downstream: 100 }, true);
    expect(r.region).toMatchObject({ start: 1, stop: 140, strand: 'reverse' });
    expect(r.cut).toEqual({ upstream: 0, downstream: 70 });
    expect(r.gene).toEqual({ start: 10, end: 110 });
  });

  it('clamps at the end of the record when its length is known', () => {
    const f = geneWindow(FORWARD, { upstream: 0, downstream: 1000 }, false, 1500);
    expect(f.region).toMatchObject({ start: 1001, stop: 1500 });
    expect(f.cut).toEqual({ upstream: 0, downstream: 800 });
    const r = geneWindow(REVERSE, { upstream: 1000, downstream: 0 }, true, 1500);
    expect(r.region).toMatchObject({ start: 1001, stop: 1500, strand: 'reverse' });
    expect(r.cut).toEqual({ upstream: 800, downstream: 0 });
    expect(r.gene).toEqual({ start: 200, end: 500 });
  });

  it('refuses a window past the record cap before anything is sent', () => {
    expect(() => geneWindow(FORWARD, { upstream: 0, downstream: MAX_RECORD_BP }, false)).toThrow(
      NcbiError,
    );
    try {
      geneWindow(REVERSE, { upstream: MAX_RECORD_BP, downstream: 0 }, true);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(NcbiError);
      expect((e as NcbiError).kind).toBe('too-large');
      expect((e as NcbiError).message).toMatch(/10 Mb/);
    }
    // The gene itself plus the flanks exactly at the cap is fine; and a
    // flank the record's start clamps cannot pass it (the gene is at 1000).
    expect(() =>
      geneWindow(FORWARD, { upstream: 0, downstream: MAX_RECORD_BP - 300 }, false),
    ).not.toThrow();
    expect(() =>
      geneWindow(FORWARD, { upstream: MAX_RECORD_BP, downstream: 0 }, false),
    ).not.toThrow();
  });
});

type FetchArgs = Parameters<typeof globalThis.fetch>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockFetch(...answers: (Response | Error)[]) {
  const calls: string[] = [];
  const fetch = (...args: FetchArgs): Promise<Response> => {
    const [url] = args;
    calls.push(url instanceof Request ? url.url : url.toString());
    const next = answers.shift();
    if (next === undefined) throw new Error('unexpected request');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  return { fetch, calls };
}

const ESEARCH = {
  header: { type: 'esearch', version: '0.3' },
  esearchresult: { count: '3', retmax: '3', retstart: '0', idlist: ['7157', '373859', '352997'] },
};

const ESUMMARY = {
  result: {
    uids: ['7157', '373859', '352997'],
    '7157': TP53_ROW,
    '373859': { ...TP53_ROW, uid: '373859', name: 'TP53-AS1', description: 'TP53 antisense RNA 1' },
    '352997': {
      ...TP53_ROW,
      uid: '352997',
      name: 'TP53-DT',
      description: 'TP53 divergent transcript',
    },
  },
};

describe('searchGenes', () => {
  const waits: number[] = [];
  const base = {
    wait: (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    },
    online: () => true,
  };
  let clock = 0;
  const now = () => clock;

  beforeEach(() => {
    resetRequestGap();
    waits.length = 0;
    clock = 0;
  });

  it('asks for the ids, then their rows, keeping the gap between the two', async () => {
    const { fetch, calls } = mockFetch(json(ESEARCH), json(ESUMMARY));
    const found = await searchGenes('P53', '9606', { ...base, fetch, now });
    expect(calls).toEqual([
      esearchUrl('P53*[sym] AND txid9606[orgn] AND alive[prop]'),
      esummaryUrl(['7157', '373859', '352997']),
    ]);
    expect(waits).toEqual([REQUEST_GAP_MS]);
    expect(found.count).toBe(3);
    expect(found.hits.map((h) => h.symbol)).toEqual(['TP53', 'TP53-AS1', 'TP53-DT']);
  });

  it('is no hits, and one request, when the search finds nothing', async () => {
    const { fetch, calls } = mockFetch(json({ esearchresult: { count: '0', idlist: [] } }));
    const found = await searchGenes('ZZZZ', '9606', { ...base, fetch, now });
    expect(found).toEqual({ hits: [], count: 0 });
    expect(calls).toHaveLength(1);
  });

  it('sends nothing for too short a name', async () => {
    const { fetch, calls } = mockFetch();
    expect(await searchGenes('T', '9606', { ...base, fetch, now })).toEqual({ hits: [], count: 0 });
    expect(calls).toEqual([]);
  });

  it('reports a server error and an unreadable answer', async () => {
    const down = mockFetch(json({}, 503), json({}, 503));
    await expect(
      searchGenes('TP53', '', { ...base, fetch: down.fetch, now }),
    ).rejects.toMatchObject({
      kind: 'server',
    });
    const garbage = mockFetch(new Response('<html>'));
    await expect(
      searchGenes('TP53', '', { ...base, fetch: garbage.fetch, now }),
    ).rejects.toMatchObject({
      kind: 'not-genbank',
    });
  });

  it('passes the cancel signal to fetch', async () => {
    const controller = new AbortController();
    let seen: AbortSignal | null | undefined;
    const fetch = (_url: FetchArgs[0], init?: RequestInit): Promise<Response> => {
      seen = init?.signal;
      return Promise.resolve(json(ESEARCH));
    };
    const { fetch: rows } = mockFetch(json(ESUMMARY));
    let calls = 0;
    await searchGenes('TP53', '9606', {
      ...base,
      now,
      fetch: (url, init) => (calls++ === 0 ? fetch(url, init) : rows(url, init)),
      signal: controller.signal,
    });
    expect(seen).toBe(controller.signal);
  });
});

describe('refSeqGeneUid', () => {
  const base = { wait: () => Promise.resolve(), online: () => true, now: () => 0 };

  beforeEach(() => {
    resetRequestGap();
  });

  it('finds the NG_ record of a gene that has one, and null for one that has none', async () => {
    const linked = mockFetch(
      json({
        linksets: [
          {
            dbfrom: 'gene',
            ids: ['7157'],
            linksetdbs: [
              { dbto: 'nuccore', linkname: 'gene_nuccore_refseqgene', links: ['383209646'] },
            ],
          },
        ],
      }),
    );
    expect(await refSeqGeneUid('7157', { ...base, fetch: linked.fetch })).toBe('383209646');
    expect(linked.calls).toEqual([elinkRefSeqGeneUrl('7157')]);
    const none = mockFetch(json({ linksets: [{ dbfrom: 'gene', ids: ['851303'] }] }));
    expect(await refSeqGeneUid('851303', { ...base, fetch: none.fetch })).toBeNull();
  });
});
