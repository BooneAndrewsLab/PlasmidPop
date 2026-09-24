import { SeqDocument, getEnzyme } from '@/core';
import { parseGenBank, writeGenBank } from '@/io';

import { findCutSites } from './restriction';
import {
  METHYLATED_HOST,
  UNMETHYLATED_HOST,
  blockedByHost,
  cuttableSites,
  describeHost,
  hostMethylationAt,
} from './methylation';

/**
 * pBR322's MscI site at 1,446 sits in CCTGGCCA: the Dcm target CCWGG
 * overlaps it, so DNA from an ordinary strain is not cut there (item 44).
 */
const DCM_BLOCKED = 'AAAACCTGGCCAAAAA';

function sites(sequence: string, enzyme: string) {
  const e = getEnzyme(enzyme);
  if (e === undefined) throw new Error(`no enzyme ${enzyme}`);
  return {
    found: findCutSites(sequence, 'linear', [e]),
    length: (name: string) => (name === enzyme ? e.site.length : 0),
  };
}

describe('cuttableSites', () => {
  it('drops a site the host’s methylation blocks, and keeps it when it does not', () => {
    const { found, length } = sites(DCM_BLOCKED, 'MscI');
    expect(found).toHaveLength(1);
    // The mark is about the sequence and is there either way.
    expect(hostMethylationAt(DCM_BLOCKED, 'linear', found[0] as never, 6)).toEqual(['Dcm']);

    // In a dam+/dcm+ strain the enzyme does not cut.
    expect(cuttableSites(DCM_BLOCKED, 'linear', METHYLATED_HOST, found, length)).toEqual([]);
    // In a dcm− strain, or in DNA made by PCR, it does.
    expect(
      cuttableSites(DCM_BLOCKED, 'linear', { dam: true, dcm: false }, found, length),
    ).toHaveLength(1);
    expect(cuttableSites(DCM_BLOCKED, 'linear', UNMETHYLATED_HOST, found, length)).toHaveLength(1);
  });

  it('leaves an insensitive enzyme alone wherever its site falls', () => {
    // BamHI's GGATCC holds a Dam GATC and BamHI ignores it.
    const { found, length } = sites('AAAAGGATCCAAAA', 'BamHI');
    expect(cuttableSites('AAAAGGATCCAAAA', 'linear', METHYLATED_HOST, found, length)).toEqual(
      found,
    );
  });

  it('reads the host the way the UI and the file say it', () => {
    expect(describeHost(METHYLATED_HOST)).toBe('dam+/dcm+');
    expect(describeHost(UNMETHYLATED_HOST)).toBe('unmethylated');
    expect(describeHost({ dam: true, dcm: false })).toBe('dam+ only');
    expect(blockedByHost({ dam: false, dcm: true }, ['Dam'])).toBe(false);
    expect(blockedByHost({ dam: false, dcm: true }, ['Dam', 'Dcm'])).toBe(true);
  });
});

describe('the host in a GenBank file', () => {
  const doc = SeqDocument.create({ name: 'p1', sequence: DCM_BLOCKED, topology: 'circular' });

  it('says nothing for an ordinary plasmid, and round-trips anything else', () => {
    // The default needs no line: a file without one reads as dam+/dcm+.
    expect(writeGenBank(doc)).not.toContain('PlasmidPop-methylation');
    expect(parseGenBank(writeGenBank(doc)).documents[0]?.methylation).toEqual(METHYLATED_HOST);

    for (const state of [UNMETHYLATED_HOST, { dam: true, dcm: false }, { dam: false, dcm: true }]) {
      const text = writeGenBank(doc.setMethylation(state));
      expect(text).toContain('PlasmidPop-methylation');
      const back = parseGenBank(text).documents[0];
      expect(back?.methylation).toEqual(state);
      // The line is ours, so it does not pile up in the comments.
      expect(back?.metadata.comments.join(' ')).not.toContain('PlasmidPop-methylation');
      expect(writeGenBank(writeBack(text))).toBe(text);
    }
  });

  function writeBack(text: string): SeqDocument {
    const back = parseGenBank(text).documents[0];
    if (back === undefined) throw new Error('no document');
    return back;
  }
});
