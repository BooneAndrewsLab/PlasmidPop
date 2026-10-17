import { ExportCancelledError, type ExportProgress } from '@/app/exportJob';
import { readZip } from '@/io';

import { handleExportRequest } from './export.worker';
import { ExportClient } from './exportClient';
import { type ExportRequest, type ExportResponse, transferablesOf } from './exportProtocol';

/** A worker the test answers by hand. */
class FakeWorker {
  onmessage: ((ev: MessageEvent<ExportResponse>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  readonly sent: { req: ExportRequest; transfer: Transferable[] }[] = [];
  terminated = false;

  postMessage(req: ExportRequest, transfer: Transferable[] = []): void {
    this.sent.push({ req, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  answer(res: ExportResponse): void {
    this.onmessage?.({ data: res } as MessageEvent<ExportResponse>);
  }

  fail(): void {
    this.onerror?.({ message: 'boom' } as ErrorEvent);
  }
}

function clientWithFakes() {
  const workers: FakeWorker[] = [];
  const client = new ExportClient(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w as unknown as Worker;
  });
  return { client, workers };
}

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('ExportClient (#247, #248)', () => {
  it('sends the job with its buffers handed over, relays progress as the writing stage and resolves the bytes', async () => {
    const { client, workers } = clientWithFakes();
    const seen: ExportProgress[] = [];
    const png = bytes('png');
    const job = client.rasterPdf([{ png, width: 10, height: 20 }], 'T', {
      onProgress: (p) => seen.push(p),
    });
    const w = workers[0];
    if (w === undefined) throw new Error('no worker');
    const sent = w.sent[0];
    expect(sent?.req).toMatchObject({ kind: 'rasterPdf', title: 'T', id: 1 });
    expect(sent?.transfer).toEqual([png.buffer]);
    w.answer({ id: 1, kind: 'progress', done: 0, total: 1 });
    w.answer({ id: 1, kind: 'progress', done: 1, total: 1 });
    w.answer({ id: 1, kind: 'done', bytes: bytes('pdf') });
    expect(new TextDecoder().decode(await job)).toBe('pdf');
    expect(seen).toEqual([
      { stage: 'writing', done: 0, total: 1 },
      { stage: 'writing', done: 1, total: 1 },
    ]);
  });

  it('rejects with the worker’s message on an error answer, and keeps the worker', async () => {
    const { client, workers } = clientWithFakes();
    const job = client.zip([{ path: 'a', data: bytes('a') }]);
    workers[0]?.answer({ id: 1, kind: 'error', message: 'No room.' });
    await expect(job).rejects.toThrow('No room.');
    void client.zip([{ path: 'b', data: bytes('b') }]);
    expect(workers).toHaveLength(1);
    expect(workers[0]?.terminated).toBe(false);
  });

  it('aborting the signal ends the worker, rejects with the cancellation and ignores a late answer', async () => {
    const { client, workers } = clientWithFakes();
    const controller = new AbortController();
    const seen: ExportProgress[] = [];
    const job = client.zip([{ path: 'a', data: bytes('a') }], {
      signal: controller.signal,
      onProgress: (p) => seen.push(p),
    });
    const w = workers[0];
    if (w === undefined) throw new Error('no worker');
    controller.abort();
    await expect(job).rejects.toBeInstanceOf(ExportCancelledError);
    expect(w.terminated).toBe(true);
    w.answer({ id: 1, kind: 'progress', done: 1, total: 1 });
    w.answer({ id: 1, kind: 'done', bytes: bytes('zip') });
    expect(seen).toEqual([]);
    // The next job gets a fresh worker.
    void client.zip([{ path: 'b', data: bytes('b') }]);
    expect(workers).toHaveLength(2);
    expect(workers[1]?.sent[0]?.req.id).toBe(2);
  });

  it('a signal already aborted is refused before any worker is made', async () => {
    const { client, workers } = clientWithFakes();
    const controller = new AbortController();
    controller.abort();
    await expect(client.zip([], { signal: controller.signal })).rejects.toBeInstanceOf(
      ExportCancelledError,
    );
    expect(workers).toEqual([]);
  });

  it('a worker that crashes fails the job and is replaced', async () => {
    const { client, workers } = clientWithFakes();
    const job = client.zip([{ path: 'a', data: bytes('a') }]);
    workers[0]?.fail();
    await expect(job).rejects.toThrow('The export worker failed.');
    expect(workers[0]?.terminated).toBe(true);
    void client.zip([{ path: 'b', data: bytes('b') }]);
    expect(workers).toHaveLength(2);
  });

  it('runs on the calling thread where no worker can be made, writing a ZIP readZip reads', async () => {
    const client = new ExportClient(() => {
      throw new Error('no workers here');
    });
    const zip = await client.zip([
      { path: 'one.txt', data: bytes('one') },
      { path: 'two.txt', data: bytes('two') },
    ]);
    const { entries } = readZip(zip);
    expect(entries.map((e) => [e.path, new TextDecoder().decode(e.data)])).toEqual([
      ['one.txt', 'one'],
      ['two.txt', 'two'],
    ]);
    const inline = new ExportClient(null);
    expect((await inline.zip([{ path: 'a', data: bytes('a') }])).length).toBeGreaterThan(0);
  });
});

describe('handleExportRequest', () => {
  it('writes the ZIP as writeZip does, and refuses a cancelled job before starting', async () => {
    const zip = await handleExportRequest({
      id: 1,
      kind: 'zip',
      entries: [{ path: 'a', data: bytes('a') }],
    });
    expect(readZip(zip).entries.map((e) => e.path)).toEqual(['a']);
    const controller = new AbortController();
    controller.abort();
    await expect(
      handleExportRequest({ id: 2, kind: 'zip', entries: [] }, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(ExportCancelledError);
  });
});

describe('transferablesOf', () => {
  it('lists each buffer once, for pages and for entries', () => {
    const shared = new Uint8Array(new ArrayBuffer(8));
    const a = shared.subarray(0, 4);
    const b = shared.subarray(4);
    const c = bytes('c');
    expect(
      transferablesOf({
        id: 1,
        kind: 'rasterPdf',
        title: 't',
        pages: [
          { png: a, width: 1, height: 1 },
          { png: b, width: 1, height: 1 },
          { png: c, width: 1, height: 1 },
        ],
      }),
    ).toEqual([shared.buffer, c.buffer]);
    expect(transferablesOf({ id: 2, kind: 'zip', entries: [{ path: 'x', data: c }] })).toEqual([
      c.buffer,
    ]);
  });
});
