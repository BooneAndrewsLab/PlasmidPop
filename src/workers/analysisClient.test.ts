import pBR322 from '@/io/fixtures/J01749.gb?raw';
import { parseSequenceFile } from '@/io';
import {
  type EnzymeDigest,
  type EnzymeSites,
  SeqDocument,
  activeEnzymes,
  codonUsageTable,
  describeMolecule,
  documentChecksum,
  enzymeDigest,
  findCutSites,
  sitesByEnzyme,
} from '@/core';
import { handleAnalysisRequest } from './analysis.worker';
import { AnalysisCancelledError, AnalysisClient } from './analysisClient';
import { packCutSites, packEnzymeDigest, unpackCutSites, unpackScan } from './analysisProtocol';

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

  it('makes a GC profile without a worker (item 75)', async () => {
    const profile = await client.gcProfile('GGAA', 1, true);
    expect(Array.from(profile)).toEqual([1, 1, 0, 0]);
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

  it("searches the user's own parts with the bundled ones, ahead of them, and says where a hit came from", async () => {
    const mine = 'TTGACAATTAATCATCGGCTCGTATAATGTGTGGA';
    const seq = 'GATTACAGATTACAGATTACA' + mine + 'CATTAGGACCATTAGGACCA';
    const found = await client.detectFeatures(seq, 'linear', undefined, {}, [
      {
        name: 'my promoter',
        type: 'promoter',
        category: 'my part',
        sequence: mine,
        accession: 'My parts',
        location: '',
        source: 'mine',
        origin: 'My parts',
      },
    ]);
    const hit = found.find((d) => d.part.name === 'my promoter');
    expect(hit?.part).toMatchObject({ source: 'mine', origin: 'My parts' });
    expect(hit?.part).not.toHaveProperty('sequence');
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

describe('recode (#209)', () => {
  it('answers inline where there is no worker, and the protein is the one asked for', async () => {
    const client = new AnalysisClient(null);
    const host = codonUsageTable('ecoli');
    const result = await client.recode(
      [
        { aminoAcid: 'M', fixed: null },
        { aminoAcid: 'L', fixed: null },
        { aminoAcid: '*', fixed: null },
      ],
      { host },
    );
    expect(result.dna).toBe('ATGCTGTAA');
    expect(result.cai).toBeGreaterThan(0.99);
  });
});

describe('multiple alignment (#207)', () => {
  it('answers inline where there is no worker, with progress', async () => {
    const client = new AnalysisClient(null);
    const seen: number[] = [];
    const out = await client.alignMultiple(
      ['ACGTACGTAC', 'ACGTACGTAC', 'ACGAACGTAC'],
      {},
      { onProgress: (f) => seen.push(f) },
    );
    expect(out.rows).toHaveLength(3);
    expect(out.rows[0]).toBe('ACGTACGTAC');
    expect(seen.at(-1)).toBe(1);
  });

  it('takes the checksum the main thread would (#270)', async () => {
    const client = new AnalysisClient(null);
    const [doc] = parseSequenceFile(pBR322, 'J01749.gb').documents;
    if (doc === undefined) throw new Error('no document in the fixture');
    expect(await client.checksum(describeMolecule(doc))).toEqual(documentChecksum(doc));
    const sticky = SeqDocument.create({
      sequence: 'aattgacctaggcatgca',
      ends: {
        left: { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' },
        right: { kind: "3'", overhang: 'TGCA', enzyme: 'PstI' },
      },
    });
    expect(await client.checksum(describeMolecule(sticky))).toEqual(documentChecksum(sticky));
    expect(
      await client.checksum(describeMolecule(SeqDocument.create({ sequence: '' }))),
    ).toBeNull();
  });

  it('rejects with the reason when there are too few', async () => {
    const client = new AnalysisClient(null);
    await expect(client.alignMultiple(['ACGT'])).rejects.toThrow(/at least two/);
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

describe('the digest with the scan (item 98, #271)', () => {
  const sequence = `${'A'.repeat(20)}CCTGGCCA${'A'.repeat(20)}GATCGAT${'A'.repeat(20)}GAATTC`;

  /** A digest with plain arrays throughout, so one unpacked compares with one taken here. */
  const plain = (d: EnzymeDigest) => ({
    host: Array.from(d.host),
    lengths: new Map([...d.lengths].map(([name, l]) => [name, Array.from(l)])),
    counts: d.counts,
  });
  const plainGroups = (groups: ReadonlyMap<string, EnzymeSites> | undefined) =>
    new Map(
      [...(groups ?? [])].map(([name, g]) => [name, { sites: g.sites, host: Array.from(g.host) }]),
    );

  it('packs and unpacks to the digest that went in, enzymes without lengths left out', async () => {
    const sites = findCutSites(sequence, 'circular', activeEnzymes());
    const digest = enzymeDigest(sites, sequence, 'circular');
    const enzymes = packCutSites(sites).enzymes;
    const packed = packEnzymeDigest(digest, enzymes);
    expect(packed.offsets).toHaveLength(enzymes.length + 1);
    expect(packed.lengths).toHaveLength(
      [...digest.lengths.values()].reduce((n, l) => n + l.length, 0),
    );
    const back = await unpackScan(packCutSites(sites), packed);
    expect(back.sites).toEqual(sites);
    expect(plain(back.digest)).toEqual(plain(digest));
    const none = await unpackScan(packCutSites([]), packEnzymeDigest(digest, []));
    expect(none.sites).toEqual([]);
    expect(plain(none.digest)).toEqual({
      host: Array.from(digest.host),
      lengths: new Map(),
      counts: new Map(),
    });
    expect(none.digest.byEnzyme?.size).toBe(0);
  });

  it('groups the sites by enzyme on the way, with their marks, as sitesByEnzyme does (#278)', async () => {
    const sites = findCutSites(sequence.repeat(3), 'circular', activeEnzymes());
    const digest = enzymeDigest(sites, sequence.repeat(3), 'circular');
    const packedSites = packCutSites(sites);
    const back = await unpackScan(packedSites, packEnzymeDigest(digest, packedSites.enzymes));
    expect(plainGroups(back.digest.byEnzyme)).toEqual(
      plainGroups(sitesByEnzyme(sites, digest.host)),
    );
    // The grouped sites are the same objects as the list's, so a set of them means one thing.
    const first = back.digest.byEnzyme?.values().next().value?.sites[0];
    expect(back.sites).toContain(first);
    expect(
      [...(back.digest.byEnzyme?.values() ?? [])].some((g) =>
        Array.from(g.host).some((m) => m !== 0),
      ),
    ).toBe(true);
  });

  it('pauses between slices, and gives the same whatever the slice (#278)', async () => {
    const long = sequence.repeat(4);
    const sites = findCutSites(long, 'linear', activeEnzymes());
    const digest = enzymeDigest(sites, long, 'linear');
    const packedSites = packCutSites(sites);
    const packed = packEnzymeDigest(digest, packedSites.enzymes);
    const pause = vi.fn(() => Promise.resolve());
    const sliced = await unpackScan(packedSites, packed, pause, 3);
    // Between slices, and once after the last.
    expect(sites.length).toBeGreaterThan(6);
    expect(pause).toHaveBeenCalledTimes(Math.ceil(sites.length / 3));
    const once = vi.fn(() => Promise.resolve());
    await unpackScan(packedSites, packed, once, sites.length);
    expect(once).not.toHaveBeenCalled();
    const whole = await unpackScan(packedSites, packed);
    expect(sliced.sites).toEqual(whole.sites);
    expect(plain(sliced.digest)).toEqual(plain(whole.digest));
    expect(plainGroups(sliced.digest.byEnzyme)).toEqual(plainGroups(whole.digest.byEnzyme));
  });

  it('is answered with the sites when asked for, and only then', async () => {
    const client = new AnalysisClient(null);
    const sites = await client.cutSites(sequence, 'linear');
    const withDigest = await client.cutSitesWithDigest(sequence, 'linear');
    expect(withDigest.sites).toEqual(sites);
    expect(plain(withDigest.digest)).toEqual(plain(enzymeDigest(sites, sequence, 'linear')));
    expect(Array.from(withDigest.digest.lengths.get('EcoRI') ?? [])).toEqual([
      76,
      sequence.length - 76,
    ]);
    const answer = handleAnalysisRequest({ id: 1, kind: 'cutSites', sequence, topology: 'linear' });
    expect(answer.kind === 'cutSites' && answer.digest).toBeUndefined();
  });
});

describe('AnalysisClient.start (#276)', () => {
  it('starts the worker once, ahead of the first request, which then uses it', async () => {
    const w = heldWorker();
    const factory = vi.fn(() => w as unknown as Worker);
    const client = new AnalysisClient(factory);
    client.start();
    client.start();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(w.posted).toEqual([]);
    const answer = client.orfs('ATG', 'linear');
    expect(factory).toHaveBeenCalledTimes(1);
    w.reply({ id: w.posted[0]?.id, kind: 'orfs', orfs: [] });
    expect(await answer).toEqual([]);
  });

  it('does nothing without workers', async () => {
    const client = new AnalysisClient(null);
    client.start();
    expect(await client.orfs('ATG', 'linear')).toEqual([]);
  });
});
