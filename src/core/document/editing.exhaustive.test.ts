import fc from 'fast-check';

import { parseGenBank } from '@/io';
import { RefModel, checkEdit, opShapeArb, resolveOp } from '@/test/editArbitraries';
import { listFixtures, readFixture } from '@/test/fixtures';

import { type Feature, createFeature, rangeSegment, siteSegment } from '../features';
import { type Range, type Topology } from '../range';
import { type EditOp } from './editOp';
import { SeqDocument } from './seqDocument';

/**
 * Fixed samples next to the random ones in `editing.property.test.ts`, so a
 * corner case never depends on the generator happening to find it:
 *
 * - every edit at every position of every sequence up to 5 bp, linear and
 *   circular, on a document carrying every feature that fits on it at once
 *   (each range on both strands, two-piece joins, sites), and every pair of
 *   edits up to 3 bp;
 * - random edits on real NCBI records, which carry what generated features
 *   never do: partial ends, sites, long joins, located qualifiers.
 *
 * Each edit goes through the same check as the random sessions (`checkEdit`).
 */

const BASES = 'ACGTM';

function everyFeature(L: number, topology: Topology): Feature[] {
  const out: Feature[] = [];
  let n = 0;
  const add = (segments: Feature['segments'], strand: Feature['strand']): void => {
    out.push(createFeature({ id: `x${n}`, type: 'misc_feature', strand, segments }));
    n += 1;
  };
  for (const strand of ['forward', 'reverse'] as const) {
    for (let s = 0; s < L; s++) {
      const maxLen = topology === 'circular' ? L : L - s;
      for (let len = 1; len <= maxLen; len++) add([rangeSegment(s, s + len)], strand);
    }
    for (let a = 0; a < L; a++)
      for (let b = a + 1; b <= L; b++)
        for (let c = b; c < L; c++)
          for (let d = c + 1; d <= L; d++) add([rangeSegment(a, b), rangeSegment(c, d)], strand);
  }
  const lastSite = topology === 'circular' ? L - 1 : L;
  for (let p = 0; p <= lastSite && L > 0; p++) add([siteSegment(p)], 'forward');
  return out;
}

function everyRange(doc: SeqDocument, minLen: number): Range[] {
  const L = doc.length;
  const out: Range[] = [];
  const starts = L === 0 ? [0] : [...Array(L).keys()];
  for (const start of starts) {
    const maxLen = doc.isCircular ? L : L - start;
    for (let len = minLen; len <= maxLen; len++) out.push({ start, end: start + len });
  }
  return out;
}

let pasteId = 0;
function everyOp(doc: SeqDocument): EditOp[] {
  const L = doc.length;
  const ops: EditOp[] = [];
  for (let p = 0; p <= L; p++) {
    ops.push({ type: 'insert', position: p, text: 'G' });
    ops.push({ type: 'insert', position: p, text: 'TTa' });
  }
  for (const range of everyRange(doc, 1)) ops.push({ type: 'delete', range });
  for (const range of everyRange(doc, 0)) {
    for (const text of ['', 'G', 'TTa']) ops.push({ type: 'replace', range, text });
    pasteId += 1;
    const pasted = createFeature({
      id: `p${pasteId}`,
      type: 'gene',
      segments: [rangeSegment(1, 3)],
    });
    ops.push({ type: 'insertFragment', range, fragment: { sequence: 'GcTN', features: [pasted] } });
    ops.push({ type: 'insertFragment', range, fragment: { sequence: '', features: [] } });
  }
  if (doc.isCircular) for (let p = 0; p <= L; p++) ops.push({ type: 'setOrigin', position: p });
  ops.push({ type: 'reverseComplement' });
  ops.push({ type: 'setTopology', topology: doc.isCircular ? 'linear' : 'circular' });
  return ops;
}

/** Applies `op` to both the document and a copy of the model, checking it; returns both. */
function step(doc: SeqDocument, model: RefModel, op: EditOp): [SeqDocument, RefModel] {
  const next = model.clone();
  const coveredBefore = new Map(doc.features.all().map((f) => [f.id, next.coveredBySegment(f)]));
  const after = doc.apply(op);
  const s = next.apply(op);
  try {
    checkEdit(doc, after, op, next, s, coveredBefore);
  } catch (e) {
    throw new Error(
      `${doc.topology} "${doc.sequence.toString()}", ${JSON.stringify(op)}: ${(e as Error).message}`,
      { cause: e },
    );
  }
  return [after, next];
}

describe('every edit of every small sequence', () => {
  for (const topology of ['linear', 'circular'] as const) {
    for (let L = 0; L <= 5; L++) {
      it(`${topology}, ${L} bp`, () => {
        const sequence = BASES.slice(0, L);
        const doc = SeqDocument.create({ sequence, topology, features: everyFeature(L, topology) });
        const model = new RefModel(sequence, topology);
        for (const op of everyOp(doc)) {
          const [after, afterModel] = step(doc, model, op);
          // And every edit after that, on the smallest sequences.
          if (L <= 3) for (const op2 of everyOp(after)) step(after, afterModel, op2);
        }
      });
    }
  }
});

describe('random edits on real records', () => {
  for (const name of listFixtures()) {
    it(name, () => {
      const original = parseGenBank(readFixture(name)).documents[0];
      if (original === undefined) throw new Error(`${name}: no record`);
      fc.assert(
        fc.property(fc.array(opShapeArb, { maxLength: 15 }), (shapes) => {
          let doc = original;
          let model = new RefModel(doc.sequence.toString(), doc.topology);
          for (const shape of shapes) {
            const op = resolveOp(doc, shape);
            if (op !== null) [doc, model] = step(doc, model, op);
          }
        }),
        { numRuns: 25 },
      );
    });
  }
});
