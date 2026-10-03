import {
  alignEitherStrand,
  createFeature,
  rangeSegment,
  reverseComplement,
  SeqDocument,
} from '@/core';
import { describe, expect, it } from 'vitest';

import {
  abbreviateBases,
  changeText,
  differenceRows,
  differencesTsv,
  effectText,
  featureText,
  positionText,
  qualityText,
  samplesText,
} from './alignmentDifferences';
import { buildFrames } from './alignmentResidues';
import { differenceRegions, stackAlignments } from './alignmentStack';
import { annotationsOf } from './alignmentTrack';
import { finishReadAlignment, prepareReadAlignment } from './readAlignment';

// ATG AAA GGG TTT CCC TAA at 2..20, then a tail
const sequence = 'GCATGAAAGGGTTTCCCTAAGCGCGATCGATTAGC';

function setup(
  reads: string[],
  opts: { reference?: string; strand?: 'forward' | 'reverse'; range?: [number, number] } = {},
) {
  const reference = opts.reference ?? sequence;
  const ref = { sequence: reference, offset: 0, wrap: null };
  const samples = reads.map((read, i) => {
    const prepared = prepareReadAlignment(ref, { sequence: read, read: null }, null);
    if (!prepared.ok) throw new Error(prepared.message);
    const { job } = prepared;
    return {
      name: `r${i}`,
      result: finishReadAlignment(job, alignEitherStrand(job.a, job.b, { mode: 'local' })),
    };
  });
  const stack = stackAlignments(ref, samples);
  const doc = SeqDocument.create({ sequence: reference, topology: 'linear' });
  const [start, end] = opts.range ?? [2, 20];
  const feature = createFeature({
    type: 'CDS',
    name: 'g',
    strand: opts.strand ?? 'forward',
    segments: [rangeSegment(start, end)],
  });
  const features = [feature];
  const frames = buildFrames(stack, doc, features, 0);
  const regions = differenceRegions(stack.differences);
  return { stack, rows: differenceRows(stack, regions, annotationsOf(features, []), frames, doc) };
}

function one<T>(items: readonly T[]): T {
  const [first] = items;
  if (first === undefined) throw new Error('no row');
  return first;
}

function mutate(text: string, at: number, base: string): string {
  return text.slice(0, at) + base + text.slice(at + 1);
}

describe('differenceRows', () => {
  it('calls a changed third base silent and gives its 1-based position', () => {
    const { rows } = setup([mutate(sequence, 7, 'G')]);
    const row = one(rows);
    expect(rows).toHaveLength(1);
    expect(positionText(row)).toBe('8');
    expect(changeText(row)).toBe('A→G');
    expect(effectText(row)).toBe('silent');
    expect(featureText(row)).toBe('CDS g');
    expect(samplesText(row)).toBe('r0');
  });

  it('names a missense change with the residue number', () => {
    const { rows } = setup([mutate(sequence, 5, 'C')]);
    expect(effectText(one(rows))).toBe('p.K2Q');
  });

  it('names a nonsense change and a lost stop', () => {
    expect(effectText(one(setup([mutate(sequence, 5, 'T')]).rows))).toBe('p.K2*');
    // TAA -> CAA at the last codon: stop lost, read as Q at residue 6.
    expect(effectText(one(setup([mutate(sequence, 17, 'C')]).rows))).toBe('p.*6Q');
  });

  it('calls a one-base deletion in a CDS a frameshift and a codon-sized one in-frame', () => {
    const del1 = setup([sequence.slice(0, 9) + sequence.slice(10)]);
    expect(effectText(one(del1.rows))).toBe('frameshift');
    const del3 = setup([sequence.slice(0, 9) + sequence.slice(12)]);
    expect(effectText(one(del3.rows))).toBe('in-frame indel');
  });

  it('reads a reverse-strand CDS after reverse complementing', () => {
    // The same gene on the other strand: the forward base 5 is base 29 here, complemented.
    const reference = reverseComplement(sequence);
    const at = sequence.length - 1 - 5;
    const read = mutate(reference, at, 'G'); // forward A->C
    const { rows } = setup([read], { reference, strand: 'reverse', range: [15, 33] });
    expect(effectText(one(rows))).toBe('p.K2Q');
    expect(positionText(one(rows))).toBe(`${at + 1}`);
    expect(changeText(one(rows))).toBe('T→G');
  });

  it('puts a difference outside any feature as none, with no effect', () => {
    const { rows } = setup([mutate(sequence, 30, 'A')]);
    expect(featureText(one(rows))).toBe('none');
    expect(effectText(one(rows))).toBe('');
  });

  it('lists every sample that carries a region and each one’s own change', () => {
    const { rows } = setup([mutate(sequence, 5, 'C'), mutate(sequence, 5, 'G'), sequence]);
    expect(rows).toHaveLength(1);
    expect(samplesText(one(rows))).toBe('r0, r1');
    expect(changeText(one(rows))).toBe('A→C, A→G');
    expect(effectText(one(rows))).toBe('r0: p.K2Q; r1: p.K2E');
  });

  it('puts an insertion after the base before it and shows no quality without any', () => {
    const { rows } = setup([sequence.slice(0, 25) + 'TT' + sequence.slice(25)]);
    expect(changeText(one(rows))).toBe('-→TT');
    expect(positionText(one(rows))).toBe('25');
    expect(qualityText(one(rows))).toBe('');
  });

  it('has no feature or effect without a document', () => {
    const { stack } = setup([mutate(sequence, 5, 'C')]);
    const rows = differenceRows(stack, differenceRegions(stack.differences), [], [], null);
    expect(featureText(one(rows))).toBe('none');
    expect(effectText(one(rows))).toBe('');
  });
});

describe('differencesTsv', () => {
  it('writes a header and one tab-separated line per region', () => {
    const { rows } = setup([mutate(sequence, 5, 'C'), mutate(sequence, 30, 'A')]);
    const lines = differencesTsv(rows).split('\n');
    expect(lines[0]).toBe('Position\tChange\tSamples\tFeature\tQuality\tProtein effect');
    expect(lines[1]).toBe('6\tA→C\tr0\tCDS g\t\tp.K2Q');
    expect(lines[2]).toBe('31\tT→A\tr1\tnone\t\t');
    expect(lines).toHaveLength(3);
  });
});

describe('abbreviateBases', () => {
  it('keeps short runs and cuts long ones to the ends and a length', () => {
    expect(abbreviateBases('ACGT')).toBe('ACGT');
    expect(abbreviateBases('A'.repeat(8) + 'C'.repeat(30) + 'G'.repeat(8))).toBe(
      'AAAAAAAA…GGGGGGGG (46)',
    );
  });
});
