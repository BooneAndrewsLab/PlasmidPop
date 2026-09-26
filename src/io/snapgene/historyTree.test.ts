import { readHistoryTree } from './historyTree';

/**
 * A history tree in the shape SnapGene writes, shortened: the sample
 * project's `pIB2-SEC13-mEGFP.dna`, whose product is a vector and a PCR
 * product ligated, with the insert amplified from a piece taken out of a
 * genome and the vector mutagenised. The sample file itself is not in the
 * repository (it is SnapGene's), so the XML is.
 */
const TREE = `<?xml version="1.0" encoding="UTF-8"?><HistoryTree>
<Node name="pIB2-SEC13-mEGFP.dna" type="DNA" seqLen="7235" strandedness="double" ID="8" circular="1" operation="insertFragments">
  <RegeneratedSite name="KpnI" pos="689" siteCount="1"/>
  <InputSummary manipulation="replace" name1="SpeI" name2="KpnI" val1="700" val2="689"/>
  <Node name="pIB2.dna" type="DNA" seqLen="5550" ID="1" circular="1" operation="invalid"/>
  <Node name="Amplified SEC13.dna" type="DNA" seqLen="969" ID="4" circular="0" operation="amplifyFragment">
    <Oligo name="SEC13.FOR" sequence="ACGGTATCGATAAGCTTGAT"/>
    <Oligo name="SEC13.REV" sequence="GGTACCTTAATCCTGATCCA"/>
    <Node name="SEC13.dna" type="DNA" seqLen="944" ID="3" circular="0" operation="flip">
      <Node name="SEC13.dna" type="DNA" seqLen="944" ID="2" circular="0" operation="newFileFromSelection">
        <Node name="NC_012963.1.dna" type="DNA" seqLen="2798491" ID="0" circular="0" operation="invalid"/>
      </Node>
    </Node>
  </Node>
  <Node name="pmEGFP-1.dna" type="DNA" seqLen="4151" ID="7" circular="1" operation="changeMethylation">
    <Node name="pmEGFP-1.dna" type="DNA" seqLen="4151" ID="6" circular="1" operation="primerDirectedMutagenesis">
      <InputSummary manipulation="insert" name1="A206K"/>
      <Oligo name="mut.FOR" sequence="CTGAGCAAAGACCCCAACGAGAAG"/>
      <Oligo name="mut.REV" sequence="CTTCTCGTTGGGGTCTTTGCTCAG"/>
      <Node name="pEGFP-1.dna" type="DNA" seqLen="4151" ID="5" circular="1" operation="invalid"/>
    </Node>
  </Node>
</Node></HistoryTree>`;

describe("SnapGene's history tree (#85)", () => {
  const root = readHistoryTree(TREE);

  it('reads the product and what went into it', () => {
    expect(root).not.toBeNull();
    expect(root).toMatchObject({
      name: 'pIB2-SEC13-mEGFP.dna',
      length: 7235,
      topology: 'circular',
      // SnapGene stores no checksum, so no node can be looked for here.
      checksum: null,
    });
    expect(root?.step?.op).toBe('ligation');
    expect(root?.step?.parents.map((p) => p.name)).toEqual([
      'pIB2.dna',
      'Amplified SEC13.dna',
      'pmEGFP-1.dna',
    ]);
  });

  it('reads a PCR with the oligos it was run with', () => {
    const pcr = root?.step?.parents[1]?.step;
    expect(pcr?.op).toBe('pcr');
    if (pcr?.op !== 'pcr') throw new Error('not a PCR');
    expect(pcr.forward).toEqual({ name: 'SEC13.FOR', sequence: 'ACGGTATCGATAAGCTTGAT' });
    expect(pcr.reverse).toEqual({ name: 'SEC13.REV', sequence: 'GGTACCTTAATCCTGATCCA' });
    expect(pcr.parents[0]?.name).toBe('SEC13.dna');
  });

  it('reads a mutagenesis with its primers, and what it changed', () => {
    const methylation = root?.step?.parents[2]?.step;
    // Changing the methylation is SnapGene's own operation, kept by name.
    expect(methylation).toMatchObject({ op: 'other', name: 'changeMethylation' });
    const mutagenesis = methylation?.parents[0]?.step;
    expect(mutagenesis?.op).toBe('mutagenesis');
    if (mutagenesis?.op !== 'mutagenesis') throw new Error('not a mutagenesis');
    expect(mutagenesis.primers).toEqual(['CTGAGCAAAGACCCCAACGAGAAG', 'CTTCTCGTTGGGGTCTTTGCTCAG']);
    expect(mutagenesis.parents[0]?.name).toBe('pEGFP-1.dna');
  });

  it('keeps an operation of its own under its own name, and a leaf as a file opened', () => {
    const chain = root?.step?.parents[1]?.step?.parents[0];
    expect(chain).toMatchObject({ name: 'SEC13.dna', step: { op: 'other', name: 'flip' } });
    const selection = chain?.step?.parents[0]?.step;
    expect(selection).toMatchObject({ op: 'other', name: 'newFileFromSelection' });
    // The genome it was taken from was opened, not made: no step at all.
    const genome = selection?.parents[0];
    expect(genome).toMatchObject({ name: 'NC_012963.1.dna', length: 2798491, step: null });
  });

  it('is nothing for XML that is not a history tree, or a tree of one file', () => {
    expect(readHistoryTree('<Features/>')).toBeNull();
    expect(readHistoryTree('not xml at all')).toBeNull();
    expect(readHistoryTree('')).toBeNull();
    // A file that was only ever opened has a tree, and it says nothing.
    expect(
      readHistoryTree(
        '<HistoryTree><Node name="a.dna" seqLen="10" operation="invalid"/></HistoryTree>',
      ),
    ).toBeNull();
  });

  it('takes a linear molecule as linear, and a name it can use', () => {
    const tree = readHistoryTree(
      `<HistoryTree><Node name="  a  file  " seqLen="12" operation="flip">
         <Node name="" seqLen="12" operation="invalid"/>
       </Node></HistoryTree>`,
    );
    expect(tree).toMatchObject({ name: 'a file', topology: 'linear', length: 12 });
    expect(tree?.step?.parents[0]?.name).toBe('Untitled');
  });
});
