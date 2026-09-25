import pBR322 from '@/io/fixtures/J01749.gb?raw';
import { parseSequenceFile } from '@/io';
import { AnalysisCancelledError, AnalysisClient } from './analysisClient';
import { packCutSites, unpackCutSites } from './analysisProtocol';

describe('AnalysisClient (inline fallback)', () => {
  const client = new AnalysisClient(null);

  it('computes cut sites and ORFs without a worker', async () => {
    const sites = await client.cutSites('CCGAATTCCC', 'linear', ['EcoRI']);
    expect(sites).toEqual([
      { enzyme: 'EcoRI', cut: 3, cutBottom: 7, siteStart: 2, strand: 'forward' },
    ]);
    const orfs = await client.orfs('ATGGCCATTGTAATGTAA', 'linear', { minCodons: 3 });
    expect(orfs).toHaveLength(1);
    const all = await client.cutSites('CCGAATTCCC', 'linear');
    expect(all.map((s) => s.enzyme)).toContain('EcoRI');
    const aln = await client.align('ACGT', 'ACGT');
    expect(aln.identity).toBe(1);
  });

  it('finds a collection of primers without a worker (#64)', async () => {
    const template = 'TTGACAGCTAGCTCAGTCCTAGGTATAATGCTAGCGAATTCGGATCCAAGCTTGGG';
    const result = await client.findPrimers(template, 'circular', [
      { id: 'f', name: 'fwd', sequence: template.slice(5, 25) },
      { id: 's', name: 'short', sequence: 'ACGT' },
    ]);
    expect(result.tooShort).toEqual(['s']);
    expect(result.hits.map((h) => [h.primerId, h.name, h.range.start, h.strand])).toEqual([
      ['f', 'fwd', 5, 'forward'],
    ]);
  });

  it('detects features, loading the library first, and names the parts it found', async () => {
    const [doc] = parseSequenceFile(pBR322, 'J01749.gb').documents;
    if (doc === undefined) throw new Error('no fixture');
    const found = await client.detectFeatures(doc.sequence.toString(), doc.topology);
    const amp = found.find((d) => d.part.name === 'AmpR');
    // bla is complement(3293..4153) in J01749, the record the part is read from.
    expect(amp?.hit).toMatchObject({
      range: { start: 3292, end: 4153 },
      strand: 'reverse',
      mismatches: 0,
    });
    expect(amp?.part).toMatchObject({ accession: 'J01749.1', source: 'core' });
    expect(amp?.part).not.toHaveProperty('sequence');
  });

  it('uses the worker when a factory is provided', async () => {
    const posted: unknown[] = [];
    const fake = {
      onmessage: null as ((ev: MessageEvent) => void) | null,
      onerror: null,
      postMessage(msg: { id: number }) {
        posted.push(msg);
        queueMicrotask(() => {
          fake.onmessage?.({ data: { id: msg.id, kind: 'orfs', orfs: [] } } as MessageEvent);
        });
      },
      terminate: vi.fn(),
    };
    const withWorker = new AnalysisClient(() => fake as unknown as Worker);
    expect(await withWorker.orfs('ATG', 'linear')).toEqual([]);
    expect(posted).toHaveLength(1);
    withWorker.dispose();
    expect(fake.terminate).toHaveBeenCalled();
  });
});

/** A worker that answers only when told to, and remembers what it was sent. */
function heldWorker() {
  const w = {
    posted: [] as { id: number; kind: string }[],
    onmessage: null as ((ev: MessageEvent) => void) | null,
    onerror: null,
    postMessage(msg: { id: number; kind: string }) {
      w.posted.push(msg);
    },
    reply(data: unknown) {
      w.onmessage?.({ data } as MessageEvent);
    },
    terminate: vi.fn(),
  };
  return w;
}

describe('AnalysisClient long requests (#54)', () => {
  it('passes progress on and resolves with the answer that follows it', async () => {
    const w = heldWorker();
    const client = new AnalysisClient(() => w as unknown as Worker);
    const seen: number[] = [];
    const answer = client.alignEitherStrand(
      'ACGT',
      'ACGT',
      {},
      { onProgress: (f) => seen.push(f) },
    );
    const { id } = w.posted[0] ?? { id: -1 };
    w.reply({ id, kind: 'progress', fraction: 0.25 });
    w.reply({ id, kind: 'progress', fraction: 0.5 });
    w.reply({ id, kind: 'alignEitherStrand', result: { strand: 'forward', alignment: {} } });
    expect((await answer).strand).toBe('forward');
    expect(seen).toEqual([0.25, 0.5]);
  });

  it('cancels by replacing the worker, and sends what else was waiting to the new one', async () => {
    const workers = [heldWorker(), heldWorker()];
    let started = 0;
    const client = new AnalysisClient(() => workers[started++] as unknown as Worker);
    const controller = new AbortController();
    const alignment = client.alignEitherStrand('ACGT', 'ACGT', {}, { signal: controller.signal });
    const orfs = client.orfs('ATG', 'linear');
    const [first, second] = workers;
    if (first === undefined || second === undefined) throw new Error('two workers');

    controller.abort();
    await expect(alignment).rejects.toBeInstanceOf(AnalysisCancelledError);
    expect(first.terminate).toHaveBeenCalled();
    // the ORF scan went to the new worker and is answered from there
    const resent = second.posted.find((m) => m.kind === 'orfs');
    expect(resent).toBeDefined();
    expect(second.posted.some((m) => m.kind === 'alignEitherStrand')).toBe(false);
    second.reply({ id: resent?.id, kind: 'orfs', orfs: [] });
    expect(await orfs).toEqual([]);
  });

  it('ignores a cancel that comes after the answer', async () => {
    const w = heldWorker();
    const client = new AnalysisClient(() => w as unknown as Worker);
    const controller = new AbortController();
    const answer = client.alignEitherStrand('A', 'A', {}, { signal: controller.signal });
    w.reply({
      id: w.posted[0]?.id,
      kind: 'alignEitherStrand',
      result: { strand: 'reverse', alignment: {} },
    });
    expect((await answer).strand).toBe('reverse');
    controller.abort();
    expect(w.terminate).not.toHaveBeenCalled();
  });

  it('refuses a request whose signal was already aborted', async () => {
    const client = new AnalysisClient(null);
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.alignEitherStrand('A', 'A', {}, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(AnalysisCancelledError);
  });
});

describe('packed cut sites', () => {
  it('come back as they went in, reverse strand and negative positions included', () => {
    const sites = [
      { enzyme: 'EcoRI', cut: 5, cutBottom: 9, siteStart: 4, strand: 'forward' as const },
      { enzyme: 'BsaI', cut: 0, cutBottom: 3, siteStart: 12, strand: 'reverse' as const },
      { enzyme: 'EcoRI', cut: 4000, cutBottom: 4004, siteStart: 3999, strand: 'forward' as const },
    ];
    const packed = packCutSites(sites);
    expect(packed.enzymes).toEqual(['EcoRI', 'BsaI']);
    expect(packed.data).toHaveLength(12);
    expect(unpackCutSites(packed)).toEqual(sites);
    expect(unpackCutSites(packCutSites([]))).toEqual([]);
  });
});
