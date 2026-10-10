import { type TranslationTable, DEFAULT_TABLE, IUPAC_SETS, STOP, translateCodon } from './codons';
import { type CodonUsageTable } from './codonUsageTables';
import { ALL_CODONS, codonChoices } from './codonUsage';
import { reverseComplement } from '../sequence';

/**
 * Back-translating a protein and recoding a CDS for a host (#209): each
 * residue gets a codon the host uses, within limits on restriction sites, GC
 * in a window and runs of one base. The aim is a gene a host reads well, not
 * the highest score: the Codon Adaptation Index is reported and never
 * maximised for its own sake, and a codon the host barely uses is kept out
 * unless nothing else clears a limit.
 *
 * Every result is translated back and compared with the protein it was made
 * for; a mismatch throws rather than returns.
 */

/** A recognition site to keep out, as `name` and the IUPAC `site`. */
export interface RecodeSite {
  readonly name: string;
  readonly site: string;
}

/** How codons are chosen before the limits are applied. */
export type RecodeStrategy = 'best' | 'proportional';

export interface RecodeOptions {
  readonly host: CodonUsageTable;
  readonly table?: TranslationTable;
  /** `best`: the host's commonest codon. `proportional`: the host's own mix, spread evenly along the gene. */
  readonly strategy?: RecodeStrategy;
  /** Sites to keep out of the gene, on both strands. */
  readonly avoid?: readonly RecodeSite[];
  /** Window for the GC limits, in bases (50). */
  readonly gcWindow?: number;
  /** Lowest GC fraction of any window (0.3); 0 for no limit. */
  readonly gcMin?: number;
  /** Highest GC fraction of any window (0.7); 1 for no limit. */
  readonly gcMax?: number;
  /** Longest run of one base (6); 0 for no limit. */
  readonly maxRun?: number;
  /** A codon the host uses for less than this share of its amino acid is kept out while anything else will do (0.1). */
  readonly minFraction?: number;
  /** Bases before the gene, so a site across its start is seen. */
  readonly prefix?: string;
  /** Bases after the gene. */
  readonly suffix?: string;
}

export const RECODE_DEFAULTS = {
  gcWindow: 50,
  gcMin: 0.3,
  gcMax: 0.7,
  maxRun: 6,
  minFraction: 0.1,
} as const;

/** What a codon position asks of the recoder: its residue, and the codon to keep if it must be kept. */
export interface CodonSlot {
  readonly aminoAcid: string;
  readonly fixed: string | null;
}

export type RecodeProblemKind = 'site' | 'gc' | 'run';

export interface RecodeProblem {
  readonly kind: RecodeProblemKind;
  /** First base, 0-based from the start of the gene. */
  readonly start: number;
  readonly end: number;
  /** What it is: the enzyme, the GC fraction, the base repeated. */
  readonly detail: string;
}

export interface RecodeResult {
  readonly codons: readonly string[];
  readonly dna: string;
  /** Codon Adaptation Index of the result under the host, 0–1. */
  readonly cai: number;
  /** Limits the result still breaks: none when the limits could all be met. */
  readonly unresolved: readonly RecodeProblem[];
  /** Codons the host uses for less than `minFraction` of their amino acid, taken to meet a limit. */
  readonly rareCodons: number;
}

interface Resolved {
  readonly host: CodonUsageTable;
  readonly table: TranslationTable;
  readonly strategy: RecodeStrategy;
  readonly gcWindow: number;
  readonly gcMin: number;
  readonly gcMax: number;
  readonly maxRun: number;
  readonly minFraction: number;
  readonly prefix: string;
  readonly suffix: string;
  readonly patterns: readonly SitePattern[];
}

interface SitePattern {
  readonly name: string;
  readonly length: number;
  readonly regex: RegExp;
}

function resolve(options: RecodeOptions): Resolved {
  return {
    host: options.host,
    table: options.table ?? DEFAULT_TABLE,
    strategy: options.strategy ?? 'best',
    gcWindow: Math.max(4, Math.floor(options.gcWindow ?? RECODE_DEFAULTS.gcWindow)),
    gcMin: options.gcMin ?? RECODE_DEFAULTS.gcMin,
    gcMax: options.gcMax ?? RECODE_DEFAULTS.gcMax,
    maxRun: options.maxRun ?? RECODE_DEFAULTS.maxRun,
    minFraction: options.minFraction ?? RECODE_DEFAULTS.minFraction,
    prefix: (options.prefix ?? '').toUpperCase(),
    suffix: (options.suffix ?? '').toUpperCase(),
    patterns: sitePatterns(options.avoid ?? []),
  };
}

function classOf(letter: string): string {
  const set = IUPAC_SETS[letter.toUpperCase()];
  if (set === undefined || set.length === 0) return letter.toUpperCase();
  return set.length === 1 ? set.join('') : `[${set.join('')}]`;
}

/** Overlapping matches too, hence the lookahead. */
function sitePatterns(sites: readonly RecodeSite[]): SitePattern[] {
  const out: SitePattern[] = [];
  for (const { name, site } of sites) {
    const forward = site.toUpperCase();
    if (forward === '') continue;
    const strands = new Set([forward, reverseComplement(forward)]);
    for (const strand of strands) {
      const body = Array.from(strand).map(classOf).join('');
      out.push({ name, length: strand.length, regex: new RegExp(`(?=(${body}))`, 'g') });
    }
  }
  return out;
}

/** The share of each codon in its amino acid's, over the host's best, per codon. */
function adaptiveness(host: CodonUsageTable, table: TranslationTable): Map<string, number> {
  const w = new Map<string, number>();
  const aminoAcids = new Set(ALL_CODONS.map((c) => translateCodon(c, table)));
  for (const aa of aminoAcids) {
    const choices = codonChoices(aa, host, '', table);
    const top = choices[0]?.fraction ?? 1;
    for (const c of choices) w.set(c.codon, top === 0 ? 1 : Math.max(c.fraction / top, 0.01));
  }
  return w;
}

/**
 * Codon Adaptation Index (Sharp and Li 1987) of `codons` under `host`: the
 * geometric mean of each codon's use relative to the host's favourite for
 * its amino acid. Methionine, tryptophan and stops have one choice and take
 * no part.
 */
export function codonAdaptationIndex(
  codons: readonly string[],
  host: CodonUsageTable,
  table: TranslationTable = DEFAULT_TABLE,
): number {
  const w = adaptiveness(host, table);
  let sum = 0;
  let n = 0;
  for (const codon of codons) {
    const aa = translateCodon(codon.toUpperCase(), table);
    if (aa === STOP || codonChoices(aa, host, '', table).length < 2) continue;
    sum += Math.log(w.get(codon.toUpperCase()) ?? 1);
    n++;
  }
  return n === 0 ? 1 : Math.exp(sum / n);
}

function gcCount(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 71 || c === 67) n++;
  }
  return n;
}

/**
 * Walks the limits a candidate breaks, `from` to `to` of the whole string,
 * handing each to `visit` with a weight (how far past the limit it is, so a
 * change that eases a problem counts as progress); `visit` returns true to
 * stop. Runs of one base, sites that touch the gene, GC windows lying inside
 * it (a gene shorter than the window is one window).
 */
function scan(
  dna: string,
  from: number,
  to: number,
  r: Resolved,
  visit: (
    kind: RecodeProblemKind,
    start: number,
    end: number,
    detail: string,
    weight: number,
  ) => boolean,
): void {
  if (r.maxRun > 0) {
    let i = from;
    while (i < to) {
      let j = i + 1;
      while (j < to && dna.charCodeAt(j) === dna.charCodeAt(i)) j++;
      if (j - i > r.maxRun && visit('run', i - from, j - from, dna.charAt(i), j - i - r.maxRun)) {
        return;
      }
      i = j;
    }
  }
  for (const p of r.patterns) {
    p.regex.lastIndex = 0;
    for (let m = p.regex.exec(dna); m !== null; m = p.regex.exec(dna)) {
      const at = m.index;
      p.regex.lastIndex = at + 1;
      if (
        at < to &&
        at + p.length > from &&
        visit('site', at - from, at + p.length - from, p.name, SITE_WEIGHT)
      ) {
        return;
      }
    }
  }
  const span = to - from;
  if ((r.gcMin > 0 || r.gcMax < 1) && span > 0) {
    const w = Math.min(r.gcWindow, span);
    let gc = gcCount(dna.slice(from, from + w));
    for (let s = from; s + w <= to; s++) {
      if (s > from) {
        if (isGc(dna, s - 1)) gc--;
        if (isGc(dna, s + w - 1)) gc++;
      }
      const over = Math.max(gc - r.gcMax * w, r.gcMin * w - gc);
      if (
        over > 1e-9 &&
        visit('gc', s - from, s + w - from, (gc / w).toFixed(2), Math.ceil(over - 1e-9))
      ) {
        return;
      }
    }
  }
}

/** A site is worth a few bases of run or GC excess: it is the one a gene order cannot live with. */
const SITE_WEIGHT = 4;

function findProblems(dna: string, from: number, to: number, r: Resolved): RecodeProblem[] {
  const out: RecodeProblem[] = [];
  scan(dna, from, to, r, (kind, start, end, detail) => {
    out.push({ kind, start, end, detail });
    return false;
  });
  return out;
}

function severity(dna: string, from: number, to: number, r: Resolved): number {
  let n = 0;
  scan(dna, from, to, r, (_k, _s, _e, _d, weight) => {
    n += weight;
    return false;
  });
  return n;
}

function isGc(s: string, i: number): boolean {
  const c = s.charCodeAt(i);
  return c === 71 || c === 67;
}

/** Overlapping GC windows are one problem: the stretch they cover, worst fraction. */
function mergeProblems(problems: readonly RecodeProblem[]): RecodeProblem[] {
  const out: RecodeProblem[] = [];
  for (const p of problems) {
    const last = out[out.length - 1];
    if (p.kind === 'gc' && last?.kind === 'gc' && p.start < last.end) {
      const worse = Math.abs(Number(p.detail) - 0.5) > Math.abs(Number(last.detail) - 0.5);
      out[out.length - 1] = {
        kind: 'gc',
        start: last.start,
        end: p.end,
        detail: worse ? p.detail : last.detail,
      };
    } else {
      out.push(p);
    }
  }
  return out;
}

const MAX_MOVES = 5000;

function check(slots: readonly CodonSlot[], codons: readonly string[], table: TranslationTable) {
  slots.forEach((slot, i) => {
    const codon = codons[i] ?? '';
    const ok =
      slot.fixed !== null
        ? codon === slot.fixed
        : codon.length === 3 && translateCodon(codon, table) === slot.aminoAcid;
    if (!ok) {
      throw new Error(
        `Recoding would change residue ${i + 1} (${slot.aminoAcid}); nothing changed`,
      );
    }
  });
  if (codons.length !== slots.length) throw new Error('Recoding changed the length of the protein');
}

/**
 * Chooses a codon for every slot. A slot with a `fixed` codon keeps it (a
 * start or stop codon to leave alone); the rest take the host's choice, then
 * are moved codon by codon to clear the limits, preferring codons the host
 * uses. Throws if a residue has no codon in the genetic code.
 */
export function recodeSlots(slots: readonly CodonSlot[], options: RecodeOptions): RecodeResult {
  const r = resolve(options);
  // The host's codons for each amino acid, favourite first, those it uses enough ahead.
  const menu = new Map<string, { codon: string; fraction: number }[]>();
  const choicesFor = (aa: string): { codon: string; fraction: number }[] => {
    let c = menu.get(aa);
    if (c === undefined) {
      c = codonChoices(aa, r.host, '', r.table).map(({ codon, fraction }) => ({
        codon,
        fraction,
      }));
      menu.set(aa, c);
    }
    return c;
  };

  const codons: string[] = [];
  const used = new Map<string, Map<string, number>>();
  slots.forEach((slot, i) => {
    if (slot.fixed !== null) {
      codons.push(slot.fixed.toUpperCase());
      return;
    }
    const choices = choicesFor(slot.aminoAcid);
    if (choices.length === 0) throw new Error(`No codon for ${slot.aminoAcid} at residue ${i + 1}`);
    const usable = choices.filter((c) => c.fraction >= r.minFraction);
    const pool = usable.length > 0 ? usable : choices;
    if (r.strategy === 'best' || pool.length === 1) {
      codons.push(pool[0]?.codon ?? '');
      return;
    }
    // The host's own mix, spread along the gene: the codon furthest behind its share.
    let counts = used.get(slot.aminoAcid);
    if (counts === undefined) {
      counts = new Map();
      used.set(slot.aminoAcid, counts);
    }
    const total = pool.reduce((n, c) => n + c.fraction, 0);
    let seen = 0;
    for (const n of counts.values()) seen += n;
    let best = pool[0];
    let bestGap = -Infinity;
    for (const c of pool) {
      const gap = (c.fraction / total) * (seen + 1) - (counts.get(c.codon) ?? 0);
      if (gap > bestGap) {
        bestGap = gap;
        best = c;
      }
    }
    const chosen = best?.codon ?? '';
    counts.set(chosen, (counts.get(chosen) ?? 0) + 1);
    codons.push(chosen);
  });

  // Repair: the first limit broken is worked on by changing codons under it,
  // taking whichever change eases the limits most and loses the host least.
  const geneStart = r.prefix.length;
  const build = (cs: readonly string[]): string => r.prefix + cs.join('') + r.suffix;
  const geneEnd = (cs: readonly string[]): number => geneStart + cs.length * 3;
  const score = (cs: readonly string[]): number => severity(build(cs), geneStart, geneEnd(cs), r);
  const unlimited = r.patterns.length === 0 && r.maxRun === 0 && r.gcMin <= 0 && r.gcMax >= 1;

  if (!unlimited) {
    for (const allowRare of [false, true]) {
      let current = score(codons);
      // Where a problem could not be eased, so that and what overlaps it is left alone until something changes.
      let stuck: { kind: RecodeProblemKind; start: number; end: number }[] = [];
      for (let move = 0; move < MAX_MOVES && current > 0; move++) {
        let found: RecodeProblem | undefined;
        scan(build(codons), geneStart, geneEnd(codons), r, (kind, start, end, detail) => {
          if (stuck.some((s) => s.kind === kind && start < s.end && end > s.start)) return false;
          found = { kind, start, end, detail };
          return true;
        });
        if (found === undefined) break;
        const problem: RecodeProblem = found;
        const lo = Math.max(0, Math.floor(problem.start / 3));
        const hi = Math.min(codons.length - 1, Math.floor((problem.end - 1) / 3));
        let bestScore = current;
        let bestAt = -1;
        let bestCodon = '';
        let bestFraction = -1;
        for (let i = lo; i <= hi; i++) {
          const slot = slots[i];
          if (slot?.fixed !== null) continue;
          const before = codons[i] ?? '';
          for (const c of choicesFor(slot.aminoAcid)) {
            if (c.codon === before || (!allowRare && c.fraction < r.minFraction)) continue;
            codons[i] = c.codon;
            const s = score(codons);
            codons[i] = before;
            const better =
              s < bestScore || (s === bestScore && bestAt >= 0 && c.fraction > bestFraction);
            if (better) {
              bestScore = s;
              bestAt = i;
              bestCodon = c.codon;
              bestFraction = c.fraction;
            }
          }
        }
        if (bestAt < 0) {
          stuck.push({ kind: problem.kind, start: problem.start, end: problem.end });
          continue;
        }
        codons[bestAt] = bestCodon;
        current = bestScore;
        stuck = [];
      }
      if (current === 0) break;
    }
  }

  check(slots, codons, r.table);
  const dna = codons.join('');
  const unresolved = unlimited
    ? []
    : mergeProblems(findProblems(build(codons), geneStart, geneEnd(codons), r));
  let rareCodons = 0;
  slots.forEach((slot, i) => {
    if (slot.fixed !== null) return;
    const choice = choicesFor(slot.aminoAcid).find((c) => c.codon === codons[i]);
    if (choice !== undefined && choice.fraction < r.minFraction) rareCodons++;
  });
  return {
    codons,
    dna,
    cai: codonAdaptationIndex(codons, r.host, r.table),
    unresolved,
    rareCodons,
  };
}

/**
 * DNA for a protein: a codon for each residue under `options`. A final `*`
 * becomes the stop the host's genes use. Residues the genetic code has no
 * codon for (X, B, Z) throw.
 */
export function backTranslate(protein: string, options: RecodeOptions): RecodeResult {
  const slots = Array.from(protein.toUpperCase()).map((aminoAcid): CodonSlot => ({
    aminoAcid,
    fixed: null,
  }));
  return recodeSlots(slots, options);
}
