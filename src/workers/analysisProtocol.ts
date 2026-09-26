import {
  type Alignment,
  type AlignmentOptions,
  type AnnealOptions,
  type CutSite,
  type EnzymeSet,
  type FeatureHit,
  type LibraryPart,
  type Orf,
  type OrfOptions,
  type PrimerSearch,
  type StrandedAlignment,
  type Topology,
} from '@/core';

/** Requests the main thread sends to the analysis worker. */
export type AnalysisRequest =
  | {
      /**
       * Installs the enzyme set to scan with. Sent once whenever a worker
       * is started, since a worker has its own module state and would
       * otherwise fall back to the bundled table. `set` null means the
       * bundled table.
       */
      readonly id: number;
      readonly kind: 'setEnzymes';
      readonly set: EnzymeSet | null;
    }
  | {
      readonly id: number;
      readonly kind: 'cutSites';
      readonly sequence: string;
      readonly topology: Topology;
      readonly enzymes?: readonly string[];
    }
  | {
      readonly id: number;
      readonly kind: 'orfs';
      readonly sequence: string;
      readonly topology: Topology;
      readonly options: OrfOptions;
    }
  | {
      readonly id: number;
      readonly kind: 'align';
      readonly a: string;
      readonly b: string;
      readonly options: AlignmentOptions;
    }
  | {
      /** `b` or its reverse complement, whichever aligns better. */
      readonly id: number;
      readonly kind: 'alignEitherStrand';
      readonly a: string;
      readonly b: string;
      readonly options: AlignmentOptions;
    }
  | {
      /** Where each primer of the collection binds (#64). */
      readonly id: number;
      readonly kind: 'findPrimers';
      readonly sequence: string;
      readonly topology: Topology;
      readonly primers: readonly {
        readonly id: string;
        readonly name: string;
        readonly sequence: string;
      }[];
      readonly options: AnnealOptions;
    }
  | {
      /** The bundled library's parts found in `sequence` (item 59). */
      readonly id: number;
      readonly kind: 'detectFeatures';
      readonly sequence: string;
      readonly topology: Topology;
      readonly minIdentity?: number;
    };

/**
 * A part of the library as the main thread is told of it: everything but
 * its bases, which only the worker needs (and which it alone loads).
 */
/**
 * A part as the main thread hears of it: without its bases, and without the
 * protein a translation match was made against (#93) — the panel names and
 * describes a hit, and neither sequence is wanted for that.
 */
export type DetectedPart = Omit<LibraryPart, 'sequence' | 'protein'>;

/** A hit with the part it is a hit of. */
export interface Detection {
  readonly hit: FeatureHit;
  readonly part: DetectedPart;
}

export type AnalysisResponse =
  | { readonly id: number; readonly kind: 'setEnzymes' }
  | { readonly id: number; readonly kind: 'cutSites'; readonly sites: PackedCutSites }
  | { readonly id: number; readonly kind: 'orfs'; readonly orfs: Orf[] }
  | { readonly id: number; readonly kind: 'align'; readonly alignment: Alignment }
  | {
      readonly id: number;
      readonly kind: 'alignEitherStrand';
      readonly result: StrandedAlignment;
    }
  | { readonly id: number; readonly kind: 'findPrimers'; readonly result: PrimerSearch }
  | {
      readonly id: number;
      readonly kind: 'detectFeatures';
      readonly detections: readonly Detection[];
    }
  | {
      /** Sent ahead of the answer to a long request; not an answer itself. */
      readonly id: number;
      readonly kind: 'progress';
      readonly fraction: number;
    }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };

/**
 * Cut sites as four integers each, so the answer crosses to the main thread
 * as one transferred buffer instead of a structured clone of an object per
 * site. A REBASE scan of 52 kb is 110,000 sites: 204 ms to clone, of which
 * the main thread pays the half that rebuilds them, against 10 ms to pack
 * and 10 ms to unpack (docs/perf-notes.md).
 */
export interface PackedCutSites {
  /** Per site: enzyme index << 1 | reverse, cut, cutBottom, siteStart. */
  readonly data: Int32Array;
  /** What the enzyme indices point at. */
  readonly enzymes: readonly string[];
}

export function packCutSites(sites: readonly CutSite[]): PackedCutSites {
  const index = new Map<string, number>();
  const enzymes: string[] = [];
  const data = new Int32Array(sites.length * 4);
  sites.forEach((s, i) => {
    let e = index.get(s.enzyme);
    if (e === undefined) {
      e = enzymes.length;
      index.set(s.enzyme, e);
      enzymes.push(s.enzyme);
    }
    data[i * 4] = (e << 1) | (s.strand === 'reverse' ? 1 : 0);
    data[i * 4 + 1] = s.cut;
    data[i * 4 + 2] = s.cutBottom;
    data[i * 4 + 3] = s.siteStart;
  });
  return { data, enzymes };
}

export function unpackCutSites({ data, enzymes }: PackedCutSites): CutSite[] {
  const out: CutSite[] = [];
  for (let i = 0; i + 3 < data.length; i += 4) {
    const head = data[i] ?? 0;
    out.push({
      enzyme: enzymes[head >> 1] ?? '',
      cut: data[i + 1] ?? 0,
      cutBottom: data[i + 2] ?? 0,
      siteStart: data[i + 3] ?? 0,
      strand: (head & 1) === 1 ? 'reverse' : 'forward',
    });
  }
  return out;
}
