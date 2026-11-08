import { SeqDocument, createFeature, rangeSegment, reverseComplement, translateCds } from '@/core';

import { BATCH_ROW_LIMIT, type BatchContext, scanRows, validateBatch, validateRow } from './rows';
import { type RawRow, parseBatchText } from './table';

/** A pseudo-random sequence over `alphabet`, fixed by its seed. */
function random(length: number, alphabet: string, seed: number): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += alphabet.charAt((x >> 16) % alphabet.length);
  }
  return out;
}

const SENSE = ['GCT', 'GCC', 'AAA', 'GAA', 'TTC', 'CTG', 'ATT', 'GGT', 'CGT', 'TGG'];
/** ATG, every sense codon above and again in reverse (two alanines each way, one lysine each), TAA. */
const ORF = `ATG${SENSE.join('')}${[...SENSE].reverse().join('')}TAA`;

const BACKBONE = random(1200, 'ACGT', 11);
const FWD_AT = 100;
const REV_AT = FWD_AT + ORF.length + 200;
const PLASMID_TEXT = `${BACKBONE.slice(0, FWD_AT)}${ORF}${BACKBONE.slice(FWD_AT, FWD_AT + 200)}${reverseComplement(ORF)}${BACKBONE.slice(FWD_AT + 200)}`;

function plasmid(): SeqDocument {
  return SeqDocument.create({
    name: 'pTest',
    sequence: PLASMID_TEXT,
    topology: 'circular',
    features: [
      createFeature({
        id: 'f',
        type: 'CDS',
        name: 'geneF',
        segments: [rangeSegment(FWD_AT, FWD_AT + ORF.length)],
      }),
      createFeature({
        id: 'r',
        type: 'CDS',
        name: 'geneR',
        strand: 'reverse',
        segments: [rangeSegment(REV_AT, REV_AT + ORF.length)],
      }),
      createFeature({ id: 'p', type: 'promoter', name: 'pLac', segments: [rangeSegment(10, 60)] }),
      createFeature({
        id: 'p2',
        type: 'misc_feature',
        name: 'twin',
        segments: [rangeSegment(1, 9)],
      }),
      createFeature({
        id: 'p3',
        type: 'misc_feature',
        name: 'Twin',
        segments: [rangeSegment(11, 19)],
      }),
    ],
  });
}

const LINEAR = SeqDocument.create({
  name: 'lin',
  sequence: random(300, 'ACGT', 3),
  topology: 'linear',
});

const CONTEXT: BatchContext = {
  templates: [
    { name: 'pTest', document: plasmid() },
    { name: 'lin', document: LINEAR },
  ],
  defaultTemplate: 'pTest',
};

function row(cells: RawRow['cells'], line = 2, notes = ''): RawRow {
  return { line, cells, notes };
}

function bad(cells: RawRow['cells']): string {
  const r = validateRow(row(cells), CONTEXT);
  if (r.ok) throw new Error('expected a bad row');
  return r.message;
}

function good(cells: RawRow['cells']) {
  const r = validateRow(row(cells), CONTEXT);
  if (!r.ok) throw new Error(r.message);
  return r.row;
}

describe('validateRow: good rows', () => {
  it('reads a 1-based inclusive region as 0-based half-open', () => {
    const r = good({ name: 'a', template: 'pTest', region: '11..20' });
    expect(r.source).toEqual({
      kind: 'region',
      range: { start: 10, end: 20 },
      strand: 'forward',
      text: '11..20',
    });
    expect(r.template).toBe('pTest');
  });

  it.each(['11-20', '11 – 20', '11:20', '11 to 20'])('reads %s as a range', (text) => {
    expect(good({ name: 'a', region: text }).source).toMatchObject({
      range: { start: 10, end: 20 },
    });
  });

  it('reads thousands separators in a range', () => {
    expect(good({ name: 'a', region: '1,000-1,010' }).source).toMatchObject({
      range: { start: 999, end: 1010 },
    });
  });

  it('reads complement(...) as the reverse strand over the same bases', () => {
    expect(good({ name: 'a', region: 'complement(11..20)' }).source).toMatchObject({
      range: { start: 10, end: 20 },
      strand: 'reverse',
    });
  });

  it('wraps the origin on a circular template, as 20-5 or as join(...)', () => {
    const length = plasmid().length;
    for (const text of [`${length - 4}-5`, `join(${length - 4}..${length},1..5)`]) {
      expect(good({ name: 'a', region: text }).source).toMatchObject({
        range: { start: length - 5, end: length + 5 },
      });
    }
  });

  it('reads a join of separate pieces as their span, with a warning', () => {
    const r = good({ name: 'a', region: 'join(11..20,41..50)' });
    expect(r.source).toMatchObject({ range: { start: 10, end: 50 } });
    expect(r.warnings.join(' ')).toMatch(/span/);
  });

  it('reads a feature name, case aside, with the feature strand', () => {
    expect(good({ name: 'a', region: 'PLAC' }).source).toMatchObject({
      range: { start: 10, end: 60 },
      strand: 'forward',
    });
    expect(good({ name: 'a', region: 'geneR' }).source).toMatchObject({ strand: 'reverse' });
  });

  it('uses the document in front when no template is named, and the whole template without a region', () => {
    const r = good({ name: 'a' });
    expect(r.template).toBe('pTest');
    expect(r.source).toEqual({ kind: 'whole', range: { start: 0, end: plasmid().length } });
  });

  it('finds a template by name without regard to case', () => {
    expect(good({ name: 'a', template: 'LIN', region: '1-5' }).template).toBe('lin');
  });

  it('reads a literal sequence, which needs no template', () => {
    const r = validateRow(row({ name: 'a', sequence: 'acg tu\nN' }), { templates: [] });
    expect(r).toMatchObject({
      ok: true,
      row: { template: null, source: { kind: 'sequence', bases: 'ACGTTN' } },
    });
  });

  it('reads the per-row options', () => {
    const r = good({
      name: 'a',
      region: '1-50',
      tm: '62 °C',
      size: '600 bp',
      enzyme: 'BamHI',
      left: 'gg atcc',
      right: 'CTCGAG',
      include_start: 'Yes',
      include_stop: 'no',
      kit: 'NEBuilder',
      change: 'gcc',
    });
    expect(r.overrides).toEqual({
      tm: 62,
      size: 600,
      enzyme: 'BamHI',
      left: 'GGATCC',
      right: 'CTCGAG',
      includeStart: true,
      includeStop: false,
      kit: 'NEBuilder',
      change: 'GCC',
    });
  });

  it('reads a dash or "deletion" as an empty change', () => {
    expect(good({ name: 'a', region: '1-3', change: '-' }).overrides.change).toBe('');
    expect(good({ name: 'a', region: '1-3', change: 'Deletion' }).overrides.change).toBe('');
  });

  it('keeps the notes and the line', () => {
    const r = validateRow(row({ name: 'a' }, 7, 'plate: 2'), CONTEXT);
    expect(r).toMatchObject({ ok: true, row: { line: 7, notes: 'plate: 2' } });
  });
});

describe('validateRow: bad rows', () => {
  it('names the missing name', () => {
    expect(bad({ region: '1-5' })).toMatch(/no name/);
  });

  it('names an unknown template', () => {
    expect(bad({ name: 'a', template: 'pNope', region: '1-5' })).toMatch(
      /No template named “pNope”/,
    );
  });

  it('wants a template when no document is in front and no sequence is given', () => {
    const r = validateRow(row({ name: 'a', region: '1-5' }), { templates: CONTEXT.templates });
    if (r.ok) throw new Error('expected a bad row');
    expect(r.message).toMatch(/no template/);
  });

  it('refuses a location that does not parse', () => {
    expect(bad({ name: 'a', region: 'join(1..5' })).toMatch(/not a location/);
    expect(bad({ name: 'a', region: '5..x' })).toMatch(/not a location/);
  });

  it('refuses a feature name the template has not, or has twice', () => {
    expect(bad({ name: 'a', region: 'nothing' })).toMatch(/No feature named “nothing”/);
    expect(bad({ name: 'a', region: 'twin' })).toMatch(/2 features are named “twin”/);
  });

  it('refuses a region beyond either end', () => {
    expect(bad({ name: 'a', template: 'lin', region: '250-301' })).toMatch(
      /past the template's ends \(1\.\.300\)/,
    );
    expect(bad({ name: 'a', template: 'lin', region: '0-10' })).toMatch(/past the template's ends/);
  });

  it('refuses a region that wraps a linear template', () => {
    expect(bad({ name: 'a', template: 'lin', region: '200-10' })).toMatch(
      /past the template's ends/,
    );
  });

  it('refuses bases that are not IUPAC, naming them', () => {
    expect(bad({ name: 'a', sequence: 'ACGXZ' })).toMatch(/“X”, “Z”, which are not an IUPAC base/);
    expect(bad({ name: 'a', sequence: '12' })).toMatch(/“1”, “2”/);
    expect(bad({ name: 'a', region: '1-5', left: 'GGQ' })).toMatch(
      /left tail has “Q”, which is not/,
    );
    expect(bad({ name: 'a', region: '1-5', change: 'GC1' })).toMatch(/change/);
  });

  it('refuses an empty sequence, and a region together with a sequence', () => {
    expect(bad({ name: 'a', sequence: '  ' })).toBe('The sequence is empty.');
    expect(bad({ name: 'a', region: '1-5', sequence: 'ACGT' })).toMatch(
      /region or a sequence, not both/,
    );
  });

  it.each([
    [{ tm: 'hot' }, /Tm/],
    [{ tm: '-5' }, /Tm/],
    [{ size: '1.5' }, /Size/],
    [{ size: '0' }, /Size/],
    [{ include_start: 'maybe' }, /yes or no/],
  ])('refuses the option %j', (extra, message) => {
    expect(bad({ name: 'a', region: '1-5', ...extra })).toMatch(message);
  });
});

describe('validateBatch', () => {
  it('runs the good rows and lists the bad ones, in order', () => {
    const table = parseBatchText(
      'name,region,template\na,1-50,pTest\nb,1-9999,pTest\nc,60-90,lin\nd,x,pTest\n',
    );
    const v = validateBatch(table, CONTEXT);
    expect(v.results.map((r) => r.ok)).toEqual([true, false, true, false]);
    expect(v.rows.map((r) => r.name)).toEqual(['a', 'c']);
    expect(v.results[1]).toMatchObject({ ok: false, line: 3, name: 'b' });
    expect(v.overLimit).toBe(0);
  });

  it('refuses the later of two rows with one name, without regard to case', () => {
    const v = validateBatch(
      parseBatchText('name,region\nGene,1-5\nother,6-9\ngene,10-20\n'),
      CONTEXT,
    );
    expect(v.results[2]).toEqual({
      ok: false,
      line: 4,
      name: 'gene',
      message: 'The name “gene” is already used on line 2.',
    });
    expect(v.rows.map((r) => r.name)).toEqual(['Gene', 'other']);
  });

  it('does not let a bad row take its name from a good one', () => {
    const v = validateBatch(parseBatchText('name,region\ndup,9999999\ndup,1-5\n'), CONTEXT);
    expect(v.results.map((r) => r.ok)).toEqual([false, true]);
  });

  it(`takes ${BATCH_ROW_LIMIT} rows and counts the rest`, () => {
    const rows = Array.from({ length: BATCH_ROW_LIMIT + 4 }, (_, i) =>
      row({ name: `r${i}`, region: '1-5' }, i + 2),
    );
    const v = validateBatch(rows, CONTEXT);
    expect(v.results).toHaveLength(BATCH_ROW_LIMIT);
    expect(v.rows).toHaveLength(BATCH_ROW_LIMIT);
    expect(v.overLimit).toBe(4);
    expect(validateBatch(rows.slice(0, BATCH_ROW_LIMIT), CONTEXT).overLimit).toBe(0);
  });
});

describe('scanRows', () => {
  const doc = plasmid();
  const feature = (name: string) => {
    const f = doc.features.all().find((x) => x.name === name);
    if (f === undefined) throw new Error(name);
    return f;
  };

  /** What each valid scan row does to the plasmid: the new protein of its feature. */
  function mutate(cds: string, to = 'A'): string[] {
    const f = feature(cds);
    const { rows } = scanRows(doc, f, { template: 'pTest', to });
    return rows.map((r) => {
      const v = validateRow(r, CONTEXT);
      if (!v.ok || v.row.source.kind !== 'region') throw new Error('scan row did not validate');
      const edited = doc.sequence.toString();
      const { start, end } = v.row.source.range;
      const next = SeqDocument.create({
        name: 'm',
        sequence: edited.slice(0, start) + (v.row.overrides.change ?? '') + edited.slice(end),
        topology: 'circular',
        features: doc.features.all(),
      });
      return translateCds(next, f).protein;
    });
  }

  it('makes a row for every codon that is not already alanine, naming the residue', () => {
    const f = feature('geneF');
    const protein = translateCds(doc, f).protein;
    const { rows, skipped } = scanRows(doc, f, { template: 'pTest' });
    const alanines = (protein.match(/A/g) ?? []).length;
    expect(rows).toHaveLength(protein.length - 1 - alanines);
    expect(skipped.filter((s) => s.reason === 'a stop codon')).toHaveLength(1);
    expect(skipped.filter((s) => s.reason === 'already A')).toHaveLength(alanines);
    expect(rows[0]?.cells).toMatchObject({ name: 'geneF_M1A', template: 'pTest' });
    expect(rows.map((r) => r.cells.name)).toEqual([...new Set(rows.map((r) => r.cells.name))]);
  });

  it.each(['geneF', 'geneR'])(
    'changes exactly one residue to Ala in %s, whatever the strand',
    (cds) => {
      const f = feature(cds);
      const wild = translateCds(doc, f).protein;
      const { rows } = scanRows(doc, f, { template: 'pTest' });
      const mutants = mutate(cds);
      expect(mutants).toHaveLength(rows.length);
      mutants.forEach((protein, i) => {
        const residue = Number(/_[A-Z*](\d+)A$/.exec(rows[i]?.cells.name ?? '')?.[1]);
        expect(protein).toBe(`${wild.slice(0, residue - 1)}A${wild.slice(residue)}`);
      });
    },
  );

  it('puts the region on the forward strand and the change in the strand it is written on', () => {
    const { rows } = scanRows(doc, feature('geneR'), { template: 'pTest' });
    // the reverse gene's first codon, ATG read on the bottom strand, is the CAT ending its feature
    expect(doc.sequence.slice(REV_AT + ORF.length - 3, REV_AT + ORF.length)).toBe('CAT');
    const first = validateRow(rows[0] ?? row({}), CONTEXT);
    expect(first).toMatchObject({
      ok: true,
      row: { source: { range: { start: REV_AT + ORF.length - 3, end: REV_AT + ORF.length } } },
    });
    // M to A, nearest: GCG, written as its reverse complement
    expect(rows[0]?.cells.change).toBe(reverseComplement('GCG'));
  });

  it('picks the codon nearest the one there', () => {
    const { rows } = scanRows(doc, feature('geneF'), { template: 'pTest', to: 'A' });
    // AAA (K) becomes GCA, two bases away, not GCC or GCT, three
    const lys = rows.find((r) => r.cells.name?.includes('_K'));
    expect(lys?.cells.change).toBe('GCA');
    expect(rows.filter((r) => r.cells.name?.includes('_K'))).toHaveLength(2);
  });

  it('scans to another residue, a window of the protein, under another prefix', () => {
    const { rows } = scanRows(doc, feature('geneF'), {
      template: 'pTest',
      to: 'g',
      from: 2,
      through: 5,
      prefix: 'my gene',
    });
    expect(rows.map((r) => r.cells.name?.replace(/\d+/, '#'))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^my_gene_[A-Z]#G$/)]),
    );
    expect(rows.every((r) => /^GG.$/.test(r.cells.change ?? ''))).toBe(true);
    expect(rows.length).toBeLessThanOrEqual(4);
  });

  it('makes a codon that crosses the origin a join the row validates', () => {
    // ATG at the last two bases and the first, then AAA, TAA
    const wrap = SeqDocument.create({
      name: 'w',
      sequence: `GAAATAA${random(100, 'ACGT', 5)}AT`,
      topology: 'circular',
    });
    const cds = createFeature({
      id: 'w',
      type: 'CDS',
      name: 'wrapper',
      segments: [rangeSegment(wrap.length - 2, wrap.length + 7)],
    });
    expect(translateCds(wrap, cds).protein).toBe('MK*');
    const { rows } = scanRows(wrap, cds, { template: 'w', to: 'G' });
    expect(rows.map((r) => r.cells.region)).toEqual([
      `join(${wrap.length - 1}..${wrap.length},1)`,
      '2..4',
    ]);
    const v = validateRow(rows[0] ?? row({}), { templates: [{ name: 'w', document: wrap }] });
    expect(v).toMatchObject({
      ok: true,
      row: { source: { range: { start: wrap.length - 2, end: wrap.length + 1 } } },
    });
  });

  it('refuses a feature that does not code, and a residue the code lacks', () => {
    expect(() => scanRows(doc, feature('pLac'), { template: 'pTest' })).toThrow(
      /not a coding feature/,
    );
    expect(() => scanRows(doc, feature('geneF'), { template: 'pTest', to: 'J' })).toThrow(
      /no codon/,
    );
  });

  it('round-trips through the validator: every scan row is a good row', () => {
    for (const cds of ['geneF', 'geneR']) {
      const { rows } = scanRows(doc, feature(cds), { template: 'pTest' });
      expect(validateBatch(rows, CONTEXT).results.every((r) => r.ok)).toBe(true);
    }
  });
});
