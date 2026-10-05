import { type Topology } from '../range';
import { type CutSite, getEnzyme } from './restriction';

/**
 * Dam and Dcm methylation, which most laboratory E. coli strains put on the
 * DNA they replicate, and which blocks or impairs some restriction enzymes
 * where it falls inside their site (#17). Mammalian DNA, PCR products and
 * DNA from a dam–/dcm– strain carry none.
 */
export type HostMethylation = 'Dam' | 'Dcm';

/**
 * Which overlapping Dam or Dcm methylation blocks or impairs an enzyme, from
 * REBASE's "Effects of overlapping methylation" tables for NEB's enzymes
 * (`rebase.neb.com/cgi-bin/damlist?mM.EcoKDam+sN`, `mM.EcoKDcm+sN`), the
 * facts they record, not their text (item 44, #135).
 *
 * A configuration is the set of methylated bases that fall inside the
 * enzyme's recognition site, as its offsets on the top strand and on the
 * bottom strand, the site read the way the enzyme's name spells it. The
 * enzyme is affected when the DNA carries at least those bases: GATCTAGATC
 * methylates two bases of XbaI's TCTAGA and the listed configuration asks
 * for one or both, while SfoI is blocked only when CCWGG methylates both
 * strands of its site, not one. A methylated base is the A of GATC and the
 * one opposite its T (Dam), the inner C of CCWGG and the one opposite its
 * second G (Dcm).
 *
 * Where REBASE gives one configuration both "cut" and "impaired" from
 * different tests, it is read as cut unless it is also "blocked": the
 * impairment in those rows (FokI, HaeIII, BslI's single Dcm base) was
 * measured with M.HpaII or M.SssI, not Dcm.
 */
export type Configuration = readonly [top: readonly number[], bottom: readonly number[]];

export const REBASE_CONFIGURATIONS: Readonly<
  Record<string, Partial<Record<HostMethylation, readonly Configuration[]>>>
> = {
  Acc65I: {
    Dcm: [
      [[5], []],
      [[5], [0]],
    ],
  },
  AlwI: { Dam: [[[2], [3]]] },
  AlwNI: {
    Dcm: [
      [[0], [2]],
      [
        [0, 6],
        [2, 8],
      ],
    ],
  },
  ApaI: {
    Dcm: [
      [[5], []],
      [[5], [0]],
    ],
  },
  AvaII: {
    Dcm: [
      [[4], []],
      [[4], [0]],
    ],
  },
  BanI: {
    Dcm: [
      [[5], []],
      [[5], [0]],
    ],
  },
  BsaBI: {
    Dam: [
      [[1], [2]],
      [
        [1, 7],
        [2, 8],
      ],
    ],
  },
  BsaHI: { Dcm: [[[5], [0]]] },
  BsaI: { Dcm: [[[], [0]]] },
  BslI: { Dcm: [[[1], [9]]] },
  BsmFI: { Dcm: [[[], [0]]] },
  BspDI: {
    Dam: [
      [[0], [1]],
      [
        [0, 4],
        [1, 5],
      ],
    ],
  },
  BspEI: {
    Dam: [
      [[5], []],
      [[5], [0]],
    ],
  },
  BspHI: {
    Dam: [
      [[5], []],
      [[5], [0]],
    ],
  },
  BstXI: { Dcm: [[[1], [10]]] },
  ClaI: {
    Dam: [
      [[0], [1]],
      [
        [0, 4],
        [1, 5],
      ],
    ],
  },
  EaeI: {
    Dcm: [
      [[4], []],
      [[4], [1]],
    ],
  },
  EciI: { Dam: [[[5], []]] },
  EcoO109I: {
    Dcm: [
      [[5], []],
      [[5], [0]],
      [[5], [1]],
    ],
  },
  FseI: { Dcm: [[[7], [0]]] },
  HphI: { Dam: [[[4], []]] },
  Hpy188I: {
    Dam: [
      [[4], []],
      [[4], [0]],
    ],
  },
  Hpy188III: {
    Dam: [
      [[5], []],
      [[5], [0]],
    ],
  },
  MboI: { Dam: [[[1], [2]]] },
  MboII: { Dam: [[[4], []]] },
  MscI: {
    Dcm: [
      [[4], []],
      [[4], [1]],
    ],
  },
  NlaIV: {
    Dcm: [
      [[5], []],
      [[5], [0]],
    ],
  },
  NruI: {
    Dam: [
      [[5], []],
      [[5], [0]],
    ],
  },
  PflMI: {
    Dcm: [
      [[1], []],
      [[1], [9]],
    ],
  },
  PpuMI: {
    Dcm: [
      [[5], []],
      [[5], [0]],
      [[5], [1]],
    ],
  },
  PspGI: { Dcm: [[[1], [3]]] },
  PspOMI: {
    Dcm: [
      [[5], []],
      [[5], [0]],
    ],
  },
  Sau96I: {
    Dcm: [
      [[4], []],
      [[4], [0]],
    ],
  },
  ScrFI: { Dcm: [[[1], [3]]] },
  SexAI: { Dcm: [[[2], [4]]] },
  SfiI: {
    Dcm: [
      [[3], []],
      [[3, 12], []],
      [[3], [0]],
      [[3, 12], [0]],
    ],
  },
  SfoI: { Dcm: [[[5], [0]]] },
  StuI: {
    Dcm: [
      [[4], []],
      [[4], [1]],
    ],
  },
  StyD4I: { Dcm: [[[1], [3]]] },
  TaqI: {
    Dam: [
      [[3], []],
      [[3], [0]],
    ],
  },
  XbaI: {
    Dam: [
      [[5], []],
      [[5], [0]],
    ],
  },
};

/**
 * Enzymes NEB's application note ("DNA Methylation & Restriction Digests")
 * lists as sensitive that REBASE's tables above have no configuration for:
 * any methylated base of the named methylase inside the site counts. BcgI,
 * FspI and PhoI are named without a methylase, so either one does.
 */
export const ANY_OVERLAP: Readonly<Record<string, readonly HostMethylation[]>> = {
  BclI: ['Dam'],
  DpnII: ['Dam'],
  BssKI: ['Dcm'],
  BcgI: ['Dam', 'Dcm'],
  FspI: ['Dam', 'Dcm'],
  PhoI: ['Dam', 'Dcm'],
};

const lower = <T>(table: Readonly<Record<string, T>>): ReadonlyMap<string, T> =>
  new Map(Object.entries(table).map(([name, v]) => [name.toLowerCase(), v]));
const CONFIGURATIONS = lower(REBASE_CONFIGURATIONS);
const ANY = lower(ANY_OVERLAP);

/** Lowercased names of every enzyme Dam or Dcm can affect. */
export const DAM_DCM_SENSITIVE: ReadonlySet<string> = new Set([
  ...CONFIGURATIONS.keys(),
  ...ANY.keys(),
]);

export function isHostMethylationSensitive(enzyme: string): boolean {
  return DAM_DCM_SENSITIVE.has(enzyme.toLowerCase());
}

/**
 * Each motif, and where in it the methylated base sits on either strand, in
 * top-strand offsets. Dam puts N6-methyladenine on the A of GATC (REBASE's
 * M.EcoKDam, `2(6)`), and GATC being palindromic, on the bottom strand's A,
 * opposite the T. Dcm puts 5-methylcytosine on the internal C of CCWGG and
 * on the bottom strand's, opposite the second G.
 */
const MOTIFS: readonly {
  readonly kind: HostMethylation;
  readonly motif: RegExp;
  readonly length: number;
  readonly methylated: readonly number[];
}[] = [
  { kind: 'Dam', motif: /GATC/g, length: 4, methylated: [1, 2] },
  { kind: 'Dcm', motif: /CC[AT]GG/g, length: 5, methylated: [1, 3] },
];

/**
 * Which host methylation sits inside this recognition site in a way the
 * enzyme is sensitive to (#135): the methylated bases the sequence around
 * the site puts inside it, matched against the configurations REBASE lists
 * for the enzyme. Empty for an enzyme not in the table. A site found on the
 * reverse strand is read mirrored, since the configurations follow the
 * enzyme's own spelling of its site.
 */
export function hostMethylationAt(
  sequence: string,
  topology: Topology,
  site: Pick<CutSite, 'enzyme' | 'siteStart'> & { readonly strand?: CutSite['strand'] },
  siteLength: number,
): HostMethylation[] {
  const name = site.enzyme.toLowerCase();
  const configurations = CONFIGURATIONS.get(name);
  const any = ANY.get(name);
  if (configurations === undefined && any === undefined) return [];
  const L = sequence.length;
  const reach = 4;
  const from = site.siteStart - reach;
  const to = site.siteStart + siteLength + reach;
  // The stretch around the site, wrapping on a circle, clipped on a line.
  let window = '';
  let offset = from;
  if (topology === 'circular' && L > 0) {
    for (let i = from; i < to; i++) window += sequence.charAt(((i % L) + L) % L);
  } else {
    offset = Math.max(0, from);
    window = sequence.slice(offset, Math.min(L, to));
  }
  window = window.toUpperCase();
  const mirror = site.strand === 'reverse';
  const palindromic = getEnzyme(site.enzyme)?.palindromic === true;
  const out: HostMethylation[] = [];
  for (const { kind, motif, methylated } of MOTIFS) {
    // Offsets inside the site of the bases this methylase puts on each
    // strand, in the enzyme's own orientation.
    const top = new Set<number>();
    const bottom = new Set<number>();
    motif.lastIndex = 0;
    for (let m = motif.exec(window); m !== null; m = motif.exec(window)) {
      motif.lastIndex = m.index + 1;
      methylated.forEach((k, strandIndex) => {
        const at = offset + m.index + k - site.siteStart;
        if (at < 0 || at >= siteLength) return;
        const onTop = strandIndex === 0;
        const position = mirror ? siteLength - 1 - at : at;
        // The first listed base is on the top strand, the second on the bottom.
        (onTop !== mirror ? top : bottom).add(position);
      });
    }
    if (top.size === 0 && bottom.size === 0) continue;
    const fits = (t: ReadonlySet<number>, b: ReadonlySet<number>): boolean => {
      const listed = configurations?.[kind];
      return listed !== undefined
        ? listed.some(([ct, cb]) => ct.every((p) => t.has(p)) && cb.every((p) => b.has(p)))
        : any?.includes(kind) === true;
    };
    // REBASE draws a palindromic site once; its mirror image, the same
    // DNA read from the other strand, is the same configuration (MscI's
    // TGGCCAGG and CCTGGCCA).
    const flip = (set: ReadonlySet<number>) => new Set([...set].map((p) => siteLength - 1 - p));
    const affected = fits(top, bottom) || (palindromic && fits(flip(bottom), flip(top)));
    if (affected) out.push(kind);
  }
  return out;
}

/**
 * Where a document's DNA was grown, as far as its restriction sites are
 * concerned (#45). Almost every plasmid on a bench comes out of an
 * ordinary `dam+ dcm+` laboratory strain of E. coli, so that is the
 * default; DNA made in a tube (a PCR product) carries no methylation at
 * all, and DNA from a `dam−/dcm−` strain carries whichever was knocked out.
 */
export interface HostMethylationState {
  readonly dam: boolean;
  readonly dcm: boolean;
}

/** An ordinary laboratory strain: what a plasmid is assumed to come from. */
export const METHYLATED_HOST: HostMethylationState = { dam: true, dcm: true };

/** DNA made in a tube, or grown in a `dam− dcm−` strain. */
export const UNMETHYLATED_HOST: HostMethylationState = { dam: false, dcm: false };

export function methylationEqual(a: HostMethylationState, b: HostMethylationState): boolean {
  return a.dam === b.dam && a.dcm === b.dcm;
}

/** "dam+/dcm+", "dam+ only", "unmethylated" — how the UI and a file say it. */
export function describeHost(state: HostMethylationState): string {
  if (state.dam && state.dcm) return 'dam+/dcm+';
  if (state.dam) return 'dam+ only';
  if (state.dcm) return 'dcm+ only';
  return 'unmethylated';
}

/**
 * Whether this host's methylation blocks a cut that `hostMethylationAt`
 * marked. A site marked for Dcm is cut normally by DNA from a `dcm−`
 * strain, which is why the marks and the host are kept apart.
 */
export function blockedByHost(
  state: HostMethylationState,
  marks: readonly HostMethylation[],
): boolean {
  return marks.some((m) => (m === 'Dam' ? state.dam : state.dcm));
}

/**
 * The sites of `sites` that would actually cut DNA grown as `state` says
 * (#45): a site an enzyme is sensitive to, with Dam or Dcm inside it and
 * that methylase present, is left out.
 *
 * The marks themselves (`hostMethylationAt`) are about the sequence and
 * stay whatever the host is — the Enzymes tab shows them either way, since
 * "this site would be blocked in a dam+ strain" is worth knowing about DNA
 * that is not in one. This is the other half: what the tube would do.
 */
export function cuttableSites(
  sequence: string,
  topology: Topology,
  state: HostMethylationState,
  sites: readonly CutSite[],
  siteLength: (enzyme: string) => number,
): CutSite[] {
  if (!state.dam && !state.dcm) return [...sites];
  return sites.filter(
    (site) =>
      !blockedByHost(state, hostMethylationAt(sequence, topology, site, siteLength(site.enzyme))),
  );
}
