import { SeqDocument } from '@/core';

import {
  type LineageNode,
  MAX_LINEAGE_DEPTH,
  MAX_LINEAGE_NAME,
  MAX_LINEAGE_NODES,
  isLineageNode,
  lineageChecksum,
  lineageName,
  lineageOf,
  pruneLineage,
} from './lineage';

// Survivors of the 1.6 mutation run (item 50): boundaries, exact pruned
// trees and the shape check of every kind of step.

function leaf(name: string, length = 100): LineageNode {
  return { name, checksum: null, topology: 'linear', length, step: null };
}

function ligation(name: string, parents: readonly LineageNode[]): LineageNode {
  return {
    name,
    checksum: null,
    topology: 'circular',
    length: 1000,
    step: { op: 'ligation', parents, circular: true, flipped: parents.map(() => false) },
  };
}

function chain(n: number): LineageNode {
  let node = leaf('start');
  for (let i = 0; i < n; i++) {
    node = { ...leaf(`step ${i + 1}`), step: { op: 'edited', parents: [node] } };
  }
  return node;
}

describe('lineage names and checksums at their edges', () => {
  it('keeps a name of exactly the longest length whole, and cuts one a character longer', () => {
    const exact = 'x'.repeat(MAX_LINEAGE_NAME);
    expect(lineageName(exact)).toBe(exact);
    expect(lineageName(`${exact}y`)).toBe(`${'x'.repeat(MAX_LINEAGE_NAME - 1)}…`);
  });

  it('records no checksum for an empty molecule', () => {
    const empty = SeqDocument.create({ name: 'nothing', sequence: '' });
    expect(lineageChecksum(empty)).toBeNull();
    expect(lineageOf(empty)).toEqual({
      name: 'nothing',
      checksum: null,
      topology: 'linear',
      length: 0,
      step: null,
    });
  });
});

describe('pruneLineage at its limits', () => {
  it('leaves a tree of exactly the node limit as it is', () => {
    const full = ligation(
      'p',
      Array.from({ length: MAX_LINEAGE_NODES - 1 }, (_, i) => leaf(`part ${i}`)),
    );
    expect(pruneLineage(full)).toBe(full);
  });

  it('marks a step whose parents would take the tree one past the node limit', () => {
    const over = ligation(
      'p',
      Array.from({ length: MAX_LINEAGE_NODES }, (_, i) => leaf(`part ${i}`)),
    );
    expect(pruneLineage(over)).toEqual({
      ...over,
      step: { op: 'elided', parents: [], nodes: MAX_LINEAGE_NODES },
    });
  });

  it('leaves a tree of exactly the depth limit as it is, and cuts one a level deeper', () => {
    const deepest = chain(MAX_LINEAGE_DEPTH);
    expect(pruneLineage(deepest)).toBe(deepest);
    const pruned = pruneLineage(chain(MAX_LINEAGE_DEPTH + 1));
    let node = pruned;
    for (let i = 0; i < MAX_LINEAGE_DEPTH; i++) node = node.step?.parents[0] ?? node;
    expect(node).toEqual({ ...leaf('step 1'), step: { op: 'elided', parents: [], nodes: 1 } });
  });

  it('expands a step whose parents bring the count exactly to the limit, and leaves leaves alone', () => {
    const inner = ligation('inner', [leaf('a1'), leaf('a2')]);
    const tree = ligation('top', [inner, leaf('b')]);
    expect(pruneLineage(tree, 3)).toEqual(
      ligation('top', [
        { ...inner, step: { op: 'elided', parents: [], nodes: 2 } },
        { ...leaf('b'), step: null },
      ]),
    );
  });

  it('keeps an elided marker already in the tree as it is, however large its count', () => {
    const marker: LineageNode = {
      ...leaf('long ago'),
      step: { op: 'elided', parents: [], nodes: 1_500_000_000 },
    };
    const edited: LineageNode = { ...leaf('edited'), step: { op: 'edited', parents: [leaf('x')] } };
    const pruned = pruneLineage(ligation('top', [marker, edited]), 3);
    expect(pruned.step?.parents).toEqual([
      marker,
      { ...edited, step: { op: 'elided', parents: [], nodes: 1 } },
    ]);
  });
});

describe('isLineageNode, kind by kind', () => {
  const one = [leaf('a')];
  const two = [leaf('a'), leaf('b')];
  const withStep = (step: unknown): boolean => isLineageNode({ ...leaf('x'), step });

  const good: Record<string, Record<string, unknown>> = {
    digest: {
      op: 'digest',
      parents: one,
      enzymes: ['EcoRI'],
      range: { start: 0, end: 10 },
      uncut: 0,
    },
    pcr: {
      op: 'pcr',
      parents: one,
      forward: { name: 'F', sequence: 'ACGT' },
      reverse: { name: 'R', sequence: 'TTGC' },
      polymerase: 'taq',
    },
    ligation: { op: 'ligation', parents: two, circular: true, flipped: [false, true] },
    'golden-gate': { op: 'golden-gate', parents: two, enzymes: ['BsaI'], flipped: [false, false] },
    gibson: {
      op: 'gibson',
      parents: two,
      kit: 'nebuilder',
      circular: false,
      overlap: 20,
      flipped: [false, false],
    },
    gateway: { op: 'gateway', parents: two, reaction: 'LR', byproduct: true },
    mutagenesis: {
      op: 'mutagenesis',
      parents: one,
      change: 'A12G',
      method: 'overlapping',
      primers: ['ACGT', 'TGCA'],
    },
    phosphates: { op: 'phosphates', parents: one, removed: false },
    edited: { op: 'edited', parents: one },
    elided: { op: 'elided', parents: [], nodes: 3 },
  };
  const variant = (op: string, patch: Record<string, unknown>): boolean =>
    withStep({ ...good[op], ...patch });

  it('accepts every kind of step recorded right, with each value a field may take', () => {
    for (const step of Object.values(good)) expect(withStep(step)).toBe(true);
    expect(variant('pcr', { polymerase: 'proofreading' })).toBe(true);
    expect(variant('gibson', { kit: 'gibson' })).toBe(true);
    expect(variant('gibson', { kit: 'in-fusion' })).toBe(true);
    expect(variant('gateway', { reaction: 'BP' })).toBe(true);
    expect(variant('mutagenesis', { method: 'back-to-back' })).toBe(true);
    expect(variant('digest', { enzymes: [] })).toBe(true);
  });

  it('refuses parents that are not a list, without throwing', () => {
    expect(variant('edited', { parents: 'a' })).toBe(false);
    expect(variant('edited', { parents: undefined })).toBe(false);
  });

  it('refuses a node whose length is not a count', () => {
    expect(isLineageNode({ ...leaf('x'), length: '5' })).toBe(false);
    expect(isLineageNode({ ...leaf('x'), length: 1.5 })).toBe(false);
    expect(isLineageNode({ ...leaf('x'), length: -1 })).toBe(false);
    expect(isLineageNode({ ...leaf('x'), length: 0 })).toBe(true);
  });

  it('refuses a digest with bad enzymes, range or uncut count', () => {
    expect(variant('digest', { enzymes: 'EcoRI' })).toBe(false);
    expect(variant('digest', { enzymes: ['EcoRI', 1] })).toBe(false);
    expect(variant('digest', { range: null })).toBe(false);
    expect(variant('digest', { range: { start: '0', end: 10 } })).toBe(false);
    expect(variant('digest', { range: { start: 0, end: 1.5 } })).toBe(false);
    expect(variant('digest', { range: { start: -1, end: 10 } })).toBe(false);
    expect(variant('digest', { uncut: -1 })).toBe(false);
    expect(variant('digest', { uncut: '0' })).toBe(false);
  });

  it('refuses a PCR with a bad primer or polymerase', () => {
    expect(variant('pcr', { forward: null })).toBe(false);
    expect(variant('pcr', { forward: { name: 1, sequence: 'ACGT' } })).toBe(false);
    expect(variant('pcr', { forward: { name: 'F', sequence: null } })).toBe(false);
    expect(variant('pcr', { reverse: null })).toBe(false);
    expect(variant('pcr', { reverse: { name: 'R' } })).toBe(false);
    expect(variant('pcr', { polymerase: 'pfu' })).toBe(false);
  });

  it('refuses a ligation, Golden Gate or Gibson with bad flags', () => {
    expect(variant('ligation', { circular: 'yes' })).toBe(false);
    expect(variant('ligation', { flipped: [false, 1] })).toBe(false);
    expect(variant('ligation', { flipped: [1, 2] })).toBe(false);
    expect(variant('ligation', { flipped: 'no' })).toBe(false);
    expect(variant('golden-gate', { enzymes: 'BsaI' })).toBe(false);
    expect(variant('golden-gate', { enzymes: [3] })).toBe(false);
    expect(variant('golden-gate', { flipped: [false] })).toBe(false);
    expect(variant('gibson', { kit: 'hifi' })).toBe(false);
    expect(variant('gibson', { circular: 1 })).toBe(false);
    expect(variant('gibson', { overlap: -1 })).toBe(false);
    expect(variant('gibson', { flipped: [false] })).toBe(false);
  });

  it('refuses a Gateway, mutagenesis, phosphate or elided step with a bad field', () => {
    expect(variant('gateway', { reaction: 'BR' })).toBe(false);
    expect(variant('gateway', { byproduct: 'no' })).toBe(false);
    expect(variant('mutagenesis', { change: 5 })).toBe(false);
    expect(variant('mutagenesis', { method: 'random' })).toBe(false);
    expect(variant('mutagenesis', { primers: [1] })).toBe(false);
    expect(variant('phosphates', { removed: 'yes' })).toBe(false);
    expect(variant('phosphates', { removed: undefined })).toBe(false);
    expect(variant('elided', { nodes: 1.5 })).toBe(false);
  });
});
