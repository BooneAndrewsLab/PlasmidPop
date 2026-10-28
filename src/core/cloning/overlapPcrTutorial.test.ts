import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type SeqDocument,
  type SoeDesign,
  BUNDLED_ENZYME_SET,
  findOrfs,
  designOverlapExtension,
  recordOverlapExtension,
  reverseComplement,
  setActiveEnzymeSet,
  translate,
} from '@/core';
import { parseGenBank } from '@/io/genbank/parseGenBank';
import { writeGenBank } from '@/io/genbank/writeGenBank';

import { insertChoices } from '../../app/components/insertChoices';

/**
 * Verifies docs/tutorials/overlap-pcr.md: the files it hands out and every
 * number it prints, through the function the Overlap PCR panel calls.
 */

const DIR = join(__dirname, '../../../docs/tutorials/files');
function tut(name: string): SeqDocument {
  const doc = parseGenBank(readFileSync(join(DIR, `${name}.gb`), 'utf8')).documents[0];
  if (doc === undefined) throw new Error(name);
  return doc;
}
const seq = (doc: SeqDocument): string => doc.sequence.toString().toUpperCase();
const names = (doc: SeqDocument): string[] => [...doc.features].map((f) => f.name);
/** The fragment the panel offers first for a tab: its feature. */
function fragment(doc: SeqDocument) {
  const choice = insertChoices({ doc, selection: null })[0];
  if (choice === undefined) throw new Error(doc.name);
  return { doc, range: choice.range };
}
function productText(d: SoeDesign): string {
  if (d.product === null) throw new Error('no product');
  return seq(d.product);
}
function design(tag: string, overlapTm = 60): SoeDesign {
  return designOverlapExtension(
    ['OE-Promoter', 'OE-Gene', tag].map((n) => fragment(tut(n))),
    { overlapTm, primerPrefix: 'Promoter-Gene-Tag ', name: 'Promoter-Gene-Tag' },
  );
}

beforeAll(() => {
  setActiveEnzymeSet(BUNDLED_ENZYME_SET);
});

const FILES = ['OE-Promoter', 'OE-Gene', 'OE-Tag', 'OE-bad-Tag'];

describe('overlap-pcr.md: the files', () => {
  it.each(FILES)('%s parses, round-trips and says it is synthetic', (f) => {
    const doc = tut(f);
    expect(doc.metadata.description).toMatch(/synthetic/i);
    expect(doc.topology).toBe('linear');
    const again = parseGenBank(writeGenBank(doc)).documents[0];
    expect(again?.sequence.toString()).toBe(doc.sequence.toString());
    expect(names(again ?? doc)).toEqual(names(doc));
  });

  it('are the sizes and fragments the page gives', () => {
    expect(FILES.map((f) => tut(f).length)).toEqual([260, 660, 169, 170]);
    expect(
      FILES.map((f) => insertChoices({ doc: tut(f), selection: null }).map((c) => c.label)),
    ).toEqual([
      ['synthetic promoter (promoter), 41–200, 160 bp', 'All of it (1–260, 260 bp)'],
      ['synthGene (CDS), 51–590, 540 bp', 'All of it (1–660, 660 bp)'],
      ['synthTag (CDS), 41–109, 69 bp', 'All of it (1–169, 169 bp)'],
      ['synthTag (CDS), 41–110, 70 bp', 'All of it (1–170, 170 bp)'],
    ]);
  });

  it('share no stretch of 15 bases with each other, so only the tails can join them', () => {
    const [a, b, c] = ['OE-Promoter', 'OE-Gene', 'OE-Tag'].map((f) => seq(tut(f)));
    for (const [x, y] of [
      [a, b],
      [b, c],
      [a, c],
    ] as const) {
      for (let i = 0; i + 15 <= (x?.length ?? 0); i++) {
        const k = x?.slice(i, i + 15) ?? '';
        expect((y?.includes(k) ?? false) || (y?.includes(reverseComplement(k)) ?? false)).toBe(
          false,
        );
      }
    }
  });

  it('the gene is 180 codons with no stop; the tag is 23 codons ending in one', () => {
    const gene = seq(tut('OE-Gene')).slice(50, 590);
    expect(translate(gene)).toHaveLength(180);
    expect(translate(gene).startsWith('M')).toBe(true);
    expect(translate(gene)).not.toContain('*');
    const tag = seq(tut('OE-Tag')).slice(40, 109);
    expect(translate(tag)).toBe(translate(tag).slice(0, 22) + '*');
    expect(translate(tag)).toHaveLength(23);
  });

  it('the bad tag is the tag with one extra base in front of its ATG, read from the second', () => {
    const good = seq(tut('OE-Tag'));
    const bad = seq(tut('OE-bad-Tag'));
    expect(bad).toBe(good.slice(0, 40) + 'G' + good.slice(40));
    const cds = [...tut('OE-bad-Tag').features][0];
    expect(cds?.qualifiers.find((q) => q.name === 'codon_start')?.value).toBe('2');
  });
});

describe('overlap-pcr.md: the design', () => {
  const d = design('OE-Tag');

  it('designs without a problem or a warning', () => {
    expect(d.problem).toBeNull();
    expect(d.warnings).toEqual([]);
  });

  it('lists the six primers with the lengths, tails, annealing parts and Tm the page gives', () => {
    expect(
      d.primers.map((p) => [p.name, p.sequence.length, p.tail.length, p.annealLength, p.role]),
    ).toEqual([
      ['Promoter-Gene-Tag F1', 24, 0, 24, 'outer'],
      ['Promoter-Gene-Tag R1', 49, 19, 30, 'inner'],
      ['Promoter-Gene-Tag F2', 46, 19, 27, 'inner'],
      ['Promoter-Gene-Tag R2', 37, 10, 27, 'inner'],
      ['Promoter-Gene-Tag F3', 28, 10, 18, 'inner'],
      ['Promoter-Gene-Tag R3', 21, 0, 21, 'outer'],
    ]);
    expect(d.primers.map((p) => Number(p.tm.toFixed(0)))).toEqual([60, 57, 61, 60, 67, 61]);
  });

  it('prints the primers as the page shows them: the tail in upper case, then the annealing part', () => {
    expect(d.primers.map((p) => p.sequence)).toEqual([
      'ctaccaaagccacggctagaaagg',
      'CCTCCAAATGATCTATCATaggcttctaagataagtcaggttagttagt',
      'TGACTTATCTTAGAAGCCTatgatagatcatttggagggctgtggc',
      'CGCTGCCCATgctgcaaaaggacgatggaaacttaga',
      'CTTTTGCAGCatgggcagcggcagcggc',
      'ttaagacctcgtcctcgcccg',
    ]);
  });

  it('the inner primers of a junction are complementary over the whole overlap', () => {
    const [, r1, f2, r2, f3] = d.primers.map((p) => p.tail);
    // Junction 1: R1's tail is the reverse complement of the gene's first 19 bases, F2's tail the promoter's last 19.
    expect(d.junctions[0]?.overlap).toBe('TGACTTATCTTAGAAGCCTATGATAGATCATTTGGAGG');
    expect(`${f2}${reverseComplement(r1 ?? '')}`).toBe(d.junctions[0]?.overlap);
    expect(d.junctions[1]?.overlap).toBe('CTTTTGCAGCATGGGCAGCG');
    expect(`${f3}${reverseComplement(r2 ?? '')}`).toBe(d.junctions[1]?.overlap);
  });

  it('reports the 38 bp and 20 bp overlaps, both at Tm 61 °C', () => {
    expect(d.junctions.map((j) => [j.length, Number(j.tm.toFixed(0))])).toEqual([
      [38, 61],
      [20, 61],
    ]);
  });

  it('first round 179, 569 and 79 bp; fused 769 bp: the three fragments less the 58 bp shared', () => {
    expect(d.firstRound.map((x) => x.length)).toEqual([179, 569, 79]);
    expect(d.fused?.length).toBe(769);
    expect(179 + 569 + 79 - (38 + 20)).toBe(769);
    expect(160 + 540 + 69).toBe(769);
  });

  it('the product is the fragments end to end, linear, 769 bp', () => {
    const p = d.product;
    if (p === null) throw new Error('no product');
    expect(p.length).toBe(769);
    expect(p.topology).toBe('linear');
    expect(seq(p)).toBe(
      seq(tut('OE-Promoter')).slice(40, 200) +
        seq(tut('OE-Gene')).slice(50, 590) +
        seq(tut('OE-Tag')).slice(40, 109),
    );
  });

  it('Open product: named as typed, with the three features', () => {
    const opened = recordOverlapExtension(
      d,
      ['OE-Promoter', 'OE-Gene', 'OE-Tag'].map((n) => fragment(tut(n))),
    );
    if (opened === null) throw new Error('not recorded');
    expect(opened.name).toBe('Promoter-Gene-Tag');
    expect(opened.length).toBe(769);
    const named = [...opened.features].filter((f) => f.type !== 'primer_bind');
    expect(named.map((f) => f.name)).toEqual(['synthetic promoter', 'synthGene', 'synthTag']);
    // The part of a gene inside an overlap belongs to the first-round product before it.
    expect(
      named.map((f) => [f.segments[0]?.kind === 'range' ? f.segments[0].start + 1 : 0]),
    ).toEqual([[1], [180], [711]]);
  });

  it('reads as one frame: ATG at base 161, 202 residues and a stop, the only ORF', () => {
    const text = productText(d);
    expect(text.slice(160, 163)).toBe('ATG');
    const protein = translate(text.slice(160));
    expect(protein).toHaveLength(203);
    expect(protein.indexOf('*')).toBe(202);
    expect(protein.startsWith('MIDHLEG')).toBe(true);
    expect(protein.endsWith('MGSGSGSHHHHHHGSARARTRS*')).toBe(true);
    expect(
      findOrfs(text, 'linear', { minCodons: 75 }).map((o) => [o.range.start, o.range.end]),
    ).toEqual([[160, 769]]);
  });

  it('each overlap appears once in the product', () => {
    const text = productText(d);
    for (const j of d.junctions) {
      expect(text.split(j.overlap)).toHaveLength(2);
      expect(text.split(reverseComplement(j.overlap)).length).toBe(1);
    }
  });
});

describe('overlap-pcr.md: the overlap Tm', () => {
  it('at 65 °C the overlaps are 40 bp (the longest allowed, Tm 62) and 23 bp (Tm 65)', () => {
    const d = design('OE-Tag', 65);
    expect(d.problem).toBeNull();
    expect(d.junctions.map((j) => [j.length, Number(j.tm.toFixed(0))])).toEqual([
      [40, 62],
      [23, 65],
    ]);
    expect(d.firstRound.map((x) => x.length)).toEqual([180, 571, 81]);
    expect(d.fused?.length).toBe(769);
    expect(d.warnings).toEqual([]);
  });

  it('at 52 °C they are 28 bp (Tm 52) and 18 bp (Tm 57, the shortest allowed)', () => {
    const d = design('OE-Tag', 52);
    expect(d.junctions.map((j) => [j.length, Number(j.tm.toFixed(0))])).toEqual([
      [28, 52],
      [18, 57],
    ]);
    expect(d.firstRound.map((x) => x.length)).toEqual([174, 563, 78]);
    expect(d.fused?.length).toBe(769);
    expect(d.warnings).toEqual([]);
  });
});

describe('overlap-pcr.md: the tag that is a base off', () => {
  const d = design('OE-bad-Tag');

  it('still fuses, 770 bp, and says the tag is out of frame', () => {
    expect(d.problem).toBeNull();
    expect(d.product?.length).toBe(770);
    expect(d.warnings).toEqual([
      'synthGene runs into synthTag at junction 2 out of frame: the fusion shifts the reading frame of synthTag.',
    ]);
  });

  it('the gene’s reading never meets a stop: no ORF of 75 codons or more is listed', () => {
    const text = productText(d);
    expect(translate(text.slice(160)).includes('*')).toBe(false);
    expect(findOrfs(text, 'linear', { minCodons: 75 })).toEqual([]);
  });
});
