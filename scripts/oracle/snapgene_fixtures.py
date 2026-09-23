"""Writes the SnapGene .dna fixtures in src/io/fixtures/snapgene/.

Real .dna files cannot be committed (SnapGene's bundled ones are theirs), so
these are built here from the packet format, written by this script rather
than by PlasmidPop so that the two do not share a misunderstanding. Their
shape copies what SnapGene 8.2 writes, established from its 203 bundled
files: cookie version 1/15/19, packets in the order 09 00 03 08 0a 05 06 0d
0e, and packets PlasmidPop ignores (enzyme list, display settings, a
compressed history) left in so that skipping them is tested too.

What the files should contain is then read by Biopython (generate.py), not
asserted here. Run through `npm run oracle:generate`.
"""
import os
import random
import struct
from xml.sax.saxutils import quoteattr

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'src', 'io', 'fixtures', 'snapgene')
SEED = 20260924


def packet(kind, payload):
    if isinstance(payload, str):
        payload = payload.encode('utf-8')
    return struct.pack('>BI', kind, len(payload)) + payload


def cookie():
    return packet(0x09, b'SnapGene' + struct.pack('>HHH', 1, 15, 19))


def sequence(seq, circular):
    # Flags as SnapGene writes them: bit 0 circular, bit 1 double-stranded,
    # bits 2-4 Dam/Dcm/EcoKI methylation of the host.
    flags = (0x01 if circular else 0) | 0x02 | 0x04 | 0x08 | 0x10
    return packet(0x00, bytes([flags]) + seq.encode('ascii'))


def properties(up=0, down=0):
    return packet(
        0x08,
        '<AdditionalSequenceProperties>'
        f'<UpstreamStickiness>{up}</UpstreamStickiness>'
        f'<DownstreamStickiness>{down}</DownstreamStickiness>'
        '<UpstreamModification>Unmodified</UpstreamModification>'
        '<DownstreamModification>Unmodified</DownstreamModification>'
        '</AdditionalSequenceProperties>',
    )


def html(text):
    """SnapGene keeps qualifier text as escaped HTML."""
    return f'<html><body>{text}</body></html>'


def feature(name, kind, directionality, segments, qualifiers=()):
    segs = ''.join(
        f'<Segment range="{a}-{b}" color="#993366" type="{t}"/>' for a, b, t in segments
    )
    quals = ''.join(
        f'<Q name={quoteattr(q)}><V {attr}={quoteattr(v)}/></Q>' for q, attr, v in qualifiers
    )
    return (
        f'<Feature recentID="0" name={quoteattr(name)} directionality="{directionality}" '
        f'type={quoteattr(kind)} allowSegmentOverlaps="0">{segs}{quals}</Feature>'
    )


def features(*items):
    return packet(0x0A, '<?xml version="1.0"?><Features nextValidID="9">' + ''.join(items) + '</Features>')


def primers(*items):
    body = ''.join(
        f'<Primer recentID="0" name={quoteattr(name)} sequence="{seq}">'
        + ''.join(
            f'<BindingSite location="{a}-{b}" boundStrand="{strand}"'
            + (' simplified="1"' if simplified else '')
            + '/>'
            for a, b, strand, simplified in sites
        )
        + '</Primer>'
        for name, seq, sites in items
    )
    return packet(
        0x05,
        '<?xml version="1.0"?><Primers nextValidID="3"><HybridizationParams '
        'minContinuousMatchLen="10" allowMismatch="1" minMeltingTemperature="40"/>'
        + body
        + '</Primers>',
    )


def notes(description, accession=None):
    acc = f'<AccessionNumber>{accession}</AccessionNumber>' if accession else ''
    return packet(
        0x06,
        '<Notes><Type>Synthetic</Type><ConfirmedExperimentally>0</ConfirmedExperimentally>'
        f'<Description>{quoteattr(html(description))[1:-1]}</Description>{acc}'
        '<LastModified>2026.9.24</LastModified></Notes>',
    )


def filler():
    """Packets PlasmidPop does not read, shaped like SnapGene's."""
    return b''.join(
        [
            packet(0x03, b'\x01\x00\x00\x00\x10GAATTC,GGATCC,AAGCTT'),
            packet(0x0D, bytes(345)),
            packet(0x0E, '<?xml version="1.0"?><CustomEnzymeSets/>\n'),
            packet(0x11, '<AlignableSequences trimStringency="Medium"/>'),
            packet(0x1C, '<?xml version="1.0"?><EnzymeVisibilities vals=""/>\n'),
            # A history packet is xz-compressed; any bytes do to be skipped.
            packet(0x07, b'\xfd7zXZ\x00\x00' + bytes(range(64))),
        ]
    )


def rc(seq):
    return seq.translate(str.maketrans('ACGT', 'TGCA'))[::-1]


def write(name, *parts):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with open(path, 'wb') as f:
        f.write(cookie() + b''.join(parts))
    print(f'wrote {os.path.relpath(path, ROOT)} ({os.path.getsize(path)} bytes)')


def main():
    rng = random.Random(SEED)
    seq = ''.join(rng.choice('ACGT') for _ in range(300))

    # A plasmid: a two-part CDS with a gap segment, a reverse gene, a feature
    # over the origin, qualifiers with markup, and primers on both strands
    # including SnapGene's "simplified" duplicate of a binding site.
    write(
        'plasmid.dna',
        sequence(seq, circular=True),
        packet(0x03, b'\x01\x00\x00\x00\x06GAATTC'),
        properties(),
        features(
            feature(
                'split CDS',
                'CDS',
                1,
                [(11, 40, 'standard'), (41, 60, 'gap'), (61, 90, 'standard')],
                [('product', 'text', html('a &amp; b protein')), ('codon_start', 'int', '1')],
            ),
            feature('backwards', 'gene', 2, [(120, 180, 'standard')], [('note', 'text', html('on the <i>bottom</i> strand'))]),
            feature('over the origin', 'misc_feature', 0, [(281, 20, 'standard')]),
            feature('both ways', 'misc_feature', 3, [(200, 210, 'standard')]),
        ),
        primers(
            ('fwd', seq[30:50], [(30, 49, 0, False)]),
            ('rev', rc(seq[230:252]), [(230, 251, 1, False), (230, 251, 1, True)]),
        ),
        notes('A plasmid for the oracle', accession='PP000001'),
        packet(0x0D, bytes(345)),
        packet(0x0E, '<?xml version="1.0"?><CustomEnzymeSets/>\n'),
    )

    # A linearised TA vector: SnapGene says -1/-1, and its sequence starts
    # with the A under the bottom strand's T and ends with the top strand's T.
    insert = ''.join(rng.choice('ACGT') for _ in range(160))
    write(
        'ta-vector.dna',
        sequence('A' + insert + 'T', circular=False),
        properties(-1, -1),
        features(feature('lacZ alpha', 'CDS', 1, [(1, 60, 'standard')])),
        notes('Linearised TA vector with 3-prime T overhangs'),
        filler(),
    )

    # A directional TOPO vector: a 4-base 5' overhang downstream, carried by
    # the bottom strand, and a feature running onto it.
    body = ''.join(rng.choice('ACGT') for _ in range(120))
    write(
        'd-topo.dna',
        sequence(body + 'CACC', circular=False),
        properties(0, 4),
        features(feature('tip', 'misc_feature', 1, [(110, 124, 'standard')])),
        primers(('T7', body[5:25], [(5, 24, 0, False)])),
        notes('Directional TOPO vector'),
    )

    # Names and notes outside ASCII, and a bare file: no features, no notes.
    write(
        'unicode.dna',
        sequence(seq[:150], circular=True),
        properties(),
        features(feature('β-lactamase', 'CDS', 2, [(10, 90, 'standard')], [('note', 'text', html('résumé — 5′→3′'))])),
    )
    write('bare.dna', sequence(seq[:80], circular=False))


if __name__ == '__main__':
    main()
