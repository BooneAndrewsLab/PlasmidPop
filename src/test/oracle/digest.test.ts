import { createHash } from 'node:crypto';

import { SeqDocument } from '@/core';
import { ENZYMES, findCutSites } from '@/core/analysis/restriction';
import { documentChecksum } from '@/core/checksum';
import { digest } from '@/core/cloning/digest';
import { flipFragment, ligate } from '@/core/cloning/ligate';
import { parseGenBank } from '@/io';
import { readFixture } from '@/test/fixtures';

import oracle from './digest.json';

/**
 * Digests and ligations against pydna's Dseq.cut and Dseq + / looped()
 * (scripts/oracle/digest.py), on the pBR322, pUC19, phiX174, AF177870 and
 * U49845 fixtures: the top strand of every fragment, how each end looks
 * (kind of overhang, its bases along the top strand), and what ligation makes
 * of them, including hybrid sites, blunt ends, 3' overhangs, Type IIS ends,
 * and a vector whose origin has been moved. Host methylation and REBASE
 * imports are not covered (issues #135, #136).
 */

interface End {
  readonly kind: string;
  readonly overhang: string;
}
interface Piece {
  readonly length: number;
  readonly sha: string;
  readonly left: End;
  readonly right: End;
}
interface Source {
  readonly fixture: string;
  readonly topology: 'circular' | 'linear';
  readonly rotation: number;
  readonly enzymes: readonly string[];
}

const sha = (text: string): string =>
  createHash('sha1').update(text.toUpperCase()).digest('hex').slice(0, 12);

function documentOf(s: Source): SeqDocument {
  const record = parseGenBank(readFixture(s.fixture)).documents[0];
  if (record === undefined) throw new Error(`${s.fixture}: no record`);
  const text = record.sequence.toString().toUpperCase();
  const k = s.rotation % text.length;
  return SeqDocument.create({
    name: s.fixture,
    sequence: text.slice(k) + text.slice(0, k),
    topology: s.topology,
  });
}

function fragmentsOf(s: Source) {
  const doc = documentOf(s);
  const enzymes = s.enzymes.map((name) => {
    const e = ENZYMES.find((x) => x.name === name);
    if (e === undefined) throw new Error(`${name} is not in the bundled table`);
    return e;
  });
  return digest(doc, findCutSites(doc.sequence.toString(), doc.topology, enzymes));
}

const describe1 = (e: End): End => ({ kind: e.kind, overhang: e.overhang.toUpperCase() });

describe('digests against pydna', () => {
  for (const c of oracle.digests) {
    const label = `${c.source} ${c.topology}${c.rotation ? ` rotated ${c.rotation}` : ''} ${c.enzymes.join('+')}`;
    it(label, () => {
      const ours: Piece[] = fragmentsOf(c as Source).map((f) => ({
        length: f.sequence.length,
        sha: sha(f.sequence),
        left: describe1(f.left),
        right: describe1(f.right),
      }));
      const key = (p: Piece): string => `${p.sha}/${p.length}`;
      ours.sort((a, b) => (key(a) < key(b) ? -1 : 1));
      const expected = [...(c.fragments as readonly Piece[])].sort((a, b) =>
        key(a) < key(b) ? -1 : 1,
      );
      expect(ours).toEqual(expected);
    });
  }
});

describe('ligation against pydna', () => {
  for (const c of oracle.ligations) {
    it(c.name, () => {
      const fragments = c.parts.map((part, i) => {
        const found = fragmentsOf(part as Source).filter((f) => f.sequence.length === part.length);
        expect(found).toHaveLength(1);
        const fragment = found[0];
        if (fragment === undefined) throw new Error('unreachable');
        return c.flips[i] ? flipFragment(fragment) : fragment;
      });
      const product = ligate(fragments, { name: c.name, circular: c.circular });
      // The product is compared by its SEGUID, which names a molecule whichever way
      // round it is written and wherever a circle starts (seguid.test.ts pins the
      // checksum itself against the seguid package).
      expect(product.isCircular).toBe(c.circular);
      expect(product.sequence.length).toBe(c.length);
      expect(documentChecksum(product)?.value).toBe(c.seguid);
      if (!c.circular) {
        const ends = (c as { ends?: { left: End; right: End } }).ends;
        expect(product.ends).not.toBeNull();
        expect(describe1(product.ends?.left ?? { kind: '?', overhang: '' })).toEqual(ends?.left);
        expect(describe1(product.ends?.right ?? { kind: '?', overhang: '' })).toEqual(ends?.right);
      }
    });
  }
});
