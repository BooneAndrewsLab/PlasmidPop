import { alignEitherStrand, createFeature, rangeSegment, SeqDocument } from '@/core';
import { describe, expect, it } from 'vitest';

import { buildFrames, Change, codonSpan, residueOf } from './alignmentResidues';
import { stackAlignments } from './alignmentStack';
import { finishReadAlignment, prepareReadAlignment } from './readAlignment';

// ATG AAA GGG TTT CCC TAA, then a tail
const sequence = 'GCATGAAAGGGTTTCCCTAAGCGCGATCGATTAGC';

function stackOf(reads: string[], reference = sequence) {
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
  return stackAlignments(ref, samples);
}

function docOf(strand: 'forward' | 'reverse' = 'forward', text = sequence) {
  const doc = SeqDocument.create({ sequence: text, topology: 'linear' });
  const feature = createFeature({
    type: 'CDS',
    name: 'g',
    strand,
    segments: [rangeSegment(2, 20)],
  });
  return { doc, features: [feature] };
}

function residues(read: string) {
  const stack = stackOf([read]);
  const { doc, features } = docOf();
  const [frame] = buildFrames(stack, doc, features, 0);
  const row = stack.rows[0];
  if (frame === undefined || row === undefined) throw new Error('no frame');
  return { frame, residues: frame.codons.map((c) => residueOf(frame, c, row)) };
}

describe('buildFrames', () => {
  it('reads the CDS codon by codon', () => {
    const stack = stackOf([sequence]);
    const { doc, features } = docOf();
    const [frame] = buildFrames(stack, doc, features, 0);
    expect(frame?.codons.map((c) => c.reference).join('')).toBe('MKGFP*');
    expect(frame?.codons.map((c) => codonSpan(c).start)).toEqual([2, 5, 8, 11, 14, 17]);
  });

  it('skips features that are not CDS', () => {
    const stack = stackOf([sequence]);
    const { doc } = docOf();
    const gene = createFeature({
      type: 'gene',
      name: 'g',
      strand: 'forward',
      segments: [rangeSegment(2, 20)],
    });
    expect(buildFrames(stack, doc, [gene], 0)).toEqual([]);
  });
});

describe('residueOf', () => {
  it('marks an identical read as the same', () => {
    const { residues: r } = residues(sequence);
    expect(r.map((x) => x.letter).join('')).toBe('MKGFP*');
    expect(r.every((x) => x.change === Change.Same)).toBe(true);
  });

  it('tells synonymous from missense', () => {
    // AAA→AAG (K, synonymous); GGG→GAG (G→E, missense)
    const read = sequence.slice(0, 5) + 'AAG' + 'GAG' + sequence.slice(11);
    const { residues: r } = residues(read);
    expect(r[1]).toEqual({ letter: 'K', change: Change.Synonymous });
    expect(r[2]).toEqual({ letter: 'E', change: Change.Missense });
  });

  it('marks a gained stop and a lost one', () => {
    // TTT→TAA gains a stop; TAA→CAA loses it
    const read =
      sequence.slice(0, 11) + 'TAA' + sequence.slice(14, 17) + 'CAA' + sequence.slice(20);
    const { residues: r } = residues(read);
    expect(r[3]).toEqual({ letter: '*', change: Change.Nonsense });
    expect(r[5]).toEqual({ letter: 'Q', change: Change.StopLost });
  });

  it('marks a deletion inside a codon as an indel', () => {
    const read = sequence.slice(0, 9) + sequence.slice(10);
    const { residues: r } = residues(read);
    expect(r.some((x) => x.change === Change.Indel)).toBe(true);
  });

  it('is blank where the read does not reach', () => {
    const { residues: r } = residues(sequence.slice(0, 12));
    expect(r[5]).toEqual({ letter: ' ', change: Change.Blank });
  });

  it('reads a reverse-strand CDS through the complement', () => {
    const rc = 'GCTAATCGATCGCGCTTAGGGAAACCCTTTCATGC';
    const stack = stackOf([rc], rc);
    const { doc, features } = docOf('reverse', rc);
    const [frame] = buildFrames(stack, doc, features, 0);
    const row = stack.rows[0];
    if (frame === undefined || row === undefined) throw new Error('no frame');
    expect(frame.codons.map((c) => residueOf(frame, c, row).letter).join('')).toBe(
      frame.codons.map((c) => c.reference).join(''),
    );
  });
});
