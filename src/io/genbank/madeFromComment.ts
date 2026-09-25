import {
  type LineageNode,
  type LineageOp,
  type LineageStep,
  isLineageNode,
  parentCount,
  pruneLineage,
} from '@/core';

/**
 * What a product was made from, in a GenBank file (#67, item 52).
 *
 * GenBank has no field for a construct's history, so it travels as one
 * COMMENT block of ours, the way sticky ends and the host do
 * (`endsComment.ts`, `methylationComment.ts`), but over several lines: a
 * header with the format's version, then one line per molecule of the tree,
 * root first and each molecule's parents after it (pre-order):
 *
 *     PlasmidPop-made-from: 1
 *     0 ligation cdseguid=dUxN7YQyVInv3oDcvz8ByupL44A 3426 circular
 *     + pUC19+GFP%20assembly circular=yes flipped=01
 *     1 digest ldseguid=dmS9Y4eutZMCbPaGkq0blFgh8RU 2665 linear
 *     + pUC19%20EcoRI-BamHI%20fragment enzymes=EcoRI,BamHI
 *     + range=2661..2639
 *     2 - cdseguid=AAAAAAAAAAAAAAAAAAAAAAAAAAA 2686 circular pUC19
 *     1 pcr - 761 linear GFP%20PCR
 *     + forward=GFP%20fwd%2C%205%E2%80%B2%20EcoRI,GGAATTCATGGTGAGCAAGGGCGAGGAG
 *     + reverse=GFP%20rev,CGGGATCCTTACTTGTACAGCTCGTCCATG
 *     + polymerase=proofreading
 *     2 - cdseguid=dUxN7YQyVInv3oDcvz8ByupL44A 4733 circular pEGFP-N1
 *
 * Each line is: depth, how it was made (`-` for a molecule with no recorded
 * history), its checksum (`-` for none), length, topology and name (`-` for
 * none), then the step's settings as `key=value`. A line longer than
 * GenBank's 79 columns goes on on lines that start with `+`; a single token
 * longer than that (a long primer) runs over, as the writer lets a long word
 * in any header do. Every token is percent-escaped where it holds a space,
 * `%`, `,`, `=` or anything outside printable ASCII, so a name is safe
 * whatever it holds and the file stays ASCII. Ranges are 1-based and
 * inclusive, as GenBank counts; across the origin of a circle the end is the
 * smaller number.
 *
 * A block that cannot be read back whole — a line out of place, a step with
 * the wrong number of parents, a version this build does not know — is not
 * ours, so it stays among the ordinary comments both ways (#72) rather than
 * being dropped, or half read.
 */
const PREFIX = 'PlasmidPop-made-from:';

/** The format written, and the only one read. */
const VERSION = '1';

/** Columns a comment line has after the 12 of the COMMENT keyword. */
const WIDTH = 67;

/** More lines than a file of ours can hold, so a block this long is not one. */
const MAX_LINES = 2000;

const CHECKSUM = /^(?:ls|cs|ld|cd)seguid=[A-Za-z0-9_-]{27}$/;

// ---------------------------------------------------------------- escaping

function escapeToken(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x21 && code <= 0x7e && ch !== '%' && ch !== ',' && ch !== '=') out += ch;
    else {
      try {
        out += encodeURIComponent(ch);
      } catch {
        out += '%EF%BF%BD'; // a lone surrogate: the replacement character
      }
    }
  }
  return out;
}

/**
 * A name as a token of its own: `-` stands for an empty one, so the line
 * keeps its place, and a name that is just `-` is escaped to stay itself.
 */
function nameToken(name: string): string {
  return name === '' ? '-' : name === '-' ? '%2D' : escapeToken(name);
}

function unescapeToken(token: string): string | null {
  try {
    return decodeURIComponent(token);
  } catch {
    return null;
  }
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

function flags(values: readonly boolean[]): string {
  return values.map((v) => (v ? '1' : '0')).join('');
}

/** A list, each item escaped as a name is, so an empty list and a list of one empty item differ. */
function items(values: readonly string[]): string {
  return values.map(nameToken).join(',');
}

function rangeText(
  range: { readonly start: number; readonly end: number },
  length: number,
): string {
  const to = length > 0 ? ((range.end - 1) % length) + 1 : range.end;
  return `${String(range.start + 1)}..${String(to)}`;
}

// ---------------------------------------------------------------- writing

function settings(step: LineageStep): string[] {
  switch (step.op) {
    case 'digest': {
      const parentLength = step.parents[0]?.length ?? 0;
      return [
        `enzymes=${items(step.enzymes)}`,
        `range=${rangeText(step.range, parentLength)}`,
        ...(step.uncut === 0 ? [] : [`uncut=${String(step.uncut)}`]),
      ];
    }
    case 'pcr':
      return [
        `forward=${items([step.forward.name, step.forward.sequence])}`,
        `reverse=${items([step.reverse.name, step.reverse.sequence])}`,
        `polymerase=${step.polymerase}`,
      ];
    case 'ligation':
      return [`circular=${yesNo(step.circular)}`, `flipped=${flags(step.flipped)}`];
    case 'golden-gate':
      return [`enzymes=${items(step.enzymes)}`, `flipped=${flags(step.flipped)}`];
    case 'gibson':
      return [
        `kit=${step.kit}`,
        `circular=${yesNo(step.circular)}`,
        `overlap=${String(step.overlap)}`,
        `flipped=${flags(step.flipped)}`,
      ];
    case 'gateway':
      return [`reaction=${step.reaction}`, `byproduct=${yesNo(step.byproduct)}`];
    case 'mutagenesis':
      return [
        `change=${escapeToken(step.change)}`,
        `method=${step.method}`,
        `primers=${items(step.primers)}`,
      ];
    case 'phosphates':
      return [`removed=${yesNo(step.removed)}`];
    case 'edited':
      return [];
    case 'elided':
      return [`nodes=${String(step.nodes)}`];
  }
}

/** One molecule's tokens, and its parents' lines after it. */
function nodeLines(node: LineageNode, depth: number, out: string[]): void {
  const step = node.step;
  const tokens = [
    String(depth),
    step === null ? '-' : step.op,
    node.checksum ?? '-',
    String(node.length),
    node.topology,
    nameToken(node.name),
    ...(step === null ? [] : settings(step)),
  ];
  let line = '';
  for (const token of tokens) {
    if (line === '') line = token;
    else if (line.length + 1 + token.length <= WIDTH) line += ` ${token}`;
    else {
      out.push(line);
      line = `+ ${token}`;
    }
  }
  out.push(line);
  for (const parent of step?.parents ?? []) nodeLines(parent, depth + 1, out);
}

/** The block for a lineage: the header and one line (or a few) per molecule, joined by newlines. */
export function formatMadeFromComment(lineage: LineageNode): string {
  const lines = [`${PREFIX} ${VERSION}`];
  nodeLines(lineage, 0, lines);
  return lines.join('\n');
}

// ---------------------------------------------------------------- reading

/** A node as read, before its step is checked against its parents. */
interface Draft {
  readonly depth: number;
  readonly op: LineageOp | null;
  readonly name: string;
  readonly checksum: string | null;
  readonly topology: 'linear' | 'circular';
  readonly length: number;
  readonly settings: ReadonlyMap<string, string>;
  readonly parents: Draft[];
}

const OPS: ReadonlySet<string> = new Set<LineageOp>([
  'digest',
  'pcr',
  'ligation',
  'golden-gate',
  'gibson',
  'gateway',
  'mutagenesis',
  'phosphates',
  'edited',
  'elided',
]);

function count(text: string | undefined): number | null {
  if (text === undefined || !/^\d{1,9}$/.test(text)) return null;
  return Number(text);
}

function readDraft(tokens: readonly string[]): Draft | null {
  const [depthText, opText, checksumText, lengthText, topology, nameText, ...rest] = tokens;
  const depth = count(depthText);
  const length = count(lengthText);
  if (depth === null || length === null || opText === undefined || nameText === undefined) {
    return null;
  }
  if (opText !== '-' && !OPS.has(opText)) return null;
  if (checksumText === undefined || (checksumText !== '-' && !CHECKSUM.test(checksumText))) {
    return null;
  }
  if (topology !== 'linear' && topology !== 'circular') return null;
  const name = nameText === '-' ? '' : unescapeToken(nameText);
  if (name === null) return null;
  const settings = new Map<string, string>();
  for (const token of rest) {
    const eq = token.indexOf('=');
    if (eq <= 0) return null;
    settings.set(token.slice(0, eq), token.slice(eq + 1));
  }
  return {
    depth,
    op: opText === '-' ? null : (opText as LineageOp),
    name,
    checksum: checksumText === '-' ? null : checksumText,
    topology,
    length,
    settings,
    parents: [],
  };
}

function readItems(text: string | undefined): string[] | null {
  if (text === undefined) return null;
  if (text === '') return [];
  const out: string[] = [];
  for (const part of text.split(',')) {
    const item = part === '-' ? '' : unescapeToken(part);
    if (item === null) return null;
    out.push(item);
  }
  return out;
}

function readYesNo(text: string | undefined): boolean | null {
  return text === 'yes' ? true : text === 'no' ? false : null;
}

function readFlags(text: string | undefined, n: number): boolean[] | null {
  if (text?.length !== n || !/^[01]*$/.test(text)) return null;
  return Array.from({ length: n }, (_, i) => text.charAt(i) === '1');
}

function readRange(
  text: string | undefined,
  parentLength: number,
  circular: boolean,
): { start: number; end: number } | null {
  const m = /^(\d{1,9})\.\.(\d{1,9})$/.exec(text ?? '');
  if (m === null) return null;
  const start = Number(m[1]) - 1;
  let end = Number(m[2]);
  if (start < 0) return null;
  if (end <= start) {
    if (!circular) return null;
    end += parentLength;
  }
  if (end <= start || (parentLength > 0 && (start >= parentLength || end - start > parentLength))) {
    return null;
  }
  return { start, end };
}

function readPrimer(text: string | undefined): { name: string; sequence: string } | null {
  const parts = readItems(text);
  if (parts?.length !== 2) return null;
  const [name, sequence] = parts;
  return name === undefined || sequence === undefined ? null : { name, sequence };
}

/** The finished node, with its step read from its settings; null when they do not add up. */
function finish(draft: Draft): LineageNode | null {
  const parents: LineageNode[] = [];
  for (const p of draft.parents) {
    const node = finish(p);
    if (node === null) return null;
    parents.push(node);
  }
  const node = {
    name: draft.name,
    checksum: draft.checksum,
    topology: draft.topology,
    length: draft.length,
  };
  const op = draft.op;
  if (op === null) return parents.length === 0 ? { ...node, step: null } : null;
  const wanted = parentCount(op);
  if (wanted === 'some' ? parents.length === 0 : parents.length !== wanted) return null;
  const s = (key: string): string | undefined => draft.settings.get(key);
  const step = ((): LineageStep | null => {
    switch (op) {
      case 'digest': {
        const parent = parents[0];
        const enzymes = readItems(s('enzymes'));
        const uncut = s('uncut') === undefined ? 0 : count(s('uncut'));
        if (parent === undefined || enzymes === null || uncut === null) return null;
        const range = readRange(s('range'), parent.length, parent.topology === 'circular');
        return range === null ? null : { op, parents, enzymes, range, uncut };
      }
      case 'pcr': {
        const forward = readPrimer(s('forward'));
        const reverse = readPrimer(s('reverse'));
        const polymerase = s('polymerase');
        if (forward === null || reverse === null) return null;
        if (polymerase !== 'proofreading' && polymerase !== 'taq') return null;
        return { op, parents, forward, reverse, polymerase };
      }
      case 'ligation': {
        const circular = readYesNo(s('circular'));
        const flipped = readFlags(s('flipped'), parents.length);
        return circular === null || flipped === null ? null : { op, parents, circular, flipped };
      }
      case 'golden-gate': {
        const enzymes = readItems(s('enzymes'));
        const flipped = readFlags(s('flipped'), parents.length);
        return enzymes === null || flipped === null ? null : { op, parents, enzymes, flipped };
      }
      case 'gibson': {
        const kit = s('kit');
        const circular = readYesNo(s('circular'));
        const overlap = count(s('overlap'));
        const flipped = readFlags(s('flipped'), parents.length);
        if (kit !== 'gibson' && kit !== 'in-fusion' && kit !== 'nebuilder') return null;
        if (circular === null || overlap === null || flipped === null) return null;
        return { op, parents, kit, circular, overlap, flipped };
      }
      case 'gateway': {
        const reaction = s('reaction');
        const byproduct = readYesNo(s('byproduct'));
        if ((reaction !== 'BP' && reaction !== 'LR') || byproduct === null) return null;
        return { op, parents, reaction, byproduct };
      }
      case 'mutagenesis': {
        const changeText = s('change');
        const change = changeText === undefined ? null : unescapeToken(changeText);
        const method = s('method');
        const primers = readItems(s('primers'));
        if (change === null || primers === null) return null;
        if (method !== 'back-to-back' && method !== 'overlapping') return null;
        return { op, parents, change, method, primers };
      }
      case 'phosphates': {
        const removed = readYesNo(s('removed'));
        return removed === null ? null : { op, parents, removed };
      }
      case 'edited':
        return { op, parents };
      case 'elided': {
        const nodes = count(s('nodes'));
        return nodes === null ? null : { op, parents, nodes };
      }
    }
  })();
  return step === null ? null : { ...node, step };
}

/** Whether a comment is our block, readable or not, so the writer can tell its own from another. */
export function isMadeFromComment(comment: string): boolean {
  return comment.trim().startsWith(PREFIX);
}

/**
 * The lineage a `PlasmidPop-made-from:` block describes, or null if the
 * comment is not one or cannot be read whole. A tree past the limits (not
 * one this app wrote) is cut down to them.
 */
export function parseMadeFromComment(comment: string): LineageNode | null {
  const lines = comment
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  const head = lines[0];
  if (!head?.startsWith(PREFIX) || head.slice(PREFIX.length).trim() !== VERSION) return null;
  if (lines.length > MAX_LINES) return null;

  // Continuation lines join the line they continue.
  const records: string[][] = [];
  for (const line of lines.slice(1)) {
    const tokens = line.split(/\s+/);
    if (tokens[0] === '+') {
      const last = records[records.length - 1];
      if (last === undefined || tokens.length < 2) return null;
      last.push(...tokens.slice(1));
    } else records.push(tokens);
  }

  // Pre-order with depths: each line's parent is the nearest line above one level up.
  const stack: Draft[] = [];
  let root: Draft | null = null;
  for (const tokens of records) {
    const draft = readDraft(tokens);
    if (draft === null) return null;
    if (draft.depth === 0) {
      if (root !== null) return null;
      root = draft;
    } else {
      if (draft.depth > stack.length) return null;
      stack[draft.depth - 1]?.parents.push(draft);
    }
    stack.length = draft.depth;
    stack.push(draft);
  }
  if (root === null) return null;
  const node = finish(root);
  if (node === null) return null;
  const pruned = pruneLineage(node);
  return isLineageNode(pruned) ? pruned : null;
}
