import { describe, expect, it } from 'vitest';
import {
  type DigestFragment,
  SeqDocument,
  createFeature,
  digest,
  documentFromFragment,
  emptyVector,
  findCutSites,
  getEnzyme,
  rangeSegment,
} from '@/core';

/*
 * #183: blunting a cut vector (T4 polymerase, Klenow) leaves a molecule that
 * still closes on itself, so it still has an empty-vector background. A
 * description-less blunt molecule (a PCR product) does not.
 */

function def<T>(x: T | null | undefined): T {
  if (x === undefined || x === null) throw new Error('expected a value');
  return x;
}

function cut(doc: SeqDocument, ...names: string[]): DigestFragment[] {
  const enzymes = names.map((n) => def(getEnzyme(n)));
  return digest(doc, findCutSites(doc.sequence.toString(), doc.topology, enzymes));
}

const PAD = 'C'.repeat(20);
const circle = (site: string, features = true): SeqDocument =>
  SeqDocument.create({
    name: 'p',
    sequence: PAD + 'AAAA' + site + 'TTTT' + 'C'.repeat(46),
    topology: 'circular',
    features: features
      ? [createFeature({ type: 'promoter', name: 'P', segments: [rangeSegment(15, 45)] })]
      : [],
  });

const linear = (doc: SeqDocument, ...names: string[]) =>
  documentFromFragment(def(cut(doc, ...names)[0]));

describe('emptyVector of a blunted vector (#183)', () => {
  it.each([
    ['KpnI', 'GGTACC', '3′ overhang'],
    ['EcoRI', 'GAATTC', '5′ overhang'],
  ])('%s: trim and fill both close', (name, site) => {
    const doc = circle(site);
    for (const how of ['trim', 'fill'] as const) {
      const blunted = linear(doc, name).bluntEnds(how);
      expect(blunted.ends).not.toBeNull();
      const closed = def(emptyVector(blunted));
      expect(closed.isCircular).toBe(true);
      expect(closed.length).toBe(blunted.length);
    }
  });

  it('closes over exactly the bases that were left (trim removes the overhang)', () => {
    const doc = circle('GAATTC');
    const trimmed = linear(doc, 'EcoRI').bluntEnds('trim');
    expect(def(emptyVector(trimmed)).length).toBe(doc.length - 4);
    const filled = linear(doc, 'EcoRI').bluntEnds('fill');
    expect(def(emptyVector(filled)).length).toBe(doc.length + 4);
  });

  it('closes a mixed vector: one sticky end blunted, the other already blunt', () => {
    const doc = SeqDocument.create({
      name: 'p',
      sequence: PAD + 'AAAA' + 'GAATTC' + 'TTTT' + 'CCCGGG' + 'C'.repeat(40),
      topology: 'circular',
    });
    const big = def(cut(doc, 'EcoRI', 'SmaI').find((f) => f.sequence.length > 20));
    for (const how of ['trim', 'fill'] as const) {
      expect(emptyVector(documentFromFragment(big).bluntEnds(how))).not.toBeNull();
    }
  });

  it('closes a cut that wraps the origin of a circle', () => {
    const doc = SeqDocument.create({
      name: 'p',
      sequence: 'TACC' + 'C'.repeat(60) + 'GG',
      topology: 'circular',
    });
    // KpnI GGTACC straddles position 0.
    const blunted = linear(doc, 'KpnI').bluntEnds('trim');
    const closed = def(emptyVector(blunted));
    expect(closed.isCircular).toBe(true);
  });

  it('keeps the enzyme on a blunted end, but only for a cut one', () => {
    const blunted = linear(circle('GGTACC'), 'KpnI').bluntEnds('trim');
    expect(blunted.ends?.left).toEqual({ kind: 'blunt', overhang: '', enzyme: 'KpnI' });
    expect(blunted.ends?.right).toEqual({ kind: 'blunt', overhang: '', enzyme: 'KpnI' });
    // Blunting an already-blunt molecule changes nothing.
    expect(blunted.bluntEnds('fill')).toBe(blunted);
  });

  it('still has no background for a PCR-like molecule with no ends', () => {
    const pcr = SeqDocument.create({
      name: 'pcr',
      sequence: 'ACGT'.repeat(10),
      topology: 'linear',
    });
    expect(emptyVector(pcr)).toBeNull();
  });

  it('keeps the pieces of a cut feature apart in the closed circle', () => {
    const doc = circle('GGTACC');
    for (const how of ['trim', 'fill'] as const) {
      const closed = def(emptyVector(linear(doc, 'KpnI').bluntEnds(how)));
      const features = closed.features.all();
      expect(features).toHaveLength(2);
      expect(features.every((f) => f.origin !== undefined)).toBe(true);
    }
  });
});
