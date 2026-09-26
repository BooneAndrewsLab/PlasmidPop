import { SeqDocument, documentChecksum } from '@/core';

import { describeLineageRange, describeLineageStep } from './describe';
import {
  type LineageNode,
  type LineageStep,
  MAX_LINEAGE_DEPTH,
  MAX_LINEAGE_NAME,
  MAX_LINEAGE_NODES,
  editedSinceMade,
  isLineageNode,
  lineageChecksums,
  lineageDepth,
  lineageName,
  lineageNodeCount,
  lineageOf,
  lineageSize,
  pruneLineage,
  withLineage,
} from './lineage';

const plasmid = SeqDocument.create({
  name: 'pUC19',
  sequence: 'GAATTCAAAAGGATCCTTTTAAGCTTCCCCGGGAAA',
  topology: 'circular',
});

function leaf(name: string, length = 100): LineageNode {
  return { name, checksum: null, topology: 'linear', length, step: null };
}

/** A ligation of `n` leaves. */
function ligation(name: string, parents: readonly LineageNode[]): LineageNode {
  return {
    name,
    checksum: null,
    topology: 'circular',
    length: 1000,
    step: {
      op: 'ligation',
      parents,
      circular: true,
      flipped: parents.map(() => false),
    },
  };
}

/** A chain of `n` edits, each made from the one before: `n + 1` nodes, `n` deep. */
function chain(n: number): LineageNode {
  let node = leaf('start');
  for (let i = 0; i < n; i++) {
    node = { ...leaf(`step ${i + 1}`), step: { op: 'edited', parents: [node] } };
  }
  return node;
}

describe('lineageOf', () => {
  it('gives a document with no lineage as a leaf, with its checksum and size now', () => {
    expect(lineageOf(plasmid)).toEqual({
      name: 'pUC19',
      checksum: documentChecksum(plasmid)?.text,
      topology: 'circular',
      length: plasmid.length,
      step: null,
    });
  });

  it('brings a product’s own lineage along while it is the molecule that was made', () => {
    const product = withLineage(plasmid.rename('made'), {
      op: 'phosphates',
      parents: [leaf('x')],
      removed: true,
    });
    const node = lineageOf(product.rename('renamed since'));
    // A rename changes no base: still the molecule as made, under its name now.
    expect(node.name).toBe('renamed since');
    expect(node.step).toEqual(product.metadata.lineage?.step);
    expect(editedSinceMade(product)).toBe(false);
  });

  it('marks a product edited since it was made, keeping the recorded one beneath it', () => {
    const product = withLineage(plasmid, { op: 'edited', parents: [leaf('x')] });
    const edited = product.apply({ type: 'insert', position: 3, text: 'CCC' });
    expect(editedSinceMade(edited)).toBe(true);
    const node = lineageOf(edited);
    expect(node.checksum).toBe(documentChecksum(edited)?.text);
    expect(node.step?.op).toBe('edited');
    expect(node.step?.parents).toEqual([product.metadata.lineage]);
    // An edit leaves the recorded lineage itself alone.
    expect(edited.metadata.lineage).toBe(product.metadata.lineage);
  });

  it('never calls a document without a lineage edited', () => {
    expect(editedSinceMade(plasmid.apply({ type: 'insert', position: 0, text: 'A' }))).toBe(false);
  });
});

describe('withLineage', () => {
  it('records the product at the root with the checksum it has as made', () => {
    const made = withLineage(plasmid, { op: 'edited', parents: [leaf('x')] });
    const root = made.metadata.lineage;
    expect(root?.name).toBe('pUC19');
    expect(root?.checksum).toBe(documentChecksum(plasmid)?.text);
    expect(root?.topology).toBe('circular');
    expect(root?.length).toBe(plasmid.length);
    expect(made.sequence.toString()).toBe(plasmid.sequence.toString());
  });

  it('keeps a name to one line and a sensible length', () => {
    expect(lineageName('  a\n  b\tc ')).toBe('a b c');
    expect(lineageName('')).toBe('Untitled');
    const long = lineageName('x'.repeat(500));
    expect(long).toHaveLength(MAX_LINEAGE_NAME);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('pruneLineage', () => {
  it('leaves a tree inside the limits as it is', () => {
    const tree = ligation('p', [leaf('a'), leaf('b')]);
    expect(pruneLineage(tree)).toBe(tree);
  });

  it('cuts a long chain at the depth limit and counts what it left out', () => {
    const long = chain(40);
    const pruned = pruneLineage(long);
    expect(lineageDepth(pruned)).toBe(MAX_LINEAGE_DEPTH);
    expect(lineageSize(pruned)).toBe(lineageSize(long));
    let node = pruned;
    for (let i = 0; i < MAX_LINEAGE_DEPTH; i++) node = node.step?.parents[0] ?? node;
    expect(node.step).toEqual({ op: 'elided', parents: [], nodes: 40 - MAX_LINEAGE_DEPTH });
    expect(isLineageNode(pruned)).toBe(true);
  });

  it('keeps at most the node limit, nearest first, and a step whole or not at all', () => {
    // Ten ligations of ten parts each under one of ten: 111 molecules.
    const wide = ligation(
      'top',
      Array.from({ length: 10 }, (_, i) =>
        ligation(
          `mid ${i}`,
          Array.from({ length: 10 }, (_, k) => leaf(`leaf ${i}.${k}`)),
        ),
      ),
    );
    expect(lineageNodeCount(wide)).toBe(111);
    const pruned = pruneLineage(wide);
    expect(lineageNodeCount(pruned)).toBeLessThanOrEqual(MAX_LINEAGE_NODES);
    const mids = pruned.step?.parents ?? [];
    expect(mids).toHaveLength(10);
    // The first five ligations fit whole (11 + 5 × 10 = 61); the rest are marked.
    const kept = mids.filter((m) => m.step?.op === 'ligation');
    expect(kept).toHaveLength(5);
    for (const m of kept) expect(m.step?.parents).toHaveLength(10);
    for (const m of mids.slice(5)) {
      expect(m.step).toEqual({ op: 'elided', parents: [], nodes: 10 });
      expect(m.name).toMatch(/^mid /);
    }
    expect(lineageSize(pruned)).toBe(111);
  });

  it('takes an explicit limit', () => {
    const pruned = pruneLineage(ligation('p', [leaf('a'), leaf('b')]), 2);
    expect(pruned.step).toEqual({ op: 'elided', parents: [], nodes: 2 });
  });
});

describe('isLineageNode', () => {
  const good = ligation('p', [leaf('a'), leaf('b')]);

  it('accepts what the app records', () => {
    expect(isLineageNode(good)).toBe(true);
    expect(isLineageNode(leaf('x'))).toBe(true);
  });

  it('refuses a step with the wrong number of parents or flags', () => {
    const bad = (step: unknown): boolean => isLineageNode({ ...leaf('x'), step });
    expect(bad({ op: 'ligation', parents: [], circular: true, flipped: [] })).toBe(false);
    expect(bad({ op: 'ligation', parents: [leaf('a')], circular: true, flipped: [] })).toBe(false);
    expect(bad({ op: 'edited', parents: [leaf('a'), leaf('b')] })).toBe(false);
    expect(bad({ op: 'gateway', parents: [leaf('a')], reaction: 'BP', byproduct: false })).toBe(
      false,
    );
    expect(bad({ op: 'elided', parents: [leaf('a')], nodes: 1 })).toBe(false);
    expect(
      bad({
        op: 'digest',
        parents: [leaf('a')],
        enzymes: [],
        range: { start: 5, end: 5 },
        uncut: 0,
      }),
    ).toBe(false);
    expect(bad({ op: 'teleport', parents: [] })).toBe(false);
  });

  it('refuses a malformed node', () => {
    expect(isLineageNode(null)).toBe(false);
    expect(isLineageNode({ ...leaf('x'), length: -1 })).toBe(false);
    expect(isLineageNode({ ...leaf('x'), topology: 'round' })).toBe(false);
    expect(isLineageNode({ ...leaf('x'), checksum: 3 })).toBe(false);
    expect(isLineageNode({ ...leaf('x'), step: undefined })).toBe(false);
  });

  it('refuses a tree deeper than the limit', () => {
    expect(isLineageNode(chain(MAX_LINEAGE_DEPTH))).toBe(true);
    expect(isLineageNode(chain(MAX_LINEAGE_DEPTH + 1))).toBe(false);
  });
});

describe('lineageChecksums', () => {
  it('lists each checksum once, root first', () => {
    const a = { ...leaf('a'), checksum: 'cdseguid=A' };
    const tree = { ...ligation('p', [a, a, leaf('b')]), checksum: 'cdseguid=P' };
    expect(lineageChecksums(tree)).toEqual(['cdseguid=P', 'cdseguid=A']);
  });
});

describe('describeLineageStep', () => {
  const one = [leaf('parent', 4000)];
  const cases: readonly [LineageStep, string][] = [
    [
      {
        op: 'digest',
        parents: one,
        enzymes: ['EcoRI', 'BamHI'],
        range: { start: 396, end: 3082 },
        uncut: 0,
      },
      'Digest with EcoRI and BamHI · 397–3,082',
    ],
    [
      {
        op: 'digest',
        parents: one,
        enzymes: ['EcoRI'],
        range: { start: 3900, end: 4100 },
        uncut: 1,
      },
      'Digest with EcoRI · 3,901–100, partial: 1 site uncut',
    ],
    [
      { op: 'digest', parents: one, enzymes: [], range: { start: 0, end: 4000 }, uncut: 0 },
      'Uncut · 1–4,000',
    ],
    [
      {
        op: 'pcr',
        parents: one,
        forward: { name: 'F1', sequence: 'ACGT' },
        reverse: { name: 'R1', sequence: 'TTGA' },
        polymerase: 'taq',
      },
      'PCR with F1 and R1 · Taq',
    ],
    [
      { op: 'ligation', parents: [leaf('a'), leaf('b')], circular: true, flipped: [false, true] },
      'Ligation of 2 parts, circular, 1 turned over',
    ],
    [
      {
        op: 'golden-gate',
        parents: [leaf('a'), leaf('b'), leaf('c')],
        enzymes: ['BsaI', 'BsmBI'],
        flipped: [false, false, false],
      },
      'Golden Gate with BsaI and BsmBI of 3 parts',
    ],
    [
      {
        op: 'gibson',
        parents: [leaf('a')],
        kit: 'in-fusion',
        circular: true,
        overlap: 15,
        flipped: [false],
      },
      'In-Fusion assembly of 1 part',
    ],
    [
      {
        op: 'gibson',
        parents: [leaf('a'), leaf('b')],
        kit: 'gibson',
        circular: false,
        overlap: 20,
        flipped: [false, false],
      },
      'Gibson assembly of 2 parts, linear',
    ],
    [
      { op: 'gateway', parents: [leaf('a'), leaf('b')], reaction: 'LR', byproduct: true },
      'Gateway LR reaction, its byproduct',
    ],
    [
      {
        op: 'mutagenesis',
        parents: one,
        change: 'A12G',
        method: 'overlapping',
        primers: ['A', 'T'],
      },
      'Mutagenesis A12G · QuikChange (overlapping primers)',
    ],
    [{ op: 'phosphates', parents: one, removed: true }, 'Dephosphorylated'],
    [{ op: 'phosphates', parents: one, removed: false }, 'Phosphorylated'],
    [{ op: 'edited', parents: one }, 'Edited after it was made'],
    [{ op: 'elided', parents: [], nodes: 1 }, '1 earlier molecule not kept'],
  ];
  it.each(cases)('describes %#', (step, text) => {
    expect(describeLineageStep(step)).toBe(text);
  });

  it('counts a range across the origin the way the views do', () => {
    expect(describeLineageRange({ start: 10, end: 20 }, 100)).toBe('11–20');
    expect(describeLineageRange({ start: 90, end: 110 }, 100)).toBe('91–10');
    expect(describeLineageRange({ start: 0, end: 100 }, 100)).toBe('1–100');
  });
});

describe('editedSinceMade with a lineage from elsewhere (#85)', () => {
  const doc = SeqDocument.create({ name: 'p', sequence: 'ACGTACGTACGT' });

  it('says nothing about a root that carries no checksum', () => {
    const parent = {
      name: 'a',
      checksum: null,
      topology: 'linear' as const,
      length: 6,
      step: null,
    };
    const fromSnapGene = doc.setMetadata({
      lineage: {
        name: 'p',
        // SnapGene records no checksum, so neither does the tree read from it.
        checksum: null,
        topology: 'linear' as const,
        length: doc.length,
        step: { op: 'other' as const, parents: [parent], name: 'flip' },
      },
    });
    expect(editedSinceMade(fromSnapGene)).toBe(false);
    // Edited or not, there is nothing to compare it with.
    expect(editedSinceMade(fromSnapGene.insert(0, 'A'))).toBe(false);
  });
});
