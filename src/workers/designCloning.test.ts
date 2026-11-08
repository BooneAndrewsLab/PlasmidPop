import { describe, expect, it, vi } from 'vitest';

import {
  type CloningInsert,
  type SeqDocument,
  designCloningEnds,
  designGoldenGatePart,
  designMultiOverlapPrimers,
  destinationOverhangs,
  getEnzyme,
  resolveVectorRegion,
  scanForCloningNow,
} from '@/core';
import { writeGenBank } from '@/io';
import {
  MCS,
  fromU49845,
  ggDestination,
  ggGene,
  ifGene,
  linearVector,
  pUC19,
} from '@/test/cloningFixtures';

import { handleAnalysisRequest } from './analysis.worker';
import { AnalysisCancelledError, AnalysisClient } from './analysisClient';
import { type CloningInsertRequest, type CloningRequest } from './analysisProtocol';
import { snapshotOf } from './saveProtocol';

/**
 * The `designCloning` request (item 141, packet 5): each recipe gives what
 * the engine the Cloning workspace calls gives, with its simulation run in
 * the worker and its documents back as documents.
 */

const client = new AnalysisClient(null);

function request(insert: CloningInsert): CloningInsertRequest {
  return {
    name: insert.name,
    template: snapshotOf(insert.document),
    range: insert.range,
    strand: insert.strand,
  };
}

const gen = (doc: SeqDocument | null): string => (doc === null ? '' : writeGenBank(doc));

describe('designCloning', { timeout: 60_000 }, () => {
  it('restriction: the design, the simulation and its documents are the engine’s', async () => {
    const insert = fromU49845('AXL2', 686, 836);
    const settings = { padding: 7, extra5: 'GCCACC' };
    const answer = await client.designCloning({
      recipe: 'restriction',
      vector: snapshotOf(pUC19),
      region: MCS,
      insert: request(insert),
      forward: 'EcoRI',
      reverse: 'BamHI',
      flipped: false,
      settings,
    });
    if (answer.recipe !== 'restriction') throw new Error('wrong recipe');
    const { simulate, ...direct } = designCloningEnds(
      {
        vector: pUC19,
        region: resolveVectorRegion(pUC19, MCS),
        insert,
        flipped: false,
        scans: scanForCloningNow(pUC19, insert),
      },
      { forward: 'EcoRI', reverse: 'BamHI' },
      settings,
    );
    expect(answer.design).toEqual(direct);
    const sim = simulate();
    expect(answer.simulation.problem).toBe(sim.problem);
    expect(answer.simulation.warnings).toEqual(sim.warnings);
    expect(gen(answer.simulation.product)).toBe(gen(sim.product));
    expect(gen(answer.simulation.amplicon)).toBe(gen(sim.amplicon));
    expect(answer.simulation.product?.length).toBeGreaterThan(2686);
  });

  it('golden-gate: the part and the circle it makes with the destination', async () => {
    const enzyme = getEnzyme('BsaI');
    if (enzyme === undefined) throw new Error('no BsaI');
    const overhangs = destinationOverhangs(ggDestination, enzyme);
    if (overhangs === null) throw new Error('no overhangs');
    const insert: CloningInsert = {
      document: ggGene,
      range: { start: 0, end: ggGene.length },
      strand: 'forward',
      name: 'ggGene',
    };
    const settings = { enzyme: 'BsaI', left: overhangs.left, right: overhangs.right };
    const answer = await client.designCloning({
      recipe: 'golden-gate',
      destination: snapshotOf(ggDestination),
      insert: request(insert),
      settings,
    });
    if (answer.recipe !== 'golden-gate') throw new Error('wrong recipe');
    const { simulate, ...direct } = designGoldenGatePart(
      { insert, destination: ggDestination },
      settings,
    );
    expect(answer.design).toEqual(direct);
    const sim = simulate();
    expect(sim.product).not.toBeNull();
    expect(gen(answer.simulation.product)).toBe(gen(sim.product));
    expect(answer.simulation.missing).toBe(sim.missing);
  });

  it('homology: primers, amplicon and circle, for a kit and for yeast with its overlap', async () => {
    const vector = linearVector();
    const insert: CloningInsert = {
      document: ifGene,
      range: { start: 0, end: ifGene.length },
      strand: 'forward',
      name: 'ifGene',
    };
    for (const [kit, overlap] of [
      ['in-fusion', undefined],
      ['yeast', 30],
    ] as const) {
      const answer = await client.designCloning({
        recipe: 'homology',
        vector: snapshotOf(vector),
        insert: request(insert),
        kit,
        ...(overlap === undefined ? {} : { overlap }),
        flipped: false,
      });
      if (answer.recipe !== 'homology') throw new Error('wrong recipe');
      const direct = designMultiOverlapPrimers(
        vector,
        [{ template: ifGene, region: insert.range, reverse: false }],
        kit,
        overlap === undefined ? {} : { overlap },
      );
      expect(answer.design.problem).toBeNull();
      expect(answer.design.primers).toEqual({
        forward: direct.inserts[0]?.forward,
        reverse: direct.inserts[0]?.reverse,
      });
      expect(answer.design.warnings).toEqual(direct.warnings);
      expect(answer.design.overlap).toBe(direct.overlap);
      expect(gen(answer.design.product)).toBe(gen(direct.product));
      expect(gen(answer.design.amplicon)).toBe(gen(direct.inserts[0]?.amplicon ?? null));
    }
  });

  it('a circular vector is the designer’s own refusal, not an exception', async () => {
    const answer = await client.designCloning({
      recipe: 'homology',
      vector: snapshotOf(ggDestination),
      insert: request({
        document: ifGene,
        range: { start: 0, end: ifGene.length },
        strand: 'forward',
        name: 'ifGene',
      }),
      kit: 'nebuilder',
      flipped: false,
    });
    if (answer.recipe !== 'homology') throw new Error('wrong recipe');
    expect(answer.design.problem).toMatch(/is circular, so it has no ends/);
    expect(answer.design.product).toBeNull();
  });

  it('every answer survives a structured clone, as it must to leave a worker', () => {
    const insert = fromU49845('AXL2', 686, 836);
    const cloning: CloningRequest[] = [
      {
        recipe: 'restriction',
        vector: snapshotOf(pUC19),
        region: MCS,
        insert: request(insert),
        forward: 'EcoRI',
        reverse: 'BamHI',
        flipped: false,
        settings: {},
      },
      {
        recipe: 'homology',
        vector: snapshotOf(linearVector()),
        insert: request({
          document: ifGene,
          range: { start: 0, end: ifGene.length },
          strand: 'forward',
          name: 'ifGene',
        }),
        kit: 'in-fusion',
        flipped: false,
      },
    ];
    cloning.forEach((c, id) => {
      const response = handleAnalysisRequest({ id, kind: 'designCloning', cloning: c });
      expect(response.kind).toBe('designCloning');
      expect(() => structuredClone(response)).not.toThrow();
    });
  });

  it('reports an engine error as an error, and cancels like any long request', async () => {
    await expect(
      client.designCloning({
        recipe: 'restriction',
        vector: { sequence: 'ACGT', rest: '{' },
        region: null,
        insert: request(fromU49845('x', 0, 10)),
        forward: 'EcoRI',
        reverse: 'BamHI',
        flipped: false,
        settings: {},
      }),
    ).rejects.toThrow();
    const posted: { id: number; kind: string }[] = [];
    const worker = {
      onmessage: null,
      onerror: null,
      postMessage: (m: { id: number; kind: string }) => posted.push(m),
      terminate: vi.fn(),
    };
    const held = new AnalysisClient(() => worker as unknown as Worker);
    const controller = new AbortController();
    const answer = held.designCloning(
      {
        recipe: 'golden-gate',
        destination: snapshotOf(ggDestination),
        insert: request(fromU49845('x', 0, 100)),
        settings: {},
      },
      { signal: controller.signal },
    );
    expect(posted[0]?.kind).toBe('designCloning');
    controller.abort();
    await expect(answer).rejects.toBeInstanceOf(AnalysisCancelledError);
  });
});
