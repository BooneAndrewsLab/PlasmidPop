import {
  type CutSite,
  type Enzyme,
  activeEnzymes,
  cutLabel,
  findCutSites,
  getEnzyme,
  isDoubleCutter,
  isTypeIIS,
  overhangKind,
} from '../analysis/restriction';
import { type SeqDocument } from '../document';
import { recordGoldenGate } from '../lineage/record';
import {
  DEFAULT_PRIMER_CRITERIA,
  type PrimerCriteria,
  type PrimerReport,
  designAnchoredPrimers,
  findPrimerBindingSites,
} from '../primers';
import { reverseComplement } from '../sequence';
import {
  type CloningInsert,
  type CloningPrimer,
  type CloningWarning,
  type PrimerSegments,
  type Tail,
  type TailPlan,
  type TailSite,
  buildTail,
  emptyPrimer,
  insertSequence,
} from './cloningEnds';
import { endFlank } from './endFlanks';
import { goldenGate, goldenGateFragments, overhangWarnings } from './goldenGate';
import { BUNDLED_STANDARDS } from './moclo';
import { productHolding } from './overlapPrimers';
import { pcr, primerDimers } from './pcr';

/**
 * Golden Gate ends (#310, item 113): the two primers that turn a stretch of
 * another document — a CDS fetched from NCBI, usually — into a Golden Gate
 * part, so that the tutorial's hand-typed oligos are not needed.
 *
 * Each primer is
 *
 * ```
 * 5′ padding · Type IIS site · spacer · 4-nt overhang · annealing part 3′
 * ```
 *
 * with the site pointing into the part, so that the enzyme cuts past it and
 * the site leaves with the flank. The spacer's length and the overhang's are
 * read off the enzyme table (`typeIISLayout`), never written down here: BsaI
 * `GGTCTC(1/5)` gives one spacer base and a 4-nt overhang, BbsI
 * `GAAGAC(2/6)` two and four, SapI `GCTCTTC(1/4)` one and three. An enzyme
 * whose geometry the table cannot express — a 3′ overhang, a blunt Type IIS
 * cutter, one that cuts on both sides of its site, a degenerate site — is
 * not offered, and `whyNotGoldenGate` says which of those it is.
 *
 * The overhangs are the designer's, not the enzyme's, which is what Golden
 * Gate is for: a standard's pair (`standardOverhangChoices`, MoClo's CDS
 * part `AATG`…`GCTT`), the two the destination's own cut ends ask for
 * (`destinationOverhangs`), or four bases typed by hand. An overhang may
 * overlap the part's own first or last bases — `AATG` is `A` + the start
 * codon — so the body the annealing parts are chosen on begins after what
 * the overhang already spells (`overlapAtStart`), and the part the reaction
 * releases is the same bases either way.
 *
 * The annealing parts, the padding rule, the junction-site avoidance and the
 * warning shapes are the restriction-cloning designer's (item 108); what is
 * new here is the geometry, the overhangs, the reading frame and a Simulate
 * that runs the Golden Gate rather than a digest and a ligation.
 */

// ------------------------------------------------------------- geometry

/** What the enzyme table says a Type IIS enzyme writes on a primer. */
export interface TypeIISLayout {
  readonly enzyme: Enzyme;
  /** The recognition site as the primer carries it, pointing into the part. */
  readonly site: string;
  /** Bases between the site and the top-strand cut: BsaI 1, BbsI 2. */
  readonly spacer: number;
  /** Bases of the 5′ overhang the cut leaves: BsaI 4, SapI 3. */
  readonly overhang: number;
}

/**
 * The geometry, taken from the enzyme's own row of the table. An enzyme the
 * table lists cutting 5′ of its site is turned around first, as the
 * restriction-cloning tails turn one (item 108); null when the row cannot be
 * written on a primer at all.
 */
export function typeIISLayout(enzyme: Enzyme): TypeIISLayout | null {
  if (isDoubleCutter(enzyme) || !isTypeIIS(enzyme)) return null;
  const n = enzyme.site.length;
  const rightward = Math.max(enzyme.cutTop, enzyme.cutBottom) > n;
  const site = rightward ? enzyme.site.toUpperCase() : reverseComplement(enzyme.site.toUpperCase());
  const cutTop = rightward ? enzyme.cutTop : n - enzyme.cutBottom;
  const cutBottom = rightward ? enzyme.cutBottom : n - enzyme.cutTop;
  const spacer = cutTop - n;
  const overhang = cutBottom - cutTop;
  if (spacer < 0 || overhang <= 0 || /[^ACGT]/.test(site)) return null;
  return { enzyme, site, spacer, overhang };
}

/** Why an enzyme cannot be used for a Golden Gate part, or null when it can. */
export function whyNotGoldenGate(enzyme: Enzyme): string | null {
  if (isDoubleCutter(enzyme)) {
    return `${enzyme.name} cuts on both sides of its site, so a part would lose an end.`;
  }
  if (!isTypeIIS(enzyme)) return `${enzyme.name} cuts inside its site, so it is not Type IIS.`;
  const kind = overhangKind(enzyme);
  if (kind === 'blunt')
    return `${enzyme.name} leaves a blunt end, so there is no overhang to join on.`;
  if (typeIISLayout(enzyme) === null) {
    return kind === "3'"
      ? `${enzyme.name} leaves a 3′ overhang, which a Golden Gate part cannot be written with.`
      : `${enzyme.name}'s site has an ambiguity code, so it cannot be written on a primer.`;
  }
  return null;
}

/** The enzymes offered for a part, the usual four first. */
export function goldenGatePartEnzymes(enzymes: readonly Enzyme[] = activeEnzymes()): Enzyme[] {
  const usable = enzymes.filter((e) => typeIISLayout(e) !== null);
  const rank = (e: Enzyme): number => {
    const i = PREFERRED.indexOf(e.name);
    return i < 0 ? PREFERRED.length : i;
  };
  return [...usable].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

const PREFERRED = ['BsaI', 'BsmBI', 'BbsI', 'SapI'];

// ------------------------------------------------------------- overhangs

/** One pair of overhangs the picker offers. */
export interface OverhangChoice {
  readonly id: string;
  /** "MoClo plant common syntax · CDS". */
  readonly label: string;
  readonly left: string;
  readonly right: string;
  /** The enzyme the standard is cut with, to start the enzyme picker on. */
  readonly enzyme: string;
}

/**
 * Every position of every bundled standard as a left/right pair, the
 * standards whose enzyme is the chosen one first. Only sequences are
 * bundled, which are facts of the published syntax (item 76, `moclo.ts`).
 */
export function standardOverhangChoices(enzyme = ''): OverhangChoice[] {
  const choices = BUNDLED_STANDARDS.flatMap((s) =>
    s.positions.map((p) => ({
      id: `${s.id}:${p.name}`,
      label: `${s.name} · ${p.name} (${p.left}…${p.right})`,
      left: p.left,
      right: p.right,
      enzyme: s.enzyme,
    })),
  );
  if (enzyme === '') return choices;
  return [
    ...choices.filter((c) => c.enzyme === enzyme),
    ...choices.filter((c) => c.enzyme !== enzyme),
  ];
}

/** The two overhangs a destination's own cut ends leave for a part to fill. */
export interface DestinationOverhangs {
  readonly left: string;
  readonly right: string;
  /** The backbone piece the reaction keeps, so the page can name its size. */
  readonly backbone: number;
  /** More than one piece survives the digest, so the pair is a guess at the longest. */
  readonly several: boolean;
}

/**
 * What the destination asks of the part: the backbone's right overhang is
 * where the part starts, its left overhang where the part ends. Null when
 * the enzyme releases nothing from it — the vector has no site, or no piece
 * keeps two sticky ends and loses the site.
 */
export function destinationOverhangs(
  destination: SeqDocument,
  enzyme: Enzyme,
  second?: Enzyme,
): DestinationOverhangs | null {
  const pieces = goldenGateFragments(
    destination,
    second === undefined ? { enzyme } : { enzyme, secondEnzyme: second },
  );
  const backbone = [...pieces].sort((a, b) => b.sequence.length - a.sequence.length)[0];
  if (backbone === undefined) return null;
  return {
    left: backbone.right.overhang.toUpperCase(),
    right: backbone.left.overhang.toUpperCase(),
    backbone: backbone.sequence.length,
    several: pieces.length > 1,
  };
}

const STOPS = ['TAA', 'TAG', 'TGA'];

/**
 * Bases of the part's 5′ end the overhang already spells, so that they are
 * not written twice. Only two overlaps are read, and never a coincidence:
 * the start codon, which is what `AATG` and `TATG` are for — `AATG` is `A`
 * plus `ATG`, so the annealing part begins at the base after the start
 * codon — and an overhang the part's own first bases spell whole, which is
 * a region selected with the fusion site already on it. A part whose first
 * base happens to be the overhang's last is left alone: eating it would
 * shift the frame for nothing.
 */
export function overlapAtStart(overhang: string, part: string, keepStart = true): number {
  if (overhang.length > 0 && part.startsWith(overhang)) return overhang.length;
  if (keepStart && part.startsWith('ATG') && overhang.endsWith('ATG')) return 3;
  return 0;
}

/**
 * The same at the part's 3′ end: a stop codon the overhang spells, or an
 * overhang the part already ends with. Otherwise the overhang is added
 * after the part, which is what a fusion site such as `GCTT` is.
 */
export function overlapAtEnd(part: string, overhang: string): number {
  if (overhang.length > 0 && part.endsWith(overhang)) return overhang.length;
  if (STOPS.some((stop) => part.endsWith(stop) && overhang.startsWith(stop))) return 3;
  return 0;
}

// --------------------------------------------------------------- design

export interface GoldenGatePartSettings {
  readonly enzyme: string;
  /** The overhang the part begins on, top strand. */
  readonly left: string;
  /** The overhang the part ends on, top strand. */
  readonly right: string;
  /** Keep the region's own start codon; off makes an N-terminal fusion part. */
  readonly includeStart: boolean;
  /** Keep the region's own stop codon; off lets a tag follow in frame. */
  readonly includeStop: boolean;
  /** Bases 5′ of each site, raised per enzyme as in item 108. */
  readonly padding: number;
  readonly avoidJunctionSites: boolean;
  readonly criteria: Partial<PrimerCriteria>;
  /** A second Type IIS enzyme in the same tube; its site must not be in the part either. */
  readonly secondEnzyme: string;
}

export const GOLDEN_GATE_PART_DEFAULTS: GoldenGatePartSettings = {
  enzyme: 'BsaI',
  left: '',
  right: '',
  includeStart: true,
  includeStop: false,
  padding: 6,
  avoidJunctionSites: true,
  criteria: {},
  secondEnzyme: '',
};

/** The part, the destination it goes into and whatever else is in the tube. */
export interface GoldenGatePartContext {
  readonly insert: CloningInsert;
  /** The destination vector; null when none is open, which only Simulate minds. */
  readonly destination: SeqDocument | null;
  /** The other parts of the assembly, for Simulate and for the overhang set. */
  readonly otherParts?: readonly SeqDocument[];
  /** The enzyme table the design is made with; the active set by default. */
  readonly enzymes?: readonly Enzyme[];
}

/** Whether the part's coding bases run in frame into the overhang that follows. */
export interface FrameCheck {
  /** The part is read as coding at all: it begins with a start codon, or one was kept. */
  readonly coding: boolean;
  /** Bases from the first coding base to the start of the right overhang. */
  readonly length: number;
  readonly inFrame: boolean;
  /** The part ends with its own stop codon, so nothing is fused after it. */
  readonly stopped: boolean;
}

export interface GoldenGatePartDesign {
  readonly forward: CloningPrimer;
  readonly reverse: CloningPrimer;
  /** The PCR product, tails and all, as the design expects it. */
  readonly amplicon: string;
  readonly productLength: number;
  /**
   * The part the reaction releases, top strand: the left overhang, the body,
   * and the right overhang — which the next part's piece carries, so the
   * circle counts it once.
   */
  readonly part: string;
  readonly left: string;
  readonly right: string;
  /** Bases of each overhang the part's own ends already spelled. */
  readonly overlap: { readonly left: number; readonly right: number };
  /** The region's own start or stop codon left out of the part. */
  readonly trimmed: { readonly start: boolean; readonly stop: boolean };
  readonly frame: FrameCheck;
  readonly warnings: readonly CloningWarning[];
  readonly problem: string | null;
  readonly simulate: () => GoldenGatePartSimulation;
}

export interface GoldenGatePartSimulation {
  readonly amplicon: SeqDocument | null;
  /** The assembled circle, or null when the tube could not make one. */
  readonly product: SeqDocument | null;
  /** What stopped the assembly, in a sentence; null when it worked. */
  readonly problem: string | null;
  /**
   * What the tube has not got, in plain words, when only the PCR could be
   * run: no destination, or none the enzyme opens.
   */
  readonly missing: string | null;
  readonly warnings: readonly CloningWarning[];
}

/** The two names Save both uses: `INS-F-BsaI`, `INS-R-BsaI`. */
export function goldenGatePrimerNames(
  insert: string,
  enzyme: string,
): { readonly forward: string; readonly reverse: string } {
  const base = insert.trim().replace(/\s+/g, '_') || 'part';
  return { forward: `${base}-F-${enzyme}`, reverse: `${base}-R-${enzyme}` };
}

function failed(
  names: { readonly forward: string; readonly reverse: string },
  enzyme: string,
  problem: string,
  warnings: readonly CloningWarning[] = [],
): GoldenGatePartDesign {
  return {
    forward: emptyPrimer(names.forward, enzyme),
    reverse: emptyPrimer(names.reverse, enzyme),
    amplicon: '',
    productLength: 0,
    part: '',
    left: '',
    right: '',
    overlap: { left: 0, right: 0 },
    trimmed: { start: false, stop: false },
    frame: { coding: false, length: 0, inFrame: true, stopped: false },
    warnings,
    problem,
    simulate: () => ({ amplicon: null, product: null, problem, missing: null, warnings }),
  };
}

/** "BsaI 12, 310" for the sites inside a stretch. */
function sitesText(enzyme: string, sites: readonly CutSite[], length: number): string {
  return `${enzyme} ${sites.map((s) => cutLabel(s.cut, length, 'linear').toLocaleString()).join(', ')}`;
}

/**
 * The two oligos that make `ctx.insert` a Golden Gate part, with the
 * warnings the part, the overhangs and the oligos themselves raise, and
 * `simulate` to run the PCR and the assembly.
 */
export function designGoldenGatePart(
  ctx: GoldenGatePartContext,
  settings: Partial<GoldenGatePartSettings> = {},
): GoldenGatePartDesign {
  const s: GoldenGatePartSettings = { ...GOLDEN_GATE_PART_DEFAULTS, ...settings };
  const criteria: PrimerCriteria = { ...DEFAULT_PRIMER_CRITERIA, ...s.criteria };
  const table = ctx.enzymes;
  const find = (name: string): Enzyme | undefined =>
    table === undefined ? getEnzyme(name) : table.find((e) => e.name === name);
  const names = goldenGatePrimerNames(ctx.insert.name, s.enzyme);
  const warnings: CloningWarning[] = [];

  const enzyme = find(s.enzyme);
  if (enzyme === undefined) {
    return failed(names, s.enzyme, `${s.enzyme} is not in the enzyme set.`);
  }
  const layout = typeIISLayout(enzyme);
  if (layout === null) {
    return failed(names, s.enzyme, whyNotGoldenGate(enzyme) ?? `${s.enzyme} cannot make a part.`);
  }
  const second = s.secondEnzyme === '' ? undefined : find(s.secondEnzyme);
  const inTube = second === undefined ? [enzyme] : [enzyme, second];

  const left = s.left.trim().toUpperCase();
  const right = s.right.trim().toUpperCase();
  for (const [overhang, which] of [
    [left, 'left'],
    [right, 'right'],
  ] as const) {
    if (overhang.length !== layout.overhang || /[^ACGT]/.test(overhang)) {
      return failed(
        names,
        s.enzyme,
        `The ${which} overhang must be ${layout.overhang.toString()} bases of A, C, G or T: ${enzyme.name} cuts ${layout.spacer.toString()} base${layout.spacer === 1 ? '' : 's'} past its site and leaves a ${layout.overhang.toString()}-base 5′ overhang.`,
      );
    }
  }

  // The part as the user asked for it: the region, less the codons left out.
  const region = insertSequence(ctx.insert).toUpperCase();
  const startsWithAtg = region.startsWith('ATG');
  const endsWithStop = STOPS.includes(region.slice(-3));
  const trimStart = !s.includeStart && startsWithAtg;
  const trimStop = !s.includeStop && endsWithStop;
  const part = region.slice(trimStart ? 3 : 0, region.length - (trimStop ? 3 : 0));

  // What the overhangs already spell of the part's own ends; the annealing
  // parts begin after it, which is why AATG's primer starts at the base
  // after the start codon.
  const overlapLeft = overlapAtStart(left, part, s.includeStart);
  const overlapRight = overlapAtEnd(part, right);
  const body = part.slice(overlapLeft, part.length - overlapRight);
  const anchored = designAnchoredPrimers(body, criteria);
  if (anchored === null) {
    return failed(
      names,
      s.enzyme,
      `The ${body.length.toLocaleString()} bp left after the overhangs is too short to amplify: a primer needs ${criteria.minLength.toString()} bases at each end.`,
    );
  }
  if (!anchored.withinCriteria) {
    const broken = [...anchored.forward.warnings, ...anchored.reverse.warnings];
    warnings.push({
      kind: 'annealing',
      severity: 'caution',
      text: `No annealing part at the part's ends meets the settings; the nearest ${broken.length > 0 ? `(${[...new Set(broken)].join('; ')})` : ''} is used.`,
    });
  }

  // The tails: padding, the site pointing in, the spacer and the overhang.
  // The padding rule and the free bases are the restriction designer's.
  const n = layout.site.length;
  const tailSite: TailSite = {
    bases: layout.site,
    cutTop: n + layout.spacer,
    cutBottom: n + layout.spacer + layout.overhang,
  };
  const need = endFlank(enzyme.name);
  const padding = Math.max(s.padding, need);
  const raised = need > s.padding ? need : null;
  const plan = (overhang: string): TailPlan => ({ enzyme, site: tailSite, overhang, padding });
  const fTail = buildTail(
    plan(left),
    anchored.forward.sequence,
    inTube,
    s.avoidJunctionSites,
    0x310,
  );
  const rTail = buildTail(
    plan(reverseComplement(right)),
    anchored.reverse.sequence,
    inTube,
    s.avoidJunctionSites,
    0x311,
  );
  for (const tail of [fTail, rTail]) {
    if (!tail.clean) {
      warnings.push({
        kind: 'junctionSite',
        severity: 'caution',
        enzyme: enzyme.name,
        text: `No padding found for the ${enzyme.name} tail that makes no new site where it meets the part; check the sites on the amplicon.`,
      });
    }
  }
  if (raised !== null) {
    warnings.push({
      kind: 'paddingRaised',
      severity: 'caution',
      enzyme: enzyme.name,
      text: `Padding ${raised.toString()} nt: ${enzyme.name} cuts poorly within ${(raised - 1).toString()} nt of an end.`,
    });
  }

  const oligo = (name: string, tail: Tail, annealing: PrimerReport): CloningPrimer => {
    const segments: PrimerSegments = { ...tail.segments, annealing: annealing.sequence };
    const lower = (segments.padding + segments.site + segments.spacer).toLowerCase();
    return {
      name,
      sequence: lower + segments.annealing.toUpperCase(),
      segments,
      enzyme: enzyme.name,
      tm: annealing.tm,
      annealing,
      paddingRaised: raised,
    };
  };
  const forward = oligo(names.forward, fTail, anchored.forward);
  const reverse = oligo(names.reverse, rTail, anchored.reverse);

  const middle = body.slice(anchored.forward.length, body.length - anchored.reverse.length);
  const amplicon =
    forward.sequence.toUpperCase() + middle + reverseComplement(reverse.sequence.toUpperCase());
  const released = left + body + right;

  // The reading frame across the right overhang: the usual standards put a
  // fusion site on a codon boundary, so the part that follows reads on.
  const codingStart = left.length - overlapLeft;
  const frame: FrameCheck = {
    coding: startsWithAtg && !trimStart,
    length: left.length + body.length - codingStart,
    inFrame: (left.length + body.length - codingStart) % 3 === 0,
    stopped: s.includeStop && endsWithStop,
  };
  if (frame.coding && !frame.stopped && !frame.inFrame) {
    const off = frame.length % 3;
    warnings.push({
      kind: 'frame',
      severity: 'caution',
      text: `From the start codon to the ${right} overhang is ${frame.length.toLocaleString()} bases, ${off.toString()} past a whole number of codons, so a part fused after this one is read in another frame. Move the region's end by ${(3 - off).toString()} or ${off.toString()} bases, or pick an overhang on a codon boundary.`,
    });
  }

  // A site of the tube's enzymes inside the part is the design's undoing:
  // the reaction cuts the part itself and nothing is offered silently.
  for (const e of inTube) {
    const inside = findCutSites(released, 'linear', [e]);
    if (inside.length > 0) {
      warnings.push({
        kind: 'internalSite',
        severity: 'danger',
        enzyme: e.name,
        text: `The part carries ${inside.length === 1 ? 'a' : inside.length.toString()} ${e.name} site${inside.length === 1 ? '' : 's'} of its own (${sitesText(e.name, inside, released.length)}), so the reaction cuts the part itself. Choose another enzyme, or remove the site first.`,
      });
    }
  }
  // A site the tails and the part spell between them, beyond the two meant:
  // one inside the part is the internal site above, one in a tail is new.
  const intended = new Set([
    fTail.segments.padding.length,
    amplicon.length - rTail.segments.padding.length - n,
  ]);
  const partStart = forward.sequence.length - anchored.forward.length - left.length;
  const partEnd =
    amplicon.length - (reverse.sequence.length - anchored.reverse.length) + right.length;
  for (const site of findCutSites(amplicon, 'linear', inTube)) {
    const length = find(site.enzyme)?.site.length ?? n;
    if (intended.has(site.siteStart)) continue;
    if (site.siteStart >= partStart && site.siteStart + length <= partEnd) continue;
    warnings.push({
      kind: 'extraSite',
      severity: 'danger',
      enzyme: site.enzyme,
      text: `${site.enzyme} has another site on the amplicon, at ${cutLabel(site.cut, amplicon.length, 'linear').toLocaleString()}, where a tail meets the part.`,
    });
  }

  // The overhangs, by the same rules the Bench's assembly is judged by
  // (#11, #144), against the rest of the set when the tube is known. The
  // tube's own copies of these two are the junctions this part fills, not
  // a clash, so they are left out; a real duplicate between two other
  // parts is the assembly's to report, not this design's.
  const others = overhangsInTube(ctx, enzyme, second).filter((o) => o !== left && o !== right);
  for (const w of overhangWarnings([left, right, ...others])) {
    if (!w.overhangs.some((o) => o === left || o === right)) continue;
    warnings.push({ kind: 'overhang', severity: 'caution', text: w.text });
  }

  const ambiguous = anchored.forward.degenerate + anchored.reverse.degenerate;
  if (ambiguous > 0) {
    warnings.push({
      kind: 'ambiguous',
      severity: 'caution',
      text: `The annealing parts hold ${ambiguous.toLocaleString()} ambiguity ${ambiguous === 1 ? 'code' : 'codes'}, so each oligo is a mixture; order them only if that is meant.`,
    });
  }

  const template = ctx.insert.document.sequence.toString();
  for (const [p, strand] of [
    [forward, 'forward'],
    [reverse, 'reverse'],
  ] as const) {
    const hits = findPrimerBindingSites(
      template,
      ctx.insert.document.topology,
      p.segments.annealing,
    );
    const elsewhere = hits.length - 1;
    if (elsewhere > 0) {
      warnings.push({
        kind: 'notSpecific',
        severity: 'caution',
        text: `The ${strand} primer's annealing part also binds ${ctx.insert.document.name} at ${elsewhere.toString()} other ${elsewhere === 1 ? 'place' : 'places'}.`,
      });
    }
  }
  const dimers = primerDimers([
    { name: forward.name, sequence: forward.sequence },
    { name: reverse.name, sequence: reverse.sequence },
  ]);
  if (dimers.length > 0) {
    const worst = Math.max(...dimers.map((d) => d.bases));
    warnings.push({
      kind: 'dimer',
      severity: 'caution',
      text: `The oligos pair at a 3′ end over ${worst.toString()} bases: a primer dimer a polymerase could extend.`,
    });
  }

  return {
    forward,
    reverse,
    amplicon,
    productLength: amplicon.length,
    part: released,
    left,
    right,
    overlap: { left: overlapLeft, right: overlapRight },
    trimmed: { start: trimStart, stop: trimStop },
    frame,
    warnings,
    problem: null,
    simulate: () => simulate(ctx, enzyme, second, forward, reverse, body, warnings),
  };
}

/** The overhangs the rest of the tube offers, so a clash with them is seen. */
function overhangsInTube(
  ctx: GoldenGatePartContext,
  enzyme: Enzyme,
  second: Enzyme | undefined,
): string[] {
  const options = second === undefined ? { enzyme } : { enzyme, secondEnzyme: second };
  const docs = [...(ctx.destination === null ? [] : [ctx.destination]), ...(ctx.otherParts ?? [])];
  // Each junction once: a piece's right overhang is the next piece's left.
  return [
    ...new Set(
      docs.flatMap((doc) =>
        goldenGateFragments(doc, options).flatMap((f) => [
          f.left.overhang.toUpperCase(),
          f.right.overhang.toUpperCase(),
        ]),
      ),
    ),
  ];
}

function simulate(
  ctx: GoldenGatePartContext,
  enzyme: Enzyme,
  second: Enzyme | undefined,
  forward: CloningPrimer,
  reverse: CloningPrimer,
  body: string,
  designWarnings: readonly CloningWarning[],
): GoldenGatePartSimulation {
  const warnings: CloningWarning[] = [...designWarnings];
  const reaction = pcr(ctx.insert.document, [
    { name: forward.name, sequence: forward.sequence },
    { name: reverse.name, sequence: reverse.sequence },
  ]);
  // `pcr` reads a product along the template's top strand, so a part on the
  // bottom strand comes back reverse-complemented; turned, it reads as the
  // part does, forward primer first.
  const made = productHolding(reaction.products, body);
  const turned =
    made === undefined ? productHolding(reaction.products, reverseComplement(body)) : undefined;
  const amplicon = made?.document ?? turned?.document.reverseComplement();
  if (amplicon === undefined) {
    return {
      amplicon: null,
      product: null,
      problem:
        reaction.problem ??
        `The primers amplify ${reaction.products.length.toString()} other ${reaction.products.length === 1 ? 'product' : 'products'} of ${ctx.insert.document.name} but not the part.`,
      missing: null,
      warnings,
    };
  }

  const destination = ctx.destination;
  if (destination === null) {
    return {
      amplicon,
      product: null,
      problem: null,
      missing: `No destination vector is open, so only the PCR was run. Open the vector the part goes into — the one with two ${enzyme.name} sites around its stuffer — and simulate again, or take the product to the Bench's Golden Gate.`,
      warnings,
    };
  }
  const options = second === undefined ? { enzyme } : { enzyme, secondEnzyme: second };
  if (goldenGateFragments(destination, options).length === 0) {
    return {
      amplicon,
      product: null,
      problem: null,
      missing: `${enzyme.name} opens nothing in ${destination.name}: the destination needs two ${enzyme.name} sites pointing outwards around the stretch the part replaces. Only the PCR was run.`,
      warnings,
    };
  }

  const parts = [destination, amplicon, ...(ctx.otherParts ?? [])];
  const run = goldenGate(parts, {
    ...options,
    name: `${destination.name}-${ctx.insert.name}`,
  });
  if (run.assembly === null) {
    return {
      amplicon,
      product: null,
      problem: run.problem,
      missing:
        ctx.otherParts === undefined || ctx.otherParts.length === 0
          ? `Only the destination and this part were in the tube; a set that needs other parts cannot close without them.`
          : null,
      warnings,
    };
  }
  for (const w of run.assembly.warnings) {
    warnings.push({ kind: 'overhang', severity: 'caution', text: w.text });
  }
  const product = recordGoldenGate(
    run.assembly,
    second === undefined ? [enzyme.name] : [enzyme.name, second.name],
  );
  return { amplicon, product, problem: null, missing: null, warnings };
}
