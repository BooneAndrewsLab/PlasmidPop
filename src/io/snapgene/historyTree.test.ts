import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { historyXml, readHistoryTree, readSnapGeneHistory } from './historyTree';

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

describe('the history packet, compressed or not (#85)', () => {
  const fixture = (name: string): Uint8Array =>
    new Uint8Array(readFileSync(join(__dirname, '..', 'fixtures', 'snapgene', name)));

  it('decompresses an xz packet, and reads a plain one as it is', async () => {
    const xz = fixture('history-tree.xml.xz');
    // The magic the reader looks for, so the fixture is what it claims.
    expect([...xz.slice(0, 6)]).toEqual([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]);
    const fromXz = await historyXml(xz);
    const plain = new TextDecoder().decode(fixture('history-tree.xml'));
    expect(fromXz).toBe(plain);
    expect(await historyXml(fixture('history-tree.xml'))).toBe(plain);
  });

  it('reads the tree of a packet either way round', async () => {
    for (const name of ['history-tree.xml.xz', 'history-tree.xml']) {
      const tree = await readSnapGeneHistory(fixture(name));
      expect(tree, name).toMatchObject({ name: 'product.dna', length: 120, topology: 'circular' });
      expect(tree?.step?.op, name).toBe('ligation');
      const pcr = tree?.step?.parents[1]?.step;
      expect(pcr?.op, name).toBe('pcr');
      if (pcr?.op !== 'pcr') throw new Error('not a PCR');
      expect(pcr.forward.name).toBe('fwd');
      expect(pcr.parents[0]?.length).toBe(5000);
    }
  });

  it('costs the tree and never the file when the packet is rubbish', async () => {
    // xz magic, then nothing that decompresses.
    const broken = new Uint8Array([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00, 1, 2, 3, 4]);
    expect(await historyXml(broken)).toBeNull();
    expect(await readSnapGeneHistory(broken)).toBeNull();
    // Plain bytes that are not XML read as text, and are no tree.
    expect(await readSnapGeneHistory(new TextEncoder().encode('not xml'))).toBeNull();
  });
});

describe('what the tree reader keeps and drops', () => {
  const tree = (body: string): ReturnType<typeof readHistoryTree> =>
    readHistoryTree(`<HistoryTree>${body}</HistoryTree>`);

  it('takes a length it can use and nothing else', () => {
    const node = tree(
      '<Node name="a" seqLen="many" operation="flip"><Node name="b" seqLen="-5"/></Node>',
    );
    // Not a count of bases: nothing rather than a guess.
    expect(node?.length).toBe(0);
    expect(node?.step?.parents[0]?.length).toBe(0);
    expect(
      tree('<Node name="a" seqLen="12.7" operation="flip"><Node name="b"/></Node>')?.length,
    ).toBe(12);
  });

  it('is linear unless the node says circular, and reads only circular="1"', () => {
    expect(
      tree('<Node name="a" circular="0" operation="flip"><Node name="b"/></Node>')?.topology,
    ).toBe('linear');
    expect(
      tree('<Node name="a" circular="true" operation="flip"><Node name="b"/></Node>')?.topology,
    ).toBe('linear');
    expect(
      tree('<Node name="a" circular="1" operation="flip"><Node name="b"/></Node>')?.topology,
    ).toBe('circular');
  });

  it('needs both oligos to call a node a PCR', () => {
    const one = tree(
      '<Node name="a" operation="amplifyFragment"><Oligo name="f" sequence="ACGT"/><Node name="b"/></Node>',
    );
    // One oligo is not a PCR we can describe: the operation is kept by name.
    expect(one?.step).toMatchObject({ op: 'other', name: 'amplifyFragment' });
    const none = tree(
      '<Node name="a" operation="amplifyFragment"><Oligo name="f" sequence=""/><Oligo name="r" sequence="TTTT"/><Node name="b"/></Node>',
    );
    // An oligo with no bases is not an oligo.
    expect(none?.step).toMatchObject({ op: 'other' });
  });

  it('takes the manipulation as what a mutagenesis changed, or says who made it', () => {
    const named = tree(
      '<Node name="a" operation="primerDirectedMutagenesis"><InputSummary manipulation="insert"/><Node name="b"/></Node>',
    );
    expect(named?.step).toMatchObject({ op: 'mutagenesis', change: 'insert' });
    const plain = tree(
      '<Node name="a" operation="primerDirectedMutagenesis"><Node name="b"/></Node>',
    );
    expect(plain?.step).toMatchObject({ change: 'as SnapGene made it' });
  });

  it('calls a step with no operation, or an invalid one, what SnapGene made', () => {
    expect(tree('<Node name="a"><Node name="b"/></Node>')?.step).toMatchObject({
      op: 'other',
      name: 'made in SnapGene',
    });
    expect(tree('<Node name="a" operation="invalid"><Node name="b"/></Node>')?.step).toMatchObject({
      name: 'made in SnapGene',
    });
  });

  it('stops at the depth and the size a lineage keeps', () => {
    // A chain deeper than MAX_LINEAGE_DEPTH: the tail is not kept.
    let body = '<Node name="deep-25"/>';
    for (let i = 24; i >= 0; i--)
      body = `<Node name="deep-${String(i)}" operation="flip">${body}</Node>`;
    const deep = tree(body);
    let depth = 0;
    for (let n = deep; n?.step?.parents[0] !== undefined; n = n.step.parents[0]) depth++;
    expect(depth).toBeLessThanOrEqual(24);
    // And a tree wider than MAX_LINEAGE_NODES keeps that many.
    const wide = tree(
      `<Node name="root" operation="insertFragments">${'<Node name="p"/>'.repeat(80)}</Node>`,
    );
    expect(wide?.step?.parents.length).toBeLessThanOrEqual(63);
  });

  it('is nothing when the root element is not a HistoryTree', () => {
    expect(readHistoryTree('<Nodes><Node name="a" operation="flip"/></Nodes>')).toBeNull();
  });
});
