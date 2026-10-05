import { SeqDocument } from '@/core';
import { cdseguid, csseguid, documentChecksum, ldseguid, lsseguid } from '@/core/checksum';
import { parseGenBank } from '@/io';
import { readFixture } from '@/test/fixtures';

import oracle from './seguid.json';

/**
 * SEGUID v2 against the seguid package and pydna's Dseq.seguid()
 * (scripts/oracle/checksums.py): single-stranded linear and circular,
 * double-stranded linear with every mix of overhang kinds, circular on every
 * rotation and strand, and documentChecksum on sticky-ended fragments cut
 * from the pUC19 and pBR322 fixtures and on whole plasmids.
 */

type Kind = 'blunt' | "5'" | "3'";
interface End {
  readonly kind: Kind;
  readonly overhang: string;
}

describe('SEGUID against the seguid package', () => {
  it('lsseguid and csseguid', () => {
    for (const c of oracle.singleStranded) {
      expect(lsseguid(c.sequence).value, c.sequence).toBe(c.ls);
      expect(csseguid(c.sequence).value, c.sequence).toBe(c.cs);
      if (c.csOfOriginal !== undefined) expect(c.cs).toBe(c.csOfOriginal);
    }
  });

  it('ldseguid on strands with staggered ends', () => {
    for (const c of oracle.duplexes) {
      expect(ldseguid(c.watson, c.crick).value, `${c.watson};${c.crick}`).toBe(c.ld);
    }
  });

  it('cdseguid on every rotation and strand', () => {
    for (const c of oracle.circles) {
      expect(cdseguid(c.watson, c.crick).value, c.watson).toBe(c.cd);
    }
  });
});

describe('document checksum against pydna Dseq.seguid()', () => {
  it('sticky-ended fragments', () => {
    expect(oracle.fragments.length).toBeGreaterThan(20);
    for (const c of oracle.fragments) {
      const left = c.left as End;
      const right = c.right as End;
      const doc = SeqDocument.create({
        name: 'fragment',
        sequence: c.top,
        topology: 'linear',
        ends: {
          left: { ...left, enzyme: null },
          right: { ...right, enzyme: null },
        },
      });
      const sum = documentChecksum(doc);
      expect(sum?.kind).toBe('ldseguid');
      expect(sum?.value, `${left.kind} ${left.overhang} .. ${right.kind} ${right.overhang}`).toBe(
        c.ld,
      );
    }
  });

  it('whole circular plasmids, wherever they start', () => {
    for (const c of oracle.wholeCircles) {
      const record = parseGenBank(readFixture(c.fixture)).documents[0];
      if (record === undefined) throw new Error(c.fixture);
      const text = record.sequence.toString().toUpperCase();
      const k = c.rotation % text.length;
      const doc = SeqDocument.create({
        name: c.fixture,
        sequence: text.slice(k) + text.slice(0, k),
        topology: 'circular',
      });
      const sum = documentChecksum(doc);
      expect(sum?.kind).toBe('cdseguid');
      expect(sum?.value).toBe(c.cd);
    }
  });
});
