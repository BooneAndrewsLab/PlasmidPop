import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SeqDocument } from '@/core';
import { parseGenBank } from '@/io';
import { readFixture } from '@/test/fixtures';
import { randomDna, seededRandom } from '@/test/random';

import { reverseComplement } from '../sequence';
import {
  type CloningInsert,
  designCloningEnds,
  readExtraBases,
  resolveVectorRegion,
  scanForCloningNow,
} from './cloningEnds';
import { designGoldenGatePart } from './goldenGateEnds';

/**
 * `extra5` and `extra3` (item 141, packet 5): bases between a primer's tail
 * and its annealing part. Empty, they change nothing: the literals below were
 * taken from the designers before the settings existed.
 */

function doc(name: string, file: string): SeqDocument {
  const d = parseGenBank(readFixture(file)).documents[0];
  if (d === undefined) throw new Error(`${name}: no record`);
  return d;
}

const pUC19 = doc('pUC19', 'L09137.gb');
const U49845 = doc('U49845', 'U49845.gb');
const destination = (() => {
  const text = readFileSync(
    join(__dirname, '../../../docs/tutorials/files/pGG-Destination.gb'),
    'utf8',
  );
  const d = parseGenBank(text).documents[0];
  if (d === undefined) throw new Error('pGG-Destination: no record');
  return d;
})();

const insert: CloningInsert = {
  document: U49845,
  range: { start: 686, end: 836 },
  strand: 'forward',
  name: 'AXL2',
};
const PAIR = { forward: 'EcoRI', reverse: 'BamHI' };

function restriction(settings: { extra5?: string; extra3?: string } = {}) {
  const region = resolveVectorRegion(pUC19, { start: 395, end: 452 });
  const scans = scanForCloningNow(pUC19, insert);
  return designCloningEnds(
    { vector: pUC19, region, insert, flipped: false, scans },
    PAIR,
    settings,
  );
}

const BASES = 'ATG' + randomDna(seededRandom(7), 147);
const part: CloningInsert = {
  document: SeqDocument.create({ name: 'g', sequence: BASES }),
  range: { start: 0, end: BASES.length },
  strand: 'forward',
  name: 'g',
};

function goldenGate(settings: { extra5?: string; extra3?: string } = {}) {
  return designGoldenGatePart(
    { insert: part, destination },
    { enzyme: 'BsaI', left: 'AATG', right: 'GCTT', ...settings },
  );
}

describe('empty extra bases change no output', () => {
  const warningText = (w: readonly { readonly text: string }[]): string[] => w.map((x) => x.text);

  it('restriction ends: oligos, amplicon, segments and warnings are as before', () => {
    for (const d of [restriction(), restriction({ extra5: '', extra3: '' })]) {
      expect(d.forward.sequence).toBe('gttctggaattcATGACACAGCTTCAGATTTCATTATTG');
      expect(d.reverse.sequence).toBe('ctaataggatccATTGGAAATTTGAAATGTAAACGATTC');
      expect(d.amplicon).toBe(
        'GTTCTGGAATTCATGACACAGCTTCAGATTTCATTATTGctgacagctactatatcactactccatctagtagtggccacgccctatgaggcatatcctatcggaaaacaataccccccagtggcaagagtcaatGAATCGTTTACATTTCAAATTTCCAATGGATCCTATTAG',
      );
      expect(d.forward.segments).toEqual({
        padding: 'GTTCTG',
        site: 'GAATTC',
        spacer: '',
        annealing: 'ATGACACAGCTTCAGATTTCATTATTG',
      });
      expect(warningText(d.warnings)).toEqual([
        "No annealing part at the insert's ends meets the settings; the nearest (GC content below 35%; Tm below 55 °C) is used.",
      ]);
      expect(d.simulate().product?.length).toBe(2821);
    }
  });

  it('Golden Gate part: oligos, amplicon, part, frame and warnings are as before', () => {
    for (const d of [goldenGate(), goldenGate({ extra5: '', extra3: '' })]) {
      expect(d.forward.sequence).toBe('ggagatggtctccaatgAATGGCCAGGCATGACCGC');
      expect(d.reverse.sequence).toBe('tccgagggtctctaagcGGTTAATTTTTGGGTCGCTAACTGAC');
      expect(d.amplicon).toBe(
        'GGAGATGGTCTCCAATGAATGGCCAGGCATGACCGCTATAAACGTATGGGTGTTAACCAATCCCTGGCCAATCAGCAGTGTGTAGGTTTGTTGTAGCGGTTGTCGGGCAAATTGAGGGTCTGTGTATGGACATTGGTGGTCAGTTAGCGACCCAAAAATTAACCGCTTAGAGACCCTCGGA',
      );
      expect(d.part).toBe(
        'AATGAATGGCCAGGCATGACCGCTATAAACGTATGGGTGTTAACCAATCCCTGGCCAATCAGCAGTGTGTAGGTTTGTTGTAGCGGTTGTCGGGCAAATTGAGGGTCTGTGTATGGACATTGGTGGTCAGTTAGCGACCCAAAAATTAACCGCTT',
      );
      expect(d.frame).toEqual({ coding: true, length: 150, inFrame: true, stopped: false });
      expect(d.forward.segments).toEqual({
        padding: 'GGAGAT',
        site: 'GGTCTC',
        spacer: 'CAATG',
        annealing: 'AATGGCCAGGCATGACCGC',
      });
      expect(warningText(d.warnings)).toEqual([
        "No annealing part at the part's ends meets the settings; the nearest (Self-dimer, ΔG −6.0 kcal/mol; Run of 5 identical bases) is used.",
      ]);
    }
  });
});

describe('extra bases', () => {
  it('restriction: extra5 sits before the annealing part, extra3 reads on after the insert', () => {
    const base = restriction();
    const d = restriction({ extra5: 'gccacc', extra3: 'taa' });
    expect(d.problem).toBeNull();
    const f = d.forward;
    expect(f.segments.extra).toBe('GCCACC');
    expect(f.sequence).toBe(
      (f.segments.padding + f.segments.site + f.segments.spacer + 'GCCACC').toLowerCase() +
        f.segments.annealing.toUpperCase(),
    );
    expect(d.reverse.segments.extra).toBe(reverseComplement('TAA'));
    expect(d.amplicon.length).toBe(base.amplicon.length + 9);
    expect(d.amplicon.toUpperCase()).toContain('GAATTCGCCACCATGACACAG');
    expect(d.amplicon.toUpperCase()).toContain('TAAGGATCC');
    const product = d.simulate().product;
    expect(product).not.toBeNull();
    expect(product?.length).toBe(2821 + 9);
    expect(product?.sequence.toString().toUpperCase()).toContain('GAATTCGCCACCATGACACAG');
  });

  it('Golden Gate: the part carries the extra bases and the frame counts the ones it reads', () => {
    const d = goldenGate({ extra5: 'CC', extra3: 'TAA' });
    expect(d.problem).toBeNull();
    expect(d.part.startsWith('AATGCC')).toBe(true);
    expect(d.part.endsWith('TAAGCTT')).toBe(true);
    // The overhang spells the start codon, so the reading starts at its A: ATG 3 + extra 2 + body 147 + extra 3 = 155.
    expect(d.frame.length).toBe(155);
    expect(d.forward.segments.extra).toBe('CC');
    expect(d.amplicon.toUpperCase()).toContain('GGTCTCCAATGCCAATGG');
    const sim = d.simulate();
    expect(sim.amplicon?.sequence.toString().toUpperCase()).toBe(d.amplicon.toUpperCase());
  });

  it('refuses bases that are not A, C, G or T, in both designers', () => {
    expect(readExtraBases(' gcc acc ', 'extra5')).toEqual({ bases: 'GCCACC', problem: null });
    expect(readExtraBases('GCN', 'extra3').problem).toMatch(
      /extra3 bases may only be A, C, G or T/,
    );
    expect(restriction({ extra5: 'GXC' }).problem).toMatch(/extra5/);
    expect(goldenGate({ extra3: 'T-A' }).problem).toMatch(/extra3/);
  });
});
