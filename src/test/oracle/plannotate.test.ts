import { writeFileSync } from 'node:fs';

import { beforeAll, describe, expect, it } from 'vitest';

import { detectFeatures } from '@/core/annotate/detect';
import { loadFeatureLibrary } from '@/core/annotate/library';

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
  terminator: 0.891,
  RNA: 0.916,
  other: 0.778,
};
const BASELINE_ALL = 0.879;

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
      'OR992667.1: M13 ori / f1 ori',
      'KJ634048.1: M13 ori / f1 ori',
      'AF239250.1: SV40 ori / SV40 promoter',
      'AF396260.1: f1 ori / M13 ori',
      'KX151731.1: f1 ori / M13 ori',
      'U89930.1: TetR (Tn10) / rtTA (Tet-On 3G)',
    ]);
    const found = result.nameConflicts.map((c) => `${c.accession}: ${c.part} / ${c.theirs}`);
    expect(found.filter((c) => !known.has(c))).toEqual([]);
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
