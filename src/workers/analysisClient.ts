import {
  type Alignment,
  type AlignmentOptions,
  type AnnealOptions,
  type CodonSlot,
  type CrisprGuide,
  type CrisprOptions,
  type CutSite,
  type CutSiteSet,
  type EnzymeDigest,
  type EnzymeSet,
  type MoleculeDescription,
  type MsaOptions,
  type MultipleAlignment,
  type Nuclease,
  type Orf,
  type OrfOptions,
  type LibraryPart,
  type PrimerSearch,
  type RecodeOptions,
  type RecodeResult,
  type Seguid,
  type StrandedAlignment,
  type Topology,
  setActiveEnzymeSet,
} from '@/core';

import { handleAnalysisRequestAsync } from './analysis.worker';
import {
  type AnalysisRequest,
  type AnalysisResponse,
  type Detection,
  unpackCutSites,
  unpackScan,
} from './analysisProtocol';

/**
 * Lets the page run before the next slice of work (#278): `scheduler.yield`
 * where there is one (Chromium), which goes back to the front of the queue,
 * otherwise the next task.
 */
export function yieldToPage(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (typeof scheduler?.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

interface Pending {
  readonly request: AnalysisRequest;
  readonly resolve: (r: AnalysisResponse) => void;
  readonly onProgress?: (fraction: number) => void;
}

/** What a long request can be given: where to report progress, and a way to stop it. */
export interface LongRequestOptions {
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
}

/** The rejection of a request its signal stopped. */
export class AnalysisCancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'AnalysisCancelledError';
  }
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
      if (ev.data.kind === 'progress') {
        p.onProgress?.(ev.data.fraction);
        return;
      }
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

  private send(req: RequestBody, long: LongRequestOptions = {}): Promise<AnalysisResponse> {
    const { onProgress, signal } = long;
    if (signal?.aborted === true) return Promise.reject(new AnalysisCancelledError());
    const id = this.nextId++;
    const full: AnalysisRequest = { ...req, id };
    const worker = this.ensureWorker();
    // Inline, the work runs to the end before a signal could be looked at.
    if (worker === null) return handleAnalysisRequestAsync(full, onProgress);
    return new Promise((resolve, reject) => {
      this.pending.set(
        id,
        onProgress === undefined
          ? { request: full, resolve }
          : { request: full, resolve, onProgress },
      );
      signal?.addEventListener(
        'abort',
        () => {
          if (!this.pending.delete(id)) return; // already answered
          reject(new AnalysisCancelledError());
          this.restart();
        },
        { once: true },
      );
      worker.postMessage(full);
    });
  }

  /**
   * Stops whatever the worker is doing by replacing it — a fill cannot be
   * interrupted from outside — and sends what else was waiting for an answer
   * to the new one, so a cancelled alignment takes no scan down with it.
   */
  private restart(): void {
    this.worker?.terminate();
    this.worker = null;
    const worker = this.ensureWorker();
    if (worker === null) return;
    for (const p of this.pending.values()) worker.postMessage(p.request);
  }

  /**
   * Starts the worker before anything is asked of it (#276). Started by the
   * first request, it was being spun up while opening a genome kept the main
   * thread busy, 100 ms where it takes 20 when the page is idle. Does
   * nothing where there are no workers.
   */
  start(): void {
    this.ensureWorker();
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

  /**
   * Every enzyme's cut sites and the Enzymes tab's digest of them (item 98),
   * taken in the worker in the same pass as the scan; the sites stay packed
   * and are made into objects an enzyme at a time as they are asked for (#281).
   */
  async cutSitesWithDigest(
    sequence: string,
    topology: Topology,
  ): Promise<{ readonly sites: CutSiteSet; readonly digest: EnzymeDigest }> {
    const res = await this.send({ kind: 'cutSites', sequence, topology, digest: true });
    if (res.kind === 'error') throw new Error(res.message);
    if (res.kind !== 'cutSites' || res.digest === undefined)
      throw new Error('Unexpected analysis response');
    return unpackScan(res.sites, res.digest, yieldToPage);
  }

  /** The GC fraction in a window centred on each base (item 75). */
  async gcProfile(sequence: string, window: number, circular: boolean): Promise<Float32Array> {
    const res = await this.send({ kind: 'gcProfile', sequence, window, circular });
    if (res.kind === 'error') throw new Error(res.message);
    if (res.kind !== 'gcProfile') throw new Error('Unexpected analysis response');
    return res.profile;
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

  async alignEitherStrand(
    a: string,
    b: string,
    options: AlignmentOptions = {},
    long: LongRequestOptions = {},
  ): Promise<StrandedAlignment> {
    const res = await this.send({ kind: 'alignEitherStrand', a, b, options }, long);
    if (res.kind === 'error') throw new Error(res.message);
    if (res.kind !== 'alignEitherStrand') throw new Error('Unexpected analysis response');
    return res.result;
  }

  /** Where each primer of a collection binds on `sequence` (#64). */
  async findPrimers(
    sequence: string,
    topology: Topology,
    primers: readonly { readonly id: string; readonly name: string; readonly sequence: string }[],
    options: AnnealOptions = {},
  ): Promise<PrimerSearch> {
    const res = await this.send({ kind: 'findPrimers', sequence, topology, primers, options });
    if (res.kind === 'error') throw new Error(res.message);
    if (res.kind !== 'findPrimers') throw new Error('Unexpected analysis response');
    return res.result;
  }

  /** The bundled library's parts found in `sequence`, on both strands (item 59). */
  async detectFeatures(
    sequence: string,
    topology: Topology,
    minIdentity?: number,
    long: LongRequestOptions = {},
    userParts: readonly LibraryPart[] = [],
  ): Promise<readonly Detection[]> {
    const res = await this.send(
      {
        kind: 'detectFeatures',
        sequence,
        topology,
        ...(minIdentity === undefined ? {} : { minIdentity }),
        ...(userParts.length === 0 ? {} : { userParts }),
      },
      long,
    );
    if (res.kind === 'error') throw new Error(res.message);
    if (res.kind !== 'detectFeatures') throw new Error('Unexpected analysis response');
    return res.detections;
  }

  /** CRISPR guides for one nuclease, with off-targets (item 74, #206). */
  async crisprGuides(
    sequence: string,
    topology: Topology,
    nuclease: Nuclease,
    options: Omit<CrisprOptions, 'onProgress'> = {},
    long: LongRequestOptions = {},
  ): Promise<readonly CrisprGuide[]> {
    const res = await this.send({ kind: 'crispr', sequence, topology, nuclease, options }, long);
    if (res.kind === 'error') throw new Error(res.message);
    if (res.kind !== 'crispr') throw new Error('Unexpected analysis response');
    return res.guides;
  }

  /** A codon for each slot, within the limits of `options` (#209). */
  async recode(
    slots: readonly CodonSlot[],
    options: RecodeOptions,
    long: LongRequestOptions = {},
  ): Promise<RecodeResult> {
    const res = await this.send({ kind: 'recode', slots, options }, long);
    if (res.kind === 'error') throw new Error(res.message);
    if (res.kind !== 'recode') throw new Error('Unexpected analysis response');
    return res.result;
  }

  /** Several sequences aligned together, in the worker (#207). */
  async alignMultiple(
    sequences: readonly string[],
    options: Omit<MsaOptions, 'onProgress'> = {},
    long: LongRequestOptions = {},
  ): Promise<MultipleAlignment> {
    const res = await this.send({ kind: 'msa', sequences, options }, long);
    if (res.kind === 'error') throw new Error(res.message);
    if (res.kind !== 'msa') throw new Error('Unexpected analysis response');
    return res.alignment;
  }

  /**
   * The SEGUID checksum of the molecule, in the worker (#270): what
   * `moleculeChecksum` gives, without its digest on the main thread.
   */
  async checksum(molecule: MoleculeDescription): Promise<Seguid | null> {
    const res = await this.send({ kind: 'checksum', molecule });
    if (res.kind === 'error') throw new Error(res.message);
    if (res.kind !== 'checksum') throw new Error('Unexpected analysis response');
    return res.checksum;
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
