import { SeqDocument } from '@/core';

import { isOwnComment } from './ownComments';
import { parseGenBank } from './parseGenBank';
import { writeGenBank } from './writeGenBank';

/**
 * Our COMMENT lines — sticky ends, where a document came from, where its DNA
 * was grown — are rewritten from the document on every save. That is right
 * for a line we understood and wrong for one we did not: before #72 a
 * damaged line survived the read and vanished on the next save. Each kind is
 * checked here both ways.
 */
const DAMAGED = [
  'PlasmidPop-ends: left=7 AA',
  'PlasmidPop-derived-from: not a checksum',
  'PlasmidPop-methylation: garbage',
];

function readBack(text: string): SeqDocument {
  const doc = parseGenBank(text).documents[0];
  if (doc === undefined) throw new Error('no document');
  return doc;
}

describe('our comment lines', () => {
  it('counts only a line it understands as its own', () => {
    for (const line of DAMAGED) expect(isOwnComment(line)).toBe(false);
    expect(isOwnComment('PlasmidPop-methylation: dam-; dcm-')).toBe(true);
    expect(isOwnComment("PlasmidPop-ends: left=5' AATT/EcoRI; right=blunt")).toBe(true);
    expect(isOwnComment('a note of the user’s own')).toBe(false);
  });

  it('keeps every damaged line through a read and a save, beside the user’s own', () => {
    const doc = SeqDocument.create({
      name: 'p',
      sequence: 'ACGTACGT',
      metadata: { comments: ['first note', ...DAMAGED, 'last note'] },
    });
    const text = writeGenBank(doc);
    for (const line of DAMAGED) expect(text).toContain(line);
    const back = readBack(text);
    expect(back.metadata.comments).toEqual(['first note', ...DAMAGED, 'last note']);
    expect(back.ends).toBeNull();
    expect(back.methylation).toEqual({ dam: true, dcm: true });
    // A fixed point: a second save changes nothing.
    expect(writeGenBank(back)).toBe(text);
  });

  it('still takes a readable line out of the comments and writes it once', () => {
    const doc = SeqDocument.create({
      name: 'p',
      sequence: 'ACGTACGT',
      methylation: { dam: false, dcm: false },
      metadata: {
        comments: ['PlasmidPop-methylation: dam+; dcm+', 'PlasmidPop-methylation: garbage'],
      },
    });
    // The document says unmethylated; the stale readable line in its comments
    // is not written, the fresh one is, and the damaged one stays.
    const text = writeGenBank(doc);
    expect(text.match(/PlasmidPop-methylation: dam/g)).toHaveLength(1);
    expect(text).toContain('PlasmidPop-methylation: dam-; dcm-');
    expect(text).toContain('PlasmidPop-methylation: garbage');
    const back = readBack(text);
    expect(back.methylation).toEqual({ dam: false, dcm: false });
    expect(back.metadata.comments).toEqual(['PlasmidPop-methylation: garbage']);
  });
});
