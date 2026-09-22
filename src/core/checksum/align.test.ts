import { describe, expect, it } from 'vitest';

import { SeqDocument } from '../document';
import { createFeature, rangeSegment } from '../features';
import { reverseComplement } from '../sequence';

import {
  type MoleculeAlignment,
  alignToDocument,
  applyAlignment,
  isIdentityAlignment,
} from './align';
import { documentChecksum } from './seguid';

/** Long enough that a 32-base anchor is not most of it, and not repetitive. */
const PLASMID =
  'ATGCGTACGTTAGCCATGGATCCGAATTCAAGCTTGGTACCGAGCTCGGATCCACTAGTAACGGCCGCCAGTGTGCTGGAATTCTGCAGATATCCATCACACTGGCGGCCGCTCGAGCATGCATCTAGAGGGCCCAATTCGCCCTATAGTGAGTCGTATTACAATTCACTGGCCGTCGTTTTACAACGTCGTGACTGGGAAAACCCTGGCGTTACCCAACTTAATCGCCTTGCAGCACATCCCCCTTTCGCCAGCTGGCGTAATAGCGAAGAGGCCCGCACCGATCGCCCTTCCCAACAGTTGCGCAGCCTGAATGGCGAATGG';

function required(alignment: MoleculeAlignment | null): MoleculeAlignment {
  if (alignment === null) throw new Error('expected an alignment');
  return alignment;
}

const circular = (sequence: string): SeqDocument =>
  SeqDocument.create({ sequence, topology: 'circular' });

describe('alignToDocument', () => {
  it('finds the rotation between two writings of the same plasmid', () => {
    const mine = circular(PLASMID);
    const theirs = circular(PLASMID).setOrigin(137);
    const alignment = alignToDocument(mine, theirs);
    expect(alignment).not.toBeNull();
    expect(alignment?.exact).toBe(true);
    expect(applyAlignment(theirs, required(alignment)).sequence.toString()).toBe(PLASMID);
  });

  it('finds the strand as well as the rotation', () => {
    const mine = circular(PLASMID);
    const theirs = circular(PLASMID).setOrigin(200).reverseComplement();
    const alignment = alignToDocument(mine, theirs);
    expect(alignment?.exact).toBe(true);
    expect(alignment?.flipped).toBe(true);
    expect(applyAlignment(theirs, required(alignment)).sequence.toString()).toBe(PLASMID);
  });

  it('asks for nothing when the two already read the same way', () => {
    const alignment = alignToDocument(circular(PLASMID), circular(PLASMID));
    expect(alignment).not.toBeNull();
    expect(isIdentityAlignment(required(alignment))).toBe(true);
  });

  it('lines up a rotated plasmid that also differs, where the checksums cannot', () => {
    // The case anyone actually compares: the same construct, written from
    // another origin, with an edit in it. No checksum agrees here.
    const mine = circular(PLASMID);
    const edited = circular(`${PLASMID.slice(0, 40)}GGGGGGGG${PLASMID.slice(48)}`).setOrigin(90);
    expect(documentChecksum(mine)?.text).not.toBe(documentChecksum(edited)?.text);
    const alignment = alignToDocument(mine, edited);
    expect(alignment?.exact).toBe(false);
    expect(alignment?.origin).toBe(PLASMID.length - 90);
    expect(applyAlignment(edited, required(alignment)).sequence.toString()).toBe(
      `${PLASMID.slice(0, 40)}GGGGGGGG${PLASMID.slice(48)}`,
    );
  });

  it('turns a linear molecule over but never rotates it', () => {
    const mine = SeqDocument.create({ sequence: PLASMID });
    const theirs = SeqDocument.create({ sequence: reverseComplement(PLASMID) });
    const alignment = alignToDocument(mine, theirs);
    expect(alignment).toEqual({ origin: 0, flipped: true, exact: true });
    expect(applyAlignment(theirs, required(alignment)).sequence.toString()).toBe(PLASMID);
  });

  it('says nothing about two unrelated sequences', () => {
    // Same length, same base composition, nothing in common but chance.
    let shuffled = '';
    for (let i = 0; i < PLASMID.length; i++) {
      shuffled += PLASMID.charAt((i * 137 + 11) % PLASMID.length);
    }
    expect(alignToDocument(circular(PLASMID), circular(shuffled))).toBeNull();
  });

  it('does not line up a plasmid with a linear molecule of the same bases', () => {
    expect(
      alignToDocument(circular(PLASMID), SeqDocument.create({ sequence: PLASMID })),
    ).toBeNull();
  });

  it('is not fooled by one chance stretch in common', () => {
    const shared = PLASMID.slice(0, 40);
    const other = circular(`${shared}${'ACCTGATCGA'.repeat(30)}`);
    expect(alignToDocument(circular(PLASMID), other)).toBeNull();
  });

  it('keeps the features of the file it turns', () => {
    const theirs = SeqDocument.create({
      sequence: PLASMID,
      topology: 'circular',
      features: [
        createFeature({
          id: 'f1',
          type: 'CDS',
          name: 'test',
          segments: [rangeSegment(10, 40)],
        }),
      ],
    }).setOrigin(137);
    const alignment = alignToDocument(circular(PLASMID), theirs);
    const turned = applyAlignment(theirs, required(alignment));
    expect(turned.features.all()[0]?.segments[0]).toEqual(rangeSegment(10, 40));
  });
});
