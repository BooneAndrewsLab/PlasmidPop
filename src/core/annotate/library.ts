import { translate } from '../analysis/codons';

/**
 * The bundled database of common features that Detect features looks for
 * (item 59, `docs/design/59-detect-features.md`). Two files, both generated
 * by `scripts/build-feature-db.mjs` from public records and committed:
 *
 * - `data/core-parts.json`, the hand-curated core: origins, markers,
 *   promoters, terminators, tags, operators, primer sites. Each part cites the
 *   NCBI record and location its bases were read from.
 * - `data/fpbase.json`, fluorescent proteins chosen from FPbase, whose data
 *   is CC BY-SA 4.0 (see `DATA-LICENSES.md`); kept apart so its licence and
 *   attribution travel with it.
 *
 * They are loaded on first use, in the worker, so the app's own bundle
 * carries none of it.
 */

/**
 * Which list a part came from, which decides the credit it carries: the two
 * bundled files, or the user's own parts (`mine`, #210).
 */
export type LibrarySource = 'core' | 'fpbase' | 'mine';

/**
 * What names a part for one variant of an element rather than for the
 * element (#284), and what to call a hit that does not show it.
 *
 * - `protein`: residues of the part's own protein a hit must carry, 1-based,
 *   or `'exact'` for all of them (the variant is the whole protein, as for a
 *   wild-type fluorescent protein a mutant would otherwise be called).
 *   Residues are placed by counting, so a hit with an indel, one cut off by a
 *   linear end, and a homologue (`similar`) show nothing.
 * - `bases`: a stretch of the part's own bases, 1-based and inclusive, that a
 *   hit must carry base for base — looked for in what was matched, so a base
 *   missing from it (the trc promoter's -35/-10 spacer in a tac promoter)
 *   shows even where the matcher read the copy with an indel.
 * - `codons`: the variant is in the codons alone (luc+ against luc2), so a
 *   hit made in the translation can never show it.
 *
 * A `family` alone asks only that the hit be the part rather than a
 * homologue of it: a protein 70% identical to the pSC101 repressor is a
 * TetR, but not that class of one.
 */
export interface PartVariant {
  /** The element's own name, used where a hit does not show the variant. */
  readonly family?: string;
  readonly protein?: 'exact' | readonly number[];
  readonly bases?: { readonly start: number; readonly end: number };
  readonly codons?: boolean;
}

export interface LibraryPart {
  readonly name: string;
  /** GenBank feature key a hit is annotated as. */
  readonly type: string;
  /** Coarse group for the list: origin, marker, promoter, … */
  readonly category: string;
  /**
   * The part 5′→3′ as it reads, upper case A/C/G/T only; empty for a part
   * that is only looked for in the translation (#93).
   */
  readonly sequence: string;
  /**
   * What it codes for, one letter per residue, for the parts matched in the
   * six frames (#93): the peptide tags no record spells in DNA, and the
   * proteins a construct carries with synonymous changes.
   */
  readonly protein?: string;
  /** The NCBI nucleotide record the bases were read from, accession.version. */
  readonly accession: string;
  /** Where in that record, as a GenBank location. */
  readonly location: string;
  readonly note?: string;
  /**
   * Reported only when every base matches: no mismatches, no indels, no
   * ambiguity code in the sequence where the part has a base, and not when a
   * linear end cuts it off. For a part that is a few-base variant of another
   * (lacUV5 of the lac promoter), which would otherwise match it.
   */
  readonly exact?: boolean;
  /**
   * The parts this one is a segment of (#282): the signal peptide of AmpR,
   * the R-U5 end of an HIV-1 LTR (all a vector keeps where a heterologous
   * promoter replaces U3, #286). It is reported only where no hit of one of
   * them, on its strand, holds all of its bases, however well either
   * matched: where the gene is called the segment is a part of it, not a
   * feature beside it, and where the gene is not called (a signal peptide
   * fused to something else) it is offered as itself. Without it a segment
   * of another type stayed beside its gene always, and one of the same type
   * whenever the gene had a mismatch outside it.
   */
  readonly segmentOf?: readonly string[];
  /**
   * The parts this one is made of (#282): the T7lac promoter is the T7
   * promoter running straight into the lac operator. A hit of it displaces no
   * hit of those parts, so a composite is offered together with its
   * components, whatever their types; without it the component that shares
   * the composite's type went and the other stayed.
   */
  readonly components?: readonly string[];
  /**
   * The part named here lies inside this one on the other strand: the two
   * are one bidirectional element read either way (#282), the SV40 late
   * poly(A) signal holding the early one. Where both are called over one
   * stretch, each is offered only where a gene on its strand runs into it,
   * and the named part, the generic label, also where none runs into either
   * (`inUseStrands`, `bidirectional.ts`).
   */
  readonly complementOf?: string;
  /**
   * What a hit must show for the part's name to be used (#284): the part is
   * named for one variant of an element (trc, kanMX, luc+, avGFP), and the
   * name is a claim about the bases, not only about the place. Where a hit
   * does not show it, the hit is reported under `family`, the name of the
   * element itself, or not reported at all where the part names no family.
   */
  readonly variant?: PartVariant;
  readonly source: LibrarySource;
  /** FPbase page of a fluorescent protein. */
  readonly fpbase?: string;
  /**
   * For a part of the user's own (`source: 'mine'`), the list it was kept
   * from: `My parts`, or `pLannotate: snapgene` for an imported copy. A hit
   * says so, so a part of the user's is never taken for the bundled, cited list.
   */
  readonly origin?: string;
}

export interface FeatureLibrary {
  readonly parts: readonly LibraryPart[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function text(entry: Record<string, unknown>, key: string): string | undefined {
  const v = entry[key];
  return typeof v === 'string' ? v : undefined;
}

/**
 * What a coding part's own bases code for (#219): the translation of a CDS
 * of whole codons with no stop inside (a closing stop is dropped), or
 * undefined for anything else. Nothing is typed in: the protein is read off
 * the part's cited bases, so every CDS of the library is also looked for in
 * the six frames, and found recoded for another host or as a homologue.
 */
export function codingProtein(type: string, sequence: string): string | undefined {
  // Stryker disable next-line ConditionalExpression,ArithmeticOperator: equivalent, a shorter sequence has too few residues for the check below
  if (type !== 'CDS' || sequence.length < 3 * MIN_CODING_RESIDUES || sequence.length % 3 !== 0) {
    return undefined;
  }
  const protein = translate(sequence).replace(/\*$/, '');
  return protein.length >= MIN_CODING_RESIDUES && /^[A-WYZ]+$/.test(protein) ? protein : undefined;
}

/** Shorter than the matcher's protein seed, a protein is no part. */
const MIN_CODING_RESIDUES = 8;

/**
 * The positions a `variant`'s `protein` names: `exact`, or a list of 1-based
 * positions and `a..b` ranges, as `71,95,101,102` or `1..8` (#284).
 */
function parsePositions(spec: string, limit: number): 'exact' | number[] {
  if (spec === 'exact') return 'exact';
  const out: number[] = [];
  for (const piece of spec.split(',')) {
    const m = /^\s*(\d+)(?:\.\.(\d+))?\s*$/.exec(piece);
    if (m?.[1] === undefined) throw new Error(`malformed positions ${JSON.stringify(spec)}`);
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (from < 1 || to < from || to > limit) throw new Error(`positions ${piece} out of range`);
    for (let p = from; p <= to; p++) out.push(p);
  }
  if (out.length === 0) throw new Error('no positions');
  return out;
}

/** A part's `variant` (#284), checked against the part's own bases and protein. */
function parseVariant(
  value: unknown,
  sequence: string,
  protein: string | undefined,
): PartVariant | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('variant is not an object');
  const family = text(value, 'family');
  const codons = value['codons'];
  if (codons !== undefined && typeof codons !== 'boolean') throw new Error('malformed codons');
  const proteinSpec = text(value, 'protein');
  const basesSpec = text(value, 'bases');
  if (proteinSpec !== undefined && (protein === undefined || protein === '')) {
    throw new Error('variant names residues of a part with no protein');
  }
  const residues =
    proteinSpec === undefined ? undefined : parsePositions(proteinSpec, protein?.length ?? 0);
  let bases;
  if (basesSpec !== undefined) {
    const positions = parsePositions(basesSpec, sequence.length);
    if (positions === 'exact') bases = { start: 1, end: sequence.length };
    else {
      const start = positions[0] ?? 0;
      const end = positions[positions.length - 1] ?? 0;
      if (positions.length !== end - start + 1)
        throw new Error('variant bases are not one stretch');
      bases = { start, end };
    }
    if (bases.end <= bases.start) throw new Error('variant bases are a single base');
  }
  if (family === undefined && residues === undefined && bases === undefined && codons !== true) {
    throw new Error('variant says nothing a hit must show');
  }
  return {
    ...(family === undefined ? {} : { family }),
    ...(residues === undefined ? {} : { protein: residues }),
    ...(bases === undefined ? {} : { bases }),
    ...(codons === true ? { codons } : {}),
  };
}

/** A list of part names, or undefined; anything else is a fault in the build. */
function partNames(value: unknown, field: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((v): v is string => typeof v === 'string' && v !== '')
  ) {
    throw new Error(`malformed ${field}`);
  }
  return value;
}

/**
 * The parts of one data file, checked field by field: a part that is not
 * what the matcher expects is a fault in the build, and throws.
 */
export function parseLibraryFile(json: string, source: LibrarySource): LibraryPart[] {
  const parsed: unknown = JSON.parse(json);
  const parts = isRecord(parsed) ? parsed['parts'] : undefined;
  if (!Array.isArray(parts)) throw new Error(`Feature library (${source}): no parts`);
  return parts.map((entry: unknown, i): LibraryPart => {
    if (!isRecord(entry))
      throw new Error(`Feature library (${source}): part ${i} is not an object`);
    const name = text(entry, 'name');
    const type = text(entry, 'type');
    const category = text(entry, 'category');
    const sequence = text(entry, 'sequence');
    const accession = text(entry, 'accession');
    const location = text(entry, 'location');
    if (
      name === undefined ||
      type === undefined ||
      category === undefined ||
      // Stryker disable next-line ConditionalExpression: equivalent, a missing sequence fails the base test that ends the condition
      sequence === undefined ||
      accession === undefined ||
      location === undefined ||
      !/^[ACGT]*$/.test(sequence)
    ) {
      throw new Error(`Feature library (${source}): part ${i} is malformed`);
    }
    const note = text(entry, 'note');
    const complementOf = entry['complementOf'];
    if (complementOf !== undefined && (typeof complementOf !== 'string' || complementOf === '')) {
      throw new Error(`Feature library (${source}): part ${i} has a malformed complementOf`);
    }
    const fpbase = text(entry, 'fpbase');
    const protein = text(entry, 'protein') ?? codingProtein(type, sequence);
    const exact = entry['exact'];
    if (exact !== undefined && typeof exact !== 'boolean') {
      throw new Error(`Feature library (${source}): part ${i} has a malformed exact`);
    }
    // A part is looked for by its bases, by its protein, or by both; one
    // with neither would match nothing and is a fault in the build.
    if (sequence === '' && (protein === undefined || protein === '')) {
      throw new Error(`Feature library (${source}): part ${i} has neither bases nor a protein`);
    }
    if (protein !== undefined && !/^[A-Z]+$/.test(protein)) {
      throw new Error(`Feature library (${source}): part ${i} has a malformed protein`);
    }
    let variant;
    let components;
    let segmentOf;
    try {
      variant = parseVariant(entry['variant'], sequence, protein);
      components = partNames(entry['components'], 'components');
      segmentOf = partNames(entry['segmentOf'], 'segmentOf');
    } catch (e) {
      throw new Error(
        `Feature library (${source}): part ${i}: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      );
    }
    return {
      name,
      type,
      category,
      sequence,
      accession,
      location,
      source,
      ...(note === undefined ? {} : { note }),
      ...(fpbase === undefined ? {} : { fpbase }),
      ...(protein === undefined ? {} : { protein }),
      ...(exact === true ? { exact } : {}),
      ...(segmentOf === undefined ? {} : { segmentOf }),
      ...(components === undefined ? {} : { components }),
      ...(complementOf === undefined ? {} : { complementOf }),
      ...(variant === undefined ? {} : { variant }),
    };
  });
}

let loading: Promise<FeatureLibrary> | null = null;

/** The bundled library, fetched once and kept. */
export function loadFeatureLibrary(): Promise<FeatureLibrary> {
  loading ??= Promise.all([
    import('./data/core-parts.json?raw'),
    import('./data/fpbase.json?raw'),
  ]).then(([core, fp]) => ({
    parts: [...parseLibraryFile(core.default, 'core'), ...parseLibraryFile(fp.default, 'fpbase')],
  }));
  // A failed load (offline before the chunk was cached) may be tried again.
  loading.catch(() => {
    loading = null;
  });
  return loading;
}
