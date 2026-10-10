import {
  type LineageNode,
  type LineageStep,
  describeLineageStep,
  editedSinceMade,
} from '../lineage';
import { type SeqDocument } from '../document';
import {
  type DigestProfile,
  type GelOptions,
  compareDiagnostic,
  enzymeProfile,
} from '../analysis/gel';
import { cuttableSites } from '../analysis/methylation';
import { activeEnzymes, findCutSites } from '../analysis/restriction';
import {
  cleanPrimer,
  meltingTemperature,
  q5AnnealingTemperature,
  q5MeltingTemperature,
} from '../primers';

/**
 * A bench protocol for a product (#215, item 78): what to order, which
 * reactions to set up, in what order, and what the gel should show.
 *
 * It is built from the lineage the product carries (item 52) and nothing
 * else, so it holds only what that records: names, sizes, enzymes, primers
 * and settings. The numbers come from calculations the app already does
 * (melting temperature, the gel, the restriction scan); the programs are
 * the textbook ones for each reaction, stated as such. It does not model
 * the chemistry any further than that.
 */

/** An oligo to order, once however many reactions use it. */
export interface ProtocolOligo {
  readonly name: string;
  /** 5′ to 3′. */
  readonly sequence: string;
  readonly length: number;
  /** The products it is used to make. */
  readonly usedFor: readonly string[];
  /** The name of the same oligo in My primers, when it is already there. */
  readonly inCollection: string | null;
}

export interface PcrStep {
  readonly kind: 'pcr';
  readonly product: string;
  readonly productLength: number;
  readonly template: string;
  readonly templateLength: number;
  readonly forward: ProtocolOligo;
  readonly reverse: ProtocolOligo;
  readonly polymerase: 'proofreading' | 'taq';
  /** Melting temperatures of the annealing parts, °C; NaN where the bases are ambiguous. */
  readonly tmForward: number;
  readonly tmReverse: number;
  /** Suggested annealing temperature, °C, or null when a Tm could not be worked out. */
  readonly annealing: number | null;
  /** Seconds of extension per cycle. */
  readonly extensionSeconds: number;
}

export interface DigestStep {
  readonly kind: 'digest';
  readonly product: string;
  readonly productLength: number;
  readonly template: string;
  readonly templateLength: number;
  readonly enzymes: readonly string[];
  readonly uncut: number;
  readonly notes: readonly string[];
}

/** One part of an assembly with the amount that goes in the tube. */
export interface ProtocolPart {
  readonly name: string;
  readonly length: number;
  readonly role: 'vector' | 'insert';
  readonly ng: number;
  readonly pmol: number;
  /** Microlitres, when a concentration was entered for it. */
  readonly microlitres: number | null;
  /** The concentration used, ng/µL. */
  readonly concentration: number | null;
}

export interface AssemblyStep {
  readonly kind: 'ligation' | 'golden-gate' | 'gibson';
  readonly product: string;
  readonly productLength: number;
  readonly description: string;
  readonly parts: readonly ProtocolPart[];
  /** Molar ratio of each insert to the vector. */
  readonly ratio: number;
  readonly enzymes: readonly string[];
  /** The conditions, one line each. */
  readonly program: readonly string[];
}

/** A reaction with nothing to measure out: Gateway, mutagenesis, phosphates. */
export interface OtherStep {
  readonly kind: 'other';
  readonly product: string;
  readonly productLength: number;
  readonly description: string;
  readonly parts: readonly string[];
}

export type ProtocolStep = PcrStep | DigestStep | AssemblyStep | OtherStep;

export interface DiagnosticDigest {
  readonly enzyme: string;
  readonly cuts: number;
  readonly profile: DigestProfile;
}

export interface Protocol {
  readonly product: string;
  readonly length: number;
  readonly topology: 'circular' | 'linear';
  /** Reactions in the order to run them: the first makes a part of the next. */
  readonly steps: readonly ProtocolStep[];
  readonly oligos: readonly ProtocolOligo[];
  /** Digests to check the product by, clearest first. */
  readonly diagnostics: readonly DiagnosticDigest[];
  /** Things the record could not say, e.g. molecules a long tree left out. */
  readonly caveats: readonly string[];
}

export interface ProtocolOptions {
  /** Vector in each assembly, ng. */
  readonly vectorNg?: number;
  /** Insert-to-vector molar ratio; by default 3 for a ligation and 2 for the others. */
  readonly ratio?: number;
  /** Concentration in ng/µL by part name, for the volumes. */
  readonly concentrations?: Readonly<Record<string, number>>;
  /** Oligos already kept, to mark among those to order. */
  readonly collection?: readonly { readonly name: string; readonly sequence: string }[];
  readonly gel?: GelOptions;
  /** How many diagnostic digests to list. */
  readonly diagnosticCount?: number;
}

export const DEFAULT_VECTOR_NG = 50;
const MAX_DIAGNOSTIC_CUTS = 6;
/** Longest primer taken to anneal along its whole length. */
const WHOLE_PRIMER = 30;
/** Bases of the 3′ end taken as the annealing part of a longer, tailed primer. */
const TAIL_ANNEAL = 22;

/**
 * The part of an oligo to take the melting temperature of. The lineage keeps
 * the whole oligo, not where it anneals, so a long one is taken to be a
 * tailed cloning primer and its 3′ end to anneal; a short one anneals whole.
 */
export function annealingPart(sequence: string): string {
  const s = cleanPrimer(sequence);
  return s.length <= WHOLE_PRIMER ? s : s.slice(s.length - TAIL_ANNEAL);
}

/** ng of DNA to pmol of molecules, 660 g/mol per base pair. */
export function pmolOf(ng: number, bp: number): number {
  return bp <= 0 ? 0 : ng / (0.66 * bp);
}

/** pmol of DNA to ng. */
export function ngOf(pmol: number, bp: number): number {
  return pmol * 0.66 * bp;
}

function round(x: number, digits: number): number {
  const k = 10 ** digits;
  return Math.round(x * k) / k;
}

function oligoFor(
  name: string,
  sequence: string,
  product: string,
  collection: ProtocolOptions['collection'],
): ProtocolOligo {
  const clean = cleanPrimer(sequence);
  const kept = collection?.find((p) => cleanPrimer(p.sequence) === clean);
  return {
    name,
    sequence: clean,
    length: clean.length,
    usedFor: [product],
    inCollection: kept?.name ?? null,
  };
}

function pcrStep(
  node: LineageNode,
  step: Extract<LineageStep, { op: 'pcr' }>,
  collection: ProtocolOptions['collection'],
): PcrStep {
  const template = step.parents[0];
  const forward = oligoFor(step.forward.name, step.forward.sequence, node.name, collection);
  const reverse = oligoFor(step.reverse.name, step.reverse.sequence, node.name, collection);
  const proof = step.polymerase === 'proofreading';
  const tm = proof ? q5MeltingTemperature : meltingTemperature;
  const tmForward = tm(annealingPart(forward.sequence));
  const tmReverse = tm(annealingPart(reverse.sequence));
  let annealing: number | null = null;
  if (!Number.isNaN(tmForward) && !Number.isNaN(tmReverse)) {
    annealing = proof
      ? q5AnnealingTemperature(tmForward, tmReverse)
      : round(Math.min(tmForward, tmReverse) - 5, 1);
  }
  // 30 s per kb for a proofreading enzyme (Q5's 20-30 s/kb, Phusion's 15-30),
  // 60 s per kb for Taq, never under 10 s.
  const perKb = proof ? 30 : 60;
  return {
    kind: 'pcr',
    product: node.name,
    productLength: node.length,
    template: template?.name ?? 'template',
    templateLength: template?.length ?? 0,
    forward,
    reverse,
    polymerase: step.polymerase,
    tmForward,
    tmReverse,
    annealing,
    extensionSeconds: Math.max(10, Math.ceil((node.length / 1000) * perKb)),
  };
}

function digestNotes(enzymes: readonly string[], uncut: number): string[] {
  const notes: string[] = [];
  if (enzymes.length > 1) {
    notes.push(
      'Two enzymes: check that both are active in one buffer, or cut with one, clean up, then the other.',
    );
  }
  if (uncut > 0)
    notes.push(`A partial digest: stop it early, leaving ${String(uncut)} site(s) uncut.`);
  notes.push('Buffer and incubation: take them from the supplier’s table; PlasmidPop holds none.');
  return notes;
}

const DEFAULT_RATIO: Readonly<Record<AssemblyStep['kind'], number>> = {
  ligation: 3,
  'golden-gate': 2,
  gibson: 2,
};

const PROGRAMS: Readonly<Record<AssemblyStep['kind'], readonly string[]>> = {
  ligation: ['T4 DNA ligase: 16 °C overnight, or 25 °C for 10 min for sticky ends.'],
  'golden-gate': [
    '30 cycles of 37 °C for 1 min and 16 °C for 1 min',
    '60 °C for 5 min to inactivate',
  ],
  gibson: ['50 °C for 15 min (up to 60 min for more than 4 parts)'],
};

function assemblyStep(
  node: LineageNode,
  step: Extract<LineageStep, { op: 'ligation' | 'golden-gate' | 'gibson' }>,
  options: ProtocolOptions,
): AssemblyStep {
  const kind = step.op;
  const ratio = options.ratio ?? DEFAULT_RATIO[kind];
  const vectorNg = options.vectorNg ?? DEFAULT_VECTOR_NG;
  let vectorIndex = 0;
  step.parents.forEach((p, i) => {
    if (p.length > (step.parents[vectorIndex]?.length ?? 0)) vectorIndex = i;
  });
  const vector = step.parents[vectorIndex];
  const vectorPmol = pmolOf(vectorNg, vector?.length ?? 0);
  const parts = step.parents.map((p, i): ProtocolPart => {
    const isVector = i === vectorIndex;
    const pmol = isVector ? vectorPmol : vectorPmol * ratio;
    const ng = isVector ? vectorNg : ngOf(pmol, p.length);
    const conc = options.concentrations?.[p.name];
    const usable = conc !== undefined && conc > 0 ? conc : null;
    return {
      name: p.name,
      length: p.length,
      role: isVector ? 'vector' : 'insert',
      ng: round(ng, 2),
      pmol: round(pmol, 4),
      microlitres: usable === null ? null : round(ng / usable, 2),
      concentration: usable,
    };
  });
  const enzymes = step.op === 'golden-gate' ? step.enzymes : [];
  return {
    kind,
    product: node.name,
    productLength: node.length,
    description: describeLineageStep(step),
    parts,
    ratio,
    enzymes,
    program: PROGRAMS[kind],
  };
}

/** The reactions of a tree, parents before what they made. */
function collectSteps(
  node: LineageNode,
  options: ProtocolOptions,
  out: ProtocolStep[],
  caveats: string[],
): void {
  const step = node.step;
  if (step === null) return;
  if (step.op === 'elided') {
    caveats.push(
      `${String(step.nodes)} earlier molecule(s) below ${node.name} were left out of the record to keep it small.`,
    );
    return;
  }
  for (const p of step.parents) collectSteps(p, options, out, caveats);
  switch (step.op) {
    case 'pcr':
      out.push(pcrStep(node, step, options.collection));
      return;
    case 'digest':
      out.push({
        kind: 'digest',
        product: node.name,
        productLength: node.length,
        template: step.parents[0]?.name ?? 'template',
        templateLength: step.parents[0]?.length ?? 0,
        enzymes: step.enzymes,
        uncut: step.uncut,
        notes: digestNotes(step.enzymes, step.uncut),
      });
      return;
    case 'ligation':
    case 'golden-gate':
    case 'gibson':
      // Overlap-extension joins by polymerase, not by an assembly mix: the
      // fragments are the ones' PCR products listed before it, and the
      // reaction is run without the outer primers (#216).
      if (step.op === 'gibson' && step.kit === 'overlap-extension') {
        out.push({
          kind: 'other',
          product: node.name,
          productLength: node.length,
          description: `${describeLineageStep(step)}: mix the first-round products in equimolar amounts, run about 10 cycles with no primers so they anneal at their overlaps and extend, then add the outer primers`,
          parts: step.parents.map((p) => p.name),
        });
        return;
      }
      out.push(assemblyStep(node, step, options));
      return;
    case 'mutagenesis':
    case 'gateway':
    case 'phosphates':
    case 'edited':
    case 'other':
      out.push({
        kind: 'other',
        product: node.name,
        productLength: node.length,
        description: describeLineageStep(step),
        parts: step.parents.map((p) => p.name),
      });
      return;
  }
}

/** The oligos of a mutagenesis step, which the lineage keeps without names. */
function mutagenesisOligos(
  node: LineageNode,
  step: Extract<LineageStep, { op: 'mutagenesis' }>,
  collection: ProtocolOptions['collection'],
): ProtocolOligo[] {
  return step.primers.map((s, i) =>
    oligoFor(`${node.name} ${i === 0 ? 'forward' : 'reverse'}`, s, node.name, collection),
  );
}

function collectOligos(
  node: LineageNode,
  collection: ProtocolOptions['collection'],
  out: ProtocolOligo[],
): void {
  const step = node.step;
  if (step === null || step.op === 'elided') return;
  for (const p of step.parents) collectOligos(p, collection, out);
  const found: ProtocolOligo[] =
    step.op === 'pcr'
      ? [
          oligoFor(step.forward.name, step.forward.sequence, node.name, collection),
          oligoFor(step.reverse.name, step.reverse.sequence, node.name, collection),
        ]
      : step.op === 'mutagenesis'
        ? mutagenesisOligos(node, step, collection)
        : [];
  for (const o of found) {
    const same = out.findIndex((x) => x.sequence === o.sequence);
    if (same < 0) out.push(o);
    else {
      const prior = out[same];
      if (prior !== undefined && !prior.usedFor.includes(node.name)) {
        out[same] = { ...prior, usedFor: [...prior.usedFor, node.name] };
      }
    }
  }
}

/**
 * The single-enzyme digests that check `doc`, clearest first: each enzyme in
 * the set in use that cuts it between once and six times (host methylation
 * allowed for), ranked as the Enzymes tab ranks its band separation.
 */
export function diagnosticDigests(
  doc: SeqDocument,
  gel: GelOptions = {},
  count = 3,
): DiagnosticDigest[] {
  const text = doc.sequence.toString();
  const enzymes = activeEnzymes();
  const sizeOf = new Map(enzymes.map((e) => [e.name, e.site.length]));
  const sites = cuttableSites(
    text,
    doc.topology,
    doc.methylation,
    findCutSites(text, doc.topology, enzymes),
    (name) => sizeOf.get(name) ?? 0,
  );
  const byEnzyme = new Map<string, typeof sites>();
  for (const s of sites) byEnzyme.set(s.enzyme, [...(byEnzyme.get(s.enzyme) ?? []), s]);
  const out: DiagnosticDigest[] = [];
  for (const [enzyme, own] of byEnzyme) {
    if (own.length > MAX_DIAGNOSTIC_CUTS) continue;
    out.push({
      enzyme,
      cuts: own.length,
      profile: enzymeProfile(own, doc.length, doc.topology, gel),
    });
  }
  out.sort(
    (a, b) => compareDiagnostic(a.profile, b.profile, gel) || a.enzyme.localeCompare(b.enzyme),
  );
  return out.slice(0, count);
}

/** The protocol for a document made here, or null when it carries no record of how. */
export function buildProtocol(doc: SeqDocument, options: ProtocolOptions = {}): Protocol | null {
  const root = doc.metadata.lineage;
  if (root === null) return null;
  const steps: ProtocolStep[] = [];
  const caveats: string[] = [];
  collectSteps(root, options, steps, caveats);
  const oligos: ProtocolOligo[] = [];
  collectOligos(root, options.collection, oligos);
  if (editedSinceMade(doc)) {
    caveats.push(
      'The product has been edited since it was made; the reactions describe the molecule as made, and the digests are of the document as it is now.',
    );
  }
  return {
    product: doc.name,
    length: doc.length,
    topology: doc.isCircular ? 'circular' : 'linear',
    steps,
    oligos,
    diagnostics: diagnosticDigests(doc, options.gel, options.diagnosticCount ?? 3),
    caveats,
  };
}
