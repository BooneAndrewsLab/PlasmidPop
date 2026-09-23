import {
  type Alignment,
  type AlignmentOptions,
  type CutSite,
  type EnzymeSet,
  type Orf,
  type OrfOptions,
  type Topology,
  setActiveEnzymeSet,
} from '@/core';

import { handleAnalysisRequest } from './analysis.worker';
import { type AnalysisRequest, type AnalysisResponse, unpackCutSites } from './analysisProtocol';

interface Pending {
  resolve: (r: AnalysisResponse) => void;
}

/** Omit that distributes over a union, so each request variant keeps its own fields. */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
type RequestBody = DistributiveOmit<AnalysisRequest, 'id'>;

/**
 * Talks to the analysis worker. Falls back to running the same code on the
 * calling thread where `Worker` does not exist (tests, old runtimes), so
 * callers never need to care.
 */
export class AnalysisClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  /** The set to scan with, null for the bundled table. */
  private enzymeSet: EnzymeSet | null = null;

  constructor(private readonly createWorker: (() => Worker) | null = defaultWorkerFactory) {}

  private ensureWorker(): Worker | null {
    if (this.worker !== null || this.createWorker === null) return this.worker;
    try {
      this.worker = this.createWorker();
    } catch {
      return null;
    }
    this.worker.onmessage = (ev: MessageEvent<AnalysisResponse>) => {
      const p = this.pending.get(ev.data.id);
      if (p === undefined) return;
      this.pending.delete(ev.data.id);
      p.resolve(ev.data);
    };
    // A worker has its own module state, so the imported set has to be sent
    // over every time one is started, including after an error killed the last.
    if (this.enzymeSet !== null) {
      this.worker.postMessage({ id: this.nextId++, kind: 'setEnzymes', set: this.enzymeSet });
    }
    this.worker.onerror = () => {
      for (const p of this.pending.values())
        p.resolve({ id: -1, kind: 'error', message: 'Analysis worker failed' });
      this.pending.clear();
      this.worker = null;
    };
    return this.worker;
  }

  private send(req: RequestBody): Promise<AnalysisResponse> {
    const id = this.nextId++;
    const full: AnalysisRequest = { ...req, id };
    const worker = this.ensureWorker();
    if (worker === null) return Promise.resolve(handleAnalysisRequest(full));
    return new Promise((resolve) => {
      this.pending.set(id, { resolve });
      worker.postMessage(full);
    });
  }

  /**
   * Installs the enzyme set on both threads: here, for the inline fallback
   * and for everything the UI reads, and in the worker if one is running.
   */
  useEnzymes(set: EnzymeSet | null): void {
    this.enzymeSet = set;
    setActiveEnzymeSet(set);
    this.worker?.postMessage({ id: this.nextId++, kind: 'setEnzymes', set });
  }

  async cutSites(
    sequence: string,
    topology: Topology,
    enzymes?: readonly string[],
  ): Promise<CutSite[]> {
    const res = await this.send(
      enzymes === undefined
        ? { kind: 'cutSites', sequence, topology }
        : { kind: 'cutSites', sequence, topology, enzymes },
    );
    if (res.kind === 'error') throw new Error(res.message);
    if (res.kind !== 'cutSites') throw new Error('Unexpected analysis response');
    return unpackCutSites(res.sites);
  }

  async orfs(sequence: string, topology: Topology, options: OrfOptions = {}): Promise<Orf[]> {
    const res = await this.send({ kind: 'orfs', sequence, topology, options });
    if (res.kind === 'error') throw new Error(res.message);
    if (res.kind !== 'orfs') throw new Error('Unexpected analysis response');
    return res.orfs;
  }

  async align(a: string, b: string, options: AlignmentOptions = {}): Promise<Alignment> {
    const res = await this.send({ kind: 'align', a, b, options });
    if (res.kind === 'error') throw new Error(res.message);
    if (res.kind !== 'align') throw new Error('Unexpected analysis response');
    return res.alignment;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}

function defaultWorkerFactory(): Worker {
  if (typeof Worker === 'undefined') throw new Error('Workers unavailable');
  return new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
}

export const analysisClient = new AnalysisClient(
  typeof Worker === 'undefined' ? null : defaultWorkerFactory,
);
