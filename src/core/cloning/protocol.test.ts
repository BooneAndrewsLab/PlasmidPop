import { describe, expect, it } from 'vitest';

import {
  type AssemblyStep,
  type LineageNode,
  type LineageStep,
  type Protocol,
  type ProtocolStep,
  SeqDocument,
  UNMETHYLATED_HOST,
  annealingPart,
  compareDiagnostic,
  diagnosticDigests,
  meltingTemperature,
  q5AnnealingTemperature,
  q5MeltingTemperature,
  buildProtocol,
  designOverlapExtension,
  recordOverlapExtension,
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

describe('buildProtocol of an overlap-extension product', () => {
  const a = SeqDocument.create({ name: 'frag A', sequence: filler(900, 5).toLowerCase() });
  const b = SeqDocument.create({ name: 'frag B', sequence: filler(800, 6).toLowerCase() });
  const fragments = [a, b].map((doc) => ({ doc, range: { start: 0, end: doc.length } }));

  it('lists the PCRs, then the fusion as a step of its own, and every primer to order', () => {
    const design = designOverlapExtension(fragments);
    const doc = must(recordOverlapExtension(design, fragments));
    const p = must(buildProtocol(doc));
    expect(p.steps.map((s) => s.kind)).toEqual(['pcr', 'pcr', 'other', 'pcr']);
    const fusion = p.steps[2];
    expect(fusion?.kind === 'other' ? fusion.description : '').toMatch(
      /Overlap-extension PCR of 2 parts, linear.*no primers/,
    );
    expect(p.oligos.map((o) => o.sequence).sort()).toEqual(
      design.primers.map((x) => x.sequence.toUpperCase()).sort(),
    );
  });
});

describe('annealingPart boundary', () => {
  it('takes 30 bases whole and the last 22 of 31', () => {
    const thirty = filler(30, 11);
    expect(annealingPart(thirty)).toBe(thirty);
    const thirtyOne = filler(31, 12);
    expect(annealingPart(thirtyOne)).toBe(thirtyOne.slice(9));
    expect(annealingPart(thirtyOne)).toHaveLength(22);
  });
});

describe('buildProtocol PCR details', () => {
  const pcrOf = (
    parents: LineageNode[],
    over: Partial<Extract<LineageStep, { op: 'pcr' }>> = {},
  ) => {
    const node: LineageNode = {
      ...leaf('prod', 2000),
      topology: 'linear',
      step: {
        op: 'pcr',
        parents,
        forward: { name: 'F1', sequence: FWD },
        reverse: { name: 'R1', sequence: REV },
        polymerase: 'proofreading',
        ...over,
      },
    };
    const doc = product({ op: 'phosphates', parents: [node], removed: false });
    return stepOf(must(buildProtocol(doc)), 'pcr');
  };

  it('names the template and its length, or falls back without one', () => {
    const named = pcrOf([leaf('pTemplateX', 4321)]);
    expect(named.template).toBe('pTemplateX');
    expect(named.templateLength).toBe(4321);
    const none = pcrOf([]);
    expect(none.template).toBe('template');
    expect(none.templateLength).toBe(0);
  });

  it('works out each Tm from the annealing part and the annealing from both', () => {
    const pcr = pcrOf([leaf('t', 100)]);
    expect(pcr.tmForward).toBe(q5MeltingTemperature(annealingPart(FWD)));
    expect(pcr.tmReverse).toBe(q5MeltingTemperature(annealingPart(REV)));
    expect(pcr.annealing).toBe(q5AnnealingTemperature(pcr.tmForward, pcr.tmReverse));
    const taq = pcrOf([leaf('t', 100)], { polymerase: 'taq' });
    expect(taq.tmForward).toBe(meltingTemperature(annealingPart(FWD)));
    expect(taq.annealing).toBe(Math.round((Math.min(taq.tmForward, taq.tmReverse) - 5) * 10) / 10);
  });

  it('gives no annealing temperature when either primer is ambiguous', () => {
    const fwdN = pcrOf([leaf('t', 100)], {
      forward: { name: 'F', sequence: 'ACGTNNACGTACGTACGT' },
    });
    expect(fwdN.tmForward).toBeNaN();
    expect(fwdN.tmReverse).not.toBeNaN();
    expect(fwdN.annealing).toBeNull();
    const revN = pcrOf([leaf('t', 100)], {
      reverse: { name: 'R', sequence: 'ACGTNNACGTACGTACGT' },
    });
    expect(revN.tmReverse).toBeNaN();
    expect(revN.tmForward).not.toBeNaN();
    expect(revN.annealing).toBeNull();
  });
});

describe('buildProtocol digest steps', () => {
  const digestOf = (enzymes: string[], uncut: number, parents: LineageNode[]) =>
    stepOf(
      must(
        buildProtocol(
          product({
            op: 'digest',
            parents,
            enzymes,
            range: { start: 0, end: 100 },
            uncut,
          }),
        ),
      ),
      'digest',
    );

  it('keeps the template, enzymes and uncut count, with only the buffer note for a plain digest', () => {
    const d = digestOf(['EcoRI'], 0, [leaf('pBase', 4000)]);
    expect(d.template).toBe('pBase');
    expect(d.templateLength).toBe(4000);
    expect(d.uncut).toBe(0);
    expect(d.notes).toEqual([
      'Buffer and incubation: take them from the supplier’s table; PlasmidPop holds none.',
    ]);
  });

  it('adds a two-enzyme note and a partial-digest note, in that order', () => {
    const d = digestOf(['EcoRI', 'BamHI'], 2, [leaf('pBase', 4000)]);
    expect(d.uncut).toBe(2);
    expect(d.notes).toEqual([
      'Two enzymes: check that both are active in one buffer, or cut with one, clean up, then the other.',
      'A partial digest: stop it early, leaving 2 site(s) uncut.',
      'Buffer and incubation: take them from the supplier’s table; PlasmidPop holds none.',
    ]);
  });

  it('falls back when the record names no template', () => {
    const d = digestOf(['EcoRI'], 0, []);
    expect(d.template).toBe('template');
    expect(d.templateLength).toBe(0);
  });
});

describe('buildProtocol other steps', () => {
  it.each([
    [
      { op: 'gateway', parents: [leaf('a', 10), leaf('b', 20)], reaction: 'LR', byproduct: false },
      'Gateway LR reaction',
    ],
    [{ op: 'edited', parents: [leaf('a', 10)] }, 'Edited after it was made'],
    [{ op: 'other', parents: [leaf('a', 10)], name: 'flip' }, 'flip of 1 part'],
    [
      {
        op: 'gibson',
        parents: [leaf('a', 10)],
        kit: 'gibson',
        circular: true,
        overlap: 20,
        flipped: [false],
      },
      null,
    ],
  ] as [LineageStep, string | null][])('step %#', (step, description) => {
    const p = must(buildProtocol(product(step)));
    expect(p.steps).toHaveLength(1);
    const s = must(p.steps[0]);
    if (description === null) {
      expect(s.kind).toBe('gibson');
      return;
    }
    expect(s.kind).toBe('other');
    if (s.kind !== 'other') return;
    expect(s.description).toBe(description);
    expect(s.product).toBe('pOut');
    expect(s.parts).toEqual(step.parents.map((x) => x.name));
  });

  it('lists the parts of an overlap-extension step by name', () => {
    const doc = product({
      op: 'gibson',
      parents: [leaf('p1', 10), leaf('p2', 20)],
      kit: 'overlap-extension',
      circular: false,
      overlap: 20,
      flipped: [false, false],
    });
    const s = must(must(buildProtocol(doc)).steps[0]);
    expect(s.kind).toBe('other');
    expect(s.kind === 'other' ? s.parts : []).toEqual(['p1', 'p2']);
  });

  it('names the oligos of a mutagenesis forward then reverse', () => {
    const p = must(
      buildProtocol(
        product({
          op: 'mutagenesis',
          parents: [leaf('pWT', 4000)],
          change: 'A10G',
          method: 'back-to-back',
          primers: ['ACGTACGTACGTACGTACGT', 'TGCATGCATGCATGCATGCA'],
        }),
      ),
    );
    expect(p.oligos.map((o) => o.name)).toEqual(['pOut forward', 'pOut reverse']);
    expect(p.oligos.map((o) => o.sequence)).toEqual([
      'ACGTACGTACGTACGTACGT',
      'TGCATGCATGCATGCATGCA',
    ]);
  });
});

describe('buildProtocol assemblies', () => {
  const ggOf = (parents: LineageNode[], options = {}) =>
    assemblyOf(
      must(
        buildProtocol(
          product({
            op: 'golden-gate',
            parents,
            enzymes: ['BsaI'],
            flipped: parents.map(() => false),
          }),
          options,
        ),
      ),
      'golden-gate',
    );

  it('takes the longest part as the vector, the first of equals, whatever the order', () => {
    const a = ggOf([leaf('ins', 600), leaf('vec', 3000), leaf('ins2', 900)]);
    expect(a.parts.map((x) => x.role)).toEqual(['insert', 'vector', 'insert']);
    const tie = ggOf([leaf('x', 1000), leaf('y', 1000)]);
    expect(tie.parts.map((x) => x.role)).toEqual(['vector', 'insert']);
  });

  it('measures out each insert against the vector, with volumes only for usable concentrations', () => {
    const a = ggOf([leaf('vec', 3000), leaf('i0', 600), leaf('iNeg', 600), leaf('iOk', 600)], {
      vectorNg: 66,
      concentrations: { i0: 0, iNeg: -5, iOk: 8, vec: 22 },
    });
    expect(a.parts.map((x) => x.name)).toEqual(['vec', 'i0', 'iNeg', 'iOk']);
    expect(a.parts.map((x) => x.microlitres)).toEqual([3, null, null, 3.3]);
    expect(a.parts.map((x) => x.concentration)).toEqual([22, null, null, 8]);
    expect(a.parts.map((x) => x.ng)).toEqual([66, 26.4, 26.4, 26.4]);
    expect(a.parts.map((x) => x.pmol)).toEqual([0.0333, 0.0667, 0.0667, 0.0667]);
    expect(a.parts.map((x) => x.role)).toEqual(['vector', 'insert', 'insert', 'insert']);
  });

  it('keeps the enzymes of a Golden Gate only, and the program of each kind', () => {
    expect(ggOf([leaf('v', 3000), leaf('i', 600)]).enzymes).toEqual(['BsaI']);
    const lig = assemblyOf(
      must(
        buildProtocol(
          product({
            op: 'ligation',
            parents: [leaf('v', 3000), leaf('i', 600)],
            circular: true,
            flipped: [false, false],
          }),
        ),
      ),
      'ligation',
    );
    expect(lig.enzymes).toEqual([]);
    expect(lig.ratio).toBe(3);
    expect(lig.program).toEqual([
      'T4 DNA ligase: 16 °C overnight, or 25 °C for 10 min for sticky ends.',
    ]);
    const gib = assemblyOf(
      must(
        buildProtocol(
          product({
            op: 'gibson',
            parents: [leaf('v', 3000), leaf('i', 600)],
            kit: 'gibson',
            circular: true,
            overlap: 20,
            flipped: [false, false],
          }),
        ),
      ),
      'gibson',
    );
    expect(gib.enzymes).toEqual([]);
    expect(gib.ratio).toBe(2);
    expect(gib.program).toEqual(['50 °C for 15 min (up to 60 min for more than 4 parts)']);
    expect(ggOf([leaf('v', 3000)]).program).toEqual([
      '30 cycles of 37 °C for 1 min and 16 °C for 1 min',
      '60 °C for 5 min to inactivate',
    ]);
  });

  it('copes with a record that lists no parts', () => {
    const a = ggOf([]);
    expect(a.parts).toEqual([]);
  });
});

describe('buildProtocol oligos', () => {
  const pcrFor = (name: string, fwd = FWD, rev = REV): LineageNode => ({
    ...leaf(name, 1000),
    topology: 'linear',
    step: {
      op: 'pcr',
      parents: [leaf('t', 100)],
      forward: { name: 'F1', sequence: fwd },
      reverse: { name: 'R1', sequence: rev },
      polymerase: 'proofreading',
    },
  });

  it('merges the products an oligo serves, once each, in order', () => {
    const doc = product({
      op: 'ligation',
      parents: [
        pcrFor('A'),
        pcrFor('B'),
        pcrFor('A'),
        pcrFor('C', FWD.toLowerCase(), 'GTCAGTCAGTCAGTCA'),
      ],
      circular: true,
      flipped: [false, false, false, false],
    });
    const p = must(buildProtocol(doc));
    expect(p.oligos.map((o) => [o.name, o.usedFor])).toEqual([
      ['F1', ['A', 'B', 'C']],
      ['R1', ['A', 'B']],
      ['R1', ['C']],
    ]);
    expect(p.oligos[0]?.sequence).toBe(FWD);
    expect(p.oligos[0]?.length).toBe(FWD.length);
  });
});

describe('buildProtocol document facts', () => {
  const step: LineageStep = { op: 'phosphates', parents: [leaf('v', 3000)], removed: false };

  it('reports the product name, length and topology, with no caveats when untouched', () => {
    const doc = product(step);
    const p = must(buildProtocol(doc));
    expect(p.product).toBe('pOut');
    expect(p.length).toBe(doc.length);
    expect(p.topology).toBe('circular');
    expect(p.caveats).toEqual([]);
    const linear = withLineage(
      SeqDocument.create({ name: 'lin', topology: 'linear', sequence: filler(500, 4) }),
      step,
    );
    expect(must(buildProtocol(linear)).topology).toBe('linear');
  });

  it('says exactly what an edit and an elision change', () => {
    const edited = product(step).setMetadata({}).insert(0, 'ACGT');
    expect(must(buildProtocol(edited)).caveats).toEqual([
      'The product has been edited since it was made; the reactions describe the molecule as made, and the digests are of the document as it is now.',
    ]);
    const elided = product({
      op: 'phosphates',
      parents: [{ ...leaf('v', 3000), step: { op: 'elided', parents: [], nodes: 9 } }],
      removed: false,
    });
    const p = must(buildProtocol(elided));
    expect(p.caveats).toEqual([
      '9 earlier molecule(s) below v were left out of the record to keep it small.',
    ]);
    expect(p.steps.map((s) => s.kind)).toEqual(['other']);
    expect(p.oligos).toEqual([]);
  });

  it('lists as many diagnostic digests as asked, three by default', () => {
    const doc = product(step);
    expect(must(buildProtocol(doc)).diagnostics).toHaveLength(3);
    expect(must(buildProtocol(doc, { diagnosticCount: 5 })).diagnostics).toHaveLength(5);
  });
});

describe('diagnosticDigests', () => {
  const sites = (n: number): SeqDocument =>
    SeqDocument.create({
      name: 'd',
      topology: 'circular',
      sequence:
        'GAATTCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'.repeat(
          n,
        ),
    });

  it('keeps an enzyme that cuts six times and drops one that cuts seven', () => {
    const six = diagnosticDigests(sites(6), {}, 1000).find((d) => d.enzyme === 'EcoRI');
    expect(six?.cuts).toBe(6);
    expect(diagnosticDigests(sites(7), {}, 1000).find((d) => d.enzyme === 'EcoRI')).toBeUndefined();
  });

  it('is ordered clearest first, ties by enzyme name', () => {
    const doc = product({ op: 'phosphates', parents: [leaf('v', 3000)], removed: true });
    const all = diagnosticDigests(doc, {}, 1000);
    expect(all.length).toBeGreaterThan(5);
    let ties = 0;
    for (let i = 1; i < all.length; i++) {
      const a = must(all[i - 1]);
      const b = must(all[i]);
      const c = compareDiagnostic(a.profile, b.profile, {});
      expect(c).toBeLessThanOrEqual(0);
      if (c === 0) {
        ties++;
        expect(a.enzyme.localeCompare(b.enzyme)).toBeLessThan(0);
      }
    }
    expect(ties).toBeGreaterThan(0);
  });

  it('leaves out a site the host methylation blocks, but not for an unmethylated host', () => {
    const doc = SeqDocument.create({
      name: 'm',
      topology: 'circular',
      sequence: `CCGATCGATCC${'A'.repeat(400)}`,
    });
    expect(diagnosticDigests(doc, {}, 1000).map((d) => d.enzyme)).not.toContain('ClaI');
    const free = doc.setMethylation(UNMETHYLATED_HOST);
    expect(diagnosticDigests(free, {}, 1000).map((d) => d.enzyme)).toContain('ClaI');
  });
});
