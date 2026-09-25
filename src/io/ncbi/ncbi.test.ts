import { readFixture } from '@/test/fixtures';

import { accessionKind, parseAccessions } from './accession';
import {
  EFETCH_URL,
  MAX_RECORD_BP,
  MAX_RESPONSE_BYTES,
  NcbiError,
  RETRY_AFTER_MS,
  efetchUrl,
  fetchRecords,
  isAbort,
  recordIds,
  resetRequestGap,
} from './efetch';

describe('accessionKind', () => {
  it.each([
    'L09137',
    'L09137.2',
    'U49845',
    'AF177870',
    'AB12345678',
    'AAAA01000001',
    'AAAAAA010000001',
    'NC_001422',
    'NC_001422.1',
    'NM_000581',
    'NZ_CP012345',
    'NZ_AAAA01000001',
    'XM_123456',
  ])('%s is nucleotide', (a) => {
    expect(accessionKind(a)).toBe('nucleotide');
  });

  it.each(['NP_000508', 'XP_123456.1', 'WP_012345678', 'AAA12345', 'CAB1234567'])(
    '%s is protein',
    (a) => {
      expect(accessionKind(a)).toBe('protein');
    },
  );

  it.each(['', '12345', 'L0913', 'pUC19', 'NC-001422', 'NC_001422.', 'L09137 ', 'ZZ_123456'])(
    '%j is not an accession',
    (a) => {
      expect(accessionKind(a)).toBeNull();
    },
  );
});

describe('parseAccessions', () => {
  it('splits on spaces, commas and semicolons, upper-cases and drops repeats', () => {
    expect(parseAccessions(' l09137, NC_001422.1;\nL09137  u49845 ')).toEqual({
      nucleotide: ['L09137', 'NC_001422.1', 'U49845'],
      protein: [],
      invalid: [],
    });
  });

  it('sorts proteins and anything else apart, keeping what was typed', () => {
    expect(parseAccessions('NP_000508 pUC19 L09137 <script>')).toEqual({
      nucleotide: ['L09137'],
      protein: ['NP_000508'],
      invalid: ['pUC19', '<script>'],
    });
  });

  it('takes a pasted NCBI address as its last segment', () => {
    expect(
      parseAccessions(
        'https://www.ncbi.nlm.nih.gov/nuccore/L09137.2 https://www.ncbi.nlm.nih.gov/nuccore/NC_001422/?report=genbank',
      ).nucleotide,
    ).toEqual(['L09137.2', 'NC_001422']);
  });

  it('gives nothing for blank input', () => {
    expect(parseAccessions('  \n ')).toEqual({ nucleotide: [], protein: [], invalid: [] });
  });
});

describe('efetchUrl', () => {
  it('asks nuccore for GenBank with parts, as PlasmidPop, and sends nothing else', () => {
    const url = new URL(efetchUrl(['L09137', 'NC_001422.1']));
    expect(`${url.origin}${url.pathname}`).toBe(EFETCH_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      db: 'nuccore',
      id: 'L09137,NC_001422.1',
      rettype: 'gbwithparts',
      retmode: 'text',
      tool: 'PlasmidPop',
    });
  });
});

describe('efetchUrl for proteins', () => {
  it('asks the protein database for GenPept', () => {
    const url = new URL(efetchUrl(['NP_000509', 'AAA12345.1'], 'protein'));
    expect(`${url.origin}${url.pathname}`).toBe(EFETCH_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      db: 'protein',
      id: 'NP_000509,AAA12345.1',
      rettype: 'gp',
      retmode: 'text',
      tool: 'PlasmidPop',
    });
  });
});

describe('recordIds', () => {
  it('collects primary and secondary accessions and the version', () => {
    expect([...recordIds(readFixture('L09137.gb'))].sort()).toEqual([
      'L09137',
      'L09137.2',
      'X02514',
    ]);
  });
});

/** A Response whose body arrives in pieces, as a network one does. */
function streamed(text: string, init: ResponseInit = {}, pieces = 4): Response {
  const bytes = new TextEncoder().encode(text);
  const size = Math.ceil(bytes.length / pieces);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
      controller.close();
    },
  });
  return new Response(stream, init);
}

type FetchArgs = Parameters<typeof globalThis.fetch>;

function mockFetch(...answers: (Response | Error)[]) {
  const calls: FetchArgs[] = [];
  const fetch = (...args: FetchArgs): Promise<Response> => {
    calls.push(args);
    const next = answers.shift();
    if (next === undefined) throw new Error('unexpected request');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  return { fetch, calls };
}

describe('fetchRecords', () => {
  const waits: number[] = [];
  const base = {
    wait: (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    },
    online: () => true,
  };

  beforeEach(() => {
    resetRequestGap();
    waits.length = 0;
  });

  it('fetches the records, without cookies or a referrer', async () => {
    const text = `${readFixture('L09137.gb')}${readFixture('NC_001422.1.gb')}`;
    const { fetch, calls } = mockFetch(streamed(text));
    const progress: number[] = [];
    const got = await fetchRecords('nucleotide', ['L09137', 'NC_001422.1'], {
      ...base,
      fetch,
      onProgress: (b) => progress.push(b),
    });
    expect(got.text).toBe(text);
    expect(got.missing).toEqual([]);
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0] ?? [];
    expect(url).toBe(efetchUrl(['L09137', 'NC_001422.1']));
    expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(init?.headers).toBeUndefined();
    expect(progress.length).toBeGreaterThan(1);
    expect(progress[progress.length - 1]).toBe(new TextEncoder().encode(text).length);
  });

  it('matches a record asked for by its secondary accession or a version', async () => {
    const { fetch } = mockFetch(streamed(readFixture('L09137.gb')));
    const got = await fetchRecords('nucleotide', ['X02514'], { ...base, fetch });
    expect(got.missing).toEqual([]);
    const again = mockFetch(streamed(readFixture('L09137.gb')));
    expect(
      (await fetchRecords('nucleotide', ['L09137.2'], { ...base, fetch: again.fetch })).missing,
    ).toEqual([]);
  });

  it('lists the accessions NCBI left out, which it does without a word', async () => {
    const { fetch } = mockFetch(streamed(readFixture('L09137.gb')));
    const got = await fetchRecords('nucleotide', ['L09137', 'AB999999'], { ...base, fetch });
    expect(got.missing).toEqual(['AB999999']);
  });

  it('reads a 400 as no such record', async () => {
    // What NCBI sends for a well-formed accession it has no record of.
    const body =
      '+Error%3A+CEFetchPApplication%3A%3Aproxy_stream()%3A+Error%3A+F+a+i+l+e+d++t+o++r+e+t+r+i+e+v+e';
    const { fetch } = mockFetch(new Response(body, { status: 400 }));
    await expect(
      fetchRecords('nucleotide', ['AB999999'], { ...base, fetch }),
    ).rejects.toMatchObject({
      kind: 'not-found',
      message: 'NCBI has no nucleotide record AB999999.',
    });
  });

  it('reads an "Error:" answer with status 200 as no such record', async () => {
    const { fetch } = mockFetch(
      new Response('Error: F a i l e d  t o  u n d e r s t a n d  i d :  Z Z 9\n\n'),
    );
    await expect(
      fetchRecords('nucleotide', ['L09137', 'U49845'], { ...base, fetch }),
    ).rejects.toMatchObject({
      kind: 'not-found',
      message: 'NCBI has no nucleotide record for any of L09137, U49845.',
    });
  });

  it('refuses an answer that is not GenBank', async () => {
    const { fetch } = mockFetch(new Response('<html>maintenance</html>'));
    await expect(fetchRecords('nucleotide', ['L09137'], { ...base, fetch })).rejects.toMatchObject({
      kind: 'not-genbank',
    });
  });

  it('reports a server error with its status', async () => {
    const { fetch } = mockFetch(new Response('', { status: 502 }));
    await expect(fetchRecords('nucleotide', ['L09137'], { ...base, fetch })).rejects.toMatchObject({
      kind: 'server',
      message: expect.stringContaining('HTTP 502') as unknown,
    });
  });

  it('tries once more after a network failure, which is how a 429 looks', async () => {
    const { fetch, calls } = mockFetch(
      new TypeError('Failed to fetch'),
      streamed(readFixture('L09137.gb')),
    );
    const got = await fetchRecords('nucleotide', ['L09137'], { ...base, fetch });
    expect(got.missing).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(waits).toContain(RETRY_AFTER_MS);
  });

  it('gives up after the second network failure', async () => {
    const { fetch, calls } = mockFetch(new TypeError('x'), new TypeError('x'));
    await expect(fetchRecords('nucleotide', ['L09137'], { ...base, fetch })).rejects.toMatchObject({
      kind: 'network',
    });
    expect(calls).toHaveLength(2);
  });

  it('says so when offline, without retrying', async () => {
    const { fetch, calls } = mockFetch(new TypeError('x'));
    await expect(
      fetchRecords('nucleotide', ['L09137'], { ...base, online: () => false, fetch }),
    ).rejects.toMatchObject({ kind: 'offline' });
    expect(calls).toHaveLength(1);
  });

  it('waits out a visible 429 for its Retry-After, once', async () => {
    const limited = () =>
      new Response('{"error":"API rate limit exceeded"}', {
        status: 429,
        headers: { 'Retry-After': '3' },
      });
    const ok = mockFetch(limited(), streamed(readFixture('L09137.gb')));
    await fetchRecords('nucleotide', ['L09137'], { ...base, fetch: ok.fetch });
    expect(waits).toContain(3000);
    const refused = mockFetch(limited(), limited());
    await expect(
      fetchRecords('nucleotide', ['L09137'], { ...base, fetch: refused.fetch }),
    ).rejects.toMatchObject({ kind: 'rate-limit' });
  });

  it('keeps a gap between requests', async () => {
    let clock = 1_000;
    const now = () => clock;
    const first = mockFetch(streamed(readFixture('L09137.gb')));
    await fetchRecords('nucleotide', ['L09137'], { ...base, now, fetch: first.fetch });
    clock += 100;
    const second = mockFetch(streamed(readFixture('L09137.gb')));
    await fetchRecords('nucleotide', ['L09137'], { ...base, now, fetch: second.fetch });
    expect(waits).toEqual([300]);
  });

  it('turns a genome away on its LOCUS line, before the rest arrives', async () => {
    const head = `LOCUS       NC_000913            ${(MAX_RECORD_BP + 1).toString()} bp    DNA     circular CON 09-MAR-2022\n`;
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new TextEncoder().encode(pulled === 1 ? head : 'x'.repeat(1000)));
      },
      cancel() {
        cancelled = true;
      },
    });
    const { fetch } = mockFetch(new Response(stream));
    const e: unknown = await fetchRecords('nucleotide', ['NC_000913'], { ...base, fetch }).catch(
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(NcbiError);
    expect(e).toMatchObject({ kind: 'too-large' });
    expect((e as Error).message).toBe(
      'NC_000913 is 10,000,001 bp. PlasmidPop opens sequences up to 10 Mb.',
    );
    expect(pulled).toBeLessThan(5);
    expect(cancelled).toBe(true);
  });

  it('takes a record of exactly the limit', async () => {
    const text = readFixture('L09137.gb').replace('2686 bp', `${MAX_RECORD_BP.toString()} bp`);
    const { fetch } = mockFetch(streamed(text, {}, 7));
    await expect(fetchRecords('nucleotide', ['L09137'], { ...base, fetch })).resolves.toMatchObject(
      {
        missing: [],
      },
    );
  });

  it('fetches GenPept from the protein database, and names a missing protein', async () => {
    const { fetch, calls } = mockFetch(streamed(readFixture('NP_000509.gp')));
    const got = await fetchRecords('protein', ['NP_000509.1', 'XP_000001'], { ...base, fetch });
    expect(got.text.startsWith('LOCUS       NP_000509')).toBe(true);
    expect(got.missing).toEqual(['XP_000001']);
    expect(calls[0]?.[0]).toBe(efetchUrl(['NP_000509.1', 'XP_000001'], 'protein'));
    const none = mockFetch(new Response('+Error%3A', { status: 400 }));
    await expect(
      fetchRecords('protein', ['XP_000001'], { ...base, fetch: none.fetch }),
    ).rejects.toMatchObject({
      kind: 'not-found',
      message: 'NCBI has no protein record XP_000001.',
    });
  });

  it('turns away a protein past the limit in residues', async () => {
    const text = readFixture('NP_000509.gp').replace(
      '147 aa',
      `${(MAX_RECORD_BP + 1).toString()} aa`,
    );
    const { fetch } = mockFetch(streamed(text));
    await expect(fetchRecords('protein', ['NP_000509'], { ...base, fetch })).rejects.toMatchObject({
      kind: 'too-large',
      message: 'NP_000509 is 10,000,001 aa. PlasmidPop opens sequences up to 10,000,000 aa.',
    });
  });

  it('passes a cancel through as an AbortError', async () => {
    const controller = new AbortController();
    const fetch = (_url: FetchArgs[0], init?: FetchArgs[1]): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    const pending = fetchRecords('nucleotide', ['L09137'], {
      ...base,
      fetch,
      signal: controller.signal,
    });
    controller.abort();
    const e: unknown = await pending.catch((x: unknown) => x);
    expect(isAbort(e)).toBe(true);
  });
});

/** A small GenBank record: one LOCUS line, its accession, a few bases. */
function tiny(accession: string, length = 10, extra = ''): string {
  return [
    `LOCUS       ${accession}              ${length.toString()} bp    DNA     linear   SYN 01-JAN-2000`,
    `ACCESSION   ${accession}`,
    `VERSION     ${accession}.1`,
    `${extra}ORIGIN`,
    '        1 acgtacgtac',
    '//',
    '',
  ].join('\n');
}

/** A Response whose body arrives in exactly these pieces. */
function inPieces(...pieces: (string | Uint8Array)[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of pieces) controller.enqueue(typeof p === 'string' ? encoder.encode(p) : p);
      controller.close();
    },
  });
  return new Response(stream);
}

describe('NcbiError and isAbort', () => {
  it('names its errors NcbiError', () => {
    expect(new NcbiError('server', 'x').name).toBe('NcbiError');
  });

  it('takes only a DOMException named AbortError for a cancel', () => {
    expect(isAbort(new DOMException('x', 'AbortError'))).toBe(true);
    expect(isAbort(new DOMException('x', 'NetworkError'))).toBe(false);
    const named = new Error('x');
    named.name = 'AbortError';
    expect(isAbort(named)).toBe(false);
    expect(isAbort(new TypeError('Failed to fetch'))).toBe(false);
  });
});

describe('recordIds, edge cases', () => {
  it('reads only ACCESSION and VERSION lines, not the words inside other lines', () => {
    const text = [
      'LOCUS       X          10 bp    DNA     linear   SYN 01-JAN-2000',
      'ACCESSION   ',
      'VERSION     AB123456.1',
      'COMMENT     Replaces',
      '            ACCESSION   Z99999',
    ].join('\n');
    expect([...recordIds(text)]).toEqual(['AB123456.1']);
  });
});

describe('fetchRecords, more answers', () => {
  const waits: number[] = [];
  const base = {
    wait: (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    },
    online: () => true,
  };

  beforeEach(() => {
    resetRequestGap();
    waits.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sends exactly the accessions, no cookies, no referrer, no cache and no signal unasked', async () => {
    const { fetch, calls } = mockFetch(inPieces(tiny('L09137')));
    await fetchRecords('nucleotide', ['L09137'], { ...base, fetch });
    expect(calls[0]?.[1]).toStrictEqual({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
  });

  it('does not wait when the gap has just run out', async () => {
    let clock = 1_000;
    const now = () => clock;
    await fetchRecords('nucleotide', ['L09137'], {
      ...base,
      now,
      fetch: mockFetch(inPieces(tiny('L09137'))).fetch,
    });
    clock += 400;
    await fetchRecords('nucleotide', ['L09137'], {
      ...base,
      now,
      fetch: mockFetch(inPieces(tiny('L09137'))).fetch,
    });
    expect(waits).toEqual([]);
  });

  it.each([
    ['no Retry-After', null, RETRY_AFTER_MS],
    ['Retry-After: 0', '0', RETRY_AFTER_MS],
    ['Retry-After: -1', '-1', RETRY_AFTER_MS],
    ['Retry-After: Infinity', 'Infinity', RETRY_AFTER_MS],
    ['an HTTP-date', 'Wed, 21 Oct 2026 07:28:00 GMT', RETRY_AFTER_MS],
    ['Retry-After: 1', '1', 1_000],
  ])('waits the usual pause after a 429 with %s', async (_label, header, expected) => {
    const headers: Record<string, string> = header === null ? {} : { 'Retry-After': header };
    const { fetch } = mockFetch(
      new Response('', { status: 429, headers }),
      inPieces(tiny('L09137')),
    );
    await fetchRecords('nucleotide', ['L09137'], { ...base, fetch });
    expect(waits[0]).toBe(expected);
  });

  it('says in words that NCBI is limiting requests', async () => {
    const limited = () => new Response('', { status: 429 });
    const { fetch } = mockFetch(limited(), limited());
    await expect(fetchRecords('nucleotide', ['L09137'], { ...base, fetch })).rejects.toMatchObject({
      kind: 'rate-limit',
      message:
        'NCBI is limiting requests from this address (3 a second without an API key). Wait a few seconds and try again.',
    });
  });

  it('reads a 404 as no such record', async () => {
    const { fetch } = mockFetch(new Response('', { status: 404 }));
    await expect(fetchRecords('nucleotide', ['L09137'], { ...base, fetch })).rejects.toMatchObject({
      kind: 'not-found',
      message: 'NCBI has no nucleotide record L09137.',
    });
  });

  it('reads an empty answer as no such record', async () => {
    const { fetch } = mockFetch(new Response('  \n'));
    await expect(fetchRecords('nucleotide', ['L09137'], { ...base, fetch })).rejects.toMatchObject({
      kind: 'not-found',
    });
  });

  it('says in words when the answer is not GenBank', async () => {
    const { fetch } = mockFetch(new Response('<html>maintenance</html>'));
    await expect(fetchRecords('nucleotide', ['L09137'], { ...base, fetch })).rejects.toMatchObject({
      message: 'NCBI sent something that is not a GenBank record.',
    });
  });

  it('takes records after blank lines, and ones that mention an error or a LOCUS inside', async () => {
    const extra = [
      'COMMENT     Error-prone PCR was used; see',
      '            LOCUS       NC_000913  20000000 bp for the parent.',
      '',
    ].join('\n');
    const text = `\n\n${tiny('L09137', 10, extra)}`;
    const { fetch } = mockFetch(inPieces(text));
    const got = await fetchRecords('nucleotide', ['L09137'], { ...base, fetch });
    expect(got).toEqual({ text, missing: [] });
  });

  it('matches an older version to the record NCBI sends', async () => {
    const { fetch } = mockFetch(streamed(readFixture('L09137.gb')));
    const got = await fetchRecords('nucleotide', ['L09137.1'], { ...base, fetch });
    expect(got.missing).toEqual([]);
  });

  it('does not match an accession to one a character shorter', async () => {
    // AAAA01000001 and AAAA010000011 are both WGS accessions.
    const { fetch } = mockFetch(inPieces(tiny('AAAA01000001')));
    const got = await fetchRecords('nucleotide', ['AAAA01000001', 'AAAA010000011'], {
      ...base,
      fetch,
    });
    expect(got.missing).toEqual(['AAAA010000011']);
  });

  it('decodes a character split between two pieces', async () => {
    const text = tiny('L09137', 10, 'COMMENT     5 µg of plasmid, 37 °C.\n');
    const bytes = new TextEncoder().encode(text);
    const at = bytes.indexOf(0xb5); // the second byte of µ
    const { fetch } = mockFetch(inPieces(bytes.slice(0, at), bytes.slice(at)));
    const got = await fetchRecords('nucleotide', ['L09137'], { ...base, fetch });
    expect(got.text).toBe(text);
  });

  it('turns a genome away when its LOCUS line is split between pieces', async () => {
    const text = tiny('NC_000913', MAX_RECORD_BP + 1);
    const at = text.indexOf('10000001') + 4;
    const { fetch } = mockFetch(inPieces(text.slice(0, at), text.slice(at)));
    await expect(
      fetchRecords('nucleotide', ['NC_000913'], { ...base, fetch }),
    ).rejects.toMatchObject({ kind: 'too-large' });
  });

  it('checks the lengths of an answer without a body stream too', async () => {
    const answer = (text: string): Response =>
      ({
        status: 200,
        ok: true,
        headers: new Headers(),
        body: null,
        text: () => Promise.resolve(text),
      }) as unknown as Response;
    const small = mockFetch(answer(tiny('L09137')));
    await expect(
      fetchRecords('nucleotide', ['L09137'], { ...base, fetch: small.fetch }),
    ).resolves.toEqual({ text: tiny('L09137'), missing: [] });
    const genome = mockFetch(answer(tiny('NC_000913', MAX_RECORD_BP + 1)));
    await expect(
      fetchRecords('nucleotide', ['NC_000913'], { ...base, fetch: genome.fetch }),
    ).rejects.toMatchObject({ kind: 'too-large' });
  });

  it('takes an answer of exactly the size limit, and refuses one byte more', async () => {
    const head = new TextEncoder().encode(tiny('L09137'));
    const exact = mockFetch(inPieces(head, new Uint8Array(MAX_RESPONSE_BYTES - head.length)));
    const got = await fetchRecords('nucleotide', ['L09137'], { ...base, fetch: exact.fetch });
    expect(got.text.length).toBe(MAX_RESPONSE_BYTES);
    const over = mockFetch(inPieces(head, new Uint8Array(MAX_RESPONSE_BYTES - head.length + 1)));
    await expect(
      fetchRecords('nucleotide', ['L09137'], { ...base, fetch: over.fetch }),
    ).rejects.toMatchObject({
      kind: 'too-large',
      message: 'The records come to more than 128 MB; open fewer at a time.',
    });
    // Two answers of 128 MB: under a second here, far longer instrumented.
  }, 60_000);

  it('stops reading when cancelled between pieces', async () => {
    const controller = new AbortController();
    const text = tiny('L09137');
    const { fetch } = mockFetch(inPieces(text.slice(0, 20), text.slice(20)));
    const e: unknown = await fetchRecords('nucleotide', ['L09137'], {
      ...base,
      fetch,
      signal: controller.signal,
      onProgress: () => {
        controller.abort();
      },
    }).catch((x: unknown) => x);
    expect(isAbort(e)).toBe(true);
  });

  it('asks the browser whether it is online when not told', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    const up = mockFetch(new TypeError('x'), new TypeError('x'));
    await expect(
      fetchRecords('nucleotide', ['L09137'], { wait: base.wait, fetch: up.fetch }),
    ).rejects.toMatchObject({ kind: 'network' });
    expect(up.calls).toHaveLength(2);
    vi.stubGlobal('navigator', { onLine: false });
    const down = mockFetch(new TypeError('x'));
    await expect(
      fetchRecords('nucleotide', ['L09137'], { wait: base.wait, fetch: down.fetch }),
    ).rejects.toMatchObject({
      kind: 'offline',
      message: 'You are offline. Opening a record from NCBI needs a connection.',
    });
  });

  describe('the wait between requests', () => {
    /** Sends one request at time 1000, so the next must wait until 1400. */
    async function afterOne(): Promise<void> {
      await fetchRecords('nucleotide', ['L09137'], {
        ...base,
        now: () => 1_000,
        fetch: mockFetch(inPieces(tiny('L09137'))).fetch,
      });
      vi.useFakeTimers();
    }

    it('lasts the rest of the gap', async () => {
      await afterOne();
      const { fetch, calls } = mockFetch(inPieces(tiny('L09137')));
      const pending = fetchRecords('nucleotide', ['L09137'], {
        online: base.online,
        now: () => 1_000,
        fetch,
      });
      await vi.advanceTimersByTimeAsync(399);
      expect(calls).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toHaveLength(1);
      await expect(pending).resolves.toMatchObject({ missing: [] });
    });

    it('is cut short by a cancel, and nothing is sent', async () => {
      await afterOne();
      const controller = new AbortController();
      const { fetch, calls } = mockFetch(inPieces(tiny('L09137')));
      const pending = fetchRecords('nucleotide', ['L09137'], {
        online: base.online,
        now: () => 1_000,
        fetch,
        signal: controller.signal,
      }).catch((x: unknown) => x);
      await vi.advanceTimersByTimeAsync(100);
      controller.abort();
      await vi.advanceTimersByTimeAsync(1_000);
      const e = await pending;
      expect(isAbort(e)).toBe(true);
      expect((e as DOMException).message).toBe('The fetch was cancelled');
      expect(calls).toHaveLength(0);
    });

    it('does not start when already cancelled', async () => {
      await afterOne();
      const controller = new AbortController();
      controller.abort();
      const { fetch, calls } = mockFetch(inPieces(tiny('L09137')));
      const pending = fetchRecords('nucleotide', ['L09137'], {
        online: base.online,
        now: () => 1_000,
        fetch,
        signal: controller.signal,
      }).catch((x: unknown) => x);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(isAbort(await pending)).toBe(true);
      expect(calls).toHaveLength(0);
    });
  });
});
