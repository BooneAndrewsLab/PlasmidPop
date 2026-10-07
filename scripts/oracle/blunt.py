"""Blunted cut ends against pydna: a vector is cut, its largest fragment has
its ends made blunt (T4 fill-in, or mung bean trimming) and closed on itself.

pydna's Dseq.T4('ACGT') fills 5' overhangs and trims 3' ones, and Dseq.mung()
trims both kinds; looped() closes the blunt fragment. PlasmidPop's
SeqDocument.bluntEnds(method) followed by emptyVector() must give the same
circle (#183). Cases cover 5', 3' and blunt cutters, Type IIS cutters whose
cut lies outside the site, and two different enzymes at the two ends.

Not covered here: what happens to the features of a blunted, rejoined
product. That depends on feature provenance across document versions and on
edited pieces (#187, #188), whose answers are still being settled.
"""
import random

from Bio import Restriction as R
from Bio.Seq import Seq
from pydna.dseqrecord import Dseqrecord

from common import random_dna, rng_for

SEED = 20261007

SINGLE = [
    'EcoRI', 'BamHI', 'HindIII', 'XbaI', 'NcoI',  # 5' overhangs
    'KpnI', 'PstI', 'SacI', 'SphI', 'ApaI', 'AatII',  # 3' overhangs
    'SmaI', 'EcoRV',  # blunt
    'BsaI', 'BsmBI', 'SapI',  # Type IIS, cut outside the site
    'BglI',  # 3' overhang, degenerate N5 site
]
PAIRS = [
    ('EcoRI', 'KpnI'), ('KpnI', 'PstI'), ('BamHI', 'SmaI'), ('BsaI', 'EcoRI'),
    ('SacI', 'XbaI'), ('ApaI', 'NotI'), ('BsmBI', 'SapI'), ('EcoRV', 'HindIII'),
]
AMBIGUOUS = {'N': 'ACGT', 'R': 'AG', 'Y': 'CT', 'W': 'AT', 'S': 'CG', 'K': 'GT', 'M': 'AC'}


def concrete(rng, site):
    return ''.join(rng.choice(AMBIGUOUS.get(c, c)) for c in site)


def vector(rng, enzymes):
    """A circular random sequence with exactly one site per enzyme."""
    while True:
        length = rng.randrange(150, 260)
        seq = list(random_dna(rng, length))
        for i, name in enumerate(enzymes):
            site = concrete(rng, getattr(R, name).site)
            p = (i * length // 2 + rng.randrange(30, length // 2 - 30)) % length
            seq[p:p + len(site)] = list(site)
            seq = seq[:length]
        seq = ''.join(seq)
        hits = R.RestrictionBatch(enzymes).search(Seq(seq), linear=False)
        if all(len(v) == 1 for v in hits.values()):
            return seq


def fragments(seq, enzymes):
    return Dseqrecord(seq, circular=True).cut(*[getattr(R, e) for e in enzymes])


def unambiguous(seq, enzymes):
    """The two fragments of a two-enzyme cut differ clearly in size, whether or
    not overhangs are counted, so "the largest" names the same one everywhere."""
    sizes = sorted(len(f) for f in fragments(seq, enzymes))
    return len(sizes) == 1 or sizes[-1] - sizes[-2] >= 10


def blunted_circle(seq, enzymes, method):
    big = max(fragments(seq, enzymes), key=len).seq
    blunt = big.T4('ACGT') if method == 'fill' else big.mung()
    return str(blunt.looped()).upper()


def generate():
    rng = rng_for(SEED)
    cases = []
    plans = [([e], m) for e in SINGLE for m in ('fill', 'trim')]
    plans += [(list(p), m) for p in PAIRS for m in ('fill', 'trim') for _ in range(2)]
    for enzymes, method in plans:
        seq = vector(rng, enzymes)
        while not unambiguous(seq, enzymes):
            seq = vector(rng, enzymes)
        cases.append({
            'name': f"{'+'.join(enzymes)} {method} {len(cases)}",
            'enzymes': enzymes,
            'method': method,
            'sequence': seq,
            'product': blunted_circle(seq, enzymes, method),
        })
    return {'cases': cases}
