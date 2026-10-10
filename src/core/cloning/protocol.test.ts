import { describe, expect, it } from 'vitest';

import {
  type AssemblyStep,
  type LineageNode,
  type LineageStep,
  type Protocol,
  type ProtocolStep,
  SeqDocument,
  annealingPart,
  buildProtocol,
  ngOf,
  pmolOf,
  protocolToHtml,
  protocolToMarkdown,
  withLineage,
} from '@/core';

function filler(length: number, seed: number): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

const leaf = (name: string, length: number): LineageNode => ({
  name,
  checksum: null,
  topology: 'circular',
  length,
  step: null,
});

const FWD = 'GGTCTCAAATGAAAGCTTGGCTAGCAAGGATCC';
const REV = 'TTGCTAGCCAAGCTTTCATTTGAGACC';

function product(step: LineageStep): SeqDocument {
  const doc = SeqDocument.create({
    name: 'pOut',
    topology: 'circular',
    sequence: `GAATTC${filler(1500, 7)}GGATCC${filler(900, 8)}`,
  });
  return withLineage(doc, step);
}

function must<T>(x: T | null | undefined): T {
  if (x === undefined || x === null) throw new Error('expected a value');
  return x;
}

function stepOf<K extends ProtocolStep['kind']>(
  p: Protocol,
  kind: K,
): Extract<ProtocolStep, { kind: K }> {
  return must(p.steps.find((s): s is Extract<ProtocolStep, { kind: K }> => s.kind === kind));
}

function assemblyOf(p: Protocol, kind: AssemblyStep['kind']): AssemblyStep {
  return must(p.steps.find((s): s is AssemblyStep => s.kind === kind));
}

const pcrNode = (): LineageNode => ({
  name: 'insert PCR',
  checksum: null,
  topology: 'linear',
  length: 1200,
  step: {
    op: 'pcr',
    parents: [leaf('template', 5000)],
    forward: { name: 'F1', sequence: FWD },
    reverse: { name: 'R1', sequence: REV },
    polymerase: 'proofreading',
  },
});

describe('protocol arithmetic', () => {
  it('converts ng and pmol at 660 g/mol per base pair', () => {
    expect(pmolOf(66, 1000)).toBeCloseTo(0.1, 10);
    expect(ngOf(0.1, 1000)).toBeCloseTo(66, 10);
    expect(pmolOf(50, 0)).toBe(0);
  });

  it('takes a short primer whole and the 3′ end of a long one', () => {
    expect(annealingPart('acgtacgt')).toBe('ACGTACGT');
    const long = `${'A'.repeat(20)}CGTACGGTCAGTCAGTCAGTCA`;
    expect(annealingPart(long)).toBe('CGTACGGTCAGTCAGTCAGTCA');
  });
});

describe('buildProtocol', () => {
  it('is null for a document with no record', () => {
    expect(buildProtocol(SeqDocument.create({ name: 'x', sequence: 'ACGT' }))).toBeNull();
  });

  it('lists a PCR with its Tm, annealing and extension time', () => {
    const doc = product({
      op: 'ligation',
      parents: [leaf('pVec', 3000), pcrNode()],
      circular: true,
      flipped: [false, false],
    });
    const p = must(buildProtocol(doc));
    const pcr = stepOf(p, 'pcr');
    expect(pcr.template).toBe('template');
    expect(pcr.productLength).toBe(1200);
    // 30 s/kb for a proofreading enzyme.
    expect(pcr.extensionSeconds).toBe(36);
    expect(pcr.annealing).not.toBeNull();
    expect(must(pcr.annealing)).toBeLessThanOrEqual(72);
    expect(pcr.tmForward).toBeGreaterThan(40);
    // The PCR comes before the ligation that uses it.
    expect(p.steps.map((s) => s.kind)).toEqual(['pcr', 'ligation']);
  });

  it('gives Taq 1 min/kb and an annealing 5 degrees under the lower Tm', () => {
    const node = pcrNode();
    if (node.step?.op !== 'pcr') throw new Error('pcr');
    const taq: LineageNode = { ...node, step: { ...node.step, polymerase: 'taq' } };
    const p = must(
      buildProtocol(product({ op: 'ligation', parents: [taq], circular: true, flipped: [false] })),
    );
    const pcr = stepOf(p, 'pcr');
    expect(pcr.extensionSeconds).toBe(72);
    expect(must(pcr.annealing)).toBeCloseTo(Math.min(pcr.tmForward, pcr.tmReverse) - 5, 1);
  });

  it('collects oligos once and marks the ones already in My primers', () => {
    const doc = product({
      op: 'ligation',
      parents: [pcrNode(), pcrNode()],
      circular: true,
      flipped: [false, false],
    });
    const p = must(
      buildProtocol(doc, { collection: [{ name: 'oJK-12', sequence: FWD.toLowerCase() }] }),
    );
    expect(p.oligos.map((o) => o.name)).toEqual(['F1', 'R1']);
    expect(p.oligos[0]?.inCollection).toBe('oJK-12');
    expect(p.oligos[1]?.inCollection).toBeNull();
  });

  it('includes the primers of a mutagenesis', () => {
    const doc = product({
      op: 'mutagenesis',
      parents: [leaf('pWT', 4000)],
      change: 'A10G',
      method: 'back-to-back',
      primers: ['ACGTACGTACGTACGTACGT', 'TGCATGCATGCATGCATGCA'],
    });
    const p = must(buildProtocol(doc));
    expect(p.oligos).toHaveLength(2);
    expect(p.oligos[0]?.usedFor).toEqual(['pOut']);
    expect(stepOf(p, 'other').description).toContain('A10G');
  });

  it('works out insert-to-vector amounts from lengths and a concentration', () => {
    const doc = product({
      op: 'golden-gate',
      parents: [leaf('pDest', 3000), leaf('insA', 600)],
      enzymes: ['BsaI'],
      flipped: [false, false],
    });
    const p = must(buildProtocol(doc, { vectorNg: 66, concentrations: { insA: 10, pDest: 33 } }));
    const gg = assemblyOf(p, 'golden-gate');
    const [vec, ins] = gg.parts;
    expect(vec?.role).toBe('vector');
    expect(vec?.pmol).toBeCloseTo(0.0333, 3);
    expect(vec?.microlitres).toBe(2);
    // 2:1 by default for Golden Gate: 0.0667 pmol of a 600 bp insert is 26.4 ng.
    expect(gg.ratio).toBe(2);
    expect(ins?.ng).toBeCloseTo(26.4, 2);
    expect(ins?.microlitres).toBeCloseTo(2.64, 2);
  });

  it('takes the ratio the user enters, and leaves volumes empty without a concentration', () => {
    const doc = product({
      op: 'ligation',
      parents: [leaf('pVec', 3000), leaf('ins', 1000)],
      circular: true,
      flipped: [false, false],
    });
    const p = must(buildProtocol(doc, { ratio: 5 }));
    const lig = assemblyOf(p, 'ligation');
    expect(lig.ratio).toBe(5);
    expect(lig.parts.every((x) => x.microlitres === null)).toBe(true);
    expect(must(lig.parts[1]).pmol).toBeCloseTo(5 * must(lig.parts[0]).pmol, 3);
  });

  it('records a digest with its enzymes and a note for two', () => {
    const doc = product({
      op: 'digest',
      parents: [leaf('pBase', 4000)],
      enzymes: ['EcoRI', 'BamHI'],
      range: { start: 0, end: 100 },
      uncut: 0,
    });
    const d = stepOf(must(buildProtocol(doc)), 'digest');
    expect(d.enzymes).toEqual(['EcoRI', 'BamHI']);
    expect(d.notes.some((n) => n.includes('one buffer'))).toBe(true);
  });

  it('offers diagnostic digests of the product, clearest first', () => {
    const doc = product({
      op: 'phosphates',
      parents: [leaf('v', 3000)],
      removed: true,
    });
    const p = must(buildProtocol(doc));
    expect(p.diagnostics.length).toBeGreaterThan(0);
    expect(p.diagnostics.length).toBeLessThanOrEqual(3);
    for (const d of p.diagnostics) {
      expect(d.cuts).toBeGreaterThanOrEqual(1);
      expect(d.cuts).toBeLessThanOrEqual(6);
    }
  });

  it('says what an elided tree could not', () => {
    const doc = product({
      op: 'phosphates',
      parents: [{ ...leaf('v', 3000), step: { op: 'elided', parents: [], nodes: 9 } }],
      removed: false,
    });
    expect(must(buildProtocol(doc)).caveats.join(' ')).toContain('9 earlier');
  });

  it('says so when the product was edited after it was made', () => {
    const doc = product({ op: 'phosphates', parents: [leaf('v', 3000)], removed: false });
    const edited = doc.setMetadata({}).insert(0, 'ACGT');
    expect(must(buildProtocol(edited)).caveats.join(' ')).toContain('edited since');
  });
});

describe('protocol text', () => {
  const doc = product({
    op: 'golden-gate',
    parents: [leaf('pDest', 3000), pcrNode()],
    enzymes: ['BsaI'],
    flipped: [false, false],
  });
  const p = must(buildProtocol(doc, { concentrations: { pDest: 50 } }));

  it('writes Markdown with the oligo, reaction and digest sections', () => {
    const md = protocolToMarkdown(p);
    expect(md.startsWith('# Protocol: pOut\n')).toBe(true);
    expect(md).toContain('## Oligos to order');
    expect(md).toContain(`| F1 | ${FWD} |`);
    expect(md).toContain('### 1. PCR: insert PCR (1,200 bp)');
    expect(md).toContain('### 2. Golden Gate: pOut');
    expect(md).toContain('## Expected diagnostic digest');
    expect(md).toContain('| --- |');
  });

  it('escapes HTML in names and pipes in Markdown cells', () => {
    const odd = must(
      buildProtocol(
        withLineage(
          SeqDocument.create({ name: 'a<b>|c', topology: 'circular', sequence: filler(800, 3) }),
          { op: 'phosphates', parents: [leaf('v&w', 100)], removed: true },
        ),
      ),
    );
    const html = protocolToHtml(odd);
    expect(html).toContain('a&lt;b&gt;|c');
    expect(html).toContain('v&amp;w');
    expect(html).not.toContain('<b>');
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });
});
