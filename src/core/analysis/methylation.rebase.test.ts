import { parseGenBank } from '@/io';
import { readFixture } from '@/test/fixtures';

import { cuttableSites, hostMethylationAt, isHostMethylationSensitive } from './methylation';
import { findCutSites, getEnzyme } from './restriction';

/**
 * Dam/Dcm sensitivity per methylase and per overlap configuration (#135,
 * item 44). The expectations are REBASE's "Effects of overlapping
 * methylation" tables for NEB's enzymes; the cases are the ones the
 * 2026-10-05 correctness audit found wrong.
 */
function marks(sequence: string, enzyme: string, topology: 'linear' | 'circular' = 'linear') {
  const e = getEnzyme(enzyme);
  if (e === undefined) throw new Error(enzyme);
  const sites = findCutSites(sequence, topology, [e]);
  expect(sites).toHaveLength(1);
  return sites.map((s) => hostMethylationAt(sequence, topology, s, e.site.length))[0];
}

const A = 'AAAAAAAAAAAAAAAAAAAAAAAA';

describe('the wrong methylase', () => {
  it.each([
    ['BstXI', `${A}CCAGATCAGTGG${A}`],
    ['AlwNI', `${A}CAGATCCTG${A}`],
    ['PflMI', `${A}CCAGATCATGG${A}`],
    ['SfiI', `${A}GGCCAGATCGGCC${A}`],
  ])('does not call a GATC inside the N of %s a Dam block', (enzyme, sequence) => {
    expect(marks(sequence, enzyme)).toEqual([]);
  });
});

describe('overlap on one side only is cut', () => {
  it.each([
    ['SfoI', `${A}GGCGCCAGG${A}`],
    ['BstXI', `${A}CCAGGAAAATGG${A}`],
    ['SfiI', `${A}GGCCAAAAAGGCCAGG${A}`],
    // lambda @30472, pBR322 @133 and lambda @30043 in the audit
    ['BsaHI', `${A}ACCAGGGGCGTC${A}`],
    ['FokI', `${A}CCCTGGGGATG${A}`],
  ])('%s', (enzyme, sequence) => {
    expect(marks(sequence, enzyme)).toEqual([]);
  });

  it('blocks SfoI and BstXI with CCWGG on both sides', () => {
    expect(marks(`${A}CCAGGCGCCAGG${A}`, 'SfoI')).toEqual(['Dcm']);
    expect(marks(`${A}CCAGGAACCTGG${A}`, 'BstXI')).toEqual(['Dcm']);
  });
});

describe('the controls REBASE blocks', () => {
  it.each([
    ['XbaI', `${A}TCTAGATC${A}`, 'Dam'],
    ['XbaI', `${A}GATCTAGA${A}`, 'Dam'],
    ['BsaI', `${A}CCAGGTCTC${A}`, 'Dcm'],
    ['MscI', `${A}TGGCCAGG${A}`, 'Dcm'],
    // the same DNA from the other strand
    ['MscI', `${A}CCTGGCCA${A}`, 'Dcm'],
    ['FseI', `${A}CCAGGCCGGCCAGG${A}`, 'Dcm'],
  ])('%s in %s', (enzyme, sequence, methylase) => {
    expect(marks(sequence, enzyme)).toEqual([methylase]);
  });
});

describe('Dam and Dcm are told apart', () => {
  it('blocks BspEI by Dam and not by Dcm, and MscI the other way round', () => {
    expect(marks(`${A}TCCGGATC${A}`, 'BspEI')).toEqual(['Dam']);
    expect(marks(`${A}TGGCCAGG${A}`, 'MscI')).toEqual(['Dcm']);
    expect(marks(`${A}TGGCCAGATCAA${A}`, 'MscI')).toEqual([]);
  });
});

describe('a site on the reverse strand', () => {
  it('is read as the enzyme spells it', () => {
    // BsaI GGTCTC: Dcm methylates the bottom base opposite its first G when
    // CCWGG ends there, CCAGGTCTC. Found as GAGACC on the top strand in
    // GAGACCTGG, it is the same configuration mirrored.
    expect(marks(`${A}CCAGGTCTC${A}`, 'BsaI')).toEqual(['Dcm']);
    expect(marks(`${A}GAGACCTGG${A}`, 'BsaI')).toEqual(['Dcm']);
    expect(marks(`${A}GAGACCAAA${A}`, 'BsaI')).toEqual([]);
    expect(marks(`${A}AAAGAGACC${A}`, 'BsaI')).toEqual([]);
  });
});

describe('FokI', () => {
  it('is not Dcm-sensitive: REBASE’s impairment is M.HpaII and M.MspI, not Dcm', () => {
    // Decided on #135: the "impaired" rows in REBASE for the base Dcm
    // methylates are tests with M.HpaII (50% cleaved) and M.SssI (cut).
    expect(isHostMethylationSensitive('FokI')).toBe(false);
  });
});

describe('on pBR322 (J01749) grown dam+/dcm+', () => {
  const record = parseGenBank(readFixture('J01749.gb')).documents[0];
  const seq = record?.sequence.toString().toUpperCase() ?? '';
  const cuttable = (name: string) => {
    const e = getEnzyme(name);
    if (e === undefined) throw new Error(name);
    const all = findCutSites(seq, 'circular', [e]);
    const kept = cuttableSites(seq, 'circular', { dam: true, dcm: true }, all, () => e.site.length);
    return [all.length, kept.length];
  };

  it('keeps all 12 FokI sites, the one in CCTGGATG at 133 included', () => {
    expect(seq.slice(127, 137)).toBe('ACCCTGGATG');
    expect(cuttable('FokI')).toEqual([12, 12]);
  });

  it('still drops the MscI site inside CCTGG', () => {
    expect(cuttable('MscI')).toEqual([1, 0]);
  });
});
