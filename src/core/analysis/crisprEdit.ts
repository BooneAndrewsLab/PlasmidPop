import { type Range, type Topology } from '../range';
import { complement, reverseComplement } from '../sequence';
import { type CrisprGuide, type Nuclease } from './crispr';

/**
 * Base-editing windows and pegRNA design on top of the guide scan (item 81).
 * Both are SpCas9 features: the windows are defined by position in a 20 nt
 * spacer with an NGG PAM, and prime editing nicks the PAM strand three bases
 * from the PAM. Nothing here scores efficiency (item 74).
 */

// ------------------------------------------------------------ base editing

export interface BaseEditor {
  readonly id: string;
  readonly name: string;
  /** The base the deaminase converts, and what it becomes, on the guide's strand. */
  readonly from: string;
  readonly to: string;
  /** The editing window, 1-based and inclusive, counted from the spacer's 5' end. */
  readonly window: readonly [number, number];
}

/**
 * Presets. BE4max-style cytosine editors edit C to T at protospacer
 * positions 4-8 (Komor 2016); ABE7.10 edits A to G at 4-7 (Gaudelli 2017)
 * and ABE8e at 4-8 (Richter 2020). Positions count the PAM as 21-23.
 */
export const BASE_EDITORS: readonly BaseEditor[] = [
  { id: 'cbe', name: 'CBE (C to T, positions 4-8)', from: 'C', to: 'T', window: [4, 8] },
  { id: 'abe7', name: 'ABE7.10 (A to G, positions 4-7)', from: 'A', to: 'G', window: [4, 7] },
  { id: 'abe8e', name: 'ABE8e (A to G, positions 4-8)', from: 'A', to: 'G', window: [4, 8] },
];

/** Base editing windows are measured for a 20 nt SpCas9 spacer only. */
export function supportsBaseEditing(
  n: Pick<Nuclease, 'pam' | 'pamSide' | 'spacerLength'>,
): boolean {
  return n.pamSide === '3prime' && n.pam === 'NGG' && n.spacerLength === 20;
}

export interface EditableBase {
  /** Position in the spacer, 1-based from its 5' end. */
  readonly position: number;
  /** The base in the guide's strand. */
  readonly base: string;
  /** Forward-strand coordinate of the base, 0-based, unrolled like the guide's range. */
  readonly at: number;
}

export interface BaseEditWindow {
  readonly editor: BaseEditor;
  /** The window as a forward-coordinate range, 0-based half-open, unrolled. */
  readonly range: Range;
  /** Every base in the window the editor converts, in spacer order. */
  readonly editable: readonly EditableBase[];
  /** The spacer after every editable base is converted (the all-edited outcome). */
  readonly edited: string;
}

/**
 * Where `editor` acts on `guide`: the bases in the window it can convert.
 * `null` for a spacer too short to hold the window.
 */
export function baseEditWindow(guide: CrisprGuide, editor: BaseEditor): BaseEditWindow | null {
  const [from, to] = editor.window;
  const n = guide.spacer.length;
  if (to > n) return null;
  const forward = guide.strand === 'forward';
  const at = (position: number): number =>
    forward ? guide.range.start + position - 1 : guide.range.end - position;
  const editable: EditableBase[] = [];
  const chars = guide.spacer.split('');
  for (let p = from; p <= to; p++) {
    const base = chars[p - 1];
    if (base === undefined || base !== editor.from) continue;
    editable.push({ position: p, base, at: at(p) });
    chars[p - 1] = editor.to;
  }
  const a = at(from);
  const b = at(to);
  return {
    editor,
    range: { start: Math.min(a, b), end: Math.max(a, b) + 1 },
    editable,
    edited: chars.join(''),
  };
}

// ----------------------------------------------------------- prime editing

/** The edit a pegRNA is to install: replace `deleteLength` bases at `start` with `insert`. */
export interface PrimeEdit {
  /** 0-based position on the forward strand. */
  readonly start: number;
  readonly deleteLength: number;
  /** Forward-strand bases written in, plain ACGT; may be empty. */
  readonly insert: string;
}

export interface PegRnaOptions {
  /** Primer binding site length, 8-17 (default 13). */
  readonly pbsLength?: number;
  /** Bases of unchanged homology the template carries after the edit (default 10). */
  readonly homology?: number;
}

export const DEFAULT_PBS = 13;
export const MIN_PBS = 8;
export const MAX_PBS = 17;
export const DEFAULT_HOMOLOGY = 10;
/** An edit further than this from the nick is out of reach of a pegRNA. */
export const MAX_NICK_DISTANCE = 30;
/** The longest reverse-transcriptase template offered. */
export const MAX_RTT = 60;

export interface PegRna {
  readonly guide: CrisprGuide;
  /** The nick: a forward-coordinate boundary between bases, unrolled. */
  readonly nick: number;
  /** Bases from the nick to the first changed base, along the PAM strand. */
  readonly distance: number;
  /** Primer binding site, 5'→3' (RNA written as DNA). */
  readonly pbs: string;
  /** Reverse-transcriptase template, 5'→3'. */
  readonly rtt: string;
  /** The 3' extension as ordered: template then primer binding site. */
  readonly extension: string;
  /** The edit also changes the PAM, which stops the edited site being nicked again. */
  readonly disruptsPam: boolean;
  readonly flags: readonly string[];
}

/** Why `edit` cannot be made, or null when it can. */
export function primeEditProblem(
  edit: PrimeEdit,
  length: number,
  topology: Topology,
): string | null {
  if (!/^[ACGT]*$/.test(edit.insert)) return 'The new bases must be plain A, C, G and T.';
  if (!Number.isInteger(edit.start) || edit.start < 0 || edit.start > length) {
    return 'The edit position is outside the sequence.';
  }
  if (!Number.isInteger(edit.deleteLength) || edit.deleteLength < 0) {
    return 'The number of bases to replace must be 0 or more.';
  }
  if (topology === 'linear' && edit.start + edit.deleteLength > length) {
    return 'The edit runs past the end of the sequence.';
  }
  if (topology === 'circular' && edit.deleteLength > length) {
    return 'The edit is longer than the sequence.';
  }
  if (edit.deleteLength === 0 && edit.insert === '') return 'Nothing to change.';
  return null;
}

const mod = (a: number, m: number): number => ((a % m) + m) % m;

/** Prime editing nicks the PAM strand with an SpCas9 nickase: 3' PAM, one cut point. */
export function supportsPrimeEditing(
  n: Pick<Nuclease, 'pamSide' | 'cut' | 'spacerLength'>,
): boolean {
  return n.pamSide === '3prime' && n.cut.pamStrand === n.cut.targetStrand;
}

/**
 * pegRNAs that install `edit`, one per guide whose nick is up to
 * `MAX_NICK_DISTANCE` bases upstream of it on the PAM strand, nearest nick
 * first. The pegRNA's 3' extension is the reverse complement of the edited
 * PAM-strand sequence from `pbsLength` bases before the nick to `homology`
 * bases past the edit: its 5' part templates reverse transcription, its 3'
 * end primes it. Only guides whose whole footprint lies in the sequence are
 * offered, wrapping the origin on a circle.
 */
export function designPegRnas(
  sequence: string,
  topology: Topology,
  guides: readonly CrisprGuide[],
  nuclease: Pick<Nuclease, 'pamSide' | 'cut' | 'spacerLength'>,
  edit: PrimeEdit,
  options: PegRnaOptions = {},
): PegRna[] {
  const L = sequence.length;
  if (!supportsPrimeEditing(nuclease) || primeEditProblem(edit, L, topology) !== null) return [];
  const pbsLength = Math.min(MAX_PBS, Math.max(MIN_PBS, options.pbsLength ?? DEFAULT_PBS));
  const homology = Math.max(0, options.homology ?? DEFAULT_HOMOLOGY);
  const upper = sequence.toUpperCase();
  const circular = topology === 'circular';
  const protoAfterNick = nuclease.spacerLength - nuclease.cut.pamStrand;

  const out: PegRna[] = [];
  for (const guide of guides) {
    const forward = guide.strand === 'forward';
    const nick = forward ? guide.cut.forward : guide.cut.reverse;
    /** The base `i` places along the PAM strand from the nick (0 is the first after it). */
    const at = (i: number): string | null => {
      const f = forward ? nick + i : nick - 1 - i;
      if (!circular && (f < 0 || f >= L)) return null;
      const c = upper[mod(f, L)];
      if (c === undefined) return null;
      return forward ? c : complement(c);
    };
    const slice = (a: number, b: number): string | null => {
      let s = '';
      for (let i = a; i < b; i++) {
        const c = at(i);
        if (c === null) return null;
        s += c;
      }
      return s;
    };

    // Where the edit starts, along the PAM strand: downstream of the nick or out.
    const rel = forward ? edit.start - nick : nick - (edit.start + edit.deleteLength);
    const half = Math.floor(L / 2);
    const distance = circular ? mod(rel + half, L) - half : rel;
    if (distance < 0 || distance > MAX_NICK_DISTANCE) continue;
    const insert = forward ? edit.insert : reverseComplement(edit.insert);

    // The edited strand from the nick on, long enough to read the PAM and the template.
    const reach = Math.max(homology, protoAfterNick + guide.pam.length);
    const before = slice(0, distance);
    const after = slice(distance + edit.deleteLength, distance + edit.deleteLength + reach);
    const primer = slice(-pbsLength, 0);
    if (before === null || after === null || primer === null) continue;
    const edited = before + insert + after;
    const rttLength = distance + insert.length + homology;
    if (rttLength > MAX_RTT) continue;
    const template = edited.slice(0, rttLength);

    const pamAt = protoAfterNick;
    const original = slice(pamAt, pamAt + guide.pam.length);
    const disruptsPam =
      distance < pamAt + guide.pam.length &&
      original !== null &&
      edited.slice(pamAt, pamAt + guide.pam.length) !== original;

    if (/[^ACGT]/.test(primer + template)) continue;
    const pbs = reverseComplement(primer);
    const rtt = reverseComplement(template);
    const flags: string[] = [];
    if (rtt.startsWith('C'))
      flags.push('The template starts with C, which can pair with the scaffold');
    const gc = pbs.split('').filter((c) => c === 'G' || c === 'C').length / pbs.length;
    if (gc < 0.4 || gc > 0.6) flags.push('Primer binding site GC outside 40-60%');
    if ((rtt + pbs).includes('TTTT')) flags.push('TTTT ends a U6 transcript');
    out.push({
      guide,
      nick,
      distance,
      pbs,
      rtt,
      extension: rtt + pbs,
      disruptsPam,
      flags,
    });
  }
  return out.sort((a, b) => a.distance - b.distance || a.nick - b.nick);
}

// ------------------------------------------------------- paired nickases

/** Which strand a nickase cuts: the guide's target strand (Cas9 D10A) or its PAM strand (H840A). */
export type NickStrand = 'target' | 'pam';

/** Ran 2013 saw double-strand breaks from nick pairs up to this far apart. */
export const MAX_PAIR_OFFSET = 100;

export interface NickPair {
  /** The guide whose nick is on the forward strand, and the one whose nick is on the reverse strand. */
  readonly forwardNick: CrisprGuide;
  readonly reverseNick: CrisprGuide;
  /** Boundaries between bases (forward coordinates, as `CrisprGuide.cut`) where each strand is nicked. */
  readonly forwardCut: number;
  readonly reverseCut: number;
  /**
   * Reverse-strand nick minus forward-strand nick, along the molecule (the
   * short way round on a circle). Positive is a 5' overhang of that many
   * bases, negative a 3' overhang of that many, zero a blunt break.
   */
  readonly offset: number;
  readonly overhang: '5prime' | '3prime' | 'blunt';
  /** Length of the single-stranded overhang. */
  readonly overhangLength: number;
  /** The bases between the two nicks (empty when blunt), forward coordinates. */
  readonly gap: Range;
}

function nickBoundary(
  g: CrisprGuide,
  nickStrand: NickStrand,
): { strand: 'forward' | 'reverse'; at: number } {
  // The strand a nick falls on: the PAM strand is the guide's own strand.
  const onForward = (g.strand === 'forward') === (nickStrand === 'pam');
  return onForward
    ? { strand: 'forward', at: g.cut.forward }
    : { strand: 'reverse', at: g.cut.reverse };
}

/**
 * Pairs of guides on opposite strands whose nicks, one on each strand, lie
 * within `maxOffset` bases of each other and so make a staggered
 * double-strand break (item 82). Cut positions come from the scan; nothing
 * is scored. Sorted by the distance between the nicks, then by position.
 */
export function pairNickases(
  guides: readonly CrisprGuide[],
  length: number,
  topology: Topology,
  options: { readonly nickStrand?: NickStrand; readonly maxOffset?: number } = {},
): NickPair[] {
  const nickStrand = options.nickStrand ?? 'target';
  const maxOffset = options.maxOffset ?? MAX_PAIR_OFFSET;
  const fwd: { g: CrisprGuide; at: number }[] = [];
  const rev: { g: CrisprGuide; at: number }[] = [];
  for (const g of guides) {
    const n = nickBoundary(g, nickStrand);
    (n.strand === 'forward' ? fwd : rev).push({ g, at: n.at });
  }
  const pairs: NickPair[] = [];
  for (const f of fwd) {
    for (const r of rev) {
      let offset = r.at - f.at;
      if (topology === 'circular') {
        offset = ((offset % length) + length) % length;
        if (offset > length / 2) offset -= length;
      }
      if (Math.abs(offset) > maxOffset) continue;
      const lo = offset >= 0 ? f.at : r.at;
      pairs.push({
        forwardNick: f.g,
        reverseNick: r.g,
        forwardCut: f.at,
        reverseCut: r.at,
        offset,
        overhang: offset > 0 ? '5prime' : offset < 0 ? '3prime' : 'blunt',
        overhangLength: Math.abs(offset),
        gap: { start: lo, end: lo + Math.abs(offset) },
      });
    }
  }
  return pairs.sort(
    (a, b) =>
      Math.abs(a.offset) - Math.abs(b.offset) ||
      a.forwardNick.range.start - b.forwardNick.range.start ||
      a.reverseNick.range.start - b.reverseNick.range.start,
  );
}

/** Pairing needs a nuclease with one cut point per guide, so a nickase can be made of it. */
export function supportsNickPairs(n: Pick<Nuclease, 'pamSide' | 'cut'>): boolean {
  return n.pamSide === '3prime' && n.cut.pamStrand === n.cut.targetStrand;
}
