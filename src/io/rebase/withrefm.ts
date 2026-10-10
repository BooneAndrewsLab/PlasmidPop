import { type CutOffsets, type Enzyme, isPalindromicSite } from '@/core';

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
  /**
   * Sentences for the user about records read differently from how they are
   * written, or left out because this reader no longer knows how to read
   * them (#150). Empty for an ordinary file.
   */
  readonly warnings: readonly string[];
}

export interface RebaseSkipped {
  /** A site is given but nobody has determined where it cuts. */
  readonly cutUnknown: number;
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
 * - `(10/12)CGANNNNNNTGC(12/10)` — cuts on *both* sides: `-10`/`-12`
 *   before the site, and `secondCut` `length + 12`/`length + 10` after it.
 * - Anything with a `?` in it has no determined cut and is left out.
 */
/**
 * Bottom-strand cuts that an N-padded caret does not determine, by enzyme,
 * with the notation REBASE wrote when the cut was checked. The caret marks
 * the top-strand cut only. For TspRI and TscAI `CASTGNN^` the bottom cut is
 * the mirror image (-2), but HauII `TGGCCANNNNNNNNNNN^` is TGGCCA(11/9), a
 * 2-nt 3' overhang at +17/+15, not a 28-nt one at +17/-11. REBASE's enzyme
 * pages, its `emboss_e` export and Biopython agree on all three. Against
 * `emboss_e.610`, of the 711 enzymes both files cut, HauII was the only one
 * the mirror got wrong.
 *
 * An entry holds only while REBASE writes the notation it names. A padded
 * caret that is not listed here, or whose notation has changed, has no
 * bottom cut we know, so it is left out with a warning rather than given a
 * guessed one (#150; docs/design/07-rebase-enzymes.md).
 */
const PADDED_CARET_BOTTOM: ReadonlyMap<string, { notation: string; cutBottom: number }> = new Map([
  ['HAUII', { notation: 'TGGCCANNNNNNNNNNN^', cutBottom: 15 }],
  ['TSCAI', { notation: 'CASTGNN^', cutBottom: -2 }],
  ['TSPRI', { notation: 'CASTGNN^', cutBottom: -2 }],
]);

/** What `readSite` makes of a record, and anything the user should be told. */
export type ReadSite =
  | {
      site: string;
      cutTop: number;
      cutBottom: number;
      secondCut?: CutOffsets;
      warning?: string;
    }
  | { skip: keyof RebaseSkipped; warning?: string };

export function readSite(raw: string, name = ''): ReadSite {
  const s = raw.trim().toUpperCase();
  const known = PADDED_CARET_BOTTOM.get(name.toUpperCase());
  const read = readNotation(s, name, known);
  // A listed enzyme REBASE now writes some other way: the entry was checked
  // against the old notation only, so it is not applied, and saying so lets
  // someone notice the table here needs another look.
  if (known !== undefined && known.notation !== s && read.warning === undefined) {
    return {
      ...read,
      warning:
        'skip' in read
          ? `${name}: REBASE now writes ${s}, not ${known.notation}; left out.`
          : `${name}: REBASE now writes ${s}, not ${known.notation}; cut read as written.`,
    };
  }
  return read;
}

/** Where `mark` sits among the bases of `site`, ignoring the other cut mark. */
function markAt(site: string, mark: '^' | '_'): number | 'none' | 'many' {
  let at = -1;
  let bases = 0;
  for (const c of site) {
    if (c === '^' || c === '_') {
      if (c !== mark) continue;
      if (at >= 0) return 'many';
      at = bases;
    } else bases++;
  }
  return at < 0 ? 'none' : at;
}

function readNotation(
  s: string,
  name: string,
  known: { notation: string; cutBottom: number } | undefined,
): ReadSite {
  if (s === '') return { skip: 'noSite' };
  if (s.includes('?')) return { skip: 'cutUnknown' };

  const lead = /^\((-?\d+)\/(-?\d+)\)/.exec(s);
  const trail = /\((-?\d+)\/(-?\d+)\)$/.exec(s);

  const site = s.replace(/^\(-?\d+\/-?\d+\)/, '').replace(/\(-?\d+\/-?\d+\)$/, '');
  const bare = site.replace(/[\^_]/g, '');
  if (bare === '' || !/^[ACGTRYSWKMBDHVN]+$/.test(bare)) return { skip: 'noSite' };

  if (lead !== null && trail !== null) {
    const offsets = [lead[1], lead[2], trail[1], trail[2]].map(Number);
    const [a = NaN, b = NaN, c = NaN, d = NaN] = offsets;
    if (!offsets.every(Number.isFinite)) return { skip: 'cutUnknown' };
    return {
      site: bare,
      cutTop: -a,
      cutBottom: -b,
      secondCut: { cutTop: bare.length + c, cutBottom: bare.length + d },
    };
  }
  if (trail !== null) {
    const top = Number(trail[1]);
    const bottom = Number(trail[2]);
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) return { skip: 'cutUnknown' };
    return { site: bare, cutTop: bare.length + top, cutBottom: bare.length + bottom };
  }
  if (lead !== null) {
    const top = Number(lead[1]);
    const bottom = Number(lead[2]);
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) return { skip: 'cutUnknown' };
    // A cut before the site: the offsets are how far upstream, so negative here.
    return { site: bare, cutTop: -top, cutBottom: -bottom };
  }
  // `_` writes the bottom-strand cut out (`G^AATT_C`). REBASE's own files
  // never use it, but the custom-enzyme dialog accepts it (#217), and it
  // goes through this reader so both read the notation alike.
  const marks = { '^': markAt(site, '^'), _: markAt(site, '_') };
  if (marks['^'] === 'many' || marks._ === 'many') return { skip: 'cutUnknown' };
  const caret = marks['^'];
  const under = marks._;
  if (caret === 'none') return { skip: 'cutUnknown' };
  // N padding is not part of the site: REBASE writes `CASTGNN^` for a site
  // CASTG cut two bases past its end. Keeping the padding would make the
  // site non-palindromic and add a second cut on the other strand. Where the
  // bottom strand is cut is not in the notation; `PADDED_CARET_BOTTOM` says
  // for the enzymes checked, and anything else is left out.
  const padL = /^N*/.exec(bare)?.[0].length ?? 0;
  const padR = /N*$/.exec(bare)?.[0].length ?? 0;
  if (padL + padR < bare.length && padL + padR > 0) {
    const core = bare.slice(padL, bare.length - padR);
    const top = caret - padL;
    if (under !== 'none') return { site: core, cutTop: top, cutBottom: under - padL };
    if (known?.notation === s) return { site: core, cutTop: top, cutBottom: known.cutBottom };
    // Left out anyway, so not worth a warning: SgeI `CNNGNNNNNNNNN^`, whose
    // bottom cut is +17 and not the mirrored -9.
    if (siteBits(core) < MIN_SITE_BITS) return { skip: 'tooUnspecific' };
    return {
      skip: 'cutUnknown',
      warning:
        known === undefined
          ? `${name}: ${s} gives only the top-strand cut; left out.`
          : `${name}: REBASE now writes ${s}, not ${known.notation} as when its bottom-strand cut was checked; left out rather than given a guessed cut.`,
    };
  }
  if (under !== 'none') return { site: bare, cutTop: caret, cutBottom: under };
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
  const skipped = { cutUnknown: 0, noSite: 0, tooUnspecific: 0 };
  const warnings: string[] = [];
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

    const read = readSite(f.get('3') ?? '', name);
    if (read.warning !== undefined) warnings.push(read.warning);
    if ('skip' in read) {
      skipped[read.skip]++;
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
      ...(read.secondCut !== undefined ? { secondCut: read.secondCut } : {}),
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
  return { version, released, enzymes, suppliers: readSuppliers(header), skipped, warnings };
}
