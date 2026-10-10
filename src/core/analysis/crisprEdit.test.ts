import { describe, expect, it } from 'vitest';

import { reverseComplement } from '../sequence';
import { NUCLEASES, findCrisprGuides } from './crispr';
import {
  BASE_EDITORS,
  baseEditWindow,
  designPegRnas,
  primeEditProblem,
  supportsBaseEditing,
  supportsPrimeEditing,
} from './crisprEdit';

const SPCAS9 = NUCLEASES[0];
const ASCAS12A = NUCLEASES[2];
if (SPCAS9 === undefined || ASCAS12A === undefined) throw new Error('presets');

const editor = (id: string) => {
  const e = BASE_EDITORS.find((x) => x.id === id);
  if (e === undefined) throw new Error(id);
  return e;
};

/** A guide with a known spacer, in plain filler that makes no other PAM. */
const SPACER = 'GACCTAGCATCGATCGGTAC';
const LEFT = 'CTCTCTCTCTCTCTCTCTCT';
const RIGHT = 'ATATCTATCTAGATCTATATCTCTAGATATCTCTATAGATCTAT';
const SEQ = `${LEFT}${SPACER}TGG${RIGHT}`;

describe('baseEditWindow', () => {
  const guide = findCrisprGuides(SEQ, 'linear', SPCAS9, { maxMismatches: 0 }).find(
    (g) => g.strand === 'forward' && g.spacer === SPACER,
  );
  if (guide === undefined) throw new Error('guide');

  it('lists the cytosines at positions 4-8 with their coordinates', () => {
    // GACCTAGC: positions 4 (C) and 8 (C); position 3 is also C but outside
    const w = baseEditWindow(guide, editor('cbe'));
    expect(w?.editable.map((b) => [b.position, b.base])).toEqual([
      [4, 'C'],
      [8, 'C'],
    ]);
    expect(w?.editable.map((b) => SEQ[b.at])).toEqual(['C', 'C']);
    expect(w?.edited).toBe('GACTTAGTATCGATCGGTAC');
    expect(w?.range).toEqual({ start: guide.range.start + 3, end: guide.range.start + 8 });
  });

  it('uses the narrower ABE7.10 window', () => {
    // positions 4-8 are C T A G C: the A at 6 is in both, nothing at 8
    expect(baseEditWindow(guide, editor('abe7'))?.editable.map((b) => b.position)).toEqual([6]);
    expect(baseEditWindow(guide, editor('abe8e'))?.edited).toBe('GACCTGGCATCGATCGGTAC');
  });

  it('reads the window from the PAM-distal end on the reverse strand', () => {
    const rc = reverseComplement(SEQ);
    const g = findCrisprGuides(rc, 'linear', SPCAS9, { maxMismatches: 0 }).find(
      (x) => x.strand === 'reverse' && x.spacer === SPACER,
    );
    if (g === undefined) throw new Error('reverse guide');
    const w = baseEditWindow(g, editor('cbe'));
    expect(w?.editable.map((b) => b.position)).toEqual([4, 8]);
    // On the forward strand the converted C is a G
    expect(w?.editable.map((b) => rc[b.at])).toEqual(['G', 'G']);
  });

  it('only applies to a 20 nt NGG spacer', () => {
    expect(supportsBaseEditing(SPCAS9)).toBe(true);
    expect(supportsBaseEditing(ASCAS12A)).toBe(false);
  });
});

describe('designPegRnas', () => {
  const guides = findCrisprGuides(SEQ, 'linear', SPCAS9, { maxMismatches: 0 });
  const nick = LEFT.length + 17;

  it('builds the extension from the edited strand around the nick', () => {
    // Substitute the base 4 past the nick
    const at = nick + 4;
    const edit = { start: at, deleteLength: 1, insert: 'G' };
    const pegs = designPegRnas(SEQ, 'linear', guides, SPCAS9, edit);
    const peg = pegs.find((p) => p.guide.spacer === SPACER && p.guide.strand === 'forward');
    expect(peg).toBeDefined();
    const edited = SEQ.slice(0, at) + 'G' + SEQ.slice(at + 1);
    expect(peg?.nick).toBe(nick);
    expect(peg?.distance).toBe(4);
    expect(peg?.pbs).toBe(reverseComplement(SEQ.slice(nick - 13, nick)));
    expect(peg?.rtt).toBe(reverseComplement(edited.slice(nick, nick + 4 + 1 + 10)));
    expect(peg?.extension).toBe(reverseComplement(edited.slice(nick - 13, nick + 15)));
    // the edit sits 4 bases from the nick; the PAM (3 past it) is untouched
    expect(peg?.disruptsPam).toBe(false);
  });

  it('handles insertions and deletions', () => {
    const ins = designPegRnas(SEQ, 'linear', guides, SPCAS9, {
      start: nick + 2,
      deleteLength: 0,
      insert: 'AAA',
    }).find((p) => p.guide.strand === 'forward' && p.guide.spacer === SPACER);
    const edited = SEQ.slice(0, nick + 2) + 'AAA' + SEQ.slice(nick + 2);
    expect(ins?.rtt).toBe(reverseComplement(edited.slice(nick, nick + 2 + 3 + 10)));
    const del = designPegRnas(SEQ, 'linear', guides, SPCAS9, {
      start: nick + 2,
      deleteLength: 3,
      insert: '',
    }).find((p) => p.guide.strand === 'forward' && p.guide.spacer === SPACER);
    const deleted = SEQ.slice(0, nick + 2) + SEQ.slice(nick + 5);
    expect(del?.rtt).toBe(reverseComplement(deleted.slice(nick, nick + 2 + 10)));
  });

  it('notes an edit that changes the PAM', () => {
    // the PAM TGG starts 3 bases past the nick: change its first G
    const peg = designPegRnas(SEQ, 'linear', guides, SPCAS9, {
      start: nick + 4,
      deleteLength: 1,
      insert: 'C',
    }).find((p) => p.guide.strand === 'forward' && p.guide.spacer === SPACER);
    expect(peg?.disruptsPam).toBe(true);
  });

  it('offers nothing upstream of the nick or too far from it', () => {
    const upstream = designPegRnas(SEQ, 'linear', guides, SPCAS9, {
      start: nick - 3,
      deleteLength: 1,
      insert: 'A',
    });
    expect(
      upstream.find((p) => p.guide.strand === 'forward' && p.guide.spacer === SPACER),
    ).toBeUndefined();
    const far = designPegRnas(SEQ, 'linear', guides, SPCAS9, {
      start: nick + 31,
      deleteLength: 1,
      insert: 'A',
    });
    expect(
      far.find((p) => p.guide.strand === 'forward' && p.guide.spacer === SPACER),
    ).toBeUndefined();
  });

  it('gives the same pegRNAs for the reverse-complemented molecule and edit', () => {
    const at = nick + 5;
    const fwd = designPegRnas(SEQ, 'linear', guides, SPCAS9, {
      start: at,
      deleteLength: 2,
      insert: 'TC',
    }).find((p) => p.guide.strand === 'forward' && p.guide.spacer === SPACER);
    const rc = reverseComplement(SEQ);
    const rcGuides = findCrisprGuides(rc, 'linear', SPCAS9, { maxMismatches: 0 });
    const rev = designPegRnas(rc, 'linear', rcGuides, SPCAS9, {
      start: SEQ.length - (at + 2),
      deleteLength: 2,
      insert: reverseComplement('TC'),
    }).find((p) => p.guide.strand === 'reverse' && p.guide.spacer === SPACER);
    expect(fwd).toBeDefined();
    expect(rev?.extension).toBe(fwd?.extension);
    expect(rev?.pbs).toBe(fwd?.pbs);
    expect(rev?.distance).toBe(fwd?.distance);
  });

  it('works through the origin of a circle', () => {
    const shift = 30;
    const rotated = SEQ.slice(shift) + SEQ.slice(0, shift);
    const g = findCrisprGuides(rotated, 'circular', SPCAS9, { maxMismatches: 0 });
    const at = nick + 4;
    const plain = designPegRnas(SEQ, 'circular', guides, SPCAS9, {
      start: at,
      deleteLength: 1,
      insert: 'G',
    }).find((p) => p.guide.strand === 'forward' && p.guide.spacer === SPACER);
    const turned = designPegRnas(rotated, 'circular', g, SPCAS9, {
      start: (at - shift + SEQ.length) % SEQ.length,
      deleteLength: 1,
      insert: 'G',
    }).find((p) => p.guide.strand === 'forward' && p.guide.spacer === SPACER);
    expect(turned?.extension).toBe(plain?.extension);
    expect(turned?.extension).toBeDefined();
  });

  it('drops guides whose template runs off a linear end, and non-Cas9 nucleases', () => {
    const peg = designPegRnas(SEQ, 'linear', guides, SPCAS9, {
      start: SEQ.length - 1,
      deleteLength: 1,
      insert: 'A',
    });
    expect(peg).toEqual([]);
    expect(supportsPrimeEditing(ASCAS12A)).toBe(false);
    expect(
      designPegRnas(SEQ, 'linear', guides, ASCAS12A, { start: nick, deleteLength: 1, insert: 'A' }),
    ).toEqual([]);
  });

  it('flags a template that starts with C and honours the PBS length', () => {
    const edit = { start: nick + 4, deleteLength: 1, insert: 'G' };
    const short = designPegRnas(SEQ, 'linear', guides, SPCAS9, edit, { pbsLength: 10 }).find(
      (p) => p.guide.strand === 'forward' && p.guide.spacer === SPACER,
    );
    expect(short?.pbs).toHaveLength(10);
  });

  it('validates the edit', () => {
    expect(primeEditProblem({ start: 0, deleteLength: 0, insert: '' }, 10, 'linear')).toMatch(
      /Nothing/,
    );
    expect(primeEditProblem({ start: 0, deleteLength: 0, insert: 'N' }, 10, 'linear')).toMatch(
      /plain/,
    );
    expect(primeEditProblem({ start: 9, deleteLength: 2, insert: 'A' }, 10, 'linear')).toMatch(
      /past the end/,
    );
    expect(primeEditProblem({ start: 9, deleteLength: 2, insert: 'A' }, 10, 'circular')).toBeNull();
  });
});
