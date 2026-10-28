import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type SeqDocument,
  type Range,
  BUNDLED_ENZYME_SET,
  codonChoices,
  codonSiteAt,
  codonUsageTable,
  designMutagenesis,
  digest,
  findCutSites,
  getEnzyme,
  readChangeBases,
  reverseComplement,
  setActiveEnzymeSet,
  translateCds,
} from '@/core';
import { parseGenBank } from '@/io/genbank/parseGenBank';
import { writeGenBank } from '@/io/genbank/writeGenBank';

/**
 * Verifies docs/tutorials/mutagenesis.md: the file it hands out and every
 * number it prints, through the functions the Mutate panel calls
 * (`designMutagenesis`, `codonSiteAt`, `codonChoices`, the digest). The page
 * has no NCBI path, so nothing here reads the gitignored fixtures.
 */

const DIR = join(__dirname, '../../../docs/tutorials/files');
const template: SeqDocument = (() => {
  const doc = parseGenBank(readFileSync(join(DIR, 'SDM-Template.gb'), 'utf8')).documents[0];
  if (doc === undefined) throw new Error('SDM-Template has no record');
  return doc;
})();
const seq = (doc: SeqDocument): string => doc.sequence.toString().toUpperCase();
const T = seq(template);
const feature = (doc: SeqDocument, name: string) => {
  const f = [...doc.features].find((x) => x.name === name);
  if (f === undefined) throw new Error(`${doc.name} has no ${name}`);
  return f;
};
/** One-based inclusive start and end of a feature's first segment. */
const span = (doc: SeqDocument, name: string): [number, number] => {
  const s = feature(doc, name).segments[0];
  if (s?.kind !== 'range') throw new Error(name);
  return [s.start + 1, s.end];
};
const protein = (doc: SeqDocument): string => translateCds(doc, feature(doc, 'synthORF')).protein;
/** One-based positions where two equal-length sequences differ. */
function differences(a: string, b: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) out.push(i + 1);
  return out;
}
function fragments(doc: SeqDocument, enzymes: string[]): number[] {
  const es = enzymes.map((n) => {
    const e = getEnzyme(n);
    if (e === undefined) throw new Error(n);
    return e;
  });
  return digest(doc, findCutSites(seq(doc), doc.topology, es))
    .map((f) => f.sequence.length)
    .sort((a, b) => b - a);
}
const sitesOf = (doc: SeqDocument, motif: string): number => seq(doc).split(motif).length - 1;
/** The range of residue `n` (1-based) of synthORF, as clicking it selects. */
function residue(n: number): Range {
  const site = codonSiteAt(template, 138 + (n - 1) * 3);
  if (site === null) throw new Error(`no codon ${n}`);
  return site.span;
}

beforeAll(() => {
  setActiveEnzymeSet(BUNDLED_ENZYME_SET);
});

describe('mutagenesis.md: the file', () => {
  it('parses, round-trips and says it is synthetic', () => {
    expect(template.metadata.description).toMatch(/synthetic/i);
    expect(template.isCircular).toBe(true);
    const again = parseGenBank(writeGenBank(template)).documents[0];
    expect(again?.sequence.toString()).toBe(template.sequence.toString());
    expect([...(again ?? template).features].map((f) => f.name)).toEqual(
      [...template.features].map((f) => f.name),
    );
  });

  it('is 1,241 bp with the features and the ORF the page lists', () => {
    expect(template.length).toBe(1241);
    expect([...template.features].map((f) => f.name)).toEqual([
      'synthetic promoter',
      'synthORF',
      'synthetic terminator',
      'AT-rich spacer',
      'AmpR',
      'ori',
    ]);
    expect(span(template, 'synthORF')).toEqual([139, 441]);
    expect(span(template, 'AT-rich spacer')).toEqual([552, 641]);
    expect(feature(template, 'AmpR').segments[0]).toMatchObject({ start: 641, end: 941 });
    const p = protein(template);
    // 100 residues, then the stop the translation shows as *.
    expect(p).toHaveLength(101);
    expect(p.startsWith('M')).toBe(true);
    expect(p.endsWith('*')).toBe(true);
    expect(p.slice(0, -1)).not.toContain('*');
    expect(p[13]).toBe('K');
    expect(p[39]).toBe('D');
    expect(p[40]).toBe('I');
    expect(T.slice(138 + 13 * 3, 138 + 14 * 3)).toBe('AAG');
    expect(T.slice(441 - 3, 441)).toBe('TAA');
    // The spacer has no G and no C: that is what the wrong case is about.
    expect(T.slice(551, 641)).toMatch(/^[AT]{90}$/);
  });

  it('has one BamHI site and no EcoRV site', () => {
    expect(sitesOf(template, 'GGATCC')).toBe(1);
    expect(T.indexOf('GGATCC') + 1).toBe(534);
    expect(sitesOf(template, 'GATATC')).toBe(0);
    expect(T.slice(255, 261)).toBe('GATATT');
  });
});

describe('mutagenesis.md, part 1: a point mutation, K14R', () => {
  const site = codonSiteAt(template, 138 + 13 * 3 + 1);
  if (site === null) throw new Error('no codon');

  it('names the codon the cursor is in and offers the codons for R', () => {
    expect(site).toMatchObject({ codon: 'AAG', aminoAcid: 'K', residue: 14 });
    expect(site.span).toEqual({ start: 177, end: 180 });
    const choices = codonChoices('R', codonUsageTable('ecoli'), site.codon, site.table);
    expect(choices.map((c) => c.codon)).toEqual(['CGC', 'CGT', 'CGG', 'CGA', 'AGA', 'AGG']);
    expect(choices.map((c) => Math.round(c.fraction * 100))).toEqual([40, 38, 10, 6, 4, 2]);
    expect(choices.map((c) => c.changes)).toEqual([3, 3, 2, 3, 2, 1]);
  });

  const back = designMutagenesis(template, site.span, 'AGG', 'back-to-back');
  const over = designMutagenesis(template, site.span, 'AGG', 'overlapping');

  it('back to back: the label, the protein change and the two primers', () => {
    expect(back.label).toBe('AAG178–180AGG');
    expect(back.proteinChanges).toEqual(['synthORF K14R']);
    expect(back.problem).toBeNull();
    expect(back.forward.sequence).toBe('AGGaacagcctacgcctggcc');
    expect(back.forward.sequence).toHaveLength(21);
    expect(back.forward.annealLength).toBe(18);
    expect(back.forward.tm.toFixed(0)).toBe('60');
    expect(back.forward.q5Tm?.toFixed(0)).toBe('71');
    expect(back.reverse.sequence).toBe('cggatttctagatatgttccacagacgcc');
    expect(back.reverse.sequence).toHaveLength(29);
    expect(back.reverse.annealLength).toBe(29);
    expect(back.reverse.tm.toFixed(0)).toBe('61');
    expect(back.reverse.q5Tm?.toFixed(0)).toBe('70');
    expect(back.annealAt).toBe(71.3);
  });

  it('back to back: the primers point away from each other and share no bases', () => {
    const fwd = back.forward.sequence.toUpperCase();
    const rev = reverseComplement(back.reverse.sequence.toUpperCase());
    // Forward starts at the changed codon (178) and runs on; the reverse's
    // reverse complement ends at base 177, the one before it.
    expect(T.slice(180, 180 + 18)).toBe(fwd.slice(3));
    expect(T.slice(177 - rev.length, 177)).toBe(rev);
    expect(T.slice(177, 180)).toBe('AAG');
  });

  it('overlapping: two complementary 34 nt primers, the change in the middle, Tm 79', () => {
    expect(over.forward.sequence).toBe('catatctagaaatccgAGGaacagcctacgcctg');
    expect(over.forward.sequence).toHaveLength(34);
    expect(over.reverse.sequence).toBe('caggcgtaggctgttCCTcggatttctagatatg');
    expect(over.reverse.sequence).toHaveLength(34);
    expect(reverseComplement(over.forward.sequence.toUpperCase())).toBe(
      over.reverse.sequence.toUpperCase(),
    );
    expect(over.forward.tm.toFixed(0)).toBe('79');
    expect(over.reverse.tm.toFixed(0)).toBe('79');
    expect(over.forward.q5Tm).toBeNull();
    expect(over.annealAt).toBeNull();
    expect(over.problem).toBeNull();
    expect(over.label).toBe(back.label);
  });

  it('the product is 1,241 bp, circular, one base different, K14R and nothing else', () => {
    for (const d of [back, over]) {
      expect(d.mutant.length).toBe(1241);
      expect(d.mutant.isCircular).toBe(true);
      expect(differences(T, seq(d.mutant))).toEqual([179]);
      expect(T[178]).toBe('A');
      expect(seq(d.mutant)[178]).toBe('G');
      const was = protein(template);
      const now = protein(d.mutant);
      expect(differences(was, now)).toEqual([14]);
      expect(now[13]).toBe('R');
      expect(span(d.mutant, 'synthORF')).toEqual([139, 441]);
      expect([...d.mutant.features].map((f) => f.name)).toEqual(
        [...template.features].map((f) => f.name),
      );
    }
  });

  it('the starred codon would change three bases', () => {
    const cgc = designMutagenesis(template, site.span, 'CGC', 'back-to-back');
    expect(cgc.proteinChanges).toEqual(['synthORF K14R']);
    expect(differences(T, seq(cgc.mutant))).toHaveLength(3);
  });
});

describe('mutagenesis.md, part 2: an insertion and a deletion', () => {
  const HIS6 = 'CACCACCACCACCACCAC';
  const ins = designMutagenesis(template, { start: 438, end: 438 }, HIS6, 'back-to-back');
  const del = designMutagenesis(template, residue(60), '', 'back-to-back');

  it('the cursor after residue 100 is after base 438', () => {
    expect(residue(100)).toEqual({ start: 435, end: 438 });
    expect(codonSiteAt(template, 435)?.aminoAcid).toBe('V');
    expect(T.slice(438, 441)).toBe('TAA');
    expect(readChangeBases(HIS6).bases).toBe(HIS6);
  });

  it('insertion: label, protein change, primers', () => {
    expect(ins.label).toBe('+CACCACCACCACCACCAC after 438');
    expect(ins.proteinChanges).toEqual(['synthORF 101 (none) → HHHHHH']);
    expect(ins.problem).toBeNull();
    expect(ins.forward.sequence).toBe('CACCACCACCACCACCACtaaggatgcggtcccctggt');
    expect(ins.forward.sequence).toHaveLength(38);
    expect(ins.forward.annealLength).toBe(20);
    expect(ins.forward.tm.toFixed(0)).toBe('60');
    expect(ins.forward.q5Tm?.toFixed(0)).toBe('71');
    expect(ins.reverse.sequence).toBe('tacttccaccagaagacggtaactgc');
    expect(ins.reverse.sequence).toHaveLength(26);
    expect(ins.reverse.tm.toFixed(0)).toBe('61');
    expect(ins.reverse.q5Tm?.toFixed(0)).toBe('70');
    expect(ins.annealAt).toBe(71.1);
  });

  it('insertion: 1,259 bp, the 18 bases and no others, the ORF grows to 139-459', () => {
    const m = ins.mutant;
    expect(m.length).toBe(1259);
    expect(m.isCircular).toBe(true);
    expect(seq(m).slice(438, 456)).toBe(HIS6);
    expect(seq(m).slice(0, 438)).toBe(T.slice(0, 438));
    expect(seq(m).slice(456)).toBe(T.slice(438));
    expect(span(m, 'synthORF')).toEqual([139, 459]);
    expect(span(m, 'synthetic terminator')).toEqual([460, 539]);
    const p = protein(m);
    expect(p).toBe(`${protein(template).slice(0, -1)}HHHHHH*`);
    expect(p).toHaveLength(107);
  });

  it('deletion: label, protein change, primers', () => {
    expect(del.label).toBe('Δ316–318');
    expect(del.proteinChanges).toEqual(['synthORF 60 E → (none)']);
    expect(del.problem).toBeNull();
    expect(del.forward.sequence).toBe('atgtttatgtctctctgtggtaagtggcc');
    expect(del.forward.sequence).toHaveLength(29);
    expect(del.forward.tm.toFixed(0)).toBe('61');
    expect(del.forward.q5Tm?.toFixed(0)).toBe('70');
    expect(del.reverse.sequence).toBe('acaactcatgaaaagctgggtagctttt');
    expect(del.reverse.sequence).toHaveLength(28);
    expect(del.reverse.tm.toFixed(0)).toBe('60');
    expect(del.reverse.q5Tm?.toFixed(0)).toBe('68');
    expect(del.annealAt).toBe(69.5);
  });

  it('deletion: 1,238 bp, three bases gone, the ORF is 139-438, residue 60 is lost', () => {
    const m = del.mutant;
    expect(residue(60)).toEqual({ start: 315, end: 318 });
    expect(T.slice(315, 318)).toBe('GAA');
    expect(m.length).toBe(1238);
    expect(m.isCircular).toBe(true);
    expect(seq(m)).toBe(T.slice(0, 315) + T.slice(318));
    expect(span(m, 'synthORF')).toEqual([139, 438]);
    const was = protein(template);
    expect(was[59]).toBe('E');
    expect(protein(m)).toBe(was.slice(0, 59) + was.slice(60));
    expect(protein(m)).toHaveLength(100);
  });
});

describe('mutagenesis.md, part 3: a silent change that makes an EcoRV site', () => {
  const site = codonSiteAt(template, 258);
  if (site === null) throw new Error('no codon');
  const back = designMutagenesis(template, site.span, 'ATC', 'back-to-back');
  const mutant = back.mutant;

  it('residue 41 is ATT (I) and ATC is one base away', () => {
    expect(site).toMatchObject({ codon: 'ATT', aminoAcid: 'I', residue: 41 });
    expect(site.span).toEqual({ start: 258, end: 261 });
    const choices = codonChoices('I', codonUsageTable('ecoli'), site.codon, site.table);
    expect(choices.find((c) => c.codon === 'ATC')?.changes).toBe(1);
  });

  it('label, protein change and primers', () => {
    expect(back.label).toBe('ATT259–261ATC');
    expect(back.proteinChanges).toEqual(['synthORF no change (silent)']);
    expect(back.problem).toBeNull();
    expect(back.forward.sequence).toBe('ATCcagtggctttcttacgtttatttacgaaaagc');
    expect(back.forward.sequence).toHaveLength(35);
    expect(back.forward.tm.toFixed(0)).toBe('60');
    expect(back.forward.q5Tm?.toFixed(0)).toBe('68');
    expect(back.reverse.sequence).toBe('atcacaggggaccatccggt');
    expect(back.reverse.sequence).toHaveLength(20);
    expect(back.reverse.tm.toFixed(0)).toBe('60');
    expect(back.reverse.q5Tm?.toFixed(0)).toBe('71');
    expect(back.annealAt).toBe(68.6);
  });

  it('the mutant differs by one base, the protein not at all, and gains one EcoRV site', () => {
    expect(mutant.length).toBe(1241);
    expect(differences(T, seq(mutant))).toEqual([261]);
    expect(protein(mutant)).toBe(protein(template));
    expect(sitesOf(template, 'GATATC')).toBe(0);
    expect(sitesOf(mutant, 'GATATC')).toBe(1);
    expect(seq(mutant).indexOf('GATATC') + 1).toBe(256);
  });

  it('the check digest: BamHI alone is one band, with EcoRV it is 965 and 276', () => {
    expect(fragments(template, ['BamHI'])).toEqual([1241]);
    expect(fragments(template, ['BamHI', 'EcoRV'])).toEqual([1241]);
    expect(fragments(mutant, ['BamHI'])).toEqual([1241]);
    expect(fragments(mutant, ['EcoRV'])).toEqual([1241]);
    expect(fragments(mutant, ['BamHI', 'EcoRV'])).toEqual([965, 276]);
  });

  it('the overlapping design for it also needs no more than one base', () => {
    const over = designMutagenesis(template, site.span, 'ATC', 'overlapping');
    expect(differences(T, seq(over.mutant))).toEqual([261]);
    expect(over.forward.sequence).toBe('gatggtcccctgtgatATCcagtggctttcttac');
  });
});

describe('mutagenesis.md, the wrong case: a change in the AT-rich spacer', () => {
  const at = { start: 590, end: 591 };

  it('back to back says the template is too AT-rich for 60 °C', () => {
    expect(T[590]).toBe('A');
    const d = designMutagenesis(template, at, 'G', 'back-to-back');
    expect(d.label).toBe('A591G');
    expect(d.proteinChanges).toEqual([]);
    expect(d.problem).toBe(
      'The template next to the change is too AT-rich to reach 60 °C within 60 bases.',
    );
    expect(d.forward.sequence).toHaveLength(61);
    expect(d.forward.annealLength).toBe(60);
    expect(d.forward.tm.toFixed(0)).toBe('55');
    expect(d.forward.q5Tm?.toFixed(0)).toBe('60');
    expect(d.reverse.sequence).toHaveLength(60);
    expect(d.reverse.tm.toFixed(0)).toBe('57');
    expect(d.reverse.q5Tm?.toFixed(0)).toBe('63');
    expect(d.annealAt).toBe(61.4);
  });

  it('overlapping says its primers reach only 69 °C', () => {
    const d = designMutagenesis(template, at, 'G', 'overlapping');
    expect(d.problem).toBe(
      'The primers reach only 69 °C at 60 bases, short of the 78 °C QuikChange asks for.',
    );
    expect(d.forward.sequence).toHaveLength(60);
    expect(d.forward.tm.toFixed(0)).toBe('69');
  });

  it('the same two designs at the ORF have no problem', () => {
    expect(designMutagenesis(template, residue(14), 'AGG', 'back-to-back').problem).toBeNull();
    expect(designMutagenesis(template, residue(14), 'AGG', 'overlapping').problem).toBeNull();
  });
});

describe('mutagenesis.md: the page prints what the panel designs', () => {
  // Whitespace folded: a line break in the Markdown is a space on the page.
  const page = readFileSync(join(DIR, '../mutagenesis.md'), 'utf8').replace(/\s+/g, ' ');
  const AT = { start: 590, end: 591 };
  const designs = [
    designMutagenesis(template, residue(14), 'AGG', 'back-to-back'),
    designMutagenesis(template, residue(14), 'AGG', 'overlapping'),
    designMutagenesis(template, { start: 438, end: 438 }, 'CACCACCACCACCACCAC', 'back-to-back'),
    designMutagenesis(template, residue(60), '', 'back-to-back'),
    designMutagenesis(template, residue(41), 'ATC', 'back-to-back'),
  ];

  it('every primer and every label of the exercises is on the page', () => {
    for (const d of designs) {
      expect(page, d.forward.sequence).toContain(d.forward.sequence);
      expect(page, d.reverse.sequence).toContain(d.reverse.sequence);
      expect(page, d.label).toContain(d.label);
      if (d.annealAt !== null) expect(page).toContain(`${d.annealAt} °C`);
      for (const c of d.proteinChanges) expect(page).toContain(c.replace('synthORF ', ''));
    }
  });

  it('the wrong case messages are on the page word for word', () => {
    for (const method of ['back-to-back', 'overlapping'] as const) {
      const problem = designMutagenesis(template, AT, 'G', method).problem;
      expect(problem).not.toBeNull();
      expect(page).toContain(problem ?? '');
    }
  });
});
