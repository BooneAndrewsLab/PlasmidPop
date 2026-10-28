"""Restriction-cloning ends (item 108), for src/test/oracle/cloningEnds.json.

Two things the designer relies on are pinned here from Biopython and pydna:

* where the enzymes a pair could use cut the insert stretch (a PCR product,
  so linear and unmethylated) and the vector (circular), from
  Bio.Restriction's search; the designer's "cuts inside the insert" and
  "cuts the vector once" come from the same positions;
* what cloning the insert into pUC19 with a pair makes: the vector cut
  with both enzymes, its backbone joined to the digested amplicon by pydna
  (Dseqrecord.cut, +, looped()), in both orientations. The product does not
  depend on the primers' padding, which the digest removes, so the
  designer's simulate() can be held to it whatever padding it chose.

The insert is the AXL2 CDS of U49845 (687..3158), and the reverse-strand
CDS complement(3300..4037) of the same record read as its own strand.
"""
import hashlib

from Bio.Restriction import AllEnzymes
from Bio.Seq import Seq
from pydna.dseqrecord import Dseqrecord

from common import fixture_sequence, rc

ENZYMES = [
    'EcoRI', 'SacI', 'KpnI', 'SmaI', 'XmaI', 'BamHI', 'XbaI', 'SalI', 'AccI',
    'PstI', 'SphI', 'HindIII', 'BfuAI', 'BsaI', 'NdeI', 'NotI', 'XhoI',
]
PAIRS = [('EcoRI', 'PstI'), ('KpnI', 'BamHI'), ('SacI', 'SalI'), ('BamHI', 'PstI')]

INSERTS = [
    {'name': 'AXL2', 'fixture': 'U49845.gb', 'start': 686, 'end': 3158, 'strand': 'forward'},
    {'name': 'REV', 'fixture': 'U49845.gb', 'start': 3299, 'end': 4037, 'strand': 'reverse'},
]


def enzyme(name):
    return AllEnzymes.get(name)


def cuts(text, linear, names):
    """0-based top-strand cut index per enzyme: Bio.Restriction's 1-based first base after the cut, less one."""
    seq = Seq(text)
    out = {}
    for name in names:
        positions = enzyme(name).search(seq, linear=linear)
        out[name] = sorted((p - 1) % len(text) for p in positions)
    return out


def insert_sequence(spec):
    text = fixture_sequence(spec['fixture'])[spec['start']:spec['end']]
    return rc(text) if spec['strand'] == 'reverse' else text


def product(vector, insert, a, b, flipped):
    """pUC19 cut with a and b, its backbone joined to the digested amplicon."""
    ea, eb = enzyme(a), enzyme(b)
    pieces = Dseqrecord(vector, circular=True).cut(ea, eb)
    backbone = max(pieces, key=len)
    # The amplicon: a site on each 5' tail, in the vector's own spelling
    # (all four pairs are palindromic sites), behind six bases of padding.
    forward_site, reverse_site = (b, a) if flipped else (a, b)
    amplicon = 'GTTCTG' + enzyme(forward_site).site + insert + rc('CTAATA' + enzyme(reverse_site).site)
    frags = Dseqrecord(amplicon).cut(ea, eb)
    middle = next(f for f in frags if insert in str(f.seq))
    placed = middle.reverse_complement() if flipped else middle
    looped = (backbone + placed).looped()
    text = str(looped.seq).upper()
    # Rotated to the vector's first base, which the designer keeps as base 0.
    head = vector[:40]
    at = (text + text).index(head)
    text = (text + text)[at:at + len(text)]
    return {
        'pair': [a, b],
        'flipped': flipped,
        'length': len(text),
        'sha256': hashlib.sha256(text.encode()).hexdigest(),
        'head': text[:60],
    }


def generate():
    vector = fixture_sequence('L09137.gb')
    inserts = []
    for spec in INSERTS:
        text = insert_sequence(spec)
        inserts.append({
            **spec,
            'length': len(text),
            'cuts': cuts(text, True, ENZYMES),
            'products': [
                product(vector, text, a, b, flipped)
                for a, b in PAIRS
                for flipped in (False, True)
                if not cuts(text, True, [a, b])[a] and not cuts(text, True, [a, b])[b]
            ],
        })
    return {
        'vector': {'fixture': 'L09137.gb', 'length': len(vector), 'cuts': cuts(vector, False, ENZYMES)},
        'inserts': inserts,
    }


if __name__ == '__main__':
    import json
    import os
    import sys

    import Bio

    root = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
    path = os.path.join(root, 'src', 'test', 'oracle', 'cloningEnds.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({'biopython': Bio.__version__, **generate()}, f, indent=1, sort_keys=True)
        f.write('\n')
    print(f'wrote {os.path.relpath(path, root)}', file=sys.stderr)
