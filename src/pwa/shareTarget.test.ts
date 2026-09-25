import { openSharedFiles } from '@/app/sharedFiles';
import { editorStore } from '@/app/state/editorStore';

import {
  SHARE_TARGET_CACHE,
  SHARE_TARGET_FIELD,
  SHARE_TARGET_NAME_HEADER,
  SHARE_TARGET_PARAM,
  SHARE_TARGET_PATH,
  handleShareTarget,
  isShareTargetRequest,
} from './shareTarget';

const SCOPE = 'https://example.org/PlasmidPop/';

/** Cache Storage in memory: enough of it for the handler and the app. */
class MemoryCaches {
  readonly stores = new Map<string, Map<string, Response>>();

  open(name: string): Promise<Cache> {
    let store = this.stores.get(name);
    if (store === undefined) {
      store = new Map();
      this.stores.set(name, store);
    }
    const s = store;
    const cache = {
      keys: () => Promise.resolve([...s.keys()].map((url) => new Request(url))),
      delete: (request: Request | string) =>
        Promise.resolve(s.delete(typeof request === 'string' ? request : request.url)),
      put: (request: Request | string, response: Response) => {
        s.set(typeof request === 'string' ? request : request.url, response);
        return Promise.resolve();
      },
      match: (request: Request | string) =>
        Promise.resolve(s.get(typeof request === 'string' ? request : request.url)?.clone()),
    };
    return Promise.resolve(cache as unknown as Cache);
  }

  delete(name: string): Promise<boolean> {
    return Promise.resolve(this.stores.delete(name));
  }
}

const GENBANK = `LOCUS       pShared                   12 bp    DNA     circular SYN 01-JAN-2026
FEATURES             Location/Qualifiers
     misc_feature    2..5
                     /label="bit"
ORIGIN
        1 acgtacgtac gt
//
`;

const FASTA = '>other\nGGGGCCCCAAAATTTT\n';

function sharePost(files: readonly File[], field = SHARE_TARGET_FIELD): Request {
  const form = new FormData();
  for (const f of files) form.append(field, f);
  form.append('title', 'not a file');
  return new Request(`${SCOPE}share-target`, { method: 'POST', body: form });
}

describe('the share target (#43)', () => {
  let caches: MemoryCaches;
  const scope = globalThis as unknown as { registration?: unknown; caches?: unknown };

  beforeEach(() => {
    caches = new MemoryCaches();
    scope.registration = { scope: SCOPE };
    scope.caches = caches;
  });

  afterEach(() => {
    delete scope.registration;
    delete scope.caches;
    editorStore.closeAllDocuments();
    editorStore.dismissError();
  });

  it('spells out inside the handler the names the app reads with', () => {
    // The handler is written into sw.js as its source, so it cannot import
    // the constants; this is what keeps the two halves agreeing.
    const source = handleShareTarget.toString();
    expect(source).toContain(SHARE_TARGET_CACHE);
    expect(source).toContain(SHARE_TARGET_FIELD);
    expect(source).toContain(SHARE_TARGET_NAME_HEADER);
    expect(source).toContain(`${SHARE_TARGET_PATH}/`);
    expect(source).toContain(`?${SHARE_TARGET_PARAM}=`);
    expect(isShareTargetRequest.toString()).toContain(`/${SHARE_TARGET_PATH}`);
  });

  it('matches only a POST to the share target', () => {
    const url = new URL(`${SCOPE}share-target`);
    expect(isShareTargetRequest({ url, request: new Request(url, { method: 'POST' }) })).toBe(true);
    expect(isShareTargetRequest({ url, request: new Request(url) })).toBe(false);
    const other = new URL(`${SCOPE}index.html`);
    expect(
      isShareTargetRequest({ url: other, request: new Request(other, { method: 'POST' }) }),
    ).toBe(false);
  });

  it('stashes the shared files and redirects to the app with a count', async () => {
    const response = await handleShareTarget({
      request: sharePost([
        new File([GENBANK], 'pShared.gb', { type: 'application/octet-stream' }),
        new File([FASTA], 'other.fasta'),
      ]),
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${SCOPE}?share-target=2`);
    const store = caches.stores.get(SHARE_TARGET_CACHE);
    expect([...(store?.keys() ?? [])]).toEqual([
      `${SCOPE}share-target/0`,
      `${SCOPE}share-target/1`,
    ]);
    const first = store?.get(`${SCOPE}share-target/0`);
    expect(first?.headers.get(SHARE_TARGET_NAME_HEADER)).toBe('pShared.gb');
    // A file with no type is stored as bytes.
    expect(store?.get(`${SCOPE}share-target/1`)?.headers.get('content-type')).toBe(
      'application/octet-stream',
    );
  });

  it('replaces a share that was never picked up', async () => {
    await handleShareTarget({
      request: sharePost([new File([FASTA], 'a.fa'), new File([FASTA], 'b.fa')]),
    });
    await handleShareTarget({ request: sharePost([new File([GENBANK], 'c.gb')]) });
    expect([...(caches.stores.get(SHARE_TARGET_CACHE)?.keys() ?? [])]).toEqual([
      `${SCOPE}share-target/0`,
    ]);
  });

  it('says it failed rather than open to nothing', async () => {
    const response = await handleShareTarget({
      request: new Request(`${SCOPE}share-target`, { method: 'POST', body: 'not a form' }),
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${SCOPE}?share-target=failed`);
  });

  it('opens what was shared as File ▸ Open would, then clears the stash', async () => {
    await handleShareTarget({
      request: sharePost([
        new File([GENBANK], 'pShared (1).gb', { type: 'text/plain' }),
        new File([FASTA], 'other.fasta'),
      ]),
    });
    const opened = await openSharedFiles('files', caches as unknown as CacheStorage);
    expect(opened).toBe(2);
    const docs = editorStore.getState().documents;
    expect(docs.map((d) => d.fileName)).toEqual(['pShared (1).gb', 'other.fasta']);
    const shared = docs[0]?.history.present;
    expect(shared?.topology).toBe('circular');
    expect(shared?.features.size).toBe(1);
    expect(caches.stores.has(SHARE_TARGET_CACHE)).toBe(false);
  });

  it('reports a share that failed or brought nothing', async () => {
    expect(await openSharedFiles('failed', caches as unknown as CacheStorage)).toBe(0);
    expect(editorStore.getState().error).toMatch(/could not be received/);
    editorStore.dismissError();
    expect(await openSharedFiles('files', caches as unknown as CacheStorage)).toBe(0);
    expect(editorStore.getState().error).toMatch(/Nothing arrived/);
    editorStore.dismissError();
    expect(await openSharedFiles('files', null)).toBe(0);
    expect(editorStore.getState().error).toMatch(/could not be received/);
  });

  it('reports a shared file it cannot read, and still opens the others', async () => {
    await handleShareTarget({
      request: sharePost([new File(['hello, world'], 'notes.txt'), new File([FASTA], 'ok.fa')]),
    });
    expect(await openSharedFiles('files', caches as unknown as CacheStorage)).toBe(1);
    expect(editorStore.getState().documents.map((d) => d.fileName)).toEqual(['ok.fa']);
  });
});
