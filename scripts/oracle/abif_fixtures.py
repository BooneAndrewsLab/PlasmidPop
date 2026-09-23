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


def main():
    rng = random.Random(SEED)
    os.makedirs(OUT, exist_ok=True)
    for name, build in [('sanger.ab1', sanger), ('consensus.ab1', consensus), ('traces-only.ab1', traces_only)]:
        with open(os.path.join(OUT, name), 'wb') as f:
            f.write(build(rng))


if __name__ == '__main__':
    main()
