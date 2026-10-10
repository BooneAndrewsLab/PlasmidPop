import { describe, expect, it } from 'vitest';

import {
  type DiagnosticDigest,
  type PcrStep,
  type Protocol,
  type ProtocolOligo,
  type ProtocolStep,
  SeqDocument,
  diagnosticDigests,
  protocolToHtml,
  protocolToMarkdown,
} from '@/core';

const oligo = (name: string, sequence: string, inCollection: string | null): ProtocolOligo => ({
  name,
  sequence,
  length: sequence.length,
  usedFor: ['pOut', 'pTwo'],
  inCollection,
});

const pcr = (over: Partial<PcrStep>): PcrStep => ({
  kind: 'pcr',
  product: 'frag',
  productLength: 1200,
  template: 'tmpl',
  templateLength: 5000,
  forward: oligo('F1', 'ACGTACGTAC', null),
  reverse: oligo('R1', 'TTGGCCAATT', null),
  polymerase: 'proofreading',
  tmForward: 61.25,
  tmReverse: 58.04,
  annealing: 60.5,
  extensionSeconds: 36,
  ...over,
});

const base: Protocol = {
  product: 'pOut',
  length: 12345,
  topology: 'circular',
  steps: [],
  oligos: [],
  diagnostics: [],
  caveats: [],
};

function diagnostic(): DiagnosticDigest {
  const doc = SeqDocument.create({
    name: 'd',
    topology: 'circular',
    sequence: `GAATTC${'A'.repeat(300)}GAATTC${'C'.repeat(500)}`,
  });
  const d = diagnosticDigests(doc).find((x) => x.enzyme === 'EcoRI');
  if (d === undefined) throw new Error('no EcoRI digest');
  return d;
}

describe('protocol text of an empty protocol', () => {
  it('says what is missing in each section', () => {
    expect(protocolToMarkdown(base)).toBe(
      [
        '# Protocol: pOut',
        '',
        "12,345 bp, circular. Built from what the product records of how it was made; the programs are the usual ones for each reaction, so follow your supplier's instructions where they differ.",
        '',
        '## Oligos to order',
        '',
        'None: no step of this product used a primer.',
        '',
        '## Reactions, in order',
        '',
        'The record names no reaction.',
        '',
        '## Expected diagnostic digest',
        '',
        'No enzyme in the set in use cuts the product between once and six times.',
        '',
      ].join('\n'),
    );
  });

  it('lists caveats right after the opening line, one paragraph each', () => {
    const md = protocolToMarkdown({ ...base, topology: 'linear', caveats: ['First.', 'Second.'] });
    expect(md).toContain('12,345 bp, linear. Built');
    expect(md).toContain('differ.\n\nFirst.\n\nSecond.\n\n## Oligos to order\n');
  });
});

describe('protocol text of reactions', () => {
  const steps: ProtocolStep[] = [
    pcr({}),
    pcr({
      product: 'frag2',
      polymerase: 'taq',
      tmForward: Number.NaN,
      tmReverse: 55,
      annealing: null,
      extensionSeconds: 100,
      forward: oligo('F2', 'AC', 'oMine'),
    }),
    {
      kind: 'digest',
      product: 'cut',
      productLength: 3000,
      template: 'pBase',
      templateLength: 4000,
      enzymes: ['EcoRI', 'BamHI'],
      uncut: 0,
      notes: ['Note one.', 'Note two.'],
    },
    {
      kind: 'digest',
      product: 'uncut',
      productLength: 4000,
      template: 'pBase',
      templateLength: 4000,
      enzymes: [],
      uncut: 0,
      notes: [],
    },
    {
      kind: 'golden-gate',
      product: 'gg',
      productLength: 3600,
      description: 'Golden Gate of 2 parts',
      ratio: 2,
      enzymes: ['BsaI', 'BsmBI'],
      program: ['line a', 'line b'],
      parts: [
        {
          name: 'pDest',
          length: 3000,
          role: 'vector',
          ng: 50,
          pmol: 0.0253,
          microlitres: 1,
          concentration: 50,
        },
        {
          name: 'ins',
          length: 600,
          role: 'insert',
          ng: 20.05,
          pmol: 0.0506,
          microlitres: null,
          concentration: null,
        },
      ],
    },
    {
      kind: 'ligation',
      product: 'lig',
      productLength: 100,
      description: 'Ligation',
      ratio: 3,
      enzymes: [],
      program: ['T4'],
      parts: [
        {
          name: 'v',
          length: 90,
          role: 'vector',
          ng: 50,
          pmol: 1,
          microlitres: null,
          concentration: null,
        },
      ],
    },
    {
      kind: 'gibson',
      product: 'gib',
      productLength: 7,
      description: 'Gibson',
      ratio: 2,
      enzymes: [],
      program: [],
      parts: [],
    },
    {
      kind: 'other',
      product: 'oth',
      productLength: 10,
      description: 'Did a thing',
      parts: ['a', 'b'],
    },
    { kind: 'other', product: 'lone', productLength: 11, description: 'Alone', parts: [] },
  ];

  const protocol: Protocol = {
    ...base,
    steps,
    oligos: [
      oligo('F1', 'ACGTACGTAC', null),
      { ...oligo('R|1', 'TTGGCCAATT', 'oMine'), usedFor: ['pOut'] },
    ],
  };

  it('writes the oligo table', () => {
    const md = protocolToMarkdown(protocol);
    expect(md).toContain(
      [
        '## Oligos to order',
        '',
        '| Name | Sequence (5′→3′) | Length | For | My primers |',
        '| --- | --- | --- | --- | --- |',
        '| F1 | ACGTACGTAC | 10 nt | pOut, pTwo | order |',
        '| R\\|1 | TTGGCCAATT | 10 nt | pOut | already there as oMine |',
        '',
        '## Reactions, in order',
        '',
      ].join('\n'),
    );
  });

  it('writes a proofreading PCR with its program', () => {
    expect(protocolToMarkdown(protocol)).toContain(
      [
        '### 1. PCR: frag (1,200 bp)',
        '',
        '| Component | Amount |',
        '| --- | --- |',
        '| Template: tmpl (5,000 bp) | 1–10 ng |',
        '| Forward primer F1 | 0.5 µM |',
        '| Reverse primer R1 | 0.5 µM |',
        '| Proofreading polymerase (Q5, Phusion) with its buffer | as the supplier says |',
        '| dNTPs | 200 µM each |',
        '',
        'Product 1,200 bp. Tm of the annealing part: 61.3 °C forward, 58.0 °C reverse, from the 3′ end of each oligo (a 5′ tail is not counted, and the record does not say where it ends, so a primer over 30 bases is taken to anneal with its last 22). Annealing 60.5 °C, extension 36 s.',
        '',
        '- 98 °C for 30 s',
        '- 30 cycles of 98 °C for 10 s, 60.5 °C for 20 s, 72 °C for 36 s',
        '- 72 °C for 2 min',
        '',
      ].join('\n'),
    );
  });

  it('writes a Taq PCR whose Tm could not be worked out', () => {
    expect(protocolToMarkdown(protocol)).toContain(
      [
        '### 2. PCR: frag2 (1,200 bp)',
        '',
        '| Component | Amount |',
        '| --- | --- |',
        '| Template: tmpl (5,000 bp) | 1–10 ng |',
        '| Forward primer F2 | 0.5 µM |',
        '| Reverse primer R1 | 0.5 µM |',
        '| Taq polymerase with its buffer | as the supplier says |',
        '| dNTPs | 200 µM each |',
        '',
        'Product 1,200 bp. Tm of the annealing part: – forward, 55.0 °C reverse, from the 3′ end of each oligo (a 5′ tail is not counted, and the record does not say where it ends, so a primer over 30 bases is taken to anneal with its last 22). Annealing could not be suggested (ambiguous bases), extension 1.7 min. Taq adds an A to each 3′ end.',
        '',
        '- 95 °C for 2 min',
        '- 30 cycles of 95 °C for 30 s, the annealing temperature for 30 s, 72 °C for 1.7 min',
        '- 72 °C for 5 min',
        '',
      ].join('\n'),
    );
  });

  it('writes digests', () => {
    const md = protocolToMarkdown(protocol);
    expect(md).toContain(
      [
        '### 3. Digest: cut (3,000 bp)',
        '',
        'Cut pBase (4,000 bp) with EcoRI and BamHI; keep the 3,000 bp fragment.',
        '',
        '- Note one.',
        '- Note two.',
        '',
        '### 4. Digest: uncut (4,000 bp)',
        '',
        'Cut pBase (4,000 bp) with no enzyme (an uncut piece); keep the 4,000 bp fragment.',
        '',
        '',
      ].join('\n'),
    );
  });

  it('writes assemblies with and without volumes', () => {
    const md = protocolToMarkdown(protocol);
    expect(md).toContain(
      [
        '### 5. Golden Gate: gg (3,600 bp)',
        '',
        'Golden Gate of 2 parts',
        '',
        '| Part | Length | ng | pmol | µL |',
        '| --- | --- | --- | --- | --- |',
        '| pDest (vector) | 3,000 bp | 50 | 0.0253 | 1 |',
        '| ins (insert) | 600 bp | 20.05 | 0.0506 | enter a concentration |',
        '',
        "Amounts give each insert 2 times the vector's molecules (660 g/mol per base pair). Enzyme: BsaI, BsmBI with T4 DNA ligase.",
        '',
        '- line a',
        '- line b',
        '',
        '### 6. Ligation: lig (100 bp)',
        '',
        'Ligation',
        '',
        '| Part | Length | ng | pmol |',
        '| --- | --- | --- | --- |',
        '| v (vector) | 90 bp | 50 | 1 |',
        '',
        "Amounts give each insert 3 times the vector's molecules (660 g/mol per base pair).",
        '',
        '- T4',
        '',
        '### 7. Gibson / homology assembly: gib (7 bp)',
        '',
      ].join('\n'),
    );
  });

  it('writes other steps with and without their parts', () => {
    const md = protocolToMarkdown(protocol);
    expect(md).toContain(
      [
        '### 8. oth (10 bp)',
        '',
        'Did a thing',
        '',
        'From: a, b.',
        '',
        '### 9. lone (11 bp)',
        '',
        'Alone',
        '',
      ].join('\n'),
    );
    expect(md).toContain('### 9. lone (11 bp)\n\nAlone\n\n## Expected diagnostic digest');
    expect(md).not.toContain('The record names no reaction.');
  });

  it('renders the same blocks as HTML, escaped', () => {
    const html = protocolToHtml({
      ...base,
      product: 'a<b>&"c',
      steps: steps.slice(7, 8),
      oligos: [oligo('F1', 'ACGT', null), oligo('R1', 'TT', 'oX')],
    });
    expect(html).toContain('<title>Protocol: a&lt;b&gt;&amp;&quot;c</title>');
    expect(html).toContain('<h1>Protocol: a&lt;b&gt;&amp;&quot;c</h1>');
    expect(html).toContain('<h2>Oligos to order</h2>');
    expect(html).toContain(
      '<table><thead><tr><th>Name</th><th>Sequence (5′→3′)</th><th>Length</th><th>For</th><th>My primers</th></tr></thead><tbody><tr><td>F1</td><td>ACGT</td><td>4 nt</td><td>pOut, pTwo</td><td>order</td></tr><tr><td>R1</td><td>TT</td><td>2 nt</td><td>pOut, pTwo</td><td>already there as oX</td></tr></tbody></table>',
    );
    expect(html).toContain('<h3>1. oth (10 bp)</h3>\n<p>Did a thing</p>\n<p>From: a, b.</p>');
    expect(html).toContain('<h2>Expected diagnostic digest</h2>\n<p>No enzyme');
    expect(html).toContain('</style>\n</head><body>\n<h1>');
    expect(html.endsWith('</body></html>\n')).toBe(true);
    expect(html).toContain('<html lang="en"><head><meta charset="utf-8">');
  });

  it('renders a list as HTML', () => {
    const html = protocolToHtml({ ...base, steps: steps.slice(2, 3) });
    expect(html).toContain('<ul><li>Note one.</li><li>Note two.</li></ul>');
  });
});

describe('protocol text of times', () => {
  it('switches from seconds to minutes at 90 s', () => {
    const at = (extensionSeconds: number): string =>
      protocolToMarkdown({ ...base, steps: [pcr({ extensionSeconds })] });
    expect(at(89)).toContain('72 °C for 89 s');
    expect(at(90)).toContain('72 °C for 1.5 min');
  });
});

describe('protocol text of a diagnostic digest', () => {
  it('lists the enzyme, its cuts and the bands, then the caveat', () => {
    const d = diagnostic();
    const md = protocolToMarkdown({ ...base, diagnostics: [d] });
    expect(md).toContain(
      [
        '## Expected diagnostic digest',
        '',
        '| Enzyme | Cuts | Bands |',
        '| --- | --- | --- |',
        '| EcoRI | 2 | 506 + 306 bp |',
        '',
        'Clearest first. Band sizes are of the fragments the product gives; a circle left uncut runs supercoiled, not at its size.',
        '',
      ].join('\n'),
    );
  });
});
