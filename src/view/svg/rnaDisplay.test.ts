import { SeqDocument, createMetadata } from '@/core';
import { writeGenBank } from '@/io/genbank';
import { parseSnapGene } from '@/io/snapgene/parseSnapGene';
import { writeSnapGene } from '@/io/snapgene/writeSnapGene';

import { exportLinearSvg } from './exportLinear';

function docOf(moleculeType: string, topology: 'linear' | 'circular' = 'linear'): SeqDocument {
  return SeqDocument.create({
    name: 'r',
    sequence: 'GGATCCATGGCTAAGGATCC',
    topology,
    metadata: createMetadata({ moleculeType }),
  });
}

/** The letters of every `<text>` element that is a run of bases. */
function baseTexts(svg: string): string[] {
  return [...svg.matchAll(/<text [^>]*>([ACGTUacgtu]{10})<\/text>/g)].map((m) => m[1] ?? '');
}

describe('sequence view of an RNA (#113)', () => {
  it('draws U for T on both strands', () => {
    const texts = baseTexts(exportLinearSvg(docOf('RNA')));
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) {
      expect(t).not.toMatch(/[Tt]/);
    }
    expect(texts.join('')).toMatch(/[Uu]/);
    // Complement of A is U, not T.
    expect(texts.join('')).toMatch(/u/i);
  });

  it('leaves a DNA document alone', () => {
    const texts = baseTexts(exportLinearSvg(docOf('DNA')));
    expect(texts.join('')).toMatch(/[Tt]/);
    expect(texts.join('')).not.toMatch(/[Uu]/);
  });

  it('leaves a DNA/RNA hybrid alone', () => {
    expect(baseTexts(exportLinearSvg(docOf('DNA/RNA'))).join('')).not.toMatch(/[Uu]/);
  });

  it('round trips: .rna read shows U, exports stay T', () => {
    const doc = docOf('RNA');
    const out = writeSnapGene(doc);
    expect(out.extension).toBe('rna');
    const back = parseSnapGene(out.bytes, 'r.rna').documents[0];
    if (back === undefined) throw new Error('no document');
    expect(back.sequence.toString()).toBe('GGATCCATGGCTAAGGATCC');
    expect(baseTexts(exportLinearSvg(back)).join('')).not.toMatch(/[Tt]/);
    const gb = writeGenBank(back);
    expect(gb).toMatch(/ggatccatgg/i);
    expect(gb).not.toMatch(/\buu|ccaug/i);
  });

  it('still writes .rna only for a linear RNA', () => {
    expect(writeSnapGene(docOf('RNA')).extension).toBe('rna');
    expect(writeSnapGene(docOf('mRNA')).extension).toBe('rna');
    expect(writeSnapGene(docOf('RNA', 'circular')).extension).toBe('dna');
    expect(writeSnapGene(docOf('DNA')).extension).toBe('dna');
    expect(writeSnapGene(docOf('DNA/RNA')).extension).toBe('dna');
  });
});
