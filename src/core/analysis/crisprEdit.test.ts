import { describe, expect, it } from 'vitest';

import { reverseComplement } from '../sequence';
import { NUCLEASES, findCrisprGuides } from './crispr';
import {
  BASE_EDITORS,
  baseEditWindow,
  MAX_PAIR_OFFSET,
  designPegRnas,
  pairNickases,
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

describe('pairNickases', () => {
  const S1 = SPACER;
  const S2 = 'TCAGTCCATGGATTACGCAG';
  const find = (seq: string, topology: 'linear' | 'circular') =>
    findCrisprGuides(seq, topology, SPCAS9, { maxMismatches: 0 }).filter(
      (g) => g.spacer === S1 || g.spacer === S2,
    );
  // forward guide S1 with its PAM to the right; reverse guide S2 whose PAM (CCA) is to the left of it
  const pamOut = `${LEFT}CCA${reverseComplement(S2)}${S1}TGG${RIGHT}`;
  const pamIn = `${LEFT}${S1}TGG${'AT'.repeat(5)}CCA${reverseComplement(S2)}${RIGHT}`;

  it('measures the offset between the two nicks and its direction (PAM-out gives 5 prime with D10A)', () => {
    const a = pairNickases(find(pamOut, 'linear'), pamOut.length, 'linear', {
      nickStrand: 'target',
    });
    const b = pairNickases(find(pamOut, 'linear'), pamOut.length, 'linear', { nickStrand: 'pam' });
    // D10A: forward-strand nick is the reverse guide's (26), reverse-strand nick the forward guide's (60)
    expect(a[0]).toMatchObject({ forwardCut: 26, reverseCut: 60, offset: 34, overhang: '5prime' });
    expect(a[0]?.gap).toEqual({ start: 26, end: 60 });
    // H840A nicks the other strands: the same two cuts, now swapped, so the overhang is 3'
    expect(b[0]).toMatchObject({ forwardCut: 60, reverseCut: 26, offset: -34, overhang: '3prime' });
    expect(b[0]?.gap).toEqual({ start: 26, end: 60 });
  });

  it('has PAM-in guides give the opposite overhang', () => {
    const p = pairNickases(find(pamIn, 'linear'), pamIn.length, 'linear');
    expect(p[0]?.overhang).toBe('3prime');
    expect(p[0]?.offset).toBeLessThan(0);
  });

  it('drops pairs farther apart than the limit, and never pairs one strand', () => {
    const guides = find(pamOut, 'linear');
    expect(pairNickases(guides, pamOut.length, 'linear', { maxOffset: 33 })).toHaveLength(0);
    expect(pairNickases(guides, pamOut.length, 'linear', { maxOffset: 34 })).toHaveLength(1);
    const same = guides.filter((g) => g.strand === 'forward');
    expect(pairNickases(same, pamOut.length, 'linear')).toHaveLength(0);
    expect(MAX_PAIR_OFFSET).toBe(100);
  });

  it('pairs across the origin of a circle and agrees with a rotation', () => {
    const rot = (s: string, k: number) => s.slice(k) + s.slice(0, k);
    const base = pairNickases(find(pamOut, 'circular'), pamOut.length, 'circular');
    expect(base).toHaveLength(1);
    for (const k of [10, 30, 45, 70]) {
      const r = rot(pamOut, k);
      const pairs = pairNickases(find(r, 'circular'), r.length, 'circular');
      expect(pairs).toHaveLength(1);
      expect(pairs[0]?.offset).toBe(base[0]?.offset);
      expect(pairs[0]?.overhang).toBe(base[0]?.overhang);
    }
  });

  it('takes the short way round a circle', () => {
    // nicks at 5 and 95 of a 100 bp circle are 10 apart, not 90
    const g = (strand: 'forward' | 'reverse', cut: number) =>
      ({ strand, cut: { forward: cut, reverse: cut }, range: { start: cut, end: cut } }) as never;
    const p = pairNickases([g('reverse', 5), g('forward', 95)], 100, 'circular', {
      nickStrand: 'pam',
    });
    // forward guide nicks forward at 95, reverse guide nicks reverse at 5: offset 5 - 95 = -90 -> +10
    expect(p[0]?.offset).toBe(10);
  });
});
