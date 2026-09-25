import { describeLineage, describeLineageRange, describeLineageStep } from './describe';
import { type LineageNode, type LineageStep } from './lineage';

function leaf(name: string, length = 100): LineageNode {
  return { name, checksum: null, topology: 'linear', length, step: null };
}

describe('describing a step, word for word', () => {
  it('lists three enzymes with commas and an and', () => {
    const step: LineageStep = {
      op: 'digest',
      parents: [leaf('p', 1000)],
      enzymes: ['EcoRI', 'BamHI', 'XhoI'],
      range: { start: 9, end: 20 },
      uncut: 0,
    };
    expect(describeLineageStep(step)).toBe('Digest with EcoRI, BamHI and XhoI · 10–20');
  });

  it('lists three Golden Gate enzymes the same way', () => {
    const step: LineageStep = {
      op: 'golden-gate',
      parents: [leaf('a'), leaf('b')],
      enzymes: ['BsaI', 'BsmBI', 'BbsI'],
      flipped: [true, true],
    };
    expect(describeLineageStep(step)).toBe(
      'Golden Gate with BsaI, BsmBI and BbsI of 2 parts, 2 turned over',
    );
  });

  it('says how many sites a partial digest left uncut, in the plural', () => {
    const step: LineageStep = {
      op: 'digest',
      parents: [leaf('p', 1000)],
      enzymes: ['EcoRI'],
      range: { start: 0, end: 10 },
      uncut: 2,
    };
    expect(describeLineageStep(step)).toBe('Digest with EcoRI · 1–10, partial: 2 sites uncut');
  });

  it('leaves the range out of a digest with no parent', () => {
    const step: LineageStep = {
      op: 'digest',
      parents: [],
      enzymes: ['EcoRI'],
      range: { start: 0, end: 10 },
      uncut: 0,
    };
    expect(describeLineageStep(step)).toBe('Digest with EcoRI');
  });

  it('names a proofreading PCR', () => {
    const step: LineageStep = {
      op: 'pcr',
      parents: [leaf('t')],
      forward: { name: 'F', sequence: 'ACGT' },
      reverse: { name: 'R', sequence: 'TTGA' },
      polymerase: 'proofreading',
    };
    expect(describeLineageStep(step)).toBe('PCR with F and R · proofreading');
  });

  it('says a ligation left linear is linear, and says nothing of no flips', () => {
    const step: LineageStep = {
      op: 'ligation',
      parents: [leaf('a')],
      circular: false,
      flipped: [false],
    };
    expect(describeLineageStep(step)).toBe('Ligation of 1 part, linear');
  });

  it('names a NEBuilder assembly', () => {
    const step: LineageStep = {
      op: 'gibson',
      parents: [leaf('a'), leaf('b'), leaf('c')],
      kit: 'nebuilder',
      circular: true,
      overlap: 20,
      flipped: [false, false, false],
    };
    expect(describeLineageStep(step)).toBe('NEBuilder HiFi assembly of 3 parts');
  });

  it('names a Gateway reaction that gave the clone', () => {
    const step: LineageStep = {
      op: 'gateway',
      parents: [leaf('a'), leaf('b')],
      reaction: 'BP',
      byproduct: false,
    };
    expect(describeLineageStep(step)).toBe('Gateway BP reaction');
  });

  it('names a Q5 mutagenesis by its back-to-back primers', () => {
    const step: LineageStep = {
      op: 'mutagenesis',
      parents: [leaf('p')],
      change: '+GGATCC at 120',
      method: 'back-to-back',
      primers: ['A', 'T'],
    };
    expect(describeLineageStep(step)).toBe(
      'Mutagenesis +GGATCC at 120 · Q5 (back-to-back primers)',
    );
  });

  it('counts many molecules left out, in the plural and with separators', () => {
    expect(describeLineageStep({ op: 'elided', parents: [], nodes: 1234 })).toBe(
      '1,234 earlier molecules not kept',
    );
  });
});

describe('describing a range', () => {
  it('gives the end as it is when the parent has no length', () => {
    expect(describeLineageRange({ start: 0, end: 5 }, 0)).toBe('1–5');
  });

  it('wraps an end through the origin of a circle of one base', () => {
    expect(describeLineageRange({ start: 0, end: 1 }, 1)).toBe('1–1');
  });
});

describe('describing a lineage', () => {
  it('is empty for a molecule with no recorded history', () => {
    expect(describeLineage(leaf('p'))).toBe('');
  });

  it('is the root step for a made one', () => {
    const node: LineageNode = {
      ...leaf('p'),
      step: { op: 'phosphates', parents: [leaf('q')], removed: true },
    };
    expect(describeLineage(node)).toBe('Dephosphorylated');
  });
});
