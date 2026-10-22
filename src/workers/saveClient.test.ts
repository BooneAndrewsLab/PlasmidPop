import { SeqDocument, createFeature, rangeSegment } from '@/core';
import { writeGenBank } from '@/io';
import { randomDna, seededRandom } from '@/test/random';
import { cloneSaveClient } from '@/test/saveWorker';

import { SaveClient, WORKER_GENBANK_FROM } from './saveClient';
import type { SaveResponse } from './saveProtocol';

const small = SeqDocument.create({ name: 'pSmall', sequence: 'ACGTACGTAC', topology: 'circular' });

function large(seed: number): SeqDocument {
  const length = WORKER_GENBANK_FROM + 10;
  return SeqDocument.create({
    name: 'pLarge',
    sequence: randomDna(seededRandom(seed), length),
    topology: 'circular',
    features: [
      createFeature({
        id: 'a',
        type: 'CDS',
        name: 'across the origin',
        strand: 'reverse',
        segments: [rangeSegment(length - 30, length), rangeSegment(0, 30)],
        qualifiers: [{ name: 'note', value: 'a "quoted" note' }],
      }),
    ],
  });
}

describe('SaveClient (#272)', () => {
  it('writes a small document here, without starting a worker', async () => {
    const created: unknown[] = [];
    const client = new SaveClient(() => {
      created.push(1);
      throw new Error('not wanted');
    });
    expect(await client.genBank([small])).toEqual([writeGenBank(small)]);
    expect(created).toEqual([]);
  });

  it('sends a large document as two strings and gives back the text writeGenBank writes', async () => {
    const { client, workers } = cloneSaveClient({ auto: false });
    const doc = large(1);
    const texts = client.genBank([doc, small]);
    const w = workers[0];
    if (w === undefined) throw new Error('no worker');
    const sent = w.received[0];
    expect(sent?.kind).toBe('genbank');
    // Nothing but strings crosses: the clone of the features would cost more.
    for (const d of sent?.docs ?? []) {
      expect(Object.keys(d).sort()).toEqual(['rest', 'sequence']);
      expect(typeof d.sequence).toBe('string');
      expect(typeof d.rest).toBe('string');
    }
    w.release();
    expect(await texts).toEqual([writeGenBank(doc), writeGenBank(small)]);
  });

  it('answers in the order asked', async () => {
    const { client, workers } = cloneSaveClient({ auto: false });
    const a = large(2);
    const b = a.insert(0, 'GGGG');
    const order: string[] = [];
    const first = client.genBank([a]).then((t) => order.push(`a ${t[0] === writeGenBank(a)}`));
    const second = client.genBank([b]).then((t) => order.push(`b ${t[0] === writeGenBank(b)}`));
    workers[0]?.release();
    await Promise.all([first, second]);
    expect(order).toEqual(['a true', 'b true']);
  });

  it('writes the text here when the worker answers with an error', async () => {
    const { client, workers } = cloneSaveClient({ auto: false });
    const doc = large(3);
    const texts = client.genBank([doc]);
    const w = workers[0];
    w?.held.splice(0);
    const answer: SaveResponse = { id: 1, kind: 'error', message: 'no' };
    w?.onmessage?.({ data: answer } as MessageEvent<SaveResponse>);
    expect(await texts).toEqual([writeGenBank(doc)]);
  });

  it('writes what was waiting here when the worker dies, and starts a new one for the next', async () => {
    const { client, workers } = cloneSaveClient({ auto: false });
    const a = large(4);
    const b = a.insert(1, 'T');
    const both = Promise.all([client.genBank([a]), client.genBank([b])]);
    workers[0]?.fail();
    expect(await both).toEqual([[writeGenBank(a)], [writeGenBank(b)]]);
    expect(workers[0]?.terminated).toBe(true);
    const next = client.genBank([b]);
    expect(workers).toHaveLength(2);
    workers[1]?.release();
    expect(await next).toEqual([writeGenBank(b)]);
  });

  it('gives up on a worker that does not answer in time and writes the text here', async () => {
    vi.useFakeTimers();
    try {
      const { client, workers } = cloneSaveClient({ auto: false, timeoutMs: 1000 });
      const doc = large(5);
      const texts = client.genBank([doc]);
      vi.advanceTimersByTime(1000);
      expect(await texts).toEqual([writeGenBank(doc)]);
      expect(workers[0]?.terminated).toBe(true);
      // A late answer from the old worker is nobody's.
      workers[0]?.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it('writes here where there are no workers, or one cannot be started', async () => {
    const doc = large(6);
    expect(await new SaveClient(null).genBank([doc])).toEqual([writeGenBank(doc)]);
    const failing = new SaveClient(() => {
      throw new Error('Workers unavailable');
    });
    expect(await failing.genBank([doc])).toEqual([writeGenBank(doc)]);
  });

  it('rejects when the document cannot be written at all, as writeGenBank would throw', async () => {
    const client = new SaveClient(null);
    const broken = { length: 1 } as unknown as SeqDocument;
    await expect(client.genBank([broken])).rejects.toThrow();
  });
});
