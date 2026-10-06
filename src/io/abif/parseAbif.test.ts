import { parseAbif } from './parseAbif';

interface Tag {
  name: string;
  number: number;
  /** ASCII for a char tag (type 2) */
  text: string;
}

/** A minimal ABIF file holding only char tags, enough for PBAS and PCON. */
function abif(tags: readonly Tag[]): Uint8Array {
  const data = tags.map((t) => Uint8Array.from(t.text, (c) => c.charCodeAt(0)));
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
    view.setInt16(e + 8, 2);
    view.setInt16(e + 10, 1);
    view.setInt32(e + 12, bytes.length);
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
