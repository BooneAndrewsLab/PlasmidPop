import fc from 'fast-check';

import { type SeqDocument, SeqDocument as Doc } from '@/core';
import { docShapeArb, layFeatures, opShapeArb, resolveOp } from '@/test/editArbitraries';

import {
  formatBaseStylesComment,
  isBaseStylesComment,
  parseBaseStylesComment,
} from './baseStylesComment';
import { parseGenBank } from './parseGenBank';
import { writeGenBank } from './writeGenBank';

/**
 * Base styles in a GenBank file (#89, #91): a COMMENT block of ours,
 * `PlasmidPop-base-styles: 1` and the runs after it. Checked: every kind of
 * style round-trips, a document with none writes no block, many runs wrap
 * to GenBank's width and read back, a block this build cannot read stays an
 * ordinary comment, runs past the end of the record are dropped with a
 * warning, and write → parse → write is a fixed point after random edits.
 */

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

const readBack = (text: string): SeqDocument => must(parseGenBank(text).documents[0], 'a record');

const plain = (): SeqDocument =>
  Doc.create({ name: 'pStyled', sequence: 'ACGT'.repeat(50), topology: 'circular' });

describe('base styles in GenBank', () => {
  it('round-trip every kind of style', () => {
    const doc = plain()
      .styleBases({ start: 0, end: 10 }, { color: '#d62728' })
      .styleBases({ start: 5, end: 15 }, { bold: true })
      .styleBases({ start: 20, end: 30 }, { highlight: '#ffe066', size: 1.5 })
      .styleBases({ start: 195, end: 205 }, { size: 2 });
    const text = writeGenBank(doc);
    expect(text).toContain('COMMENT     PlasmidPop-base-styles: 1');
    expect(text).toContain('1..5:color=#d62728');
    const back = readBack(text);
    expect(back.styles.runs).toEqual(doc.styles.runs);
    expect(back.metadata.comments).toEqual([]);
    expect(writeGenBank(back)).toBe(text);
  });

  it('write no block for a document without styles', () => {
    expect(writeGenBank(plain())).not.toContain('PlasmidPop-base-styles');
  });

  it('wrap many runs to the width of a GenBank line', () => {
    let doc = plain();
    for (let i = 0; i < 60; i += 2) doc = doc.styleBases({ start: i, end: i + 1 }, { bold: true });
    const text = writeGenBank(doc);
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(80);
    expect(readBack(text).styles.runs).toEqual(doc.styles.runs);
  });

  it('leave a block that cannot be read among the comments', () => {
    for (const bad of [
      'PlasmidPop-base-styles: 2\n1..4:bold',
      'PlasmidPop-base-styles: 1\n1..4:blink',
      'PlasmidPop-base-styles: 1\n5..8:bold 1..4:bold',
      'PlasmidPop-base-styles: 1\n1..4:size=3',
      'PlasmidPop-base-styles: 1\n1..4:color=red',
    ]) {
      expect(parseBaseStylesComment(bad)).toBeNull();
      expect(isBaseStylesComment(bad)).toBe(true);
    }
    expect(parseBaseStylesComment('1..4:bold')).toBeNull();
  });

  it('read short colours and drop runs past the end of the record', () => {
    expect(parseBaseStylesComment('PlasmidPop-base-styles: 1\n1..4:color=#F00')).toEqual([
      { start: 0, end: 4, style: { color: '#ff0000' } },
    ]);
    const text = writeGenBank(plain()).replace(
      /^(FEATURES)/m,
      'COMMENT     PlasmidPop-base-styles: 1\n            1..4:bold 199..240:bold\n$1',
    );
    const result = parseGenBank(text);
    expect(result.documents[0]?.styles.runs).toEqual([{ start: 0, end: 4, style: { bold: true } }]);
    expect(result.warnings.some((w) => w.message.includes('base styles'))).toBe(true);
  });

  it('format an empty list as just the header', () => {
    expect(formatBaseStylesComment([])).toBe('PlasmidPop-base-styles: 1');
  });

  it('write → parse → write is a fixed point after random edits', () => {
    fc.assert(
      fc.property(docShapeArb, fc.array(opShapeArb, { maxLength: 12 }), (shape, ops) => {
        let doc = Doc.create({
          sequence: shape.sequence,
          topology: shape.topology,
          features: layFeatures(shape),
        });
        for (const op of ops) {
          const resolved = resolveOp(doc, op);
          if (resolved !== null) doc = doc.apply(resolved);
        }
        if (doc.length === 0) return;
        const text = writeGenBank(doc);
        const back = readBack(text);
        expect(back.styles.runs).toEqual(doc.styles.runs);
        expect(writeGenBank(back)).toBe(text);
      }),
      { numRuns: 150 },
    );
  });
});
