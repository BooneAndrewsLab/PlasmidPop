import { efetchRegionUrl, geneHit, geneWindow, parseGenBank, regionSent } from '@/io';
import { readFixture } from '@/test/fixtures';

import oracle from './ncbi-region.json';

/**
 * One real region against Biopython's `Entrez.efetch` with the same range
 * (scripts/oracle/ncbi_region.py, run by hand: it is the one oracle that
 * uses the network). The fixture is the GenBank text NCBI sent for the
 * app's own efetch parameters — yeast HBT1 with 200 bp of flank each side,
 * as the minus strand — and the JSON is what Biopython read from the same
 * request. We must build that request from esummary's placement, read the
 * same bases, and carry every feature's location and partial marks.
 */

interface ExpectedSegment {
  readonly start: number;
  readonly end: number;
  readonly strand: number;
  readonly partialStart: boolean;
  readonly partialEnd: boolean;
}

interface ExpectedFeature {
  readonly type: string;
  readonly gene: string | null;
  readonly location: { readonly operator: string | null; readonly segments: ExpectedSegment[] };
}

/** HBT1 as esummary (db=gene, id=851303) placed it on 2026-10-27, 0-based and reverse. */
const HBT1_ROW = {
  name: 'HBT1',
  description: 'Hbt1p',
  organism: { scientificname: 'Saccharomyces cerevisiae S288C', taxid: 559292 },
  chromosome: 'IV',
  genomicinfo: [{ chraccver: 'NC_001136.10', chrstart: 60404, chrstop: 57264 }],
};

describe('a region fetched from NCBI, against Biopython', () => {
  const { region } = oracle;
  const text = readFixture(oracle.fixture);
  const doc = parseGenBank(text).documents[0];
  if (doc === undefined) throw new Error('no record in the fixture');

  it('asks efetch for the window the gene and its flanks make', () => {
    const hit = geneHit('851303', HBT1_ROW);
    expect(hit?.location).toEqual({
      accession: 'NC_001136.10',
      start: 57264,
      end: 60405,
      strand: 'reverse',
    });
    if (hit?.location == null) throw new Error('unplaced');
    const window = geneWindow(hit.location, { upstream: 200, downstream: 200 }, true);
    expect(window.region).toEqual(region);
    const params = new URL(efetchRegionUrl(window.region)).searchParams;
    expect(params.get('seq_start')).toBe(region.start.toString());
    expect(params.get('seq_stop')).toBe(region.stop.toString());
    expect(params.get('strand')).toBe('2');
    // The gene sits after its upstream flank, 0-based; Biopython's gene feature is 1-based 201..3341.
    expect(window.gene).toEqual({ start: 200, end: 3341 });
  });

  it('reads the same bases, name, topology and ACCESSION line', () => {
    expect(doc.length).toBe(oracle.length);
    expect(doc.sequence.toString().toUpperCase()).toBe(oracle.sequence);
    expect(doc.name).toBe(oracle.name);
    expect(doc.topology).toBe(oracle.topology);
    expect(doc.metadata.accession).toBe(oracle.accession);
    expect(regionSent(text)).toEqual({ start: region.start, stop: region.stop });
  });

  it('carries every feature with its location and partial marks', () => {
    const expected = oracle.features as readonly ExpectedFeature[];
    const ours = doc.features.all();
    expect(ours).toHaveLength(expected.length);
    expected.forEach((want, i) => {
      const got = ours[i];
      if (got === undefined) throw new Error(`feature ${i.toString()} missing`);
      expect(got.type).toBe(want.type);
      const segments = got.segments.map((s) =>
        s.kind === 'range'
          ? {
              start: s.start + 1,
              end: s.end,
              strand: got.strand === 'reverse' ? -1 : 1,
              partialStart: s.partialStart,
              partialEnd: s.partialEnd,
            }
          : s,
      );
      expect(segments).toEqual(want.location.segments);
    });
    // RefSeq marks a yeast gene and its mRNA partial at both ends (the UTRs
    // are not annotated) while the CDS is complete; the marks must survive.
    const gene = ours.find((f) => f.type === 'gene');
    expect(gene?.segments[0]).toMatchObject({ partialStart: true, partialEnd: true });
    const cds = ours.find((f) => f.type === 'CDS');
    expect(cds?.segments[0]).toMatchObject({ partialStart: false, partialEnd: false });
  });
});
