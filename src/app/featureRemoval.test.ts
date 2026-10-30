import { type Feature, SeqDocument, createFeature, rangeSegment, siteSegment } from '@/core';
import { parseGenBank, writeGenBank } from '@/io';
import { groupFeatures } from '@/view/featureGroups';

import { EditorStore } from './state/editorStore';
import { featuresOfType, removeOtherMembersOp, removeTypeOp } from './featureRemoval';

// An INS-shaped record (#308, item 115), circular so one mRNA can run over
// the origin: three variants of INS (one wrapped, one joined), a fourth
// mRNA of another gene, two CDSs that are copies, their sig_peptides.
const LENGTH = 400;
const q = (name: string, value: string) => ({ name, value });
const mrna = (id: string, gene: string, segments: Feature['segments'], tx: string): Feature =>
  createFeature({
    id,
    type: 'mRNA',
    segments,
    qualifiers: [q('gene', gene), q('transcript_id', tx)],
  });

const FEATURES: Feature[] = [
  createFeature({ id: 'src', type: 'source', segments: [rangeSegment(0, LENGTH)] }),
  createFeature({ id: 'gene', type: 'gene', segments: [rangeSegment(20, 300)] }),
  mrna('m1', 'INS', [rangeSegment(20, 80), rangeSegment(150, 300)], 'NM_1'),
  createFeature({
    id: 'cds1',
    type: 'CDS',
    segments: [rangeSegment(50, 80), rangeSegment(150, 210)],
    qualifiers: [q('gene', 'INS'), q('protein_id', 'NP_1')],
  }),
  createFeature({ id: 'sig1', type: 'sig_peptide', segments: [rangeSegment(50, 80)] }),
  mrna('m2', 'INS', [rangeSegment(380, 430)], 'NM_2'), // over the origin
  createFeature({
    id: 'cds2',
    type: 'CDS',
    segments: [rangeSegment(50, 80), rangeSegment(150, 210)],
    qualifiers: [q('gene', 'INS'), q('protein_id', 'NP_2')],
  }),
  createFeature({ id: 'sig2', type: 'sig_peptide', segments: [rangeSegment(50, 80)] }),
  mrna('m3', 'INS', [rangeSegment(30, 80), rangeSegment(150, 290)], 'NM_3'),
  mrna('m4', 'IGF2', [rangeSegment(310, 360)], 'NM_4'),
  createFeature({ id: 'site', type: 'misc_feature', segments: [siteSegment(100)] }),
];

const doc = SeqDocument.create({
  name: 'INS',
  sequence: 'ACGT'.repeat(LENGTH / 4),
  topology: 'circular',
  features: FEATURES,
});

const ids = (d: SeqDocument): string[] => d.features.all().map((f) => f.id);
const apply = (d: SeqDocument, op: ReturnType<typeof removeTypeOp>): SeqDocument => {
  if (op === null) throw new Error('no op');
  return d.apply(op);
};

describe('removeTypeOp (#316)', () => {
  it('removes every feature of the type, leaving the rest in order and in place', () => {
    const op = removeTypeOp(doc, 'mRNA');
    expect(op).toEqual({
      type: 'removeFeatures',
      ids: ['m1', 'm2', 'm3', 'm4'],
      label: 'Remove 4 mRNA features',
    });
    const after = apply(doc, op);
    expect(ids(after)).toEqual(['src', 'gene', 'cds1', 'sig1', 'cds2', 'sig2', 'site']);
    // The joined CDSs and the site are the very same objects: nothing moved.
    for (const f of after.features) expect(f).toBe(doc.features.get(f.id));
    expect(after.sequence.toString()).toBe(doc.sequence.toString());
  });

  it('says one feature in the singular, and is null for a type the document lacks', () => {
    expect(removeTypeOp(doc, 'gene')).toEqual(
      expect.objectContaining({ label: 'Remove 1 gene feature' }),
    );
    expect(removeTypeOp(doc, 'tRNA')).toBeNull();
    expect(featuresOfType(doc, 'CDS').map((f) => f.id)).toEqual(['cds1', 'cds2']);
  });

  it('takes only the listed features when given them: a transcript pick hides the rest (#316)', () => {
    const listed = doc.features.all().filter((f) => f.id !== 'm2' && f.id !== 'm3');
    expect(featuresOfType(doc, 'mRNA', listed).map((f) => f.id)).toEqual(['m1', 'm4']);
    const op = removeTypeOp(doc, 'mRNA', listed);
    expect(op).toEqual({
      type: 'removeFeatures',
      ids: ['m1', 'm4'],
      label: 'Remove 2 mRNA features',
    });
    expect(ids(apply(doc, op))).toEqual([
      'src',
      'gene',
      'cds1',
      'sig1',
      'm2',
      'cds2',
      'sig2',
      'm3',
      'site',
    ]);
    expect(removeTypeOp(doc, 'tRNA', listed)).toBeNull();
  });
});

describe('removeOtherMembersOp (#316)', () => {
  const grouped = groupFeatures(doc.features.all(), doc.length);

  it("keeps the chosen variant and removes the gene's other mRNAs, and only those", () => {
    const group = grouped.groupOf.get('m2');
    expect(group?.kind).toBe('transcripts');
    if (group === undefined) throw new Error('no group');
    const op = removeOtherMembersOp(group, 'm2');
    expect(op).toEqual({
      type: 'removeFeatures',
      ids: ['m1', 'm3'],
      label: 'Remove 2 other INS transcripts',
    });
    const after = apply(doc, op);
    // The other gene's mRNA, the CDSs and their peptides stay: nothing in a
    // record links an mRNA to them (#315). The kept one still wraps.
    expect(ids(after)).toEqual(['src', 'gene', 'cds1', 'sig1', 'm2', 'cds2', 'sig2', 'm4', 'site']);
    expect(after.features.get('m2')?.segments).toEqual([rangeSegment(380, 430)]);
  });

  it('removes the other copies of a feature drawn as one bar', () => {
    const group = grouped.groupOf.get('cds2');
    expect(group?.kind).toBe('copies');
    if (group === undefined) throw new Error('no group');
    const op = removeOtherMembersOp(group, 'cds2');
    expect(op).toEqual({
      type: 'removeFeatures',
      ids: ['cds1'],
      label: 'Remove 1 other copy of CDS',
    });
    const after = apply(doc, op);
    expect(after.features.get('cds2')?.segments).toEqual([
      rangeSegment(50, 80),
      rangeSegment(150, 210),
    ]);
  });

  it('is null for a feature outside the group', () => {
    const group = grouped.groupOf.get('m1');
    if (group === undefined) throw new Error('no group');
    expect(removeOtherMembersOp(group, 'm4')).toBeNull();
  });
});

describe('removeFeatures through the editor (#316)', () => {
  it('is one undo step, and undo puts every feature back in its order', () => {
    const store = new EditorStore();
    store.openDocument(doc);
    const op = removeTypeOp(doc, 'mRNA');
    if (op === null) throw new Error('no op');
    store.apply(op);
    expect(store.document?.features.size).toBe(7);
    expect(store.getState().history?.undoLabel).toBe('Remove 4 mRNA features');
    expect(store.getState().history?.undoDepth).toBe(1);
    store.undo();
    const back = store.document;
    if (back === null) throw new Error('no document');
    expect(ids(back)).toEqual(ids(doc));
    expect(back.features.all()).toEqual(doc.features.all());
    store.redo();
    expect(store.document?.features.size).toBe(7);
  });

  it('leaves no undo step when nothing matches', () => {
    const store = new EditorStore();
    store.openDocument(doc);
    store.apply({ type: 'removeFeatures', ids: ['nope'] });
    store.apply({ type: 'removeFeatures', ids: [] });
    expect(store.document).toBe(doc);
    expect(store.getState().history?.canUndo).toBe(false);
  });
});

describe('the result written to GenBank (#316)', () => {
  it('reads back with the same features, the wrapped and joined ones included', () => {
    const after = apply(doc, removeTypeOp(doc, 'sig_peptide'));
    const read = parseGenBank(writeGenBank(after)).documents[0];
    if (read === undefined) throw new Error('no record');
    const shape = (d: SeqDocument) =>
      d.features.all().map((f) => ({ type: f.type, segments: f.segments, joining: f.joining }));
    expect(shape(read)).toEqual(shape(after));
    expect(read.features.all().some((f) => f.type === 'sig_peptide')).toBe(false);
    expect(writeGenBank(read)).toBe(writeGenBank(after));
  });
});
