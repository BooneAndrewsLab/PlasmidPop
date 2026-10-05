"""Melting temperatures from primer3-py and Biopython, for src/test/oracle/thermo.json.

meltingTemperature is SantaLucia 1998 nearest-neighbour with SantaLucia's own
salt correction, which primer3's calc_tm does with those two method names.
primer3-py 2.x defaults formamide_conc to a non-zero value, so it is zeroed.

q5MeltingTemperature is NEB's calculator as we read it: nearest-neighbour at
500 nM of primer, Owczarzy 2004 salt correction at 150 mM sodium. That is
Biopython's Tm_NN with DNA_NN3, saltcorr=6, dnac1=500, dnac2=0. Self-
complementary primers are left out of that comparison: our Q5 value does not
apply the symmetry correction (issue #140) while Biopython does.
"""
import random

import primer3
from Bio.SeqUtils import MeltingTemp as mt

SEED = 20261005
COMP = {'A': 'T', 'T': 'A', 'G': 'C', 'C': 'G'}
# (sodium mM, oligo nM)
CONDITIONS = [(50, 500), (150, 500), (1000, 500), (50, 50), (100, 250)]


def revcomp(s):
    return ''.join(COMP[c] for c in reversed(s))


def is_self_complementary(s):
    return s == revcomp(s)


def random_seq(rng, n, gc=0.5):
    return ''.join(
        rng.choice('GC') if rng.random() < gc else rng.choice('AT') for _ in range(n)
    )


def primers():
    rng = random.Random(SEED)
    out = []
    for _ in range(100):
        out.append(random_seq(rng, rng.randint(8, 40)))
    for _ in range(30):
        out.append(random_seq(rng, rng.randint(12, 35), 0.85))
    for _ in range(30):
        out.append(random_seq(rng, rng.randint(12, 35), 0.15))
    for _ in range(20):
        half = random_seq(rng, rng.randint(4, 15))
        out.append(half + revcomp(half))
    for _ in range(15):
        out.append(random_seq(rng, rng.randint(2, 7)))
    out += [
        'AT', 'GC', 'TA', 'CG', 'AAAA', 'GGGGGGGG', 'ACGTACGTACGTACGTACGT',
        'ATATATATATATATAT', 'GCGCGCGCGCGC', 'AAAAAAAAAAAAAAAAAAAA', 'CGTTGA',
        'GCGAGCGAGC', 'TTTTTTTTTTTTTTTTTTTTTTT', 'GAATTC', 'GGATCCGGATCC',
    ]
    seen, unique = set(), []
    for p in out:
        if p not in seen:
            seen.add(p)
            unique.append(p)
    return unique


def generate():
    rows = []
    for seq in primers():
        tm = [
            round(
                primer3.calc_tm(
                    seq, mv_conc=na, dv_conc=0.0, dntp_conc=0.0, dna_conc=nm,
                    formamide_conc=0.0, dmso_conc=0.0, tm_method='santalucia',
                    salt_corrections_method='santalucia',
                ),
                4,
            )
            for na, nm in CONDITIONS
        ]
        row = {'seq': seq, 'tm': tm}
        if not is_self_complementary(seq) and len(seq) >= 8:
            row['q5'] = round(
                mt.Tm_NN(
                    seq, nn_table=mt.DNA_NN3, Na=150, K=0, Tris=0, Mg=0, dNTPs=0,
                    dnac1=500, dnac2=0, saltcorr=6, selfcomp=False,
                ),
                4,
            )
        rows.append(row)
    return {
        'primer3': primer3.__version__,
        'conditions': [{'sodiumMM': na, 'oligoNM': nm} for na, nm in CONDITIONS],
        'rows': rows,
    }
