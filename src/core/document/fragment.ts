import { type Feature, type Qualifier, type Segment, type Strand } from '../features';
import { type Range } from '../range';
import { type StyleRun, isBaseStyle } from './baseStyles';
import { assertValidSequence } from '../sequence';
import { extractRange } from './extract';
import { type SeqDocument } from './seqDocument';

/**
 * A piece of DNA with its annotations, detached from any document: what the
 * clipboard carries. `features` use fragment coordinates (0-based, linear,
 * starting at the fragment's first base), so a fragment can be dropped into
 * any document by shifting them.
 */
export interface SeqFragment {
  readonly sequence: string;
  readonly features: readonly Feature[];
  /** How its bases are drawn (#89), in fragment coordinates; none when absent. */
  readonly styles?: readonly StyleRun[];
}

/**
 * The bases in `r` (which may wrap on a circular document) with the features
 * they carry, trimmed to the range. `source` features describe the whole
 * record rather than the DNA, so they are left behind: pasting would
 * otherwise litter the target with partial stubs of them.
 */
export function fragmentFromRange(doc: SeqDocument, r: Range): SeqFragment {
  const sub = extractRange(doc, r);
  return {
    sequence: sub.sequence.toString(),
    features: sub.features.all().filter((f) => f.type !== 'source'),
    ...(sub.styles.isEmpty ? {} : { styles: sub.styles.runs }),
  };
}

// ------------------------------------------------------------- JSON codec

/** Envelope written to the clipboard so a paste can tell our data from arbitrary JSON. */
const FORMAT = 'plasmidpop-fragment';
const VERSION = 1;

interface FragmentJson {
  readonly format: typeof FORMAT;
  readonly version: number;
  readonly sequence: string;
  readonly features: readonly Feature[];
  readonly styles?: readonly StyleRun[];
}

export function fragmentToJSON(fragment: SeqFragment): string {
  const json: FragmentJson = {
    format: FORMAT,
    version: VERSION,
    sequence: fragment.sequence,
    features: fragment.features,
    ...(fragment.styles === undefined || fragment.styles.length === 0
      ? {}
      : { styles: fragment.styles }),
  };
  return JSON.stringify(json);
}

/**
 * Reads a fragment written by `fragmentToJSON`. Returns null for anything
 * else (other JSON, malformed features, bases outside the IUPAC alphabet),
 * so callers can fall back to treating clipboard text as plain sequence.
 */
export function parseFragmentJSON(text: string): SeqFragment | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw['format'] !== FORMAT || typeof raw['sequence'] !== 'string') {
    return null;
  }
  const sequence = raw['sequence'];
  try {
    assertValidSequence(sequence);
  } catch {
    return null;
  }
  const rawFeatures = raw['features'];
  if (!Array.isArray(rawFeatures)) return null;
  const features: Feature[] = [];
  const ids = new Set<string>();
  for (const f of rawFeatures) {
    const feature = readFeature(f, sequence.length);
    if (feature === null || ids.has(feature.id)) return null;
    ids.add(feature.id);
    features.push(feature);
  }
  const rawStyles = raw['styles'];
  if (rawStyles === undefined) return { sequence, features };
  const styles = readStyles(rawStyles, sequence.length);
  return styles === null ? null : { sequence, features, styles };
}

/** Styled runs as `fragmentToJSON` writes them: sorted, apart, inside the bases. */
export function readStyles(value: unknown, length: number): StyleRun[] | null {
  if (!Array.isArray(value)) return null;
  const out: StyleRun[] = [];
  let previous = 0;
  for (const run of value) {
    if (!isRecord(run)) return null;
    const { start, end, style } = run;
    if (!isIndex(start, length) || !isIndex(end, length) || start < previous || end <= start) {
      return null;
    }
    if (!isBaseStyle(style)) return null;
    out.push({ start, end, style });
    previous = end;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIndex(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

function readFeature(value: unknown, length: number): Feature | null {
  if (!isRecord(value)) return null;
  const { id, type, name, strand, segments, qualifiers } = value;
  if (typeof id !== 'string' || typeof type !== 'string' || typeof name !== 'string') return null;
  if (!isStrand(strand) || !Array.isArray(segments) || !Array.isArray(qualifiers)) return null;
  const segs: Segment[] = [];
  for (const s of segments) {
    const seg = readSegment(s, length);
    if (seg === null) return null;
    segs.push(seg);
  }
  if (segs.length === 0) return null;
  const quals: Qualifier[] = [];
  for (const q of qualifiers) {
    if (!isRecord(q) || typeof q['name'] !== 'string') return null;
    const v = q['value'];
    if (typeof v !== 'string' && v !== null) return null;
    quals.push({ name: q['name'], value: v });
  }
  return { id, type, name, strand, segments: segs, qualifiers: quals };
}

function isStrand(value: unknown): value is Strand {
  return value === 'forward' || value === 'reverse';
}

function readSegment(value: unknown, length: number): Segment | null {
  if (!isRecord(value)) return null;
  if (value['kind'] === 'site') {
    return isIndex(value['position'], length)
      ? { kind: 'site', position: value['position'] }
      : null;
  }
  if (value['kind'] !== 'range') return null;
  const { start, end, partialStart, partialEnd } = value;
  if (!isIndex(start, length) || !isIndex(end, length) || end <= start) return null;
  if (typeof partialStart !== 'boolean' || typeof partialEnd !== 'boolean') return null;
  return { kind: 'range', start, end, partialStart, partialEnd };
}
