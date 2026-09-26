import { reverseComplement } from '../sequence';

/**
 * Measured ligation fidelity (#68): how often a ligase joins one overhang to
 * another, from a published end-joining table the user brings.
 *
 * The Golden Gate panel's warnings are design rules — palindromes, pairs one
 * base apart, ambiguity codes — and a rule cannot say how much of the
 * reaction goes wrong. A profiling experiment can: it counts, for every pair
 * of overhangs, how often T4 DNA ligase joined them, so a set of junctions
 * can be scored before it is ordered.
 *
 * The data is not bundled. The tables people use are published as a paper's
 * supporting information and through their makers' own tools, under terms
 * that do not let this project redistribute them (decided 2026-09-25; see
 * `docs/design/03-simulated-cloning.md`), so the app reads a copy the user
 * has got for themselves, as it does for REBASE enzymes (item 7).
 *
 * The file is the usual square matrix: a header row of overhangs, then a row
 * per overhang, each cell the number of times the row's overhang was seen
 * joined to the column's. The correct, Watson-Crick partner of an overhang
 * is its reverse complement, which is where the big counts sit.
 */

export interface FidelityTable {
  /** What to call it, from the file name. */
  readonly label: string;
  readonly fileName: string | null;
  /** Length of the overhangs it covers: 4 for BsaI, 3 for SapI. */
  readonly overhangLength: number;
  /** `counts.get(a)?.get(b)`: times `a` was joined to `b`. */
  readonly counts: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

export interface FidelityParseResult {
  readonly table: FidelityTable;
  /** Overhangs the file covers. */
  readonly overhangs: number;
  /** Ligation events counted, which says whether it is the whole table. */
  readonly events: number;
}

const OVERHANG = /^[ACGT]+$/;

/** Splits a line of a comma- or tab-separated file; quotes are not used in these. */
function cells(line: string): string[] {
  return line.split(line.includes('\t') && !line.includes(',') ? '\t' : ',').map((c) => c.trim());
}

/**
 * Reads a ligation-fidelity matrix. Throws with a sentence a user can act on
 * when the file is not one: this is fed by a file picker, so the common case
 * is the wrong file rather than a broken one.
 */
export function parseFidelityCsv(
  text: string,
  fileName: string | null = null,
): FidelityParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = lines[0] === undefined ? [] : cells(lines[0]);
  // The corner cell names the row labels ("Overhang"), and is not an overhang.
  const columns = header.slice(1).map((c) => c.toUpperCase());
  const length = columns[0]?.length ?? 0;
  if (columns.length === 0 || !columns.every((c) => OVERHANG.test(c) && c.length === length)) {
    throw new Error(
      'This is not a ligation fidelity table: its first row should list the overhangs, one per column.',
    );
  }
  if (new Set(columns).size !== columns.length) {
    throw new Error('The table lists the same overhang in two columns.');
  }
  const counts = new Map<string, Map<string, number>>();
  for (const line of lines.slice(1)) {
    const row = cells(line);
    const label = (row[0] ?? '').toUpperCase();
    if (!OVERHANG.test(label) || label.length !== length) {
      throw new Error(`"${row[0] ?? ''}" is not an overhang of ${length} bases.`);
    }
    if (counts.has(label)) throw new Error(`The table has two rows for ${label}.`);
    const values = new Map<string, number>();
    for (const [i, column] of columns.entries()) {
      const n = Number(row[i + 1]);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`${label} × ${column} is not a count.`);
      }
      if (n > 0) values.set(column, n);
    }
    counts.set(label, values);
  }
  if (counts.size !== columns.length) {
    throw new Error(
      `The table has ${counts.size.toLocaleString()} rows for ${columns.length.toLocaleString()} columns; it should be square.`,
    );
  }
  // A pair stands in both of its cells, so the events are the unordered
  // pairs: counting every cell would count each ligation twice.
  const seen: FidelityTable = { label: '', fileName, overhangLength: length, counts };
  let events = 0;
  for (const [i, a] of columns.entries()) {
    for (const b of columns.slice(i)) events += joined(seen, a, b);
  }
  if (events === 0) throw new Error('The table counts no ligation at all.');
  return {
    table: {
      label: fileName?.replace(/\.[^.]+$/, '') ?? 'Imported table',
      fileName,
      overhangLength: length,
      counts,
    },
    overhangs: counts.size,
    events,
  };
}

/**
 * Times `a` was joined to `b`. The published tables are symmetric — a pair
 * is counted in both of its cells, since which of the two ends is "the" one
 * has no meaning — so the two are the same number and either will do. The
 * larger is taken so that a file giving only one half of the matrix reads
 * the same as a full one.
 */
function joined(table: FidelityTable, a: string, b: string): number {
  return Math.max(table.counts.get(a)?.get(b) ?? 0, table.counts.get(b)?.get(a) ?? 0);
}

/** One junction of the set, and how much of its ligation goes to the right place. */
export interface JunctionFidelity {
  readonly overhang: string;
  /** Joins to its own partner. */
  readonly onTarget: number;
  /** Joins to an end of another junction, or to itself. */
  readonly offTarget: number;
  /** `onTarget / (onTarget + offTarget)`, 1 when nothing was counted. */
  readonly fidelity: number;
}

/** A pair that gets joined when it should not, and how often, as a share of the ligations of `a`. */
export interface Misligation {
  readonly a: string;
  readonly b: string;
  /** Of everything `a` joined to, this share went to `b`. */
  readonly rate: number;
}

export interface SetFidelity {
  /**
   * The share of assemblies that come out right, if each junction is
   * independent: the junctions' fidelities multiplied. This is what the
   * published calculators report for a set of overhangs.
   */
  readonly fidelity: number;
  readonly junctions: readonly JunctionFidelity[];
  /** The mis-joins that cost the most, worst first. */
  readonly worst: readonly Misligation[];
  /** Overhangs the table does not cover (a different length, or an ambiguity code). */
  readonly unknown: readonly string[];
}

/**
 * Scores a set of junction overhangs against a measured table.
 *
 * Each junction of an assembly is designed as one overhang; the tube holds
 * that overhang and its reverse complement, one on each of the two fragments
 * it joins. A ligase can join either of those two ends to either end of any
 * other junction, or to another copy of itself — which is what a palindromic
 * overhang makes possible. So a junction's own join is the one between its
 * two ends, and every other join the table counts between one of its ends
 * and an end in the tube is a misligation of that junction.
 *
 * A mis-join between two junctions is charged to both, since it spoils
 * either way round; `fidelity` is therefore what the published calculators
 * report for a set — the junctions' shares multiplied — rather than a
 * probability worked out from first principles.
 */
export function setFidelity(overhangs: readonly string[], table: FidelityTable): SetFidelity {
  const set = overhangs.map((o) => o.toUpperCase());
  const known = set.filter(
    (o) => o.length === table.overhangLength && table.counts.has(o) && OVERHANG.test(o),
  );
  const unknown = [...new Set(set.filter((o) => !known.includes(o)))];
  // Every end in the tube: each junction's overhang and its partner.
  const ends = [...new Set(known.flatMap((o) => [o, reverseComplement(o)]))];
  const junctions: JunctionFidelity[] = [];
  const worst: Misligation[] = [];
  const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const overhang of known) {
    const partner = reverseComplement(overhang);
    const own = pairKey(overhang, partner);
    const onTarget = joined(table, overhang, partner);
    let offTarget = 0;
    const mistakes: Misligation[] = [];
    const counted = new Set<string>();
    for (const end of [overhang, partner]) {
      for (const other of ends) {
        const key = pairKey(end, other);
        // The junction's own join, and any pair already weighed: a
        // palindrome has one end, so both loops see the same pairs.
        if (key === own || counted.has(key)) continue;
        counted.add(key);
        const n = joined(table, end, other);
        if (n === 0) continue;
        offTarget += n;
        mistakes.push({ a: end, b: other, rate: n });
      }
    }
    const total = onTarget + offTarget;
    junctions.push({
      overhang,
      onTarget,
      offTarget,
      fidelity: total === 0 ? 1 : onTarget / total,
    });
    // A rate is of everything this junction's ends joined to, so junctions
    // the experiment saw very different numbers of times can be compared.
    if (total > 0) for (const m of mistakes) worst.push({ ...m, rate: m.rate / total });
  }
  worst.sort((a, b) => b.rate - a.rate || a.a.localeCompare(b.a) || a.b.localeCompare(b.b));
  return {
    fidelity: junctions.reduce((p, j) => p * j.fidelity, 1),
    junctions,
    worst,
    unknown,
  };
}

/** "98 %", or "99.4 %" where rounding to a whole number would say 99 %. */
export function formatFidelity(fidelity: number): string {
  const percent = fidelity * 100;
  if (percent >= 99.5 && percent < 100) return `${percent.toFixed(1)} %`;
  return `${percent.toFixed(percent < 10 ? 1 : 0)} %`;
}
