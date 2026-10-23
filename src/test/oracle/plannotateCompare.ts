import { type FeatureHit, detectFeatures, overlapLength } from '@/core/annotate/detect';
import { type FeatureLibrary } from '@/core/annotate/library';
import { nameOfHit } from '@/core/annotate/variant';
import { type Topology } from '@/core/range';

import aliases from './plannotate-aliases.json';
import oracle from './plannotate.json';

/**
 * Detect features against pLannotate (#220, docs/design/59-detect-features.md).
 * `plannotate.json` holds what pLannotate reported on a corpus of NCBI vectors
 * (scripts/plannotate/); this module runs Detect features on the same
 * sequences and sets the two side by side. Nothing of pLannotate runs here.
 */

export const PART_CLASSES = [
  'origin',
  'marker',
  'promoter',
  'tag',
  'FP',
  'terminator',
  'RNA',
  'other',
] as const;
export type PartClass = (typeof PART_CLASSES)[number];

export interface OracleHit {
  readonly name: string;
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly strand: number;
  readonly identity: number;
  readonly coverage: number;
  readonly fragment: boolean;
  readonly database: string;
}

export interface OracleVector {
  readonly accession: string;
  readonly label: string;
  readonly length: number;
  readonly topology: string;
  readonly sequence: string;
  readonly hits: readonly OracleHit[];
}

export const vectors: readonly OracleVector[] = oracle.vectors;
export const versions = { plannotate: oracle.plannotate, databases: oracle.databases };

const MARKER = new RegExp(
  '^(AmpR|KanR|NeoR|neo|HygR|BleoR|BSD|SmR|CmR|cat|tetA|TetR|ermC|PuroR|ZeoR|BlastR|GmR|' +
    'URA3|LEU2|TRP1|HIS3|LYS2|ADE2|bar|nptII|hph|pac|SpecR|StrepR)\\b',
  'i',
);
const TAG =
  /(^|\W)(\d+x)?His(\W|$)|FLAG|^HA$|^Myc$|^V5|T7 tag|Strep-?tag|S-tag|thrombin site|TEV|NLS|HiBiT|SUMO|^GST\b|^MBP\b/i;
const FP = /GFP|mCherry|DsRed|YFP|CFP|RFP|iFP|ZsGreen|hrGFP|Cycle 3|mNeon|tdTomato|hfriFP|FP\d/;

/** The class of one of pLannotate's hits, from its type, database and name. */
export function classOfOracle(h: OracleHit): PartClass {
  if (h.database === 'Rfam' || h.type === 'ncRNA' || h.type === 'misc_RNA') return 'RNA';
  if (h.type === 'rep_origin' || h.type === 'oriT') return 'origin';
  if (h.type === 'promoter') return 'promoter';
  if (h.type === 'terminator' || h.type === 'polyA_signal') return 'terminator';
  if (h.database === 'fpbase' || FP.test(h.name)) return 'FP';
  if (h.type === 'CDS' || h.type === 'misc_feature') {
    if (MARKER.test(h.name)) return 'marker';
    if (TAG.test(h.name)) return 'tag';
  }
  return 'other';
}

/** The class of one of our parts, from its category in the bundled list. */
export function classOfPart(category: string, type: string, name: string): PartClass {
  if (category === 'origin') return 'origin';
  if (category === 'marker') return 'marker';
  if (category === 'promoter') return 'promoter';
  if (category === 'tag') return 'tag';
  if (category === 'terminator') return 'terminator';
  if (category !== 'primer' && FP.test(name)) return 'FP';
  if (type === 'ncRNA' || type === 'misc_RNA' || type === 'tRNA' || type === 'rRNA') return 'RNA';
  return 'other';
}

/**
 * Why a hit of pLannotate's has no hit of ours, tried in this order:
 * - `RNA only`: found by Rfam's covariance models; the bundled list has no RNAs.
 * - `homologue`: found by similarity to a Swiss-Prot protein we have no part for.
 * - `not in our list`: no part of ours by that name (or its alias).
 * - `strand differs`: we find that part, on the other strand.
 * - `below threshold`: we find it only at the lowest identity Detect features offers.
 * - `different extent`: our part is over a third longer or shorter than the feature
 *   pLannotate calls by that name (SnapGene cuts parts differently), so no hit
 *   shares half of both.
 * - `recoded or diverged`: our part is the same size and still is not found even at
 *   the lowest identity.
 */
export type MissCause =
  | 'not in our list'
  | 'homologue'
  | 'RNA only'
  | 'strand differs'
  | 'below threshold'
  | 'different extent'
  | 'recoded or diverged';

export const MISS_CAUSES: readonly MissCause[] = [
  'not in our list',
  'homologue',
  'RNA only',
  'strand differs',
  'below threshold',
  'different extent',
  'recoded or diverged',
];

export interface Miss {
  readonly accession: string;
  readonly hit: OracleHit;
  readonly cls: PartClass;
  readonly cause: MissCause;
}

export interface Extra {
  readonly accession: string;
  readonly part: string;
  readonly category: string;
  readonly cls: PartClass;
  readonly strand: 'forward' | 'reverse';
  readonly viaProtein: boolean;
  readonly similar: boolean;
}

/**
 * A hit of ours and one of pLannotate's over the same bases (each shares at
 * least half of the longer, on the same strand) that name two different
 * parts we both have: we call it `part`, pLannotate calls it what we know as
 * `theirs` (#279). Recall cannot see this, as it matches on bases alone.
 */
export interface NameConflict {
  readonly accession: string;
  readonly part: string;
  readonly theirs: string;
}

/**
 * A hit of ours and one of pLannotate's over the same bases (each shares at
 * least half of the longer) that name the same part on opposite strands
 * (#287). Origins and att sites are left out, as `sameStrand` leaves them
 * out. A part stored antisense to the way it works shows up here on every
 * vector that carries it.
 */
export interface StrandConflict {
  readonly accession: string;
  readonly part: string;
  /** The strand of our call; pLannotate's is the other. */
  readonly ours: 'forward' | 'reverse';
}

export interface Comparison {
  readonly total: Record<PartClass, number>;
  readonly found: Record<PartClass, number>;
  readonly misses: readonly Miss[];
  readonly extras: readonly Extra[];
  readonly nameConflicts: readonly NameConflict[];
  readonly strandConflicts: readonly StrandConflict[];
  /** Calls in `ORACLE_ERRORS` that a hit of ours makes too, on the same strand. */
  readonly erroneous: readonly { readonly accession: string; readonly name: string }[];
  /** Hits of ours, all told. */
  readonly ours: number;
}

function zero(): Record<PartClass, number> {
  return Object.fromEntries(PART_CLASSES.map((c) => [c, 0])) as Record<PartClass, number>;
}

/** Letters and digits only, lower case: `AmpR promoter` and `ampR-promoter` agree. */
export function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Hits of both sides overlap when they share at least half of the shorter,
 * on the same strand.
 */
const MIN_SHARED = 0.5;

function oracleRange(h: OracleHit, length: number, topology: Topology) {
  const end = topology === 'circular' && h.end <= h.start ? h.end + length : h.end;
  return { start: h.start, end };
}

function agrees(
  a: { start: number; end: number },
  b: { start: number; end: number },
  length: number,
  topology: Topology,
): boolean {
  const shared = overlapLength(a, b, length, topology);
  return shared >= MIN_SHARED * Math.min(a.end - a.start, b.end - b.start);
}

function strandOf(hit: { strand: number }): 'forward' | 'reverse' {
  return hit.strand < 0 ? 'reverse' : 'forward';
}

/**
 * Whether two hits' strands agree. An origin has no strand to speak of: SnapGene
 * draws it in the direction of replication, a GenBank record as its author did,
 * and the two differ for the same origin, so origins are compared without it.
 * Gateway att sites are the same: the record we cite for attL2 reads it in the
 * direction of the vector, SnapGene draws it the other way round (#233).
 */
const RECOMBINATION_SITE = /^att[BPLR]\d$/;

function sameStrand(
  cls: PartClass,
  name: string,
  a: 'forward' | 'reverse',
  b: 'forward' | 'reverse',
): boolean {
  return cls === 'origin' || RECOMBINATION_SITE.test(name) || a === b;
}

/**
 * Calls of pLannotate's that are wrong, checked against the record: left out
 * of recall, and Detect features must not make them (`erroneous`).
 *
 * - JX679612.1 (pRS416 pRS-TG), 9xHis on the reverse strand: the bases are
 *   the (GGT)9 glycine linker of the record's own TetR-GFP fusion CDS (TG,
 *   2735..4117), which reads His only antisense to it (#285).
 */
export const ORACLE_ERRORS: readonly {
  readonly accession: string;
  readonly name: string;
  readonly start: number;
}[] = [{ accession: 'JX679612.1', name: '9xHis', start: 3356 }];

function isOracleError(accession: string, h: OracleHit): boolean {
  return ORACLE_ERRORS.some(
    (x) => x.accession === accession && x.name === h.name && x.start === h.start,
  );
}

/** The name pLannotate gives a part, as ours is spelled (the alias table, then itself). */
export function ourNameFor(name: string): string {
  const alias = (aliases.aliases as Record<string, string>)[name];
  return alias ?? name;
}

/**
 * Detect features on every vector of the corpus and compare with pLannotate.
 * `lowIdentity` is the least identity Detect features offers: a miss that
 * turns up at it is a miss of threshold.
 */
export function compare(library: FeatureLibrary): Comparison {
  const total = zero();
  const found = zero();
  const misses: Miss[] = [];
  const extras: Extra[] = [];
  const nameConflicts: NameConflict[] = [];
  const strandConflicts: StrandConflict[] = [];
  const erroneous: { accession: string; name: string }[] = [];
  let oursCount = 0;
  const partByName = new Map(library.parts.map((p) => [normalize(p.name), p.name]));
  // The parts of ours that stand for a name pLannotate uses somewhere in the corpus.
  const counterparts = new Set<string>();
  for (const v of vectors) {
    for (const h of v.hits) {
      const ours = partByName.get(normalize(ourNameFor(h.name)));
      if (ours !== undefined) counterparts.add(ours);
    }
  }
  for (const v of vectors) {
    const topology: Topology = v.topology === 'circular' ? 'circular' : 'linear';
    const hits = detectFeatures(v.sequence, topology, library);
    oursCount += hits.length;
    for (const h of v.hits) {
      if (!isOracleError(v.accession, h)) continue;
      const range = oracleRange(h, v.length, topology);
      if (hits.some((o) => o.strand === strandOf(h) && agrees(range, o.range, v.length, topology)))
        erroneous.push({ accession: v.accession, name: h.name });
    }
    const complete = v.hits.filter((h) => !h.fragment && !isOracleError(v.accession, h));
    let lowHits: FeatureHit[] | undefined;
    for (const h of complete) {
      const cls = classOfOracle(h);
      total[cls]++;
      const range = oracleRange(h, v.length, topology);
      const match = hits.some(
        (o) =>
          sameStrand(cls, h.name, o.strand, strandOf(h)) &&
          agrees(range, o.range, v.length, topology),
      );
      if (match) {
        found[cls]++;
        continue;
      }
      let cause: MissCause;
      const mine = library.parts.filter((p) => normalize(p.name) === normalize(ourNameFor(h.name)));
      if (cls === 'RNA' && mine.length === 0) cause = 'RNA only';
      else if (mine.length === 0)
        cause = h.database === 'swissprot' ? 'homologue' : 'not in our list';
      else if (
        hits.some((o) => {
          const part = library.parts[o.part];
          return (
            part !== undefined && mine.includes(part) && agrees(range, o.range, v.length, topology)
          );
        })
      )
        cause = 'strand differs';
      else {
        lowHits ??= detectFeatures(v.sequence, topology, library, { minIdentity: 0.9 });
        const length = h.end > h.start ? h.end - h.start : h.end - h.start + v.length;
        const ratios = mine.map((p) => (p.sequence === '' ? 1 : p.sequence.length / length));
        if (
          lowHits.some(
            (o) =>
              sameStrand(cls, h.name, o.strand, strandOf(h)) &&
              agrees(range, o.range, v.length, topology),
          )
        )
          cause = 'below threshold';
        else if (ratios.every((r) => r > 1.33 || r < 0.75)) cause = 'different extent';
        else cause = 'recoded or diverged';
      }
      misses.push({ accession: v.accession, hit: h, cls, cause });
    }
    for (const o of hits) {
      const part = library.parts[o.part];
      if (part === undefined) continue;
      const ours = nameOfHit(o, part);
      const oursClass = classOfPart(part.category, part.type, ours);
      const known = v.hits.some(
        (h) =>
          sameStrand(oursClass, h.name, strandOf(h), o.strand) &&
          agrees(oracleRange(h, v.length, topology), o.range, v.length, topology),
      );
      if (known) continue;
      extras.push({
        accession: v.accession,
        part: ours,
        category: part.category,
        cls: oursClass,
        strand: o.strand,
        viaProtein: o.viaProtein === true,
        similar: o.similar !== undefined,
      });
    }
    for (const o of hits) {
      const part = library.parts[o.part];
      if (part === undefined) continue;
      // The name the call carries, which for a hit that does not show its
      // part's variant is the element's (#284): such a call claims no part
      // of ours, so it is no part's name against pLannotate's.
      const ours = nameOfHit(o, part);
      if (!counterparts.has(ours)) continue;
      const oursClass = classOfPart(part.category, part.type, ours);
      for (const h of complete) {
        const theirs = partByName.get(normalize(ourNameFor(h.name)));
        if (theirs === undefined || theirs === ours) continue;
        if (!sameStrand(oursClass, h.name, strandOf(h), o.strand)) continue;
        const range = oracleRange(h, v.length, topology);
        const longer = Math.max(range.end - range.start, o.range.end - o.range.start);
        if (overlapLength(range, o.range, v.length, topology) < MIN_SHARED * longer) continue;
        nameConflicts.push({ accession: v.accession, part: ours, theirs });
      }
    }
    // Fragments too: a piece of a part still reads one way.
    for (const o of hits) {
      const part = library.parts[o.part];
      if (part === undefined) continue;
      const ours = nameOfHit(o, part);
      const oursClass = classOfPart(part.category, part.type, ours);
      for (const h of v.hits) {
        if (isOracleError(v.accession, h)) continue;
        if (partByName.get(normalize(ourNameFor(h.name))) !== ours) continue;
        if (sameStrand(oursClass, h.name, strandOf(h), o.strand)) continue;
        const range = oracleRange(h, v.length, topology);
        const longer = Math.max(range.end - range.start, o.range.end - o.range.start);
        if (overlapLength(range, o.range, v.length, topology) < MIN_SHARED * longer) continue;
        strandConflicts.push({ accession: v.accession, part: ours, ours: o.strand });
      }
    }
  }
  return {
    total,
    found,
    misses,
    extras,
    nameConflicts,
    strandConflicts,
    erroneous,
    ours: oursCount,
  };
}

/** The comparison as the markdown tables of item 59, for re-running it after a change. */
export function report(c: Comparison): string {
  const pct = (a: number, b: number): string => (b === 0 ? '-' : `${((100 * a) / b).toFixed(1)}%`);
  const lines = ['| Class | pLannotate hits | Found | Recall |', '|---|---:|---:|---:|'];
  let all = 0;
  let hit = 0;
  for (const k of PART_CLASSES) {
    lines.push(`| ${k} | ${c.total[k]} | ${c.found[k]} | ${pct(c.found[k], c.total[k])} |`);
    all += c.total[k];
    hit += c.found[k];
  }
  lines.push(`| **all** | ${all} | ${hit} | ${pct(hit, all)} |`, '');
  lines.push(`| Cause of a miss | ${PART_CLASSES.join(' | ')} | all |`);
  lines.push(`|---|${PART_CLASSES.map(() => '---:').join('|')}|---:|`);
  for (const cause of MISS_CAUSES) {
    const row = PART_CLASSES.map(
      (k) => c.misses.filter((m) => m.cause === cause && m.cls === k).length,
    );
    lines.push(`| ${cause} | ${row.join(' | ')} | ${row.reduce((a, b) => a + b, 0)} |`);
  }
  lines.push('');
  for (const cause of MISS_CAUSES) {
    const names = new Map<string, number>();
    for (const m of c.misses) {
      if (m.cause === cause) names.set(m.hit.name, (names.get(m.hit.name) ?? 0) + 1);
    }
    const top = [...names].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    lines.push(`- ${cause}: ${top.map(([n, k]) => `${n} (${k})`).join(', ')}`);
  }
  lines.push('', `Extras: ${c.extras.length} of our ${c.ours} hits`);
  const extras = new Map<string, number>();
  for (const x of c.extras) {
    const key = `${x.category === 'primer' ? 'primer' : x.cls}: ${x.part}`;
    extras.set(key, (extras.get(key) ?? 0) + 1);
  }
  lines.push(
    [...extras]
      .sort((a, b) => b[1] - a[1])
      .map(([n, k]) => `- ${n} (${k})`)
      .join('\n'),
  );
  return lines.join('\n');
}
