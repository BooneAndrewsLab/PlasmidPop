import {
  SeqDocument,
  createFeature,
  digest,
  documentFromFragment,
  findCutSites,
  getEnzyme,
  ligate,
  rangeSegment,
  translateCds,
} from '@/core';

function def<T>(x: T | undefined): T {
  if (x === undefined) throw new Error('expected a value');
  return x;
}

const enz = (...names: string[]) => names.map((n) => def(getEnzyme(n)));

// CDS ATG CGA ATT CCG AAA CTG TTT GCA TGG TAA = M R I P K L F A W *
// EcoRI G^AATTC at CDS offset 4 cuts the top strand after offset 4 (5 bases in).
const CDS = 'ATGCGAATTCCGAAACTGTTTGCATGGTAA';
const LEFT = 'CCCCCCCCCC';
const RIGHT = 'GGGGGGGGGG';

describe('cloning products keep features whole and in frame (#162)', () => {
  it('A2: digest fragment cut inside a CDS keeps it in frame', () => {
    const doc = SeqDocument.create({
      sequence: LEFT + CDS + RIGHT,
      topology: 'linear',
      features: [createFeature({ type: 'CDS', segments: [rangeSegment(10, 40)] })],
    });
    const frags = digest(doc, findCutSites(doc.sequence.toString(), 'linear', enz('EcoRI')));
    const right = documentFromFragment(def(frags[1]));
    const f = def(right.features.all().find((x) => x.type === 'CDS'));
    expect(translateCds(right, f).protein).toBe('IPKLFAW*');
  });

  it('B2: digest of a circle: backbone fragment across the origin, MCS inside a reverse lacZ-like CDS', () => {
    // EcoRI and BamHI inside a reverse feature; origin in the backbone.
    const mcs = 'GAATTCAAAAAGGATCC';
    const body = 'TTTTTCCCCCAAAAACCCCC' + mcs + 'CCCCCTTTTTAAAAACCCCC';
    const seq = 'GGGGGGGGGGGGGGGGGGGG' + body + 'GGGGGGGGGGGGGGGGGGGG';
    const doc = SeqDocument.create({
      sequence: seq,
      topology: 'circular',
      features: [
        createFeature({
          type: 'misc_feature',
          strand: 'reverse',
          segments: [rangeSegment(20, 20 + body.length)],
        }),
      ],
    });
    const frags = digest(doc, findCutSites(seq, 'circular', enz('EcoRI', 'BamHI')));
    const backbone = frags.reduce((a, b) => (a.sequence.length > b.sequence.length ? a : b));
    const bb = documentFromFragment(backbone);
    // The excised MCS splits the feature into the two halves of the backbone (#169).
    const halves = bb.features.all().filter((x) => x.type === 'misc_feature');
    expect(halves).toHaveLength(2);
    const bases = halves.map((h) =>
      h.segments.map((x) => (x.kind === 'range' ? bb.subsequence(x) : '')).join(''),
    );
    // One half is the stretch left of the excised MCS, the other the stretch right of it.
    expect(bases.some((b) => b.includes('TTTTTCCCCCAAAAA'))).toBe(true);
    expect(bases.some((b) => b.includes('CCCCCTTTTTAAAAA'))).toBe(true);
  });

  it('B3: a digest backbone around a lacZ-like CDS gives two CDS halves, each in frame (#169)', () => {
    // CDS = 15 + 17 (EcoRI..BamHI) + 19 bases = 51, so 17 codons without a stop.
    const cds = 'ATGCGAATTCCGAAA' + 'GAATTCAAAAAGGATCC' + 'ACTGTTTGCATGGGACCAT';
    const seq = 'G'.repeat(20) + cds + 'G'.repeat(20);
    const doc = SeqDocument.create({
      sequence: seq,
      topology: 'circular',
      features: [createFeature({ type: 'CDS', name: 'lacZa', segments: [rangeSegment(20, 71)] })],
    });
    const whole = translateCds(doc, def(doc.features.all()[0])).protein;
    expect(whole).toHaveLength(17);
    const frags = digest(doc, findCutSites(seq, 'circular', enz('EcoRI', 'BamHI')));
    const backbone = frags.reduce((a, b) => (a.sequence.length > b.sequence.length ? a : b));
    const bb = documentFromFragment(backbone);
    const halves = bb.features.all().filter((x) => x.type === 'CDS');
    expect(halves).toHaveLength(2);
    expect(halves.map((h) => h.name)).toEqual(['lacZa', 'lacZa']);
    for (const h of halves) {
      const bases = bb.featureSequence(h);
      const k = cds.indexOf(bases);
      expect(k).toBeGreaterThanOrEqual(0);
      // Each half reads as the original does over the same bases.
      // (a trailing partial codon may still translate where its third base is a wobble)
      const expected = whole.slice(Math.ceil(k / 3), Math.floor((k + bases.length) / 3));
      expect(translateCds(bb, h).protein.slice(0, expected.length)).toBe(expected);
    }
  });

  it('A4: ligation product of a fragment cut inside a CDS reads it in frame', () => {
    const vseq = 'G'.repeat(20) + 'GAATTCAAAAAGGATCC' + 'G'.repeat(20);
    const vector = SeqDocument.create({ sequence: vseq, topology: 'circular' });
    const iseq = LEFT + CDS + 'GGATCC' + LEFT;
    const insert = SeqDocument.create({
      sequence: iseq,
      topology: 'linear',
      features: [createFeature({ type: 'CDS', segments: [rangeSegment(10, 40)] })],
    });
    const v = digest(vector, findCutSites(vseq, 'circular', enz('EcoRI', 'BamHI')));
    const backbone = v.reduce((a, b) => (a.sequence.length > b.sequence.length ? a : b));
    const parts = digest(insert, findCutSites(iseq, 'linear', enz('EcoRI', 'BamHI')));
    const mid = def(parts[1]);
    const product = ligate([backbone, mid], { name: 'p', circular: true });
    const f = def(product.features.all().find((x) => x.type === 'CDS'));
    expect(translateCds(product, f).protein).toBe('IPKLFAW*');
  });
});
