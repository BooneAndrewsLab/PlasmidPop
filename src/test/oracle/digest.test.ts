import { createHash } from 'node:crypto';

import { SeqDocument } from '@/core';
import { ENZYMES, cutLabel, findCutSites, getEnzyme } from '@/core/analysis/restriction';
import { documentChecksum } from '@/core/checksum';
import { digest } from '@/core/cloning/digest';
import { flipFragment, ligate } from '@/core/cloning/ligate';
import { parseGenBank } from '@/io';
import { readFixture } from '@/test/fixtures';
import { exportMapSvg } from '@/view/svg';

import oracle from './digest.json';

/**
 * Digests and ligations against pydna's Dseq.cut and Dseq + / looped()
 * (scripts/oracle/digest.py), on the pBR322, pUC19, phiX174, AF177870 and
 * U49845 fixtures: the top strand of every fragment, how each end looks
 * (kind of overhang, its bases along the top strand), and what ligation makes
 * of them, including hybrid sites, blunt ends, 3' overhangs, Type IIS ends,
 * and a vector whose origin has been moved. Host methylation and REBASE
 * imports are not covered (issues #135, #136).
 *
 * Cuts at the origin of a circle: random circles turned so a top or bottom
 * cut lands within two bases of the origin, 16 enzymes (Type IIS and
 * non-palindromic ones included). The cut labels, in the table and on the
 * exported map, come from Bio.Restriction search(linear=False); the digest
 * fragments from pydna's Dseqrecord(circular=True).cut.
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

describe('cuts at the origin of a circle', () => {
  const enzymeOf = (name: string) => {
    const e = getEnzyme(name);
    if (e === undefined) throw new Error(`${name} is not known`);
    return e;
  };

  it('has cuts exactly at the origin and Type IIS enzymes', () => {
    expect(oracle.originLabels.length).toBeGreaterThanOrEqual(150);
    expect(oracle.originLabels.filter((c) => c.at_origin).length).toBeGreaterThanOrEqual(15);
    expect(oracle.originLabels.some((c) => c.enzyme === 'BsaI')).toBe(true);
    expect(oracle.originDigests.length).toBeGreaterThanOrEqual(150);
  });

  it('labels each cut as Bio.Restriction places it, 0 as the length', () => {
    const problems: string[] = [];
    for (const [i, c] of oracle.originLabels.entries()) {
      const e = enzymeOf(c.enzyme);
      const L = c.seq.length;
      const sites = findCutSites(c.seq, 'circular', [e]);
      const labels = [...new Set(sites.map((s) => cutLabel(s.cut, L, 'circular')))].sort(
        (a, b) => a - b,
      );
      if (labels.join() !== c.cuts.join()) {
        problems.push(`#${String(i)} ${c.enzyme}: ${labels.join()} vs ${c.cuts.join()}`);
        continue;
      }
      const doc = SeqDocument.create({ sequence: c.seq, topology: 'circular' });
      const svg = exportMapSvg(doc, { cutSites: sites });
      const drawn = [...svg.matchAll(new RegExp(`${c.enzyme}[^<(]*\\(([0-9,]+)\\)`, 'g'))].map(
        (m) => Number((m[1] ?? '').replace(/,/g, '')),
      );
      if ([...new Set(drawn)].sort((a, b) => a - b).join() !== c.cuts.join()) {
        problems.push(`#${String(i)} ${c.enzyme}: map shows ${drawn.join()}`);
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
  });

  it('digests a circle cut at the origin into the fragments pydna makes', () => {
    const problems: string[] = [];
    for (const [i, c] of oracle.originDigests.entries()) {
      const doc = SeqDocument.create({ sequence: c.seq, topology: 'circular' });
      const frags = digest(doc, findCutSites(c.seq, 'circular', [enzymeOf(c.enzyme)]));
      const ours: Piece[] = frags.map((f) => ({
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
      try {
        expect(ours).toEqual(expected);
      } catch {
        problems.push(`#${String(i)} ${c.enzyme} L=${String(c.seq.length)}`);
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
  });
});
