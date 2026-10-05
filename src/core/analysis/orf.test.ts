import fc from 'fast-check';
import { type TranslationTable, isStartCodon, isStopCodon } from './codons';
import { reverseComplement } from '../sequence';
import { type Orf, findOrfs } from './orf';

// ATG + 4 codons + TAA = 18 bp, 5 codons
const ORF = 'ATGGCCATTGTAATGTAA';

describe('findOrfs', () => {
  it('finds forward ORFs above the size threshold and reports the first start', () => {
    const seq = `CC${ORF}CC`;
    const orfs = findOrfs(seq, 'linear', { minCodons: 3 });
    expect(orfs).toEqual([
      { range: { start: 2, end: 20 }, strand: 'forward', frame: 2, codons: 5 },
    ]);
    expect(findOrfs(seq, 'linear', { minCodons: 6 })).toEqual([]);
  });

  it('ends an ORF where the chosen genetic code says it does', () => {
    // ATG + 3 codons + TGA + ATG + 2 codons + TAA. TGA stops the reading
    // under the standard code and is tryptophan under table 2, so the same
    // bases are two short ORFs or one long one depending on the code.
    const seq = 'ATGGCCATTGTATGAATGCCCGGGTAA';
    expect(findOrfs(seq, 'linear', { minCodons: 3 })).toEqual([
      { range: { start: 0, end: 15 }, strand: 'forward', frame: 0, codons: 4 },
      { range: { start: 15, end: 27 }, strand: 'forward', frame: 0, codons: 3 },
    ]);
    expect(findOrfs(seq, 'linear', { minCodons: 3, table: 2 })).toEqual([
      { range: { start: 0, end: 27 }, strand: 'forward', frame: 0, codons: 8 },
    ]);
  });

  it('finds reverse-strand ORFs in forward coordinates', () => {
    const seq = `GG${reverseComplement(ORF)}G`;
    const orfs = findOrfs(seq, 'linear', { minCodons: 3 });
    expect(orfs).toEqual([
      { range: { start: 2, end: 20 }, strand: 'reverse', frame: 1, codons: 5 },
    ]);
  });

  it('finds ORFs spanning the origin of a circular sequence, once', () => {
    const wrapped = `${ORF.slice(10)}CCCCCCC${ORF.slice(0, 10)}`; // L = 25
    const circ = findOrfs(wrapped, 'circular', { minCodons: 3 });
    expect(circ).toEqual([
      { range: { start: 15, end: 33 }, strand: 'forward', frame: 0, codons: 5 },
    ]);
    expect(findOrfs(wrapped, 'linear', { minCodons: 3 })).toEqual([]);
    const rc = findOrfs(reverseComplement(wrapped), 'circular', { minCodons: 3 });
    expect(rc).toHaveLength(1);
    expect(rc[0]?.strand).toBe('reverse');
    expect(rc[0]?.range.end).toBe((rc[0]?.range.start ?? 0) + 18);
  });

  it('never reports an ORF longer than the molecule', () => {
    // ATG followed by codons and no stop in a 9-mer circle would loop forever otherwise.
    expect(findOrfs('ATGAAAGGG', 'circular', { minCodons: 1 })).toEqual([]);
  });

  it('can use alternative starts', () => {
    const seq = `GTGGCCATTGTAATGTAA`;
    expect(findOrfs(seq, 'linear', { minCodons: 3 })).toEqual([]);
    expect(findOrfs(seq, 'linear', { minCodons: 3, atgOnly: false, table: 11 })[0]?.range).toEqual({
      start: 0,
      end: 18,
    });
  });
  // #145: a start nested in an ORF across the origin, sharing its stop.
  it('reports a start nested in an ORF across the origin once, from the farther start', () => {
    // Frame 0 round the circle: ATG(12) CCC GCC ATG(3) CCC TAA(9). The ORF
    // from 12 runs through the origin to the stop at 9; the ATG at 3 is in it.
    const seq = 'GCCATGCCCTAAATGCCC';
    const fwd = findOrfs(seq, 'circular', { minCodons: 1 }).filter((o) => o.strand === 'forward');
    expect(fwd).toEqual([
      { range: { start: 12, end: 30 }, strand: 'forward', frame: 0, codons: 5 },
    ]);
    // On a line nothing comes round, and the ATG at 3 is the first start.
    expect(findOrfs(seq, 'linear', { minCodons: 1 }).filter((o) => o.strand === 'forward')).toEqual(
      [{ range: { start: 3, end: 12 }, strand: 'forward', frame: 0, codons: 2 }],
    );
    // The same on the reverse strand.
    const rev = findOrfs(reverseComplement(seq), 'circular', { minCodons: 1 }).filter(
      (o) => o.strand === 'reverse',
    );
    expect(rev.map((o) => o.codons)).toEqual([5]);
  });

  it('reports the audit case of #145 once: the nested ORF in another frame is not repeated', () => {
    // L = 316, so the reading changes frame as it crosses the origin: the ORF
    // from 273 (frame 0) ends at 504, which is 188, where the frame-2 start
    // at 122 also ends. Expected list from a brute-force walk with
    // Biopython 1.85's table 4 (.venv-oracle).
    const seq =
      'AGAGGGCGAGTGATAGCTCATACATAAACGATCTGACAATATCGATTCAGGTAAGCGCACATGAGGACTATTTTGGCCCGACACGTGAATGACTCCGG' +
      'CTAAACCGCTTTAGTCCCGTTCGAATGGCGCCGCATGATTTCCGACGCCCGCGTGCTAAGAGGCGCGAACCTAGCCTGTTAGCTACATAAGCCACCCGCC' +
      'TGTGCCATATTCCACAGCTGGGTTCGTCTAGCTTATAGAACTTCGTTAGTGTTCCCACACGAGGCCCCAAGTTCAATGAAGGTGGGGGTGCAAAATGTGAG' +
      'TTACTGTCTATGAGTAG';
    expect(seq).toHaveLength(316);
    const got = findOrfs(seq, 'circular', { minCodons: 4, table: 4 }).map(
      (o) => [o.range.start, o.range.end, o.strand, o.frame, o.codons] as const,
    );
    expect(got).toEqual([
      [60, 102, 'forward', 0, 13],
      [67, 337, 'reverse', 1, 89],
      [88, 112, 'forward', 1, 7],
      [98, 134, 'reverse', 2, 11],
      [132, 180, 'forward', 0, 15],
      [176, 206, 'reverse', 2, 9],
      [273, 504, 'forward', 0, 76],
      [292, 316, 'forward', 1, 7],
      [299, 341, 'reverse', 0, 13],
      [306, 378, 'reverse', 2, 23],
      [308, 332, 'forward', 2, 7],
    ]);
  });

  it('keeps a nested start when the first one would make the ORF longer than the molecule', () => {
    // L = 29: the ATG at 13 reads round the circle past itself before its
    // stop, so it is no ORF; the ATG at 22 shares that stop and fits. It was
    // lost while the scan held on to the first start.
    const seq = 'ACCCTAATTGCCCATGACTGTAATGGCGG';
    const fwd = findOrfs(seq, 'circular', { minCodons: 3 }).filter((o) => o.strand === 'forward');
    expect(fwd).toEqual([
      { range: { start: 22, end: 46 }, strand: 'forward', frame: 1, codons: 7 },
    ]);
  });

  it('matches a brute-force walk from every start on circles and lines', () => {
    // Each start walks to its in-frame stop (round a circle, at most the
    // molecule's length); of the starts sharing a stop the farthest is kept.
    const brute = (
      seq: string,
      circular: boolean,
      minCodons: number,
      table: TranslationTable,
    ): string[] => {
      const L = seq.length;
      const out: string[] = [];
      const strand = (text: string, name: 'forward' | 'reverse'): void => {
        const codon = (p: number): string =>
          circular ? [0, 1, 2].map((k) => text[(p + k) % L]).join('') : text.slice(p, p + 3);
        const byStop = new Map<number, [number, number]>();
        for (let p = 0; p < L && (circular || p + 3 <= L); p++) {
          if (codon(p) !== 'ATG') continue;
          for (let q = p + 3; q + 3 - p <= L && (circular || q + 3 <= L); q += 3) {
            if (!isStopCodon(codon(q), table)) continue;
            const key = (q + 3) % (circular ? L : Infinity);
            const had = byStop.get(key);
            if (!had || q + 3 - p > had[1] - had[0]) byStop.set(key, [p, q + 3]);
            break;
          }
        }
        for (const [p, e] of byStop.values()) {
          if ((e - p) / 3 - 1 < minCodons) continue;
          const s = name === 'forward' ? p : circular ? (((L - e) % L) + L) % L : L - e;
          out.push(`${s}-${s + e - p}-${name}`);
        }
      };
      strand(seq, 'forward');
      strand(reverseComplement(seq), 'reverse');
      return out.sort();
    };
    const key = (o: Orf): string => `${o.range.start}-${o.range.end}-${o.strand}`;
    fc.assert(
      fc.property(
        fc
          .array(fc.constantFrom('A', 'T', 'G', 'C', 'A', 'T'), {
            minLength: 6,
            maxLength: 120,
            size: 'max',
          })
          .map((bases) => bases.join('')),
        fc.boolean(),
        fc.integer({ min: 0, max: 8 }),
        fc.constantFrom<TranslationTable>(1, 2, 4, 11),
        (seq, circular, minCodons, table) => {
          const got = findOrfs(seq, circular ? 'circular' : 'linear', { minCodons, table });
          expect(got.map(key).sort()).toEqual(brute(seq, circular, minCodons, table));
          for (const o of got) {
            expect(o.range.end - o.range.start).toBeLessThanOrEqual(seq.length);
            expect(o.codons).toBe((o.range.end - o.range.start) / 3 - 1);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it('applies alternative starts the same way round the origin', () => {
    // Table 11: GTG(12) CCC GCC TTG(3) CCC TAA(9); the TTG start is nested.
    const seq = 'GCCTTGCCCTAAGTGCCC';
    const fwd = findOrfs(seq, 'circular', { minCodons: 1, table: 11, atgOnly: false }).filter(
      (o) => o.strand === 'forward',
    );
    expect(fwd.map((o) => o.range)).toEqual([{ start: 12, end: 30 }]);
    expect(isStartCodon('TTG', 11)).toBe(true);
  });
});
