/**
 * What is read off a multiple alignment (#207): its consensus, how
 * conserved each column is, the two text formats it is saved in, and the
 * two scores by which it is judged against another alignment.
 */

import {
  PROTEIN_CODES,
  CODES,
  encode,
  encodeProtein,
  proteinScoreTable,
  scoreTable,
} from './scoring';

type Alphabet = 'nucleotide' | 'protein';

/** `list[i]`, for an index known to be in range; throws rather than hand back undefined. */
export function at<T>(list: ArrayLike<T>, i: number): T {
  const v = list[i];
  if (v === undefined) throw new RangeError(`Index ${i} is outside 0 to ${list.length - 1}`);
  return v;
}

export interface ColumnSummary {
  /** The commonest letter of the column, or '-' where gaps are most of it. */
  readonly consensus: string;
  /** The share of the sequences with that letter, 0 to 1; gaps count against. */
  readonly conservation: number;
}

/** Per column: the consensus letter and its share of the sequences. */
export function summariseColumns(rows: readonly string[]): ColumnSummary[] {
  const n = rows.length;
  const columns = rows[0]?.length ?? 0;
  const out: ColumnSummary[] = [];
  for (let c = 0; c < columns; c++) {
    const counts = new Map<string, number>();
    let gaps = 0;
    for (const row of rows) {
      const ch = row.charAt(c);
      if (ch === '-') gaps++;
      else counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    let top = '-';
    let best = 0;
    for (const [ch, count] of counts) {
      if (count > best || (count === best && ch < top)) {
        best = count;
        top = ch;
      }
    }
    out.push({
      consensus: gaps * 2 > n || best === 0 ? '-' : top,
      conservation: n === 0 ? 0 : best / n,
    });
  }
  return out;
}

/**
 * Clustal's line under a block: `*` where every sequence has the same
 * letter, `:` (proteins) where every pair of letters scores above zero in
 * BLOSUM62, a space otherwise.
 */
export function conservationMarks(rows: readonly string[], alphabet: Alphabet): string {
  const columns = rows[0]?.length ?? 0;
  const table = alphabet === 'protein' ? proteinScoreTable(1) : null;
  let marks = '';
  for (let c = 0; c < columns; c++) {
    const letters = rows.map((r) => r.charAt(c));
    if (letters.includes('-')) {
      marks += ' ';
      continue;
    }
    const first = letters[0] ?? '';
    if (letters.every((l) => l === first)) {
      marks += '*';
      continue;
    }
    if (table === null) {
      marks += ' ';
      continue;
    }
    const codes = letters.map((l) => encodeProtein(l)[0] ?? 0);
    let strong = true;
    for (let i = 0; i < codes.length && strong; i++) {
      for (let j = i + 1; j < codes.length; j++) {
        if ((table[(codes[i] ?? 0) * PROTEIN_CODES + (codes[j] ?? 0)] ?? 0) <= 0) {
          strong = false;
          break;
        }
      }
    }
    marks += strong ? ':' : ' ';
  }
  return marks;
}

/** Names made unique and free of whitespace, which both formats need. */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw, i) => {
    const base = raw.trim().replace(/\s+/g, '_') || `sequence_${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  });
}

/** Aligned FASTA: every record the same length, gaps as '-', 60 columns a line. */
export function msaFasta(names: readonly string[], rows: readonly string[]): string {
  const width = 60;
  return rows
    .map((row, i) => {
      const lines: string[] = [];
      for (let p = 0; p < row.length; p += width) lines.push(row.slice(p, p + width));
      return `>${names[i] ?? `sequence_${i + 1}`}\n${lines.join('\n')}\n`;
    })
    .join('');
}

/** Clustal format (the ClustalW header, blocks of 60 columns, a conservation line under each). */
export function msaClustal(
  names: readonly string[],
  rows: readonly string[],
  alphabet: Alphabet,
): string {
  const width = 60;
  const labels = uniqueNames(names);
  const pad = Math.max(16, ...labels.map((l) => l.length)) + 2;
  const marks = conservationMarks(rows, alphabet);
  const columns = rows[0]?.length ?? 0;
  const blocks: string[] = [];
  for (let p = 0; p < columns; p += width) {
    const lines = rows.map((row, i) => {
      const seg = row.slice(p, p + width);
      const residues = seg.replace(/-/g, '').length;
      const before = row.slice(0, p).replace(/-/g, '').length;
      return `${(labels[i] ?? '').padEnd(pad)}${seg} ${before + residues}`;
    });
    lines.push(`${' '.repeat(pad)}${marks.slice(p, p + width)}`);
    blocks.push(lines.join('\n'));
  }
  return `CLUSTAL W (1.83) multiple sequence alignment\n\n\n${blocks.join('\n\n')}\n`;
}

/**
 * The sum of pairs: every pair of sequences, with the columns where both
 * have a gap dropped, scored by the substitution matrix (EDNAFULL or
 * BLOSUM62) and affine gaps (open scores the first position of a run,
 * extend the rest; a run touching either end of the pair pays extension
 * only). The same scheme scores every program's alignment of one set.
 */
export function sumOfPairs(
  rows: readonly string[],
  alphabet: Alphabet,
  gapOpen = alphabet === 'protein' ? -11 : -10,
  gapExtend = alphabet === 'protein' ? -1 : -0.5,
): number {
  const protein = alphabet === 'protein';
  const k = protein ? PROTEIN_CODES : CODES;
  const table = protein ? proteinScoreTable(1) : scoreTable(5, -4, true, 1);
  const code = rows.map((r) =>
    protein ? encodeProtein(r.replace(/-/g, 'A')) : encode(r.replace(/-/g, 'A')),
  );
  let total = 0;
  for (let a = 0; a < rows.length; a++) {
    for (let b = a + 1; b < rows.length; b++) {
      const ra = at(rows, a);
      const rb = at(rows, b);
      const cols: number[] = [];
      for (let c = 0; c < ra.length; c++) if (ra[c] !== '-' || rb[c] !== '-') cols.push(c);
      let inGap: 'a' | 'b' | null = null;
      let first = 0;
      let last = cols.length - 1;
      // End columns that are gaps in one of the two.
      const gapAt = (i: number): boolean =>
        ra.charAt(at(cols, i)) === '-' || rb.charAt(at(cols, i)) === '-';
      while (first <= last && gapAt(first)) first++;
      while (last >= first && gapAt(last)) last--;
      cols.forEach((c, idx) => {
        const ga = ra[c] === '-';
        const gb = rb[c] === '-';
        if (!ga && !gb) {
          inGap = null;
          total += table[(code[a]?.[c] ?? 0) * k + (code[b]?.[c] ?? 0)] ?? 0;
          return;
        }
        const which = ga ? 'a' : 'b';
        const terminal = idx < first || idx > last;
        total += inGap === which || terminal ? gapExtend : gapOpen;
        inGap = which;
      });
    }
  }
  return total;
}

/** The residue pairs an alignment puts in one column, as keys. */
export function alignedPairs(rows: readonly string[]): Set<string> {
  const pos = rows.map(() => 0);
  const out = new Set<string>();
  const columns = rows[0]?.length ?? 0;
  for (let c = 0; c < columns; c++) {
    const here: [number, number][] = [];
    rows.forEach((row, r) => {
      if (row.charAt(c) !== '-') {
        here.push([r, at(pos, r)]);
        pos[r] = at(pos, r) + 1;
      }
    });
    for (let x = 0; x < here.length; x++) {
      for (let y = x + 1; y < here.length; y++) {
        const [ra, pa] = at(here, x);
        const [rb, pb] = at(here, y);
        out.add(`${ra}:${pa}:${rb}:${pb}`);
      }
    }
  }
  return out;
}

/** The share of `reference`'s aligned residue pairs that `test` aligns too (BAliBASE's SP score). */
export function pairAccuracy(reference: readonly string[], test: readonly string[]): number {
  const want = alignedPairs(reference);
  if (want.size === 0) return 1;
  const got = alignedPairs(test);
  let hit = 0;
  for (const key of want) if (got.has(key)) hit++;
  return hit / want.size;
}
