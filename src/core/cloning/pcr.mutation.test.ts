import { SeqDocument, reverseComplement } from '@/core';

import { type PcrPrimer, pcr } from './pcr';

/** A fixed pseudo-random template, so every primer site is unique by accident. */
function template(length: number, seed = 20260922): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

/** `text` with the base at `at` changed to another. */
function mutate(text: string, at: number): string {
  return text.slice(0, at) + (text.charAt(at) === 'A' ? 'C' : 'A') + text.slice(at + 1);
}

function fwd(text: string, start: number, end: number, name = 'F', tail = ''): PcrPrimer {
  return { name, sequence: tail + text.slice(start, end) };
}

function rev(text: string, start: number, end: number, name = 'R', tail = ''): PcrPrimer {
  return { name, sequence: tail + reverseComplement(text.slice(start, end)) };
}

describe('pcr, the order of products', () => {
  it('counts a mismatch under the reverse primer against its product', () => {
    // The exact pair is found first here, and still comes first.
    const text = template(3000);
    const strip = SeqDocument.create({ name: 'strip', sequence: text });
    const result = pcr(strip, [
      fwd(text, 100, 122),
      rev(text, 300, 322),
      { name: 'R2', sequence: mutate(reverseComplement(text.slice(500, 522)), 10) },
    ]);
    expect(result.products.map((p) => [p.reverse.name, p.length, p.mismatches])).toEqual([
      ['R', 222, 0],
      ['R2', 422, 1],
    ]);
  });

  it('puts the shorter of two exact products first, whichever was found first', () => {
    const text = template(3000);
    const strip = SeqDocument.create({ name: 'strip', sequence: text });
    const result = pcr(strip, [
      fwd(text, 100, 122, 'F1'),
      fwd(text, 300, 322, 'F2'),
      rev(text, 500, 522),
    ]);
    expect(result.products.map((p) => [p.forward.name, p.length])).toEqual([
      ['F2', 222],
      ['F1', 422],
    ]);
    // Several are numbered from the one name, from 1.
    expect(result.products.map((p) => p.document.name)).toEqual([
      'strip PCR product 1',
      'strip PCR product 2',
    ]);
  });

  it('builds twelve products by default, and counts the rest', () => {
    // Four copies of the forward site and four of the reverse: sixteen pairs.
    const base = template(4000);
    const f = base.slice(3000, 3022);
    const r = base.slice(3500, 3522);
    let text = base.slice(0, 2900);
    for (const at of [100, 300, 500, 700]) text = text.slice(0, at) + f + text.slice(at + 22);
    for (const at of [2000, 2200, 2400, 2600]) text = text.slice(0, at) + r + text.slice(at + 22);
    const strip = SeqDocument.create({ name: 'strip', sequence: text });
    const primers = [
      { name: 'F', sequence: f },
      { name: 'R', sequence: reverseComplement(r) },
    ];
    const all = pcr(strip, primers);
    expect(all.products).toHaveLength(12);
    expect(all.hidden).toBe(4);
    const three = pcr(strip, primers, { maxProducts: 3 });
    expect(three.products.map((p) => p.length)).toEqual([1322, 1522, 1522]);
    expect(three.hidden).toBe(13);
  });

  it('lists every site in template order, whichever primer came first', () => {
    const text = template(3000);
    const strip = SeqDocument.create({ name: 'strip', sequence: text });
    const sites = pcr(strip, [fwd(text, 500, 522), rev(text, 100, 122)]).sites;
    expect(sites.map((s) => [s.name, s.range.start])).toEqual([
      ['R', 100],
      ['F', 500],
    ]);
  });
});

describe('pcr, its limits', () => {
  it('reaches 20 kb with the default polymerase, and no further', () => {
    const text = template(20_100, 23);
    const long = SeqDocument.create({ name: 'long', sequence: text });
    // A primer turns up by chance somewhere on 40 kb of strand, so a stray
    // product comes too; what matters here is the designed one.
    const reach = pcr(long, [fwd(text, 0, 22), rev(text, 19_978, 20_000)]);
    const past = pcr(long, [fwd(text, 0, 22), rev(text, 19_979, 20_001)]);
    expect(reach.products.map((p) => p.length)).toContain(20_000);
    expect(past.products.map((p) => p.length)).not.toContain(20_001);
    expect(past.tooLong).toBe(reach.tooLong + 1);
  });

  it('amplifies nothing from primers on top of each other on a circle, however long each is', () => {
    // Only when the 5′ ends overlap by less than *both* annealing parts do
    // the primers point away from each other and copy the whole circle.
    // Otherwise one 3′ end is inside the other's site: they overlap.
    const text = template(3000);
    const plasmid = SeqDocument.create({ name: 'pTest', sequence: text, topology: 'circular' });
    const pairs: [PcrPrimer, PcrPrimer][] = [
      // Forward 22 bases, reverse 30, 25 apart and 22 apart.
      [fwd(text, 100, 122), rev(text, 95, 125)],
      [fwd(text, 100, 122), rev(text, 92, 122)],
      // Forward 30 bases, reverse 22.
      [fwd(text, 100, 130), rev(text, 103, 125)],
      [fwd(text, 100, 130), rev(text, 100, 122)],
    ];
    for (const pair of pairs) {
      const result = pcr(plasmid, pair);
      expect(result.products).toHaveLength(0);
      expect(result.problem).toMatch(/overlap each other/);
    }
  });
});

describe('pcr, what it writes down', () => {
  it('describes a tailed, mismatched product in its metadata, and each primer in a note', () => {
    const text = template(3000);
    const strip = SeqDocument.create({ name: 'strip', sequence: text });
    const forward: PcrPrimer = { name: 'F', sequence: `GAATTC${mutate(text.slice(100, 122), 8)}` };
    const reverse = rev(text, 1400, 1422, 'R', 'TTTT');
    const [product] = pcr(strip, [forward, reverse]).products;
    expect(product?.forward.tail).toBe('GAATTC');
    expect(product?.reverse.tail).toBe('TTTT');
    expect(product?.document.metadata).toMatchObject({
      moleculeType: 'DNA',
      division: 'SYN',
      description:
        '1,332 bp PCR product of strip with F and R: 1,322 bp of template, 10 bp of 5′ tail, 1 primer mismatch carried in',
    });
    const notes = product?.document.features
      .all()
      .filter((f) => f.type === 'primer_bind')
      .map((f) => f.qualifiers);
    expect(notes).toEqual([
      [{ name: 'note', value: `PCR primer: ${forward.sequence} (6 bp 5′ tail)` }],
      [{ name: 'note', value: `PCR primer: ${reverse.sequence} (4 bp 5′ tail)` }],
    ]);
  });

  it('describes an exact product, and a Taq one with mismatches under both primers', () => {
    const text = template(3000);
    const strip = SeqDocument.create({ name: 'strip', sequence: text });
    const [exact] = pcr(strip, [fwd(text, 100, 122), rev(text, 500, 522)]).products;
    expect(exact?.document.metadata.description).toBe(
      '422 bp PCR product of strip with F and R: 422 bp of template',
    );
    expect(
      exact?.document.features
        .all()
        .filter((f) => f.type === 'primer_bind')
        .map((f) => f.qualifiers),
    ).toEqual([
      [{ name: 'note', value: `PCR primer: ${text.slice(100, 122)}` }],
      [{ name: 'note', value: `PCR primer: ${reverseComplement(text.slice(500, 522))}` }],
    ]);
    const [taq] = pcr(
      strip,
      [
        { name: 'F', sequence: mutate(text.slice(100, 122), 8) },
        { name: 'R', sequence: mutate(reverseComplement(text.slice(500, 522)), 8) },
      ],
      { polymerase: 'taq' },
    ).products;
    // The length is the product's before its A; the note says the A is there.
    expect(taq?.document.metadata.description).toBe(
      '422 bp PCR product of strip with F and R: 422 bp of template, 2 primer mismatches carried in, A-tailed by Taq',
    );
  });

  it('says which primers anneal nowhere, one, some or all of them', () => {
    const text = template(3000);
    const strip = SeqDocument.create({ name: 'strip', sequence: text });
    const polyA = { name: 'R', sequence: 'A'.repeat(24) };
    const polyC = { name: 'R2', sequence: 'C'.repeat(24) };
    expect(pcr(strip, [polyA, polyC]).problem).toBe(
      'Neither primer anneals to strip. The 3′ end is what has to match; a 5′ tail is free.',
    );
    expect(pcr(strip, [fwd(text, 100, 122), polyA, polyC]).problem).toBe(
      'R and R2 do not anneal to strip, so there is nothing for the other primer to meet.',
    );
    // Two reverse primers are as stuck as two forward ones.
    expect(pcr(strip, [rev(text, 100, 122), rev(text, 500, 522, 'R2')]).problem).toMatch(
      /^Both primers anneal to the same strand of strip/,
    );
  });
});
