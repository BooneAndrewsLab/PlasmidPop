import { parseAbif } from './parseAbif';

interface Tag {
  name: string;
  number: number;
  /** ASCII for a char tag (type 2) */
  text: string;
  /** Instead of `text`: big-endian shorts, a short tag (type 4) */
  shorts?: readonly number[];
}

/** A minimal ABIF file holding char and short tags, enough for PBAS, PCON and a trace. */
function abif(tags: readonly Tag[]): Uint8Array {
  const data = tags.map((t) =>
    t.shorts === undefined
      ? Uint8Array.from(t.text, (c) => c.charCodeAt(0))
      : Uint8Array.from(t.shorts.flatMap((n) => [n >> 8, n & 0xff])),
  );
  const dataSize = data.reduce((n, d) => n + d.length, 0);
  const dirAt = 34 + dataSize;
  const out = new Uint8Array(dirAt + tags.length * 28);
  const view = new DataView(out.buffer);
  out.set([0x41, 0x42, 0x49, 0x46]);
  view.setInt32(6 + 12, tags.length);
  view.setInt32(6 + 20, dirAt);
  let at = 34;
  tags.forEach((t, k) => {
    const bytes = data[k] as Uint8Array;
    out.set(bytes, at);
    const e = dirAt + k * 28;
    for (let c = 0; c < 4; c++) out[e + c] = t.name.charCodeAt(c);
    view.setInt32(e + 4, t.number);
    view.setInt16(e + 8, t.shorts === undefined ? 2 : 4);
    view.setInt16(e + 10, t.shorts === undefined ? 1 : 2);
    view.setInt32(e + 12, t.shorts === undefined ? bytes.length : t.shorts.length);
    view.setInt32(e + 16, bytes.length);
    if (bytes.length <= 4) out.set(bytes, e + 20);
    else view.setInt32(e + 20, at);
    at += bytes.length;
  });
  return out;
}

const q = (...values: number[]): string => String.fromCharCode(...values);

describe('parseAbif PCON fallback (#159)', () => {
  it('reads the qualities of the preferred copy', () => {
    const r = parseAbif(
      abif([
        { name: 'PBAS', number: 1, text: 'ACGT' },
        { name: 'PBAS', number: 2, text: 'ACGA' },
        { name: 'PCON', number: 1, text: q(10, 11, 12, 13) },
        { name: 'PCON', number: 2, text: q(20, 21, 22, 23) },
      ]),
    );
    expect([...(r.documents[0]?.read?.qualities ?? [])]).toEqual([20, 21, 22, 23]);
    expect(r.warnings).toEqual([]);
  });

  it('falls back to PCON1 when PBAS2 is the same bases as PBAS1', () => {
    const r = parseAbif(
      abif([
        { name: 'PBAS', number: 1, text: 'ACGT' },
        { name: 'PBAS', number: 2, text: 'acgt' },
        { name: 'PCON', number: 1, text: q(10, 11, 12, 13) },
      ]),
    );
    expect([...(r.documents[0]?.read?.qualities ?? [])]).toEqual([10, 11, 12, 13]);
    expect(r.warnings).toEqual([]);
  });

  it('gives no qualities when PBAS2 differs from PBAS1 in content, not length', () => {
    const r = parseAbif(
      abif([
        { name: 'PBAS', number: 1, text: 'ACGT' },
        { name: 'PBAS', number: 2, text: 'ACGA' },
        { name: 'PCON', number: 1, text: q(10, 11, 12, 13) },
      ]),
    );
    expect(r.documents[0]?.sequence.toString()).toBe('ACGA');
    expect([...(r.documents[0]?.read?.qualities ?? [])]).toEqual([0, 0, 0, 0]);
    expect(r.warnings.map((w) => w.message)).toEqual(['This AB1 file has no base qualities']);
  });

  it('gives no qualities when only PBAS1 calls exist and PCON2 is the only quality tag', () => {
    const r = parseAbif(
      abif([
        { name: 'PBAS', number: 1, text: 'ACGT' },
        { name: 'PCON', number: 2, text: q(10, 11, 12, 13) },
      ]),
    );
    expect(r.warnings.map((w) => w.message)).toEqual(['This AB1 file has no base qualities']);
  });
});

describe('parseAbif PLOC fallback (#168)', () => {
  /** Four channels of ten samples, in A, C, G, T order. */
  const trace: Tag[] = [
    { name: 'FWO_', number: 1, text: 'ACGT' },
    ...[9, 10, 11, 12].map((n) => ({
      name: 'DATA',
      number: n,
      text: '',
      shorts: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    })),
  ];
  const peaksOf = (tags: readonly Tag[]): number[] | undefined => {
    const r = parseAbif(abif([...trace, ...tags]));
    const t = r.documents[0]?.read?.trace;
    return t === null || t === undefined ? undefined : [...t.peaks];
  };

  it('reads the peaks of the copy the calls come from', () => {
    expect(
      peaksOf([
        { name: 'PBAS', number: 1, text: 'ACGT' },
        { name: 'PBAS', number: 2, text: 'ACGA' },
        { name: 'PLOC', number: 1, text: '', shorts: [1, 3, 5, 7] },
        { name: 'PLOC', number: 2, text: '', shorts: [2, 4, 6, 8] },
      ]),
    ).toEqual([2, 4, 6, 8]);
  });

  it('falls back to PLOC1 when PBAS2 is the same bases as PBAS1', () => {
    expect(
      peaksOf([
        { name: 'PBAS', number: 1, text: 'ACGT' },
        { name: 'PBAS', number: 2, text: 'acgt' },
        { name: 'PLOC', number: 1, text: '', shorts: [1, 3, 5, 7] },
      ]),
    ).toEqual([1, 3, 5, 7]);
  });

  it('shows no trace, rather than the other copy peaks, when PBAS2 differs in content only', () => {
    const r = parseAbif(
      abif([
        ...trace,
        { name: 'PBAS', number: 1, text: 'ACGT' },
        { name: 'PBAS', number: 2, text: 'ACGA' },
        { name: 'PLOC', number: 1, text: '', shorts: [1, 3, 5, 7] },
      ]),
    );
    expect(r.documents[0]?.read?.trace).toBeNull();
    expect(r.warnings.map((w) => w.message)).toContain(
      'The trace of this AB1 file does not line up with its bases, so it is not shown',
    );
  });
});
