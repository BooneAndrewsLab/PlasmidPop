import { type Enzyme, isPalindromicSite } from '@/core';

/**
 * Reader for REBASE's `withrefm` file, the "All Enzymes (each w/ref &
 * isoschizomers)" monthly format.
 *
 * We do not ship REBASE data: every REBASE file says "Copyright (c) Dr.
 * Richard J. Roberts, <year>. All rights reserved.", and `rebase.neb.com`
 * sends no CORS header, so the app cannot fetch it either. The user
 * downloads the file themselves and opens it here; the parsed set lives in
 * their own browser and never leaves it. See docs/design/07-rebase-enzymes.md.
 *
 * `withrefm` is the format worth reading because it is the one that carries
 * the two fields the bundled table lacks: commercial suppliers and the
 * methylation site. One record per enzyme, fields tagged `<1>`..`<8>`:
 *
 * ```
 * <1>EcoRI                 name
 * <2>BstHPI,...            isoschizomers
 * <3>G^AATTC               recognition sequence with the cut marked
 * <4>3(6)                  methylation site of the cognate methyltransferase
 * <5>Escherichia coli...   microorganism
 * <6>...                   source
 * <7>BIJNQRSVX             commercial suppliers, one letter each
 * <8>...                   references, over as many lines as it takes
 * ```
 *
 * The header carries the key from supplier letter to supplier name.
 */

/** A supplier letter and the company it stands for, from the file's header. */
export interface RebaseSupplier {
  readonly code: string;
  readonly name: string;
}

export interface RebaseImport {
  /** REBASE release number, e.g. `609`, or null if the header did not say. */
  readonly version: string | null;
  /** The date on the header line, verbatim, e.g. `Aug 27 2026`. */
  readonly released: string | null;
  readonly enzymes: readonly Enzyme[];
  readonly suppliers: readonly RebaseSupplier[];
  /** Records read but left out, counted by why, for the UI to own up to. */
  readonly skipped: RebaseSkipped;
}

export interface RebaseSkipped {
  /** A site is given but nobody has determined where it cuts. */
  readonly cutUnknown: number;
  /** Cuts on both sides of its site (BcgI and kin); `Enzyme` holds one pair. */
  readonly doubleCutter: number;
  /** No recognition sequence at all, or one with characters we cannot read. */
  readonly noSite: number;
  /** Site too unspecific to predict from sequence; see `MIN_SITE_BITS`. */
  readonly tooUnspecific: number;
}

/**
 * How much a recognition sequence has to narrow things down before a hit
 * means anything: six bits, so at most one position in 64 by chance, which is
 * what an exact three-base site would give.
 *
 * This is how the modification-dependent enzymes are left out. REBASE gives
 * AbaSI the recognition sequence `C`, because what it actually cuts is a
 * glucosyl-5-hydroxymethylcytosine — a base we cannot see in a sequence.
 * Taking that literally would have AbaSI cutting at every C in the plasmid,
 * which is not merely noisy but wrong. The same goes for MspJI (`CNNR`),
 * FspEI (`CC`) and their kin: 27 enzymes in REBASE 609. The line falls just
 * under CviJI's `RG^CY`, a real and genuinely frequent cutter, which is kept.
 */
export const MIN_SITE_BITS = 6;

const IUPAC_WIDTH: Readonly<Record<string, number>> = {
  A: 1,
  C: 1,
  G: 1,
  T: 1,
  R: 2,
  Y: 2,
  S: 2,
  W: 2,
  K: 2,
  M: 2,
  B: 3,
  D: 3,
  H: 3,
  V: 3,
  N: 4,
};

/** Bits of information in a site: 2 per fixed base, 0 for an N. */
export function siteBits(site: string): number {
  let bits = 0;
  for (const base of site) bits += 2 - Math.log2(IUPAC_WIDTH[base] ?? 4);
  return bits;
}

export class RebaseParseError extends Error {}

const RECORD = /^<1>(.*)$/gm;
const SUPPLIER_LINE = /^\s{4,}([A-Z])\s{2,}(\S.*?)\s*$/;

/**
 * Splits a field block into its `<n>` fields. `<8>` runs over several lines,
 * which we do not keep, so only the first line of each field is taken.
 */
function fields(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of block.split('\n')) {
    const m = /^<(\d)>(.*)$/.exec(line);
    if (m?.[1] !== undefined) out.set(m[1], (m[2] ?? '').trim());
  }
  return out;
}

/**
 * Turns REBASE's recognition-sequence notation into our site plus cut
 * offsets, which count from the first base of the site in top-strand
 * coordinates.
 *
 * - `G^AATTC` — the caret is the top-strand cut. The bottom strand is cut
 *   symmetrically, so `cutBottom = length - cutTop`. This holds for the
 *   degenerate palindromes too (`GGTNACC` cut `G^GTNACC` is 1 and 6).
 * - `GGTCTC(1/5)` — a Type IIS cut beyond the 3' end of the site:
 *   `length + 1` and `length + 5`. The numbers can be negative
 *   (`CAGGTACCC...(-12/-16)`), which cuts back inside the site.
 * - `(10/12)CGANNNNNNTGC(12/10)` — cuts on *both* sides. `Enzyme` carries
 *   one pair of offsets, so these are left out rather than half-read.
 * - Anything with a `?` in it has no determined cut and is left out.
 */
function readSite(
  raw: string,
): { site: string; cutTop: number; cutBottom: number } | keyof RebaseSkipped {
  const s = raw.trim().toUpperCase();
  if (s === '') return 'noSite';
  if (s.includes('?')) return 'cutUnknown';

  const lead = /^\((-?\d+)\/(-?\d+)\)/.exec(s);
  const trail = /\((-?\d+)\/(-?\d+)\)$/.exec(s);
  if (lead !== null && trail !== null) return 'doubleCutter';

  const site = s.replace(/^\(-?\d+\/-?\d+\)/, '').replace(/\(-?\d+\/-?\d+\)$/, '');
  const bare = site.replace(/\^/g, '');
  if (bare === '' || !/^[ACGTRYSWKMBDHVN]+$/.test(bare)) return 'noSite';

  if (trail !== null) {
    const top = Number(trail[1]);
    const bottom = Number(trail[2]);
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) return 'cutUnknown';
    return { site: bare, cutTop: bare.length + top, cutBottom: bare.length + bottom };
  }
  if (lead !== null) {
    const top = Number(lead[1]);
    const bottom = Number(lead[2]);
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) return 'cutUnknown';
    // A cut before the site: the offsets are how far upstream, so negative here.
    return { site: bare, cutTop: -top, cutBottom: -bottom };
  }
  const caret = site.indexOf('^');
  if (caret < 0) return 'cutUnknown';
  if (site.includes('^', caret + 1)) return 'cutUnknown';
  return { site: bare, cutTop: caret, cutBottom: bare.length - caret };
}

/** The supplier key in the header: four or more spaces, a letter, the name. */
function readSuppliers(header: string): RebaseSupplier[] {
  const start = header.indexOf('REBASE codes for commercial sources');
  if (start < 0) return [];
  const out: RebaseSupplier[] = [];
  for (const line of header.slice(start).split('\n')) {
    const m = SUPPLIER_LINE.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) {
      // Strip the "(5/23)" revision date REBASE appends to each supplier.
      out.push({ code: m[1], name: m[2].replace(/\s*\(\d+\/\d+\)\s*$/, '') });
    }
  }
  return out;
}

function commaList(raw: string): readonly string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/**
 * Reads a REBASE `withrefm` file. Throws only when the text is not that
 * format at all; a record it cannot make sense of is counted in `skipped`
 * and the rest are kept, because one malformed enzyme should not cost the
 * user the other fifteen hundred.
 */
export function parseRebaseWithRefM(text: string): RebaseImport {
  const body = text.replace(/\r\n?/g, '\n');
  const first = body.search(/^<1>/m);
  if (first < 0) {
    throw new RebaseParseError(
      'This does not look like a REBASE withrefm file: no <1> enzyme records in it.',
    );
  }
  const header = body.slice(0, first);
  const version = /REBASE version (\S+)/.exec(header)?.[1] ?? null;
  const released = /^Rich Roberts\s{2,}(\S.*?)\s*$/m.exec(header)?.[1] ?? null;

  const enzymes: Enzyme[] = [];
  const skipped = { cutUnknown: 0, doubleCutter: 0, noSite: 0, tooUnspecific: 0 };
  const seen = new Set<string>();

  const starts: number[] = [];
  RECORD.lastIndex = 0;
  for (let m = RECORD.exec(body); m !== null; m = RECORD.exec(body)) starts.push(m.index);

  for (let i = 0; i < starts.length; i++) {
    const block = body.slice(starts[i], starts[i + 1] ?? body.length);
    const f = fields(block);
    const name = f.get('1') ?? '';
    // "M." is a methyltransferase and "V." a Vsr-like mismatch enzyme:
    // neither belongs in a list of things that cut a plasmid.
    if (name === '' || name.startsWith('M.') || name.startsWith('V.')) continue;
    if (seen.has(name.toLowerCase())) continue;

    const read = readSite(f.get('3') ?? '');
    if (typeof read === 'string') {
      skipped[read]++;
      continue;
    }
    if (siteBits(read.site) < MIN_SITE_BITS) {
      skipped.tooUnspecific++;
      continue;
    }
    seen.add(name.toLowerCase());
    const suppliers = (f.get('7') ?? '').replace(/[^A-Za-z]/g, '').split('');
    const methylation = f.get('4') ?? '';
    const isoschizomers = commaList(f.get('2') ?? '');
    enzymes.push({
      name,
      site: read.site,
      cutTop: read.cutTop,
      cutBottom: read.cutBottom,
      palindromic: isPalindromicSite(read.site),
      ...(suppliers.length > 0 ? { suppliers } : {}),
      ...(isoschizomers.length > 0 ? { isoschizomers } : {}),
      ...(methylation !== '' ? { methylation } : {}),
    });
  }

  if (enzymes.length === 0) {
    throw new RebaseParseError('No enzymes with a known cut position were found in this file.');
  }
  enzymes.sort((a, b) => a.name.localeCompare(b.name));
  return { version, released, enzymes, suppliers: readSuppliers(header), skipped };
}
