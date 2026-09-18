import { History, SeqDocument, createFeature, rangeSegment } from '@/core';

import { describeEffect, historyRows, summarizeDocument } from './historyView';

const base = SeqDocument.create({ name: 'p1', sequence: 'ACGTACGTAC' });

function withFeature(doc: SeqDocument): SeqDocument {
  return doc.addFeature(
    createFeature({ id: 'f1', type: 'CDS', name: 'gene', segments: [rangeSegment(0, 3)] }),
  );
}

describe('describeEffect', () => {
  it('measures bases, features and topology', () => {
    expect(describeEffect(base, base.insert(0, 'AAA'))).toBe('+3 bp');
    expect(describeEffect(base, base.delete({ start: 0, end: 4 }))).toBe('−4 bp');
    expect(describeEffect(base, withFeature(base))).toBe('+1 feature');
    expect(describeEffect(withFeature(base), base)).toBe('−1 feature');
    expect(describeEffect(base, base.setTopology('circular'))).toBe('circular');
    expect(describeEffect(base.setTopology('circular'), base)).toBe('linear');
  });

  it('joins several effects and says nothing about a change that moves neither', () => {
    const grown = withFeature(base.insert(0, 'AA')).setTopology('circular');
    expect(describeEffect(base, grown)).toBe('+2 bp · +1 feature · circular');
    expect(describeEffect(base, base.rename('p2'))).toBe('');
  });

  it('summarizes a document', () => {
    expect(summarizeDocument(base)).toBe('10 bp · 0 features');
    expect(summarizeDocument(withFeature(base))).toBe('10 bp · 1 feature');
  });
});

describe('historyRows', () => {
  it('is empty without a history', () => {
    expect(historyRows(null)).toEqual([]);
  });

  it('lists the starting state and every change, newest first', () => {
    const one = base.insert(0, 'AA');
    const two = withFeature(one);
    const history = History.create(base, { at: 1000 })
      .push(one, 'Insert 2 bases', 2000)
      .push(two, 'Add feature', 3000);

    const rows = historyRows(history, { savedDoc: base });
    expect(rows.map((r) => [r.position, r.label, r.effect])).toEqual([
      [2, 'Add feature', '+1 feature'],
      [1, 'Insert 2 bases', '+2 bp'],
      [0, 'Opened document', '10 bp · 0 features'],
    ]);
    expect(rows.map((r) => r.at)).toEqual([3000, 2000, 1000]);
    expect(rows.map((r) => r.current)).toEqual([true, false, false]);
    expect(rows.map((r) => r.undone)).toEqual([false, false, false]);
    // Only the version the file holds is marked as being on disk.
    expect(rows.map((r) => r.saved)).toEqual([false, false, true]);
    expect(rows[0]?.state).toBe(two);
  });

  it('marks undone changes and follows the current position', () => {
    const one = base.insert(0, 'AA');
    const two = one.insert(0, 'T');
    const history = History.create(base).push(one, 'Insert 2 bases').push(two, 'Insert 1 base');

    const rows = historyRows(history.jumpTo(1), { savedDoc: one });
    expect(rows.map((r) => [r.position, r.current, r.undone, r.saved])).toEqual([
      [2, false, true, false],
      [1, true, false, true],
      [0, false, false, false],
    ]);
  });

  it('names the starting state after where the document came from', () => {
    const history = History.create(base);
    expect(historyRows(history, { startLabel: 'New document' })[0]?.label).toBe('New document');
    // Once the limit drops steps, step 0 is no longer the document as opened.
    let capped = History.create(base, { limit: 1 });
    capped = capped
      .push(base.insert(0, 'A'), 'Insert 1 base')
      .push(base.insert(0, 'AA'), 'Insert 1 base');
    expect(historyRows(capped)[historyRows(capped).length - 1]?.label).toBe('Oldest kept state');
  });
});
