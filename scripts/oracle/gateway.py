"""Gateway BP and LR products by pydna, for src/test/oracle/gateway.json.

pydna.assembly2.gateway_assembly (multi_site_only=True: att sites of one
kind, i.e. attB1/attB2 or attL1/attL2, not the MultiSite ones) gives the
recombinant circles from authentic att sequences, the ones in pydna's own
doctests (Invitrogen and Hartley et al. 2000, Genome Res. 10:1788) plus the
25 bp attB sites of the Gateway manual. The products recorded are the
sequences of every circle it makes, compared by PlasmidPop up to rotation
and strand. Layouts: both sites forward, site 2 inverted (the real
arrangement), the vector written the other way round, a linear attB
substrate, an entry clone whose attL1 wraps the origin (with the ccdB
cassette named, issue #133 is the case without), and the full-length
realistic LR with attB2 ending GGT.
"""
from pydna.assembly2 import gateway_assembly
from pydna.dseqrecord import Dseqrecord

from common import random_dna, rc, rng_for

SEED = 20261008

ATT = {
    'attB1': 'ACAACTTTGTACAAAAAAGCAGAAG',
    'attB2': 'ACAACTTTGTACAAGAAAGCAGAAG',
    'attP1': 'AAAATAATGATTTTATTTGACTGATAGTGACCTGTTCGTTGCAACAAATTGATGAGCAATGCTTTTTTATAATGCCAACTTTGTACAAAAAAGCTGAACGAGAAGCGTAAAATGATATAAATATCAATATATTAAATTAGATTTTGCATAAAAAACAGACTACATAATACTGTAAAACACAACATATCCAGTCACTATGAATCAACTACTTAGATGGTATTAGTGACCTGTA',
    'attP2': 'AAAATAATGATTTTATTTGACTGATAGTGACCTGTTCGTTGCAACAAATTGATGAGCAATGCTTTTTTATAATGCCAACTTTGTACAAGAAAGCTGAACGAGAAGCGTAAAATGATATAAATATCAATATATTAAATTAGATTTTGCATAAAAAACAGACTACATAATACTGTAAAACACAACATATCCAGTCACTATGAATCAACTACTTAGATGGTATTAGTGACCTGTA',
    'attL1': 'CAAATAATGATTTTATTTTGACTGATAGTGACCTGTTCGTTGCAACAAATTGATAAGCAATGCTTTCTTATAATGCCAACTTTGTACAAAAAAGCAGGCT',
    'attL2': 'AAATAATGATTTTATTTTGACTGATAGTGACCTGTTCGTTGCAACAAATTGATAAGCAATGCTTTCTTATAATGCCAACTTTGTACAAGAAAGCTG',
    'attR1': 'ACAACTTTGTACAAAAAAGCTGAACGAGAAACGTAAAATGATATAAATATCAATATATTAAATTAGATTTTGCATAAAAAACAGACTACATAATACTGTAAAACACAACATATGCAGTCACTATG',
    'attR2': 'ACCACTTTGTACAAGAAAGCTGAACGAGAAACGTAAAATGATATAAATATCAATATATTAAATTAGATTTTGCATAAAAAACAGACTACATAATACTGTAAAACACAACATATCCAGTCACTATG',
}


# The MultiSite variants differ only in this seven-base specificity core (the
# thirteen bases around it are what tells them apart in pydna's consensus).
CORES = {
    '1': 'TTTGTACAAAAAA',
    '2': 'TTTGTACAAGAAA',
    '3': 'TTTGTATAATAAA',
    '4': 'TTTGTATAGAAAA',
    '5': 'TTTGTATACAAAA',
}


def att(kind, number):
    """attB4, attP1r, attL3 ... from the site of the same kind numbered 1."""
    site = ATT[f'att{kind}1'].replace(CORES['1'], CORES[number.rstrip('r')])
    return rc(site) if number.endswith('r') else site


def build(parts):
    """parts: [(name, sequence, kind, strand)] -> (sequence, features)."""
    seq, feats = '', []
    for name, s, kind, strand in parts:
        feats.append({'name': name, 'start': len(seq), 'end': len(seq) + len(s), 'strand': strand, 'kind': kind})
        seq += s
    return seq, feats


def rotate_molecule(molecule, shift):
    """Start the circle `shift` bases earlier; a feature crossing the new origin keeps end > length."""
    seq, feats = molecule
    L = len(seq)
    out = []
    for f in feats:
        start = (f['start'] + shift) % L
        out.append({**f, 'start': start, 'end': start + f['end'] - f['start']})
    return seq[-shift:] + seq[:-shift], out


def reverse_molecule(molecule):
    seq, feats = molecule
    L = len(seq)
    flipped = [
        {**f, 'start': L - f['end'], 'end': L - f['start'],
         'strand': 'reverse' if f['strand'] == 'forward' else 'forward'}
        for f in feats
    ]
    return rc(seq), flipped


def case(cid, reaction, insert, vector, insert_circular=True):
    products = gateway_assembly(
        [Dseqrecord(insert[0], circular=insert_circular), Dseqrecord(vector[0], circular=True)],
        reaction,
        multi_site_only=True,
    )
    assert products, f'pydna made no product for {cid}'
    return {
        'id': cid,
        'reaction': reaction,
        'insert': {'sequence': insert[0], 'features': insert[1], 'circular': insert_circular},
        'vector': {'sequence': vector[0], 'features': vector[1], 'circular': True},
        'pydna': sorted(str(p.seq).upper() for p in products),
    }


def generate():
    rng = rng_for(SEED)
    dna = lambda n: random_dna(rng, n)  # noqa: E731
    gene = 'ATG' + dna(297) + 'TAA'
    ccdb = 'ATG' + dna(297) + 'TGA'
    fwd, rev = 'forward', 'reverse'

    sub = build([('attB1', ATT['attB1'], 'att', fwd), ('gene', gene, 'gene', fwd),
                 ('attB2', ATT['attB2'], 'att', fwd), ('ampR', dna(600), 'filler', fwd)])
    donor = build([('attP1', ATT['attP1'], 'att', fwd), ('ccdB', ccdb, 'gene', fwd),
                   ('attP2', ATT['attP2'], 'att', fwd), ('kanR', dna(700), 'filler', fwd)])
    entry = build([('attL1', ATT['attL1'], 'att', fwd), ('gene', gene, 'gene', fwd),
                   ('attL2', ATT['attL2'], 'att', fwd), ('kanR', dna(650), 'filler', fwd)])
    dest = build([('attR1', ATT['attR1'], 'att', fwd), ('ccdB', ccdb, 'gene', fwd),
                  ('attR2', ATT['attR2'], 'att', fwd), ('ampR', dna(800), 'filler', fwd)])
    entry_inv = build([('attL1', ATT['attL1'], 'att', fwd), ('gene', gene, 'gene', fwd),
                       ('attL2', rc(ATT['attL2']), 'att', rev), ('kanR', dna(650), 'filler', fwd)])
    dest_inv = build([('attR1', ATT['attR1'], 'att', fwd), ('ccdB', ccdb, 'gene', fwd),
                      ('attR2', rc(ATT['attR2']), 'att', rev), ('ampR', dna(800), 'filler', fwd)])
    linear_sub = build([('spacer5', dna(12), 'filler', fwd), ('attB1', ATT['attB1'], 'att', fwd),
                        ('gene', gene, 'gene', fwd), ('attB2', ATT['attB2'], 'att', fwd),
                        ('spacer3', dna(12), 'filler', fwd)])
    # the realistic layout: attL2 + GGT so the recombinant attB2 is Invitrogen's 25 bp site
    entry_real = build([('attL1', ATT['attL1'], 'att', fwd), ('gene', gene, 'gene', fwd),
                        ('attL2', rc(ATT['attL2'] + 'GGT'), 'att', rev), ('kanR', dna(650), 'filler', fwd)])
    dest_real = build([('attR1', ATT['attR1'], 'att', fwd), ('ccdB', ccdb, 'gene', fwd),
                       ('attR2', rc(ATT['attR2']), 'att', rev), ('ampR', dna(800), 'filler', fwd),
                       ('ori', dna(600), 'filler', fwd)])

    # MultiSite (#147). The variants differ from attB1/attP1/attL1/attR1 only
    # in the seven-base specificity core, which is how Invitrogen's manual and
    # pydna's own consensus sites (pydna.gateway) describe them, so each one is
    # made by swapping that core in; find_gateway_sites recognises the results.
    # The fragments are the kit's: attB4-attB1r (5' element) and attB2r-attB3
    # (3' element), each with its matching pDONR, and a one-fragment LR into a
    # pDEST R4-R3. Both sites of each pair are drawn on one strand, which is
    # the case the names have to answer.
    # pydna's gateway_overlap only looks for the numbers 1 to 4, so the pairs
    # that use attB5 (attB1-attB5r, attB5-attB2) cannot be checked against it;
    # they are in gateway.test.ts instead.
    ms_pairs = [
        ('5prime', '4', '1r'),
        ('3prime', '2r', '3'),
    ]
    multisite = []
    for name, left, right in ms_pairs:
        frag = 'ATG' + dna(147) + 'TAA'
        cassette = 'ATG' + dna(147) + 'TGA'
        insert = build([(f'attB{left}', att('B', left), 'att', fwd), ('gene', frag, 'gene', fwd),
                        (f'attB{right}', att('B', right), 'att', fwd),
                        ('ampR', dna(400), 'filler', fwd)])
        pdonr = build([(f'attP{left}', att('P', left), 'att', fwd), ('ccdB', cassette, 'gene', fwd),
                       (f'attP{right}', att('P', right), 'att', fwd),
                       ('kanR', dna(500), 'filler', fwd)])
        multisite.append(case(f'BP-multisite-{name}', 'BP', insert, pdonr))
        if name == '5prime':
            # the same molecules written the other way round: the sites then
            # lie on the reverse strand, and the order has to read backwards.
            multisite.append(case(f'BP-multisite-{name}-reversed', 'BP',
                                  reverse_molecule(insert), reverse_molecule(pdonr)))
            # and with the fragment wrapping the origin.
            multisite.append(case(f'BP-multisite-{name}-wraps-origin', 'BP',
                                  rotate_molecule(insert, 80), pdonr))
    ms_entry = build([('attL4', att('L', '4'), 'att', fwd), ('gene', gene, 'gene', fwd),
                      ('attL3', att('L', '3'), 'att', fwd), ('kanR', dna(650), 'filler', fwd)])
    ms_dest = build([('attR4', att('R', '4'), 'att', fwd), ('ccdB', ccdb, 'gene', fwd),
                     ('attR3', att('R', '3'), 'att', fwd), ('ampR', dna(800), 'filler', fwd)])
    multisite.append(case('LR-multisite-R4-R3', 'LR', ms_entry, ms_dest))

    cases = [
        case('BP-forward', 'BP', sub, donor),
        case('LR-forward', 'LR', entry, dest),
        case('LR-site2-inverted', 'LR', entry_inv, dest_inv),
        case('BP-linear-substrate', 'BP', linear_sub, donor, insert_circular=False),
        case('LR-attL1-wraps-origin', 'LR', rotate_molecule(entry, 40), dest),
        case('LR-vector-reversed', 'LR', entry, reverse_molecule(dest)),
        case('LR-realistic-attB2', 'LR', entry_real, dest_real),
        case('LR-realistic-entry-rotated', 'LR', rotate_molecule(entry_real, 250), dest_real),
    ] + multisite
    return {'cases': cases}
