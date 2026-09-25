import { proteinProperties } from './proteinProperties';

/**
 * Six UniProt entries and what ExPASy ProtParam
 * (web.expasy.org/protparam, 2026-09-25) says of each: length, molecular
 * weight, theoretical pI, and ε₂₈₀ with cystines and with Cys reduced.
 */
const PROTPARAM = [
  {
    id: 'P68871 hemoglobin beta',
    sequence:
      'MVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLSTPDAVMGNPKVKAHGKKVLGAFSDGLAHLDNLKGTFATLSELHCDKLHVDPENFRLLGNVLVCVLAHHFGKEFTPPVQAAYQKVVAGVANALAHKYH',
    length: 147,
    mw: 15998.41,
    pI: 6.74,
    cystines: 15595,
    reduced: 15470,
  },
  {
    id: 'P00698 hen lysozyme',
    sequence:
      'MRSLLILVLCFLPLAALGKVFGRCELAAAMKRHGLDNYRGYSLGNWVCAAKFESNFNTQATNRNTDGSTDYGILQINSRWWCNDGRTPGSRNLCNIPCSALLSSDITASVNCAKKIVSDGNGMNAWVAWRNRCKGTDVQAWIRGCRL',
    length: 147,
    mw: 16238.65,
    pI: 9.36,
    cystines: 37970,
    reduced: 37470,
  },
  {
    id: 'P01308 preproinsulin',
    sequence:
      'MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKTRREAEDLQVGQVELGGGPGAGSLQPLALEGSLQKRGIVEQCCTSICSLYQLENYCN',
    length: 110,
    mw: 11980.91,
    pI: 5.22,
    cystines: 17335,
    reduced: 16960,
  },
  {
    id: 'P42212 GFP',
    sequence:
      'MSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTFSYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLVNRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPDNHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITHGMDELYK',
    length: 238,
    mw: 26886.32,
    pI: 5.67,
    cystines: 22015,
    reduced: 21890,
  },
  {
    id: 'P0CG47 polyubiquitin-B',
    sequence:
      'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGGMQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGGMQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGGC',
    length: 229,
    mw: 25761.64,
    pI: 6.86,
    cystines: 4470,
    reduced: 4470,
  },
  {
    id: 'P02769 bovine serum albumin',
    sequence:
      'MKWVTFISLLLLFSSAYSRGVFRRDTHKSEIAHRFKDLGEEHFKGLVLIAFSQYLQQCPFDEHVKLVNELTEFAKTCVADESHAGCEKSLHTLFGDELCKVASLRETYGDMADCCEKQEPERNECFLSHKDDSPDLPKLKPDPNTLCDEFKADEKKFWGKYLYEIARRHPYFYAPELLYYANKYNGVFQECCQAEDKGACLLPKIETMREKVLASSARQRLRCASIQKFGERALKAWSVARLSQKFPKAEFVEVTKLVTDLTKVHKECCHGDLLECADDRADLAKYICDNQDTISSKLKECCDKPLLEKSHCIAEVEKDAIPENLPPLTADFAEDKDVCKNYQEAKDAFLGSFLYEYSRRHPEYAVSVLLRLAKEYEATLEECCAKDDPHACYSTVFDKLKHLVDEPQNLIKQNCDQFEKLGEYGFQNALIVRYTRKVPQVSTPTLVEVSRSLGKVGTRCCTKPESERMPCTEDYLSLILNRLCVLHEKTPVSEKVTKCCTESLVNRRPCFSALTPDETYVPKAFDEKLFTFHADICTLPDTEKQIKKQTALVELLKHKPKATEEQLKTVMENFVAFVDKCCAADDKEACFAVEGPKLVVSTQTALA',
    length: 607,
    mw: 69293.41,
    pI: 5.82,
    cystines: 49915,
    reduced: 47790,
  },
];

describe('protein properties, against ExPASy ProtParam (#66)', () => {
  for (const known of PROTPARAM) {
    it(`agrees for ${known.id}`, () => {
      const p = proteinProperties(known.sequence);
      expect(p.length).toBe(known.length);
      expect(p.molecularWeight.toFixed(2)).toBe(known.mw.toFixed(2));
      expect(p.isoelectricPoint?.toFixed(2)).toBe(known.pI.toFixed(2));
      expect(p.extinctionCystines).toBe(known.cystines);
      expect(p.extinctionReduced).toBe(known.reduced);
      expect(p.absorbanceCystines).toBeCloseTo(known.cystines / known.mw, 6);
      expect(p.ambiguous).toBe(0);
    });
  }
});

describe('protein properties', () => {
  it('reads either case, and leaves stops out of the chain', () => {
    const upper = proteinProperties('MVHLTPEEKS');
    const lower = proteinProperties('mvhltpeeks*');
    expect(lower.length).toBe(10);
    expect(lower.stops).toBe(1);
    expect(lower.molecularWeight).toBeCloseTo(upper.molecularWeight, 9);
    expect(lower.isoelectricPoint).toBeCloseTo(upper.isoelectricPoint ?? NaN, 9);
    expect(lower.counts.get('E')).toBe(2);
  });

  it('gives an empty chain no weight, pI or absorbance', () => {
    const none = proteinProperties('');
    expect(none).toMatchObject({
      length: 0,
      molecularWeight: 0,
      isoelectricPoint: null,
      chargeAtPH7: 0,
      extinctionCystines: 0,
      absorbanceCystines: null,
      absorbanceReduced: null,
    });
    expect(proteinProperties('*').length).toBe(0);
    // Glycine: its residue and one water.
    expect(proteinProperties('G').molecularWeight).toBeCloseTo(57.0519 + 18.01524, 6);
  });

  it('counts a cystine per pair of Cys, and none for an odd one out', () => {
    expect(proteinProperties('CCC').extinctionCystines).toBe(125);
    expect(proteinProperties('CCC').extinctionReduced).toBe(0);
    expect(proteinProperties('WYC').extinctionCystines).toBe(5500 + 1490);
  });

  it('takes the terminal residue’s pK for each end', () => {
    // The same composition, turned round: only the termini's pK differ.
    const ad = proteinProperties('AKKD');
    const da = proteinProperties('DKKA');
    expect(ad.isoelectricPoint).not.toBeCloseTo(da.isoelectricPoint ?? NaN, 3);
    // A basic chain is charged at pH 7, an acidic one the other way.
    expect(proteinProperties('KKKKRR').chargeAtPH7).toBeGreaterThan(4);
    expect(proteinProperties('DDDEEE').chargeAtPH7).toBeLessThan(-5);
    expect(proteinProperties('KKKKRR').isoelectricPoint).toBeGreaterThan(11);
    expect(proteinProperties('DDDEEE').isoelectricPoint).toBeLessThan(4);
  });

  it('weighs ambiguous residues by an average and says there are some', () => {
    const p = proteinProperties('MKBZXJ');
    expect(p.ambiguous).toBe(3);
    const known = proteinProperties('MKJ').molecularWeight - 18.01524;
    expect(p.molecularWeight).toBeCloseTo(
      known + (115.0886 + 114.1038) / 2 + (129.1155 + 128.1307) / 2 + 110 + 18.01524,
      6,
    );
    // Selenocysteine and pyrrolysine have masses of their own.
    expect(proteinProperties('U').molecularWeight).toBeCloseTo(150.0379 + 18.01524, 6);
    expect(proteinProperties('O').ambiguous).toBe(0);
  });
});
