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

/** Which file a part came from, which decides the credit it carries. */
export type LibrarySource = 'core' | 'fpbase';

export interface LibraryPart {
  readonly name: string;
  /** GenBank feature key a hit is annotated as. */
  readonly type: string;
  /** Coarse group for the list: origin, marker, promoter, … */
  readonly category: string;
  /** The part 5′→3′ as it reads, upper case A/C/G/T only. */
  readonly sequence: string;
  /** The NCBI nucleotide record the bases were read from, accession.version. */
  readonly accession: string;
  /** Where in that record, as a GenBank location. */
  readonly location: string;
  readonly note?: string;
  readonly source: LibrarySource;
  /** FPbase page of a fluorescent protein. */
  readonly fpbase?: string;
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
      sequence === undefined ||
      accession === undefined ||
      location === undefined ||
      !/^[ACGT]+$/.test(sequence)
    ) {
      throw new Error(`Feature library (${source}): part ${i} is malformed`);
    }
    const note = text(entry, 'note');
    const fpbase = text(entry, 'fpbase');
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
