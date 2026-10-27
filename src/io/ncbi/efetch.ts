/**
 * GenBank and GenPept records fetched from NCBI by accession (#65, #92,
 * item 58), and stretches of one record by range (#299).
 *
 * The one host the app talks to on the user's behalf, and only when asked:
 * E-utilities, which answer a browser directly (`Access-Control-Allow-Origin:
 * *`, checked 2026-09-25 for `efetch` and 2026-10-27 for `esearch`,
 * `esummary` and `elink`). What goes is the accessions (or, for a gene
 * lookup, the name and organism typed — `gene.ts`), `tool=PlasmidPop` as
 * NCBI's usage policy asks, and nothing else: no cookies (`credentials:
 * 'omit'`), no referrer, no API key, no e-mail address.
 *
 * Without a key NCBI allows 3 requests a second, and its 429 answer carries
 * no CORS header, so a browser sees a refused request as a network failure
 * it cannot tell from being offline. Hence one request for all the
 * accessions typed, a gap kept between requests (`ncbiRequest`, shared by
 * every E-utility call the app makes), and one retry after the two seconds
 * NCBI's `Retry-After` gives. Nucleotide and protein records live in two
 * databases, so a list of both takes two requests, spaced like any others.
 */

import type { AccessionKind } from './accession';

export const EFETCH_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi';

/** The `tool` parameter NCBI asks every E-utilities client to send. */
export const NCBI_TOOL = 'PlasmidPop';

/** Records longer than this are refused as they arrive: genome-browser scale is a non-goal. */
export const MAX_RECORD_BP = 10_000_000;

/** A bound on the whole answer, whatever the records say about themselves. */
export const MAX_RESPONSE_BYTES = 128 * 1024 * 1024;

/** The least time between two requests from this page (NCBI: 3 a second without a key). */
export const REQUEST_GAP_MS = 400;

/** How long to wait before the one retry, from NCBI's `Retry-After: 2`. */
export const RETRY_AFTER_MS = 2_000;

export type NcbiErrorKind =
  'not-found' | 'offline' | 'network' | 'rate-limit' | 'too-large' | 'server' | 'not-genbank';

/** Why a fetch gave nothing to open. The message is written for the user. */
export class NcbiError extends Error {
  readonly kind: NcbiErrorKind;

  constructor(kind: NcbiErrorKind, message: string) {
    super(message);
    this.name = 'NcbiError';
    this.kind = kind;
  }
}

export interface FetchRecordsOptions {
  readonly signal?: AbortSignal;
  /** Bytes received so far, as they arrive. */
  readonly onProgress?: (bytes: number) => void;
  /** Stand-ins for tests; the browser's own otherwise. */
  readonly fetch?: typeof globalThis.fetch;
  readonly wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly online?: () => boolean;
  readonly now?: () => number;
}

export interface FetchedRecords {
  /** The GenBank (or, for proteins, GenPept) text, every record found, in NCBI's order. */
  readonly text: string;
  /** Accessions asked for that no record answered, as asked. */
  readonly missing: readonly string[];
}

/** Where each kind of accession is fetched from, and as what. */
const DATABASES: Readonly<
  Record<AccessionKind, { readonly db: string; readonly rettype: string }>
> = {
  // `gbwithparts`: a CON record comes with its sequence, not just its contig line.
  nucleotide: { db: 'nuccore', rettype: 'gbwithparts' },
  protein: { db: 'protein', rettype: 'gp' },
};

/** The efetch address for these accessions, all of one kind. */
export function efetchUrl(
  accessions: readonly string[],
  kind: AccessionKind = 'nucleotide',
): string {
  const { db, rettype } = DATABASES[kind];
  const params = new URLSearchParams({
    db,
    id: accessions.join(','),
    rettype,
    retmode: 'text',
    tool: NCBI_TOOL,
  });
  return `${EFETCH_URL}?${params.toString()}`;
}

/**
 * A stretch of one nucleotide record, in efetch's own terms: `start` and
 * `stop` are **1-based and inclusive** on the forward strand (the internal
 * model's `[start, end)` is 0-based; `regionOf` converts). On the reverse
 * strand NCBI reverse-complements the stretch and rewrites every feature
 * location to match, so the record reads 5′ to 3′ as it arrives.
 */
export interface Region {
  readonly accession: string;
  readonly start: number;
  readonly stop: number;
  readonly strand: 'forward' | 'reverse';
}

/** The efetch address for a stretch of one record (#299). */
export function efetchRegionUrl(region: Region): string {
  const { db, rettype } = DATABASES.nucleotide;
  const params = new URLSearchParams({
    db,
    id: region.accession,
    seq_start: region.start.toString(),
    seq_stop: region.stop.toString(),
    strand: region.strand === 'reverse' ? '2' : '1',
    rettype,
    retmode: 'text',
    tool: NCBI_TOOL,
  });
  return `${EFETCH_URL}?${params.toString()}`;
}

/** `[start, end)`, 0-based, as a region (1-based, inclusive) of `accession`. */
export function regionOf(
  accession: string,
  start: number,
  end: number,
  strand: Region['strand'] = 'forward',
): Region {
  return { accession, start: start + 1, stop: end, strand };
}

/** When this page may next send a request. Shared by every call. */
let nextRequestAt = 0;

function abortError(): DOMException {
  return new DOMException('The fetch was cancelled', 'AbortError');
}

/** A timer that a cancel cuts short, rejecting with an AbortError. */
function defaultWait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** True for the error `fetch` and the waits reject with on a cancel. */
export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

/**
 * One E-utilities request, as every call the app makes goes: after the gap
 * since the last one, without cookies or a referrer, and once more after a
 * pause when the first fails — to reach NCBI at all (a failure is most
 * likely its 429, which the browser cannot show us), or with a 429 we can
 * see. Throws `NcbiError` for a 429 that persists, for being offline and
 * for a server error; any other status is the caller's to read. A cancel
 * rejects with the AbortError `fetch` gives.
 */
export async function ncbiRequest(
  url: string,
  options: FetchRecordsOptions = {},
): Promise<Response> {
  const {
    signal,
    fetch = globalThis.fetch.bind(globalThis),
    wait = defaultWait,
    online = () => globalThis.navigator.onLine,
    now = Date.now,
  } = options;

  const send = async (): Promise<Response> => {
    const delay = nextRequestAt - now();
    if (delay > 0) await wait(delay, signal);
    nextRequestAt = now() + REQUEST_GAP_MS;
    return fetch(url, {
      ...(signal === undefined ? {} : { signal }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
  };

  const attempt = async (retry: boolean): Promise<Response> => {
    let response: Response;
    try {
      response = await send();
    } catch (e) {
      if (isAbort(e)) throw e;
      if (!online()) throw offlineError();
      if (!retry) {
        throw new NcbiError(
          'network',
          'Could not reach NCBI. It may be busy (it takes 3 requests a second from any one address) or blocked on this network; try again in a moment.',
        );
      }
      await wait(RETRY_AFTER_MS, signal);
      return attempt(false);
    }
    if (response.status !== 429 || !retry) return response;
    const seconds = Number(response.headers.get('Retry-After'));
    await wait(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : RETRY_AFTER_MS, signal);
    return attempt(false);
  };

  const response = await attempt(true);
  if (response.status === 429) {
    throw new NcbiError(
      'rate-limit',
      'NCBI is limiting requests from this address (3 a second without an API key). Wait a few seconds and try again.',
    );
  }
  if (response.status >= 500) {
    throw new NcbiError(
      'server',
      `NCBI answered with an error (HTTP ${response.status}). Try again later.`,
    );
  }
  return response;
}

/**
 * Fetches the records of accessions of one kind (already checked by
 * `parseAccessions`) in one request: GenBank for nucleotide, GenPept for
 * protein. Accessions NCBI has no record for are listed in `missing`; when
 * none has one, or the request fails, it throws `NcbiError`. A cancel
 * rejects with the AbortError `fetch` gives.
 */
export async function fetchRecords(
  kind: AccessionKind,
  accessions: readonly string[],
  options: FetchRecordsOptions = {},
): Promise<FetchedRecords> {
  const text = await fetchGenBank(efetchUrl(accessions, kind), options, () =>
    notFound(kind, accessions),
  );
  const found = recordIds(text);
  const missing = accessions.filter((a) => !found.has(a) && !found.has(stripVersion(a)));
  return { text, missing };
}

export interface FetchedRegion {
  /** The GenBank text of the stretch, as NCBI wrote it (one record). */
  readonly text: string;
  /**
   * The stretch NCBI actually sent, from its `ACCESSION … REGION:` line:
   * 1-based, inclusive, forward-strand coordinates whichever strand was
   * asked. Shorter than asked when `stop` ran past the record's end — NCBI
   * clips there without a word (checked 2026-10-27), and this is how a
   * flank cut short is noticed.
   */
  readonly sent: { readonly start: number; readonly stop: number };
}

/**
 * Fetches one stretch of a nucleotide record (#299). The window is refused
 * before anything is sent when longer than `MAX_RECORD_BP`; `start` below 1
 * is the caller's to clamp (NCBI answers it with an error).
 */
export async function fetchRegion(
  region: Region,
  options: FetchRecordsOptions = {},
): Promise<FetchedRegion> {
  const length = region.stop - region.start + 1;
  if (length > MAX_RECORD_BP) {
    throw new NcbiError(
      'too-large',
      `${region.accession}:${region.start.toString()}-${region.stop.toString()} is ${length.toLocaleString('en-US')} bp. PlasmidPop opens sequences up to ${(MAX_RECORD_BP / 1_000_000).toString()} Mb; ask for less flank.`,
    );
  }
  if (region.start < 1 || region.stop < region.start) {
    throw new NcbiError(
      'not-found',
      `${region.start.toString()}-${region.stop.toString()} is not a range of ${region.accession}: positions count from 1, and the end comes after the start.`,
    );
  }
  const text = await fetchGenBank(
    efetchRegionUrl(region),
    options,
    () =>
      new NcbiError(
        'not-found',
        `NCBI has no nucleotide record ${region.accession}, or ${region.start.toString()}-${region.stop.toString()} lies outside it.`,
      ),
  );
  return { text, sent: regionSent(text) ?? { start: region.start, stop: region.stop } };
}

/** The `REGION:` range on a record's ACCESSION line, as NCBI writes a stretch. */
export function regionSent(text: string): { start: number; stop: number } | null {
  const m = /^ACCESSION {2,}\S+ REGION: (?:complement\()?(\d+)\.\.(\d+)/m.exec(text);
  if (m === null) return null;
  return { start: Number(m[1]), stop: Number(m[2]) };
}

/** One efetch request read as GenBank text, or the error `notFound` makes when NCBI has nothing. */
async function fetchGenBank(
  url: string,
  options: FetchRecordsOptions,
  notFound: () => NcbiError,
): Promise<string> {
  const { signal, onProgress } = options;
  const response = await ncbiRequest(url, options);
  if (response.status === 400 || response.status === 404) throw notFound();
  if (!response.ok) {
    throw new NcbiError(
      'server',
      `NCBI answered with an error (HTTP ${response.status}). Try again later.`,
    );
  }
  const text = await readLimited(response, signal, onProgress);
  const trimmed = text.trimStart();
  if (trimmed === '' || /^Error/i.test(trimmed)) throw notFound();
  if (!trimmed.startsWith('LOCUS')) {
    throw new NcbiError('not-genbank', 'NCBI sent something that is not a GenBank record.');
  }
  return text;
}

function offlineError(): NcbiError {
  return new NcbiError(
    'offline',
    'You are offline. Opening a record from NCBI needs a connection.',
  );
}

function notFound(kind: AccessionKind, accessions: readonly string[]): NcbiError {
  const list = accessions.join(', ');
  return new NcbiError(
    'not-found',
    accessions.length === 1
      ? `NCBI has no ${kind} record ${list}.`
      : `NCBI has no ${kind} record for any of ${list}.`,
  );
}

function stripVersion(accession: string): string {
  const dot = accession.indexOf('.');
  return dot === -1 ? accession : accession.slice(0, dot);
}

/** Every accession (primary and secondary) and versioned accession the records give. */
export function recordIds(text: string): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const m of text.matchAll(/^(ACCESSION|VERSION) {2,}(.*)$/gm)) {
    for (const token of (m[2] ?? '').trim().split(/\s+/)) {
      if (token !== '') ids.add(token.toUpperCase());
    }
  }
  return ids;
}

/**
 * Reads the answer as it arrives, refusing a record past `MAX_RECORD_BP`
 * on its LOCUS line — the first line of it, so a genome is turned away in
 * its first kilobyte rather than after its hundredth megabyte.
 */
async function readLimited(
  response: Response,
  signal: AbortSignal | undefined,
  onProgress: ((bytes: number) => void) | undefined,
): Promise<string> {
  const body = response.body;
  if (body === null) {
    const text = await response.text();
    checkLengths(text);
    return text;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  let checked = 0;
  try {
    for (;;) {
      if (signal?.aborted === true) throw abortError();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        throw new NcbiError(
          'too-large',
          `The records come to more than ${MAX_RESPONSE_BYTES / 1024 / 1024} MB; open fewer at a time.`,
        );
      }
      text += decoder.decode(value, { stream: true });
      const lastLine = text.lastIndexOf('\n');
      if (lastLine > checked) {
        checkLengths(text.slice(checked, lastLine));
        checked = lastLine;
      }
      onProgress?.(bytes);
    }
    text += decoder.decode();
    checkLengths(text.slice(checked));
    return text;
  } catch (e) {
    void reader.cancel().catch(() => undefined);
    throw e;
  }
}

function checkLengths(text: string): void {
  for (const m of text.matchAll(/^LOCUS {2,}(\S+) +(\d+) (bp|aa)/gm)) {
    const length = Number(m[2]);
    if (length > MAX_RECORD_BP) {
      const unit = m[3] === 'aa' ? 'aa' : 'bp';
      const limit =
        unit === 'aa'
          ? `${MAX_RECORD_BP.toLocaleString('en-US')} aa`
          : `${(MAX_RECORD_BP / 1_000_000).toString()} Mb`;
      throw new NcbiError(
        'too-large',
        `${m[1] ?? 'The record'} is ${length.toLocaleString('en-US')} ${unit}. PlasmidPop opens sequences up to ${limit}.`,
      );
    }
  }
}

/** Forgets the gap kept between requests; for tests. */
export function resetRequestGap(): void {
  nextRequestAt = 0;
}
