import { writeFileSync } from 'node:fs';

import { beforeAll, describe, expect, it } from 'vitest';

import { detectFeatures, overlapLength } from '@/core/annotate/detect';
import { loadFeatureLibrary } from '@/core/annotate/library';
import { nameOfHit } from '@/core/annotate/variant';

import {
  type Comparison,
  ORACLE_ERRORS,
  PART_CLASSES,
  type PartClass,
  compare,
  report,
  vectors,
  versions,
} from './plannotateCompare';

/**
 * Detect features against pLannotate (#220, docs/design/59-detect-features.md).
 * scripts/plannotate/ fetches 83 vectors from NCBI, strips them to bare
 * sequence and has pLannotate annotate them; plannotate.json is what it
 * reported. This test runs Detect features on the same sequences and asserts
 * that recall, per part class, does not fall below what was measured when the
 * baseline was set. pLannotate is never run here, and CI reads only the JSON.
 *
 * A recall counts a pLannotate hit (a whole feature, not one of its
 * fragments) as found when a hit of ours on the same strand (any strand, for
 * an origin) shares half of the shorter. After a change that raises recall,
 * raise the baseline to the new numbers; to see the tables, run with
 * PLANNOTATE_REPORT=/some/file.md.
 */

/** Least recall per class, the measured recall rounded down. */
const BASELINE: Record<PartClass, number> = {
  origin: 0.97,
  marker: 0.938,
  promoter: 0.913,
  tag: 0.916,
  FP: 0.906,
  terminator: 0.902,
  RNA: 0.916,
  other: 0.778,
};
const BASELINE_ALL = 0.88;

describe('Detect features against pLannotate', () => {
  let result: Comparison;
  beforeAll(async () => {
    result = compare(await loadFeatureLibrary());
    const path = process.env['PLANNOTATE_REPORT'];
    if (path !== undefined) writeFileSync(path, report(result));
  }, 120_000);

  it('records which pLannotate and databases made the expectations', () => {
    expect(versions.plannotate).toMatch(/^pLannotate \d/);
    expect(Object.keys(versions.databases)).toEqual(
      expect.arrayContaining(['snapgene', 'fpbase', 'swissprot', 'Rfam']),
    );
  });

  it('covers a corpus of at least 50 vectors, with no annotation left in', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(50);
    for (const v of vectors) {
      expect(v.sequence).toHaveLength(v.length);
      expect(v.sequence).toMatch(/^[ACGTN]+$/);
    }
  });

  it.each(PART_CLASSES)('recall of %s parts does not fall below the baseline', (cls) => {
    expect(result.total[cls]).toBeGreaterThan(0);
    expect(result.found[cls] / result.total[cls]).toBeGreaterThanOrEqual(BASELINE[cls]);
  });

  it('recall over all pLannotate hits does not fall below the baseline', () => {
    const all = PART_CLASSES.reduce((n, c) => n + result.total[c], 0);
    const found = PART_CLASSES.reduce((n, c) => n + result.found[c], 0);
    expect(found / all).toBeGreaterThanOrEqual(BASELINE_ALL);
  });

  it('names no part differently from pLannotate where both know the part, but for the known cases', () => {
    // Each entry is a call of ours (left) on bases pLannotate calls the part
    // of ours on the right. The bundled "CMV promoter" was the chicken
    // beta-actin promoter of CAG (#279), and this list is what would have
    // caught it. f1/M13 and TetR/rtTA are variants told apart by a few
    // bases (#284); pLannotate calls pBR322's tet gene tetA and the SV40
    // origin, short in AF239250, the SV40 promoter.
    const known = new Set([
      'J01749.1: TcR / TetA (Tn10)',
      'AF239250.1: SV40 ori / SV40 promoter',
      'U89930.1: TetR (Tn10) / rtTA (Tet-On 3G)',
    ]);
    const found = result.nameConflicts.map((c) => `${c.accession}: ${c.part} / ${c.theirs}`);
    expect(found.filter((c) => !known.has(c))).toEqual([]);
  });

  it('puts no part on the other strand from pLannotate where both call it, but for the known cases', () => {
    // Each entry is a call of ours on the strand given, on bases pLannotate
    // calls the same part on the other strand. The bundled CaMV poly(A)
    // signal was stored antisense (#287), and this list is what would have
    // caught it. The Tn7 ends have no direction to work in: ours read as in
    // AY599231, SnapGene draws them the other way.
    const known = new Set(['MK161519.1: Tn7R forward', 'MK161519.1: Tn7L forward']);
    const found = result.strandConflicts.map((c) => `${c.accession}: ${c.part} ${c.ours}`);
    expect(found.filter((c) => !known.has(c))).toEqual([]);
  });

  it('calls the CaMV poly(A) signal of pCAMBIA on the strand of the gene it ends (#287)', async () => {
    const lib = await loadFeatureLibrary();
    const v = vectors.find((x) => x.accession === 'OR797711.1');
    if (v === undefined) throw new Error('OR797711.1');
    const calls = detectFeatures(v.sequence, 'circular', lib)
      .filter((h) => lib.parts[h.part]?.name === 'CaMV poly(A) signal')
      .map((h) => `${h.range.start + 1}..${h.range.end} ${h.strand}`);
    // The hygromycin gene it ends, and pLannotate's call, are both reverse.
    expect(calls).toEqual(['8717..8925 reverse']);
    expect(v.hits.find((h) => h.name === 'CaMV poly(A) signal')?.strand).toBe(-1);
  });

  it('calls the lacI promoter lacIq only where it carries the Iq base (#283)', async () => {
    // pLannotate calls the 78 bp lacI promoter on the pET/Duet vectors and
    // the lacIq promoter, one base apart, on pTrc99A and the pGEX vectors.
    // The part bundled as lacIq used to be the last 35 bp, which both share.
    const lib = await loadFeatureLibrary();
    const lacI = new Set(['lacI promoter', "lacI promoter (3' end)", 'lacIq promoter']);
    let seen = 0;
    for (const v of vectors) {
      const theirs = v.hits.filter((h) => lacI.has(h.name));
      if (theirs.length === 0) continue;
      const topology = v.topology === 'circular' ? 'circular' : 'linear';
      const ours = detectFeatures(v.sequence, topology, lib)
        .filter((h) => lacI.has(lib.parts[h.part]?.name ?? ''))
        .map((h) => `${lib.parts[h.part]?.name} ${h.range.start}..${h.range.end}`);
      expect(ours, v.accession).toEqual(theirs.map((h) => `${h.name} ${h.start}..${h.end}`));
      seen += theirs.length;
    }
    expect(seen).toBe(13);
  });

  it('calls one LTR per copy, named without a 5′ claim the bases cannot make (#286)', async () => {
    // The R-U5 end of an HIV-1 LTR is the same in both copies, so it used to
    // be drawn on top of a whole LTR call of ours, and under a 5' name on
    // the downstream copy. It is a `fragment` part now, and the whole-LTR
    // part no longer says which copy it is.
    const lib = await loadFeatureLibrary();
    const ltrs = (accession: string): string[] => {
      const v = vectors.find((x) => x.accession === accession);
      if (v === undefined) throw new Error(accession);
      const topology = v.topology === 'circular' ? 'circular' : 'linear';
      return detectFeatures(v.sequence, topology, lib)
        .filter((h) => lib.parts[h.part]?.type === 'LTR')
        .map((h) => `${lib.parts[h.part]?.name} ${h.range.start + 1}..${h.range.end}`);
    };
    // Both copies whole: one call each, neither named for a copy.
    expect(ltrs('PX139668.1')).toEqual(['HIV-1 LTR 1..634', 'HIV-1 LTR 4638..5271']);
    expect(ltrs('MH325104.1')).toEqual(['HIV-1 LTR 1..634', 'HIV-1 LTR 5254..5887']);
    // A ΔU3 LTR downstream (its deletion says so) and R-U5 alone upstream,
    // where the hybrid RSV promoter has taken U3's place.
    for (const accession of ['OQ427862.1', 'OQ427864.1']) {
      expect(ltrs(accession), accession).toEqual([
        "HIV-1 3' dLTR 1293..1526",
        'HIV-1 LTR (R-U5) 5002..5182',
      ]);
    }
    // Both copies cut back to R-U5: two calls, neither claiming a copy.
    expect(ltrs('EF177827.1')).toEqual([
      'HIV-1 LTR (R-U5) 835..1015',
      'HIV-1 LTR (R-U5) 4733..4913',
    ]);
    // Corpus-wide: no fragment part is offered inside a longer LTR call.
    for (const v of vectors) {
      const topology = v.topology === 'circular' ? 'circular' : 'linear';
      const hits = detectFeatures(v.sequence, topology, lib).filter(
        (h) => lib.parts[h.part]?.type === 'LTR',
      );
      for (const h of hits) {
        if (lib.parts[h.part]?.fragment !== true) continue;
        const inside = hits.filter(
          (k) =>
            k !== h &&
            k.strand === h.strand &&
            overlapLength(k.range, h.range, v.length, topology) >= h.range.end - h.range.start,
        );
        expect(
          inside.map((k) => lib.parts[k.part]?.name),
          v.accession,
        ).toEqual([]);
      }
    }
  }, 300_000);

  it('calls one filamentous-phage origin per locus (#284)', async () => {
    const lib = await loadFeatureLibrary();
    // The f1 and M13 parts used to be called on top of each other wherever
    // either fitted, each naming a phage the bases cannot be sure of.
    let loci = 0;
    for (const v of vectors) {
      const topology = v.topology === 'circular' ? 'circular' : 'linear';
      const ours = detectFeatures(v.sequence, topology, lib).filter(
        (h) => lib.parts[h.part]?.name === 'f1/M13 ori',
      );
      const theirs = v.hits.filter((h) => !h.fragment && /^(f1|M13) ori$/.test(h.name));
      // One call where pLannotate makes one, and never two over one locus.
      expect(ours.length, v.accession).toBe(theirs.length);
      loci += ours.length;
    }
    // Every vector of the corpus that carries one.
    expect(loci).toBe(43);
  }, 300_000);

  it('names a fluorescent protein for its family where the bases are another variant (#284)', async () => {
    const lib = await loadFeatureLibrary();
    const named = (accession: string, from: number, to: number): string | undefined => {
      const v = vectors.find((x) => x.accession === accession);
      if (v === undefined) throw new Error(accession);
      const topology = v.topology === 'circular' ? 'circular' : 'linear';
      for (const h of detectFeatures(v.sequence, topology, lib)) {
        const part = lib.parts[h.part];
        if (part === undefined || part.category !== 'fluorescent protein') continue;
        if (h.range.start + 1 === from && h.range.end === to) return nameOfHit(h, part);
      }
      return undefined;
    };
    // Cycle 3 GFP (Q80R, F99S, M153T, V163A against avGFP M62653) and two
    // GFPs of their own (one with S65A): none is the wild type the part is.
    expect(named('PP098727.1', 116, 832)).toBe('GFP');
    expect(named('U56996.1', 1, 717)).toBe('GFP');
    expect(named('U47949.1', 1, 717)).toBe('GFP');
    // DsRed.T3 (identical to AJ851289's protein), 16 residues from Express2.
    expect(named('AY916793.1', 953, 1630)).toBe('DsRed');
  }, 300_000);

  it("makes none of pLannotate's known errors (#285)", () => {
    expect(ORACLE_ERRORS.length).toBeGreaterThan(0);
    expect(result.erroneous).toEqual([]);
  });

  it('finds tags by their protein only where the frame is plausibly translated (#285)', async () => {
    const lib = await loadFeatureLibrary();
    const tags = (accession: string): string[] => {
      const v = vectors.find((x) => x.accession === accession);
      if (v === undefined) throw new Error(accession);
      const topology = v.topology === 'circular' ? 'circular' : 'linear';
      return detectFeatures(v.sequence, topology, lib)
        .filter((h) => h.viaProtein === true && lib.parts[h.part]?.category === 'tag')
        .map((h) => `${lib.parts[h.part]?.name} ${h.range.start} ${h.strand}`);
    };
    // The (GGT)9 linker of pRS-TG's TetR-GFP fusion, read antisense as His:
    // the 6xHis and 8xHis there are gone, nothing else is.
    expect(tags('JX679612.1')).toEqual([]);
    // Kept: an N-terminal His tag in pETDuet-1's 29-codon ORF, across a
    // 271-codon ORF on the other strand; the T7 tag of pACpET24 at the head
    // of its 54-codon ORF, across a 217-codon one; a TEV site with no start
    // before it, in a frame open into the iFP after it; a His tag in a
    // phagemid with no ORF on either strand.
    expect(tags('PP098729.1')).toContain('6xHis 82 forward');
    expect(tags('U16281.1')).toContain('T7 tag 2503 reverse');
    expect(tags('JF327847.1')).toContain('TEV site 697 forward');
    expect(tags('AF013597.1')).toContain('6xHis 21 forward');
  });

  it('gives every miss a cause', () => {
    const missed = PART_CLASSES.reduce((n, c) => n + result.total[c] - result.found[c], 0);
    expect(result.misses).toHaveLength(missed);
  });
});
