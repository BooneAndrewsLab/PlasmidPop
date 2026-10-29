import {
  type Alignment,
  type AlignmentOptions,
  type AnnealOptions,
  type CheckDesign,
  type CheckOptions,
  type CloneGeometry,
  type CrisprGuide,
  type CodonSlot,
  type CrisprOptions,
  type CutSite,
  type CutSiteSet,
  type EnzymeDigest,
  type EnzymeSet,
  type FeatureHit,
  type LibraryPart,
  type MoleculeDescription,
  type MsaOptions,
  type MultipleAlignment,
  type Nuclease,
  PackedCutSiteSet,
  type Orf,
  type OrfOptions,
  type PrimerSearch,
  type RecodeOptions,
  type RecodeResult,
  type Seguid,
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
      /** Also the Enzymes tab's digest of the sites (item 98). */
      readonly digest?: boolean;
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
      /** The user's own parts (#210), searched with the bundled ones. */
      readonly userParts?: readonly LibraryPart[];
    }
  | {
      /** CRISPR guides for one nuclease, with off-targets (item 74, #206). */
      readonly id: number;
      readonly kind: 'crispr';
      readonly sequence: string;
      readonly topology: Topology;
      readonly nuclease: Nuclease;
      readonly options: Omit<CrisprOptions, 'onProgress'>;
    }
  | {
      /** The sliding-window GC fraction at every base (item 75). */
      readonly id: number;
      readonly kind: 'gcProfile';
      readonly sequence: string;
      readonly window: number;
      readonly circular: boolean;
    }
  | {
      /** Several sequences aligned together (#207). */
      readonly id: number;
      readonly kind: 'msa';
      readonly sequences: readonly string[];
      readonly options: Omit<MsaOptions, 'onProgress'>;
    }
  | {
      /** The SEGUID checksum of a large document, off the main thread (#270). */
      readonly id: number;
      readonly kind: 'checksum';
      readonly molecule: MoleculeDescription;
    }
  | {
      /** A codon for each slot, within the limits (#209). */
      readonly id: number;
      readonly kind: 'recode';
      readonly slots: readonly CodonSlot[];
      readonly options: RecodeOptions;
    }
  | {
      /** Colony-PCR check primers for a cloning product (#311, item 120). */
      readonly id: number;
      readonly kind: 'checkPrimers';
      readonly product: CheckMolecule;
      /** The empty vector, or null when none can be said. */
      readonly empty: CheckMolecule | null;
      readonly geometry: CloneGeometry;
      readonly options: Omit<CheckOptions, 'empty'>;
    };

/** A molecule as the clone-check designer needs it: its bases and shape, no features. */
export interface CheckMolecule {
  readonly name: string;
  readonly sequence: string;
  readonly topology: Topology;
}

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
  | {
      readonly id: number;
      readonly kind: 'cutSites';
      readonly sites: PackedCutSites;
      /** Only when the request asked for it. */
      readonly digest?: PackedEnzymeDigest;
    }
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
  | { readonly id: number; readonly kind: 'crispr'; readonly guides: readonly CrisprGuide[] }
  | { readonly id: number; readonly kind: 'gcProfile'; readonly profile: Float32Array }
  | { readonly id: number; readonly kind: 'recode'; readonly result: RecodeResult }
  | { readonly id: number; readonly kind: 'msa'; readonly alignment: MultipleAlignment }
  | { readonly id: number; readonly kind: 'checksum'; readonly checksum: Seguid | null }
  | { readonly id: number; readonly kind: 'checkPrimers'; readonly design: CheckDesign }
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

/**
 * An `EnzymeDigest` as two transferred buffers (item 98): the marks are
 * already one, and the fragment lengths of every enzyme go end to end in
 * the order of `PackedCutSites.enzymes`, with where each enzyme's start.
 * A 1 Mb scan is 96,000 lengths, which as arrays would be cloned.
 */
export interface PackedEnzymeDigest {
  readonly host: Uint8Array;
  readonly lengths: Int32Array;
  /** Per enzyme of the packed sites, where its lengths begin; one more entry closes the last. */
  readonly offsets: Int32Array;
  /** Per enzyme of the packed sites, how many sites are its. */
  readonly counts: Int32Array;
}

export function packEnzymeDigest(
  digest: EnzymeDigest,
  enzymes: readonly string[],
): PackedEnzymeDigest {
  const offsets = new Int32Array(enzymes.length + 1);
  const counts = new Int32Array(enzymes.length);
  let total = 0;
  enzymes.forEach((name, i) => {
    offsets[i] = total;
    total += digest.lengths.get(name)?.length ?? 0;
    counts[i] = digest.counts.get(name) ?? 0;
  });
  offsets[enzymes.length] = total;
  const lengths = new Int32Array(total);
  enzymes.forEach((name, i) => {
    lengths.set(digest.lengths.get(name) ?? [], offsets[i] ?? 0);
  });
  return { host: digest.host, lengths, offsets, counts };
}

/**
 * Past how many sites `unpackScan` lets the page go on before the sites are
 * put to use (#278), so what they are for (the Enzymes tab's first render)
 * is a task of its own.
 */
export const UNPACK_SLICE = 50_000;

/**
 * A scan's sites and its digest, as the main thread keeps them (#281): the
 * sites still packed (`PackedCutSiteSet`), sorted by enzyme in one pass over
 * the integers, with an enzyme's site objects made only when something asks
 * for them; the lengths as views into the transferred buffer; and the
 * Enzymes tab's view of each enzyme (`EnzymeDigest.byEnzyme`), which reads
 * counts, cuts and marks off typed arrays. At 4.64 Mb the scan is 446,000
 * sites, whose objects, made here in #278, set off a 35-80 ms collection.
 * When there are more than `pauseAfter` sites it awaits `pause` before it
 * answers.
 */
export async function unpackScan(
  packed: PackedCutSites,
  { host, lengths, offsets, counts }: PackedEnzymeDigest,
  pause: () => Promise<void> = () => Promise.resolve(),
  pauseAfter: number = UNPACK_SLICE,
): Promise<{ readonly sites: CutSiteSet; readonly digest: EnzymeDigest }> {
  const { data, enzymes } = packed;
  const sites = new PackedCutSiteSet(data, enzymes, host);
  if (sites.size > pauseAfter) await pause();
  const byLength = new Map<string, Int32Array>();
  const countOf = new Map<string, number>();
  enzymes.forEach((name, i) => {
    const from = offsets[i] ?? 0;
    const to = offsets[i + 1] ?? from;
    if (to > from) byLength.set(name, lengths.subarray(from, to));
    const count = counts[i] ?? 0;
    if (count > 0) countOf.set(name, count);
  });
  return {
    sites,
    digest: { host, lengths: byLength, counts: countOf, byEnzyme: sites.groups() },
  };
}
