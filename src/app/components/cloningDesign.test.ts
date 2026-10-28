import { describe, expect, it } from 'vitest';

import {
  SeqDocument,
  createFeature,
  rangeSegment,
  resolveVectorRegion,
  scanForCloningNow,
} from '@/core';
import { parseGenBank } from '@/io';
import { readFixture } from '@/test/fixtures';

import { type DocumentState, editorStore } from '../state/editorStore';
import {
  GOLDEN_GATE_MEMORY,
  cloningPreview,
  designRows,
  endText,
  fetchedInsertRef,
  insertChoices,
  internalSites,
  goldenGateEnzymeNames,
  overhangWidth,
  overhangsReady,
  resolveInsert,
  siteWithCut,
  tubeDocuments,
  vectorEnzymes,
} from './cloningDesign';

function fixture(name: string): SeqDocument {
  const doc = parseGenBank(readFixture(name)).documents[0];
  if (doc === undefined) throw new Error(`${name}: no record`);
  return doc;
}

const pUC19 = fixture('L09137.gb');
const U49845 = fixture('U49845.gb');

/** The store's entry for a document opened in a tab. */
function open(
  doc: SeqDocument,
  selection: { start: number; end: number } | null = null,
): DocumentState {
  const id = editorStore.openDocument(doc);
  if (selection !== null) editorStore.setSelection(selection);
  const state = editorStore.documentState(id);
  if (state === null) throw new Error('not open');
  return state;
}

function closeAll(): void {
  while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
}

describe('the cloning mode’s helpers (#303)', () => {
  it('writes an end as its overhang and side, and a site with its cut', () => {
    expect(endText({ kind: "5'", overhang: 'aatt', enzyme: 'EcoRI' })).toBe('AATT 5′');
    expect(endText({ kind: "3'", overhang: 'TGCA', enzyme: 'PstI' })).toBe('TGCA 3′');
    expect(endText({ kind: 'blunt', overhang: '', enzyme: 'SmaI' })).toBe('blunt');
    expect(endText(null)).toBe('—');
    expect(siteWithCut('EcoRI')).toBe('G^AATTC');
    expect(siteWithCut('BsaI')).toBe('GGTCTC(1/5)');
    expect(siteWithCut('NoSuchEnzyme')).toBe('');
  });

  it('offers the other tabs’ features and selections as inserts, never the vector’s own', () => {
    try {
      const insertTab = open(U49845, { start: 10, end: 60 });
      const vectorTab = open(pUC19);
      const groups = insertChoices(editorStore.getState().documents, vectorTab.documentId);
      expect(groups.map((g) => g.documentId)).toEqual([insertTab.documentId]);
      const labels = groups[0]?.choices.map((c) => c.label) ?? [];
      expect(labels[0]).toBe('Selection 11–60 · 50 bp');
      expect(labels).toContainEqual(expect.stringMatching(/^Axl2p \(CDS\) · 687–3,158$/));
      expect(labels).toContainEqual(
        expect.stringMatching(/^Rev7p \(CDS\) · 3,300–4,037 · reverse$/),
      );
      // The vector's tab offers nothing while it is the vector.
      expect(insertChoices(editorStore.getState().documents, insertTab.documentId)).toHaveLength(1);
    } finally {
      closeAll();
    }
  });

  it('resolves an insert off its tab now, and to nothing once the tab or the feature is gone', () => {
    try {
      const tab = open(U49845);
      const cds = U49845.features.all().find((f) => f.name === 'Axl2p' && f.type === 'CDS');
      if (cds === undefined) throw new Error('no AXL2 CDS');
      const ref = {
        documentId: tab.documentId,
        featureId: cds.id,
        range: { start: 0, end: 1 },
        strand: 'forward' as const,
        name: 'AXL2',
      };
      const insert = resolveInsert(ref, editorStore.getState().documents);
      // The feature's extent, read live, not the range the reference held.
      expect(insert?.range).toEqual({ start: 686, end: 3158 });
      expect(insert?.document).toBe(U49845);
      expect(
        resolveInsert({ ...ref, featureId: 'gone' }, editorStore.getState().documents),
      ).toBeNull();
      closeAll();
      expect(resolveInsert(ref, editorStore.getState().documents)).toBeNull();
      expect(resolveInsert(null, [])).toBeNull();
    } finally {
      closeAll();
    }
  });

  it('takes a fetched record’s one CDS as the insert, else its gene, else the whole record', () => {
    const cds = createFeature({ type: 'CDS', name: 'ACT1', segments: [rangeSegment(100, 400)] });
    const gene = createFeature({
      type: 'gene',
      name: 'ACT1',
      strand: 'reverse',
      segments: [rangeSegment(50, 450)],
    });
    const both = SeqDocument.create({
      name: 'NM_1',
      sequence: 'A'.repeat(500),
      features: [cds, gene],
    });
    expect(fetchedInsertRef(both, 'tab')).toMatchObject({
      featureId: cds.id,
      range: { start: 100, end: 400 },
      strand: 'forward',
      name: 'ACT1',
    });
    const geneOnly = SeqDocument.create({
      name: 'NM_2',
      sequence: 'A'.repeat(500),
      features: [gene],
    });
    expect(fetchedInsertRef(geneOnly, 'tab')).toMatchObject({
      featureId: gene.id,
      strand: 'reverse',
    });
    const bare = SeqDocument.create({ name: 'NM_3', sequence: 'A'.repeat(500) });
    expect(fetchedInsertRef(bare, 'tab')).toEqual({
      documentId: 'tab',
      featureId: null,
      range: { start: 0, end: 500 },
      strand: 'forward',
      name: 'NM_3',
    });
  });

  it('lists the region’s enzymes that cut the insert, and every enzyme that cuts the vector', () => {
    const insert = {
      document: U49845,
      range: { start: 686, end: 3158 },
      strand: 'forward' as const,
      name: 'AXL2',
    };
    const scans = scanForCloningNow(pUC19, insert);
    const inside = internalSites(scans, ['EcoRI', 'HindIII', 'KpnI', 'BamHI']);
    // Only the enzymes asked about, each once, positions ascending.
    for (const s of inside) {
      expect(['EcoRI', 'HindIII', 'KpnI', 'BamHI']).toContain(s.enzyme);
      expect([...s.positions]).toEqual([...s.positions].sort((a, b) => a - b));
    }
    expect(internalSites(scans, [])).toEqual([]);
    const all = vectorEnzymes(scans);
    expect(all).toContain('EcoRI');
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual([...all].sort((a, b) => a.localeCompare(b)));
  });

  it('draws the MCS region as a span and the picked sites as arrows, the selection as itself', () => {
    const scans = scanForCloningNow(pUC19, {
      document: U49845,
      range: { start: 686, end: 3158 },
      strand: 'forward',
      name: 'AXL2',
    });
    const ecoRI = scans.vectorSites.find((s) => s.enzyme === 'EcoRI') ?? null;
    const given = resolveVectorRegion(pUC19, { start: 395, end: 452 });
    const spans = cloningPreview(pUC19, given, [ecoRI, null]);
    expect(spans.map((s) => s.id)).toEqual(['cut-0']);
    expect(spans[0]?.shape).toBe('arrow');
    expect(spans[0]?.label).toMatch(/^EcoRI \d/);
    expect(spans[0]?.range.end).toBe((spans[0]?.range.start ?? 0) + 6);
    const mcs = SeqDocument.create({
      sequence: pUC19.sequence.toString(),
      topology: 'circular',
      features: [
        createFeature({ type: 'misc_feature', name: 'MCS', segments: [rangeSegment(395, 452)] }),
      ],
    });
    const fallback = cloningPreview(mcs, resolveVectorRegion(mcs, null), []);
    expect(fallback).toEqual([
      {
        id: 'region',
        label: 'MCS',
        range: { start: 395, end: 452 },
        strand: 'none',
        shape: 'span',
      },
    ]);
  });
});

describe('the Golden Gate option’s helpers (#310)', () => {
  it('knows how wide an overhang the enzyme asks for', () => {
    expect(overhangWidth('BsaI')).toBe(4);
    expect(overhangWidth('SapI')).toBe(3);
    // Not a Type IIS enzyme, so it makes no part.
    expect(overhangWidth('EcoRI')).toBe(0);
    expect(goldenGateEnzymeNames().slice(0, 4)).toEqual(['BsaI', 'BsmBI', 'BbsI', 'SapI']);
  });

  it('is ready only with two overhangs of the right width and bases', () => {
    const gg = { ...GOLDEN_GATE_MEMORY, left: 'AATG', right: 'GCTT' };
    expect(overhangsReady(gg)).toBe(true);
    expect(overhangsReady({ ...gg, right: 'GCT' })).toBe(false);
    expect(overhangsReady({ ...gg, right: 'GCNT' })).toBe(false);
    expect(overhangsReady({ ...gg, enzyme: 'SapI' })).toBe(false);
    expect(overhangsReady({ ...gg, enzyme: 'SapI', left: 'ATG', right: 'CGA' })).toBe(true);
  });

  it('puts only the other tabs the enzyme opens a part out of in the tube', () => {
    const vector = open(pUC19);
    const insert = open(U49845);
    const part = open(
      SeqDocument.create({
        name: 'part',
        sequence: `TTGGTCTCAAATG${'ACGT'.repeat(20)}CGAATGAGACCAA`,
      }),
    );
    const documents = editorStore.getState().documents;
    const tube = tubeDocuments(documents, vector.documentId, insert.documentId, 'BsaI', '');
    expect(tube.map((d) => d.name)).toEqual([part.history.present.name]);
    // The vector itself and the insert's own record are never in it.
    expect(tubeDocuments(documents, vector.documentId, part.documentId, 'BsaI', '')).toEqual([]);
  });

  it('has no rows without a restriction design', () => {
    expect(designRows(null)).toEqual([]);
  });
});
