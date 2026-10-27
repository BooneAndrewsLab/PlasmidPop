import { SeqDocument, createFeature, rangeSegment } from '@/core';
import { type GeneHit } from '@/io';

import { type NcbiFetched } from './openFromNcbi';
import { designForFetchedGene, geneTarget, recallWorkspace } from './primerWorkspace';
import { editorStore } from './state/editorStore';
import { forgetPanels } from './state/panelMemory';

const hit: GeneHit = {
  id: '7157',
  symbol: 'TP53',
  fullName: 'tumor protein p53',
  organism: 'Homo sapiens',
  taxId: 9606,
  aliases: [],
  chromosome: '17',
  location: { accession: 'NC_000017.11', start: 7668420, end: 7687490, strand: 'reverse' },
};

/** A fetched gene with 500 bp of flank on either side of a 1,000 bp gene. */
function fetched(withFeature = true): NcbiFetched {
  const doc = SeqDocument.create({
    name: 'TP53',
    sequence: 'ACGT'.repeat(500),
    features: withFeature
      ? [
          createFeature({
            type: 'gene',
            name: 'TP53',
            segments: [rangeSegment(500, 1500)],
            qualifiers: [{ name: 'gene', value: 'TP53' }],
          }),
        ]
      : [],
  });
  return {
    documents: [doc],
    warnings: [],
    source: {
      kind: 'gene',
      gene: hit,
      region: { accession: 'NC_000017.11', start: 7667921, stop: 7687990, strand: 'reverse' },
    },
    fileName: () => 'TP53.gb',
  };
}

describe('the gene fetched for the Design page (item 107, #299)', () => {
  afterEach(() => {
    forgetPanels();
    while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
  });

  it('targets the gene feature, flanks left out, or the whole record without one', () => {
    expect(geneTarget(fetched())).toEqual({ start: 500, end: 1500 });
    expect(geneTarget(fetched(false))).toEqual({ start: 0, end: 2000 });
  });

  it('opens the record as a tab and the workspace on Design with the gene selected', () => {
    editorStore.openDocument(SeqDocument.create({ name: 'before', sequence: 'ACGTACGT' }));
    designForFetchedGene(fetched());
    const state = editorStore.getState();
    expect(state.documents.map((d) => d.history.present.name)).toEqual(['before', 'TP53']);
    expect(editorStore.document?.name).toBe('TP53');
    expect(state.selection).toEqual({ start: 500, end: 1500 });
    expect(state.primerWorkspace).toBe(true);
    expect(state.sidebarTab).toBe('primers');
    expect(recallWorkspace(state.documentId).page).toBe('design');
  });
});
