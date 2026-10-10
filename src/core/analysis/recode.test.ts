import { SeqDocument } from '../document';
import { createFeature, rangeSegment } from '../features';
import { reverseComplement } from '../sequence';
import { translate } from './codons';
import { codonUsageTable } from './codonUsage';
import { backTranslate, codonAdaptationIndex, recodeSlots } from './recode';
import { finishRecodeCds, prepareRecodeCds, recodeRefusal } from './recodeCds';
import { translateCds } from './cdsTranslation';

const ecoli = codonUsageTable('ecoli');
const yeast = codonUsageTable('yeast');
const PROTEIN =
  'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQFEVVHSLAKWKRQTLGQHDFSAGEGLYTHMKALRPDEDRLSPLHSVYVDQWDWERVMGDGERQFSTLKSTVEAIWAGIKATEAAVSEEFGLAPFLPDQIHFVHSQELLSRYPDLDAKGRERAIAKDLGAVFLVGIGGKLSDGHRHDVRAPDYDDWSTPSELGHAGLNGDILVWNPVLEDAFELSSMGIRVDADTLKHQLALTGDEDRLELEWHQALLRGEMPQTIGGGIGQSRLTMLLLQLPHIGQVQAAVWPAAVRESVPAL*';

const identical = (codons: readonly string[], protein: string): boolean =>
  translate(codons.join('')) === protein;

describe('backTranslate (#209)', () => {
  it('gives DNA that translates to the protein, stop included', () => {
    const r = backTranslate(PROTEIN, { host: ecoli });
    expect(translate(r.dna)).toBe(PROTEIN);
    expect(r.dna).toHaveLength(PROTEIN.length * 3);
    expect(r.codons.join('')).toBe(r.dna);
  });

  it('works for every host and both strategies', () => {
    for (const id of ['ecoli', 'yeast', 'pichia', 'human', 'mouse', 'cho']) {
      for (const strategy of ['best', 'proportional'] as const) {
        const r = backTranslate(PROTEIN, { host: codonUsageTable(id), strategy });
        expect(translate(r.dna)).toBe(PROTEIN);
      }
    }
  });

  it("takes the host's commonest codons when asked for the best", () => {
    expect(backTranslate('LP', { host: ecoli, gcMin: 0, gcMax: 1 }).dna).toBe('CTGCCG');
    expect(backTranslate('LR', { host: yeast, gcMin: 0, gcMax: 1 }).dna).toBe('TTGAGA');
  });

  it("follows the host's mix, spread along the gene, when proportional", () => {
    const r = backTranslate('L'.repeat(200), { host: ecoli, strategy: 'proportional' });
    const ctg = r.codons.filter((c) => c === 'CTG').length;
    // E. coli reads about half its leucines as CTG.
    expect(ctg).toBeGreaterThan(70);
    expect(ctg).toBeLessThan(130);
    expect(new Set(r.codons).size).toBeGreaterThan(3);
    // Neither is the whole gene's best the best CAI by chance.
    const best = backTranslate('L'.repeat(200), { host: ecoli, gcMin: 0, gcMax: 1, maxRun: 0 });
    expect(best.cai).toBeGreaterThan(r.cai);
  });

  it('reports a CAI between 0 and 1 and 1 for the all-best gene', () => {
    const r = backTranslate('LPLP', { host: ecoli, gcMin: 0, gcMax: 1 });
    expect(r.cai).toBeCloseTo(1, 10);
    const poor = codonAdaptationIndex(['CTA', 'CCC'], ecoli);
    expect(poor).toBeGreaterThan(0);
    expect(poor).toBeLessThan(0.3);
  });

  it('leaves out an enzyme site on either strand', () => {
    // E. coli's first choices for E and F read GAATTT.
    const avoid = [{ name: 'test', site: 'GAATTT' }];
    const without = backTranslate('AEFAEFAEF', { host: ecoli, gcMin: 0, gcMax: 1 });
    expect(without.dna).toContain('GAATTT');
    const r = backTranslate('AEFAEFAEF', { host: ecoli, avoid, gcMin: 0, gcMax: 1 });
    expect(r.dna).not.toContain('GAATTT');
    expect(r.dna).not.toContain('AAATTC');
    expect(translate(r.dna)).toBe('AEFAEFAEF');
    expect(r.unresolved).toEqual([]);
    // A non-palindromic site is looked for on both strands: BsaI GGTCTC.
    const bsa = backTranslate('GLGLGLGL'.repeat(4), {
      host: ecoli,
      avoid: [{ name: 'BsaI', site: 'GGTCTC' }],
    });
    expect(bsa.dna).not.toContain('GGTCTC');
    expect(bsa.dna).not.toContain(reverseComplement('GGTCTC'));
  });

  it('reads IUPAC in a site', () => {
    const r = backTranslate('AEFAEF', {
      host: ecoli,
      avoid: [{ name: 'GAWTTT', site: 'GAWTTT' }],
      gcMin: 0,
      gcMax: 1,
    });
    expect(r.dna).not.toContain('GAATTT');
  });

  it('breaks up runs of one base', () => {
    const r = backTranslate('KKKKKKKK', { host: ecoli, maxRun: 5, gcMin: 0, gcMax: 1 });
    expect(r.dna).not.toMatch(/A{6}|G{6}|C{6}|T{6}/);
    expect(translate(r.dna)).toBe('KKKKKKKK');
  });

  it('keeps GC in every window between the limits when it can', () => {
    // Glycine, alanine, proline, arginine: GC-rich whatever the choice.
    const protein = 'GAPR'.repeat(40);
    const r = backTranslate(protein, { host: ecoli, gcWindow: 60, gcMin: 0.3, gcMax: 0.7 });
    expect(identical(r.codons, protein)).toBe(true);
    for (let s = 0; s + 60 <= r.dna.length; s++) {
      const w = r.dna.slice(s, s + 60);
      const gc = Array.from(w).filter((c) => c === 'G' || c === 'C').length / 60;
      expect(gc).toBeLessThanOrEqual(0.7 + 1e-9);
    }
    expect(r.unresolved).toEqual([]);
  });

  it('says what it could not meet instead of breaking the protein', () => {
    // Methionine and tryptophan have one codon each: ATG TGG repeated has no way out of its GC.
    const r = backTranslate('MW'.repeat(30), { host: ecoli, gcMin: 0.9, gcMax: 1 });
    expect(translate(r.dna)).toBe('MW'.repeat(30));
    expect(r.unresolved.length).toBeGreaterThan(0);
    expect(r.unresolved[0]?.kind).toBe('gc');
  });

  it('keeps a fixed codon', () => {
    const r = recodeSlots(
      [
        { aminoAcid: 'L', fixed: 'TTA' },
        { aminoAcid: 'L', fixed: null },
      ],
      { host: ecoli },
    );
    expect(r.codons[0]).toBe('TTA');
    expect(r.codons[1]).toBe('CTG');
  });

  it('prefers codons the host uses, taking a rare one only as a last resort', () => {
    // Isoleucine ATA is rare in E. coli; the run limit of 2 forces a change but not to ATA.
    const r = backTranslate('IIIIII', {
      host: ecoli,
      maxRun: 0,
      gcMin: 0,
      gcMax: 1,
      avoid: [{ name: 'x', site: 'ATTATT' }],
    });
    expect(r.codons).not.toContain('ATA');
    expect(r.rareCodons).toBe(0);
    const forced = backTranslate('I', {
      host: ecoli,
      maxRun: 0,
      gcMin: 0,
      gcMax: 1,
      avoid: [
        { name: 'a', site: 'ATT' },
        { name: 'b', site: 'ATC' },
      ],
    });
    expect(forced.codons).toEqual(['ATA']);
    expect(forced.rareCodons).toBe(1);
  });

  it('refuses a residue with no codon', () => {
    expect(() => backTranslate('MXK', { host: ecoli })).toThrow(/No codon for X/);
  });

  it('is the same every time', () => {
    const a = backTranslate(PROTEIN, { host: yeast, strategy: 'proportional' });
    const b = backTranslate(PROTEIN, { host: yeast, strategy: 'proportional' });
    expect(a.dna).toBe(b.dna);
  });
});

describe('recoding a CDS in a document (#209)', () => {
  // ATG, then Leu Leu Glu Phe Lys with rare codons, then TAA.
  const cds = 'ATGTTATTAGAATTCAAATAA';
  const flank = 'GGGGAATTCCCC';

  const docWith = (strand: 'forward' | 'reverse', extra = {}): SeqDocument => {
    const seq =
      strand === 'forward' ? flank + cds + 'AAAA' : 'AAAA' + reverseComplement(cds) + flank;
    const start = strand === 'forward' ? flank.length : 4;
    return SeqDocument.create({
      sequence: seq,
      topology: 'circular',
      features: [
        createFeature({
          type: 'CDS',
          name: 'orf',
          strand,
          segments: [rangeSegment(start, start + cds.length)],
          qualifiers: [{ name: 'note', value: 'mine' }],
          ...extra,
        }),
      ],
    });
  };

  for (const strand of ['forward', 'reverse'] as const) {
    it(`recodes a ${strand}-strand CDS without changing the protein`, () => {
      const doc = docWith(strand);
      const feature = doc.features.all()[0];
      if (feature === undefined) throw new Error('no feature');
      const prep = prepareRecodeCds(doc, feature);
      if (prep.job === undefined) throw new Error(prep.reason);
      const result = recodeSlots(prep.job.slots, {
        host: ecoli,
        prefix: prep.job.prefix,
        suffix: prep.job.suffix,
        avoid: [{ name: 'EcoRI', site: 'GAATTC' }],
      });
      const plan = finishRecodeCds(doc, feature, prep.job, result, ecoli);
      const after = doc.replace(plan.edit.range, plan.edit.text);
      expect(after.length).toBe(doc.length);
      const f2 = feature;
      expect(translateCds(after, f2).protein).toBe(translateCds(doc, f2).protein);
      expect(translateCds(after, f2).protein).toBe('MLLEFK*');
      // Start and stop kept, the flank untouched, EcoRI gone from the gene.
      const all = after.subsequence({ start: 0, end: after.length });
      const gene =
        strand === 'forward'
          ? all.slice(flank.length, flank.length + cds.length)
          : reverseComplement(all.slice(4, 4 + cds.length));
      expect(gene.slice(0, 3)).toBe('ATG');
      expect(gene.slice(-3)).toBe('TAA');
      expect(gene).not.toContain('GAATTC');
      const before = doc.subsequence({ start: 0, end: doc.length });
      const flankAt = strand === 'forward' ? [0, flank.length] : [4 + cds.length, doc.length];
      expect(all.slice(flankAt[0], flankAt[1])).toBe(before.slice(flankAt[0], flankAt[1]));
      expect(plan.changed).toBeGreaterThan(0);
      expect(plan.result.cai).toBeGreaterThan(plan.caiBefore);
      expect(plan.qualifiers.filter((q) => q.name === 'note')).toHaveLength(2);
      expect(plan.qualifiers.at(-1)?.value).toMatch(/^Recoded for E\. coli/);
    });
  }

  it('refuses what it cannot recode', () => {
    const joined = SeqDocument.create({
      sequence: 'ATG'.repeat(10),
      features: [
        createFeature({
          type: 'CDS',
          segments: [rangeSegment(0, 6), rangeSegment(9, 15)],
        }),
      ],
    });
    const f = joined.features.all()[0];
    if (f === undefined) throw new Error('no feature');
    expect(recodeRefusal(joined, f)).toMatch(/several pieces/);
    expect(prepareRecodeCds(joined, f).reason).toMatch(/several pieces/);
    const gene = createFeature({
      type: 'gene',
      segments: [rangeSegment(0, 6)],
    });
    expect(recodeRefusal(joined, gene)).toMatch(/Only a CDS/);
  });

  it('throws, changing nothing, if the answer would change the protein', () => {
    const doc = docWith('forward');
    const feature = doc.features.all()[0];
    if (feature === undefined) throw new Error('no feature');
    const prep = prepareRecodeCds(doc, feature);
    if (prep.job === undefined) throw new Error(prep.reason);
    const good = recodeSlots(prep.job.slots, { host: ecoli });
    const bad = { ...good, codons: good.codons.map((c, i) => (i === 3 ? 'GGG' : c)) };
    expect(() => finishRecodeCds(doc, feature, prep.job, bad, ecoli)).toThrow(/protein/);
  });
});

describe('recoding at gene scale (#209)', () => {
  it('recodes a 1,200-residue protein with limits in a few seconds', () => {
    let state = 7;
    const rnd = (): number => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
    const letters = 'ACDEFGHIKLMNPQRSTVWY';
    const protein = `M${Array.from({ length: 1200 }, () => letters.charAt(Math.floor(rnd() * 20))).join('')}*`;
    const avoid = [
      { name: 'EcoRI', site: 'GAATTC' },
      { name: 'BamHI', site: 'GGATCC' },
      { name: 'BsaI', site: 'GGTCTC' },
      { name: 'NotI', site: 'GCGGCCGC' },
    ];
    const t0 = Date.now();
    const r = backTranslate(protein, { host: codonUsageTable('human'), avoid, strategy: 'best' });
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(translate(r.dna)).toBe(protein);
    for (const a of avoid) {
      expect(r.dna).not.toContain(a.site);
      expect(r.dna).not.toContain(reverseComplement(a.site));
    }
    expect(r.unresolved).toEqual([]);
  });
});
