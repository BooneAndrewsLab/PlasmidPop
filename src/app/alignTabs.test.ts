import { describe, expect, it } from 'vitest';

import { SeqDocument, createFeature, rangeSegment } from '@/core';

import { tabRecord, tabsToRecords } from './alignTabs';

describe('tabRecord', () => {
  it('takes the sequence, name and topology as they stand', () => {
    const d = SeqDocument.create({ name: 'p', sequence: 'ACGT', topology: 'circular' });
    expect(tabRecord(d)).toEqual({ name: 'p', sequence: 'ACGT', circular: true });
  });

  it('keeps a read and features when the tab has them', () => {
    const read = { qualities: Uint8Array.from([30, 31, 32, 33]), trace: null };
    const feature = createFeature({ type: 'CDS', name: 'gfp', segments: [rangeSegment(0, 3)] });
    const d = SeqDocument.create({ name: 'p', sequence: 'ACGT', read, features: [feature] });
    const record = tabRecord(d);
    expect(record.read).toBe(read);
    expect(record.features?.map((f) => f.name)).toEqual(['gfp']);
  });

  it('leaves them out when it has none', () => {
    const record = tabRecord(SeqDocument.create({ name: 'p', sequence: 'ACGT' }));
    expect('read' in record).toBe(false);
    expect('features' in record).toBe(false);
  });
});

describe('tabsToRecords', () => {
  const docs = ['AA', 'CC', 'GG'].map((s, i) => SeqDocument.create({ name: `t${i}`, sequence: s }));

  it('makes a record per tab, in order', () => {
    expect(tabsToRecords(docs, 96).map((r) => r.name)).toEqual(['t0', 't1', 't2']);
  });

  it('keeps at most the limit', () => {
    expect(tabsToRecords(docs, 2).map((r) => r.sequence)).toEqual(['AA', 'CC']);
  });
});
