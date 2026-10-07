"""Writes the ABIF (.ab1) fixtures in src/io/fixtures/abif/.

Real .ab1 files are an instrument's or a lab's and are not committed, so
these are built here from the format (Applied Biosystems, "ABIF File
Format", 2009), written by this script rather than by PlasmidPop so that the
two do not share a misunderstanding. What the files contain is then read by
Biopython (generate.py), not asserted here. Run through
`npm run oracle:generate`.

The shapes copy what is met in practice (#49):
- sanger.ab1: a capillary instrument's file. Copy 1 of the calls as called
  and copy 2 as edited (one base changed, one N), qualities and peaks for
  both, analysed traces DATA9-12 plus raw DATA1-4 and run tags a reader has
  to skip, the directory after the data as instruments write it.
- consensus.ab1: the few tags a nanopore service's consensus file holds,
  four trace points per base, peaks only in PLOC1.
- traces-only.ab1: traces and no base calls, as a fragment-analysis run.
"""
import math
import os
import random
import struct

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'src', 'io', 'fixtures', 'abif')
SEED = 20260925

# Element types (ABIF note, table 2).
BYTE, CHAR, SHORT, LONG, PSTRING, CSTRING = 1, 2, 4, 5, 18, 19
HEADER = 128  # the header block instruments write: 34 bytes used, the rest reserved


class Tag:
    def __init__(self, name, number, kind, size, values):
        self.name, self.number, self.kind, self.size = name, number, kind, size
        if kind in (CHAR, BYTE):
            self.count, self.data = len(values), bytes(values)
        elif kind == SHORT:
            self.count, self.data = len(values), struct.pack(f'>{len(values)}h', *values)
        elif kind == LONG:
            self.count, self.data = len(values), struct.pack(f'>{len(values)}i', *values)
        elif kind == PSTRING:
            raw = values.encode('latin1')
            self.count, self.data = len(raw) + 1, bytes([len(raw)]) + raw
        elif kind == CSTRING:
            raw = values.encode('latin1') + b'\0'
            self.count, self.data = len(raw), raw
        else:  # a date, a time: one element of packed bytes
            self.count, self.data = 1, bytes(values)


def chars(name, number, text):
    return Tag(name, number, CHAR, 1, text.encode('latin1'))


def shorts(name, number, values):
    return Tag(name, number, SHORT, 2, values)


def abif(tags):
    """The file: header, each tag's data (inline when four bytes or fewer), directory."""
    body = bytearray()
    entries = []
    for t in tags:
        if len(t.data) <= 4:
            offset_field = t.data.ljust(4, b'\0')
        else:
            offset_field = struct.pack('>i', HEADER + len(body))
            body += t.data
        entries.append(
            t.name.encode('ascii')
            + struct.pack('>ihhii', t.number, t.kind, t.size, t.count, len(t.data))
            + offset_field
            + struct.pack('>i', 0)
        )
    directory = HEADER + len(body)
    header = b'ABIF' + struct.pack('>h', 101)
    header += b'tdir' + struct.pack('>ihhiiii', 1, 1023, 28, len(entries), 28 * len(entries), directory, 0)
    header = header.ljust(HEADER, b'\xff')
    return header + bytes(body) + b''.join(entries)


def traces(rng, calls, spacing, order):
    """Four channels with a peak under each call, in the channel order given."""
    length = spacing * len(calls) + spacing
    channels = {b: [rng.randint(0, 40) for _ in range(length)] for b in 'ACGT'}
    peaks = []
    for k, base in enumerate(calls):
        centre = spacing // 2 + k * spacing + rng.randint(-1, 1)
        peaks.append(centre)
        height = rng.randint(600, 2400)
        width = spacing / 3
        # An N is a base two dyes answered at once.
        lit = 'AG' if base == 'N' else base
        for b in lit:
            for x in range(max(0, centre - spacing), min(length, centre + spacing + 1)):
                channels[b][x] += int(height * math.exp(-((x - centre) ** 2) / (2 * width * width)))
    return [channels[b] for b in order], peaks


def run_tags():
    """Tags an instrument writes that PlasmidPop does not read."""
    return [
        Tag('MODL', 1, CHAR, 1, b'3730'),
        Tag('MCHN', 1, PSTRING, 1, '3730xl-22101-012'),
        Tag('RUND', 1, 10, 4, [0x07, 0xEA, 0x09, 0x19]),  # a date, element type 10
        Tag('RUNT', 1, 11, 4, [12, 30, 5, 0]),  # a time, element type 11
        Tag('PDMF', 1, PSTRING, 1, 'KB_3730_POP7_BDTv3.mob'),
        Tag('TUBE', 1, PSTRING, 1, 'A1'),
    ]


def sanger(rng):
    called = ''.join(rng.choice('ACGT') for _ in range(240))
    edited = called[:100] + ('C' if called[100] != 'C' else 'G') + called[101:180] + 'N' + called[181:]
    order = 'GATC'
    channels, peaks = traces(rng, edited, 12, order)
    ramp = lambda k: max(5, min(60, 10 + k // 2, 60 - (240 - k) // 3))
    quality = [0 if b == 'N' else ramp(k) for k, b in enumerate(edited)]
    raw = [[rng.randint(0, 3000) for _ in range(len(channels[0]))] for _ in range(4)]
    tags = (
        [shorts('DATA', n + 1, raw[n]) for n in range(4)]
        + run_tags()
        + [shorts('DATA', 9 + n, channels[n]) for n in range(4)]
        + [
            chars('FWO_', 1, order),
            chars('PBAS', 1, called),
            chars('PBAS', 2, edited),
            Tag('PCON', 1, CHAR, 1, [q + 1 if q < 60 else q for q in quality]),
            Tag('PCON', 2, CHAR, 1, quality),
            shorts('PLOC', 1, [p + 1 for p in peaks]),
            shorts('PLOC', 2, peaks),
            Tag('SMPL', 1, PSTRING, 1, 'pUC19_M13F'),
        ]
    )
    return abif(tags)


def consensus(rng):
    calls = ''.join(rng.choice('ACGT') for _ in range(180))
    channels, peaks = traces(rng, calls, 4, 'GATC')
    quality = [rng.randint(40, 50) for _ in calls]
    tags = [shorts('DATA', 9 + n, channels[n]) for n in range(4)] + [
        chars('FWO_', 1, 'GATC'),
        chars('PBAS', 1, calls),
        chars('PBAS', 2, calls),
        Tag('PCON', 1, CHAR, 1, quality),
        Tag('PCON', 2, CHAR, 1, quality),
        shorts('PLOC', 1, peaks),
    ]
    return abif(tags)


def traces_only(rng):
    channels, _ = traces(rng, 'ACGT' * 10, 10, 'GATC')
    tags = [shorts('DATA', 9 + n, channels[n]) for n in range(4)] + [chars('FWO_', 1, 'GATC')] + run_tags()
    return abif(tags)


# --- which copy of the calls, qualities and peaks is read (#159, #168) ------------
#
# An instrument writes the base calls twice, PBAS1 as called and PBAS2 as edited, each
# with its own PCON (qualities) and PLOC (peak positions). The rule held to the
# ABIF note and #159/#168: the calls are PBAS2 if present, else PBAS1; qualities and
# peaks come from the same copy when its count matches the calls, otherwise from the
# other copy only if that copy's calls are the very same bases, otherwise none.
# Variants of two small files (one where both copies agree, one where they differ)
# are written to src/io/fixtures/abif/copies/ and the expected answer recorded.


def directory(b):
    count = struct.unpack('>i', b[18:22])[0]
    start = struct.unpack('>i', b[26:30])[0]
    entries = []
    for k in range(count):
        at = start + 28 * k
        name = b[at:at + 4].decode('latin1')
        num, kind, _, cnt, size = struct.unpack('>ihhii', b[at + 4:at + 20])
        off = at + 20 if size <= 4 else struct.unpack('>i', b[at + 20:at + 24])[0]
        entries.append(dict(at=at, name=name, num=num, kind=kind, count=cnt, size=size, off=off))
    return entries


def entry(b, key):
    for e in directory(b):
        if f"{e['name']}{e['num']}" == key:
            return e
    return None


def payload(b, e):
    return bytes(b[e['off']:e['off'] + e['size']])


def rename(b, key, new):
    b[entry(b, key)['at']:entry(b, key)['at'] + 4] = new.encode()


def replace(b, key, data, count):
    e = entry(b, key)
    offset = len(b)
    b.extend(data)
    struct.pack_into('>i', b, e['at'] + 12, count)
    struct.pack_into('>i', b, e['at'] + 16, len(data))
    struct.pack_into('>i', b, e['at'] + 20, offset)


def calls_of(b, key):
    return payload(b, entry(b, key)).decode('latin1').upper().replace('\0', '').replace(' ', '')


def copy_expectation(b):
    pbas = 'PBAS2' if entry(b, 'PBAS2') else 'PBAS1' if entry(b, 'PBAS1') else None
    if pbas is None:
        return {'error': True}
    seq = calls_of(b, pbas)
    pref = pbas[-1]
    other = '1' if pref == '2' else '2'

    def pick(name):
        own = entry(b, name + pref)
        if own and own['count'] == len(seq):
            return own
        alt = entry(b, name + other)
        if not alt or alt['count'] != len(seq):
            return None
        return alt if entry(b, 'PBAS' + other) and calls_of(b, 'PBAS' + other) == seq else None

    q, p = pick('PCON'), pick('PLOC')
    peaks = None
    if p:
        width = 2 if p['kind'] == SHORT else 4
        raw = payload(b, p)
        peaks = [int.from_bytes(raw[i * width:(i + 1) * width], 'big', signed=True) for i in range(p['count'])]
    return {'sequence': seq, 'qualities': list(payload(b, q)[:len(seq)]) if q else None, 'peaks': peaks}


def copy_base(rng, same):
    n = 70
    called = ''.join(rng.choice('ACGT') for _ in range(n))
    edited = called if same else called[:30] + ('C' if called[30] != 'C' else 'G') + called[31:55] + 'N' + called[56:]
    channels, peaks = traces(rng, edited, 6, 'GATC')
    qual = lambda k: 5 + (k * 7) % 50
    tags = [shorts('DATA', 9 + k, channels[k]) for k in range(4)] + [
        chars('FWO_', 1, 'GATC'),
        chars('PBAS', 1, called),
        chars('PBAS', 2, edited),
        Tag('PCON', 1, CHAR, 1, [qual(k) + 1 for k in range(n)]),
        Tag('PCON', 2, CHAR, 1, [qual(k) for k in range(n)]),
        shorts('PLOC', 1, [x + 1 for x in peaks]),
        shorts('PLOC', 2, peaks),
    ]
    return bytearray(abif(tags))


def copy_variants():
    rng = random.Random(SEED + 1)
    folder = os.path.join(OUT, 'copies')
    os.makedirs(folder, exist_ok=True)
    manifest = []
    for label, same in (('agree', True), ('differ', False)):
        orig = copy_base(rng, same)
        s1, s2 = calls_of(orig, 'PBAS1'), calls_of(orig, 'PBAS2')
        variants = {'orig': bytearray(orig)}

        def drop_own(v):
            rename(v, 'PLOC2', 'ZLOC')
            rename(v, 'PCON2', 'ZCON')

        # PBAS2 edited by an insertion and a deletion, no PLOC2/PCON2 of its own to match:
        # the other copy's peaks belong to different bases, so none are read.
        v = bytearray(orig)
        indel = s2[:5] + 'A' + s2[5:10] + s2[11:]
        replace(v, 'PBAS2', indel.encode(), len(indel))
        drop_own(v)
        variants['indel-no-own'] = v
        # PBAS2 the very same bases as PBAS1 and no PLOC2/PCON2 of its own: copy 1's are read.
        v = bytearray(orig)
        replace(v, 'PBAS2', s1.encode(), len(s1))
        drop_own(v)
        variants['same-no-own'] = v
        # ... and the other copy's calls in lower case
        v = bytearray(v)
        replace(v, 'PBAS1', s1.lower().encode(), len(s1))
        variants['same-no-own-lower'] = v
        # PBAS2 shortened, with PLOC2/PCON2 cut to match
        cut = s2[:-7]
        v = bytearray(orig)
        replace(v, 'PBAS2', cut.encode(), len(cut))
        replace(v, 'PLOC2', payload(orig, entry(orig, 'PLOC2'))[:len(cut) * 2], len(cut))
        replace(v, 'PCON2', payload(orig, entry(orig, 'PCON2'))[:len(cut)], len(cut))
        variants['shorter-own'] = v
        # a PLOC2 of the wrong length: falls back to PLOC1 only where the calls are the same
        v = bytearray(orig)
        replace(v, 'PLOC2', payload(orig, entry(orig, 'PLOC2'))[:-4], entry(orig, 'PLOC2')['count'] - 2)
        variants['own-wrong-length'] = v
        # a trailing NUL in PBAS2 (count + 1), PLOC2 and PCON2 unchanged
        v = bytearray(orig)
        replace(v, 'PBAS2', s2.encode() + b'\0', len(s2) + 1)
        variants['trailing-nul'] = v
        # no PBAS2 at all: copy 1 throughout
        v = bytearray(orig)
        rename(v, 'PBAS2', 'ZBAS')
        variants['no-pbas2'] = v
        for name, v in variants.items():
            file = f'{label}-{name}.ab1'
            with open(os.path.join(folder, file), 'wb') as f:
                f.write(v)
            manifest.append({'file': f'copies/{file}', **copy_expectation(v)})
    return manifest


def main():
    rng = random.Random(SEED)
    os.makedirs(OUT, exist_ok=True)
    for name, build in [('sanger.ab1', sanger), ('consensus.ab1', consensus), ('traces-only.ab1', traces_only)]:
        with open(os.path.join(OUT, name), 'wb') as f:
            f.write(build(rng))


if __name__ == '__main__':
    main()
