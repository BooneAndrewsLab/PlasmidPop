import { AnalysisClient } from './analysisClient';

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
