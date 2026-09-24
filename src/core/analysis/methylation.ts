import { type Topology } from '../range';
import { type CutSite } from './restriction';

/**
 * Dam and Dcm methylation, which most laboratory E. coli strains put on the
 * DNA they replicate, and which blocks or impairs some restriction enzymes
 * where it falls inside their site (#17). Mammalian DNA, PCR products and
 * DNA from a dam–/dcm– strain carry none.
 */
export type HostMethylation = 'Dam' | 'Dcm';

/**
 * Enzymes NEB lists as blocked or impaired by Dam or Dcm methylation
 * ("DNA Methylation & Restriction Digests", NEB application note), by
 * lowercased name. Whether a given site is affected is then a question of
 * the sequence around it (`hostMethylationAt`); an enzyme not listed here
 * cuts regardless, like BamHI, whose GGATCC holds a GATC it ignores.
 *
 * A name, not a site, because sensitivity is the enzyme's own: MboI and
 * Sau3AI share GATC, and only MboI is blocked by Dam.
 */
export const DAM_DCM_SENSITIVE: ReadonlySet<string> = new Set(
  [
    'Acc65I',
    'AlwI',
    'AlwNI',
    'ApaI',
    'AvaII',
    'BanI',
    'BcgI',
    'BclI',
    'BsaI',
    'BsaBI',
    'BsaHI',
    'BslI',
    'BsmFI',
    'BspDI',
    'BspEI',
    'BspHI',
    'BssKI',
    'BstXI',
    'ClaI',
    'DpnII',
    'EaeI',
    'EcoO109I',
    'FokI',
    'FspI',
    'HphI',
    'Hpy188I',
    'Hpy188III',
    'MboI',
    'MboII',
    'MscI',
    'NlaIV',
    'NruI',
    'PflMI',
    'PhoI',
    'PpuMI',
    'PspGI',
    'PspOMI',
    'Sau96I',
    'ScrFI',
    'SexAI',
    'SfiI',
    'SfoI',
    'StuI',
    'StyD4I',
    'TaqI',
    'XbaI',
  ].map((n) => n.toLowerCase()),
);

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
 * Which host methylation would sit inside this recognition site, reading
 * the sequence around it: a GATC or CCWGG that overlaps the site with its
 * methylated base inside it, the site's own bases or ones the flank adds to
 * them. Only for enzymes NEB lists as sensitive; empty for all others.
 */
export function hostMethylationAt(
  sequence: string,
  topology: Topology,
  site: Pick<CutSite, 'enzyme' | 'siteStart'>,
  siteLength: number,
): HostMethylation[] {
  if (!isHostMethylationSensitive(site.enzyme)) return [];
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
  const out: HostMethylation[] = [];
  for (const { kind, motif, methylated } of MOTIFS) {
    motif.lastIndex = 0;
    for (let m = motif.exec(window); m !== null; m = motif.exec(window)) {
      motif.lastIndex = m.index + 1;
      const inside = methylated.some((k) => {
        const at = offset + m.index + k;
        return at >= site.siteStart && at < site.siteStart + siteLength;
      });
      if (inside) {
        out.push(kind);
        break;
      }
    }
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
