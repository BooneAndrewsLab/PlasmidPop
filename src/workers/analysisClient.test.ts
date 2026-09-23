import { AnalysisClient } from './analysisClient';
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
