"""Hairpin and dimer free energies from primer3-py, for src/test/oracle/hairpinDimer.json.

Our checks (longestHairpinStem, maxSelfComplementarity, threePrimeComplementarity)
are length heuristics; primer3-py's calc_hairpin, calc_homodimer and
calc_heterodimer are thermodynamic (SantaLucia 1998 nearest-neighbour with
loop and mismatch terms). The data records Primer3's dG (kcal/mol) and Tm for
each primer folding on itself, pairing with itself, and for pairs, at 50 mM
sodium, no magnesium or dNTPs, 50 nM oligo, 37 C: the conditions of our own
meltingTemperature. The test gates the share of primers that both flag.

The primers are a spread meant to include what the checks are about: lengths
a designer sees (18-27) with some outside, GC from 15 to 85 %, planted
hairpin stems, planted 3' complementarity, planted internal self-
complementarity and homopolymers. Pairs mix random pairs, pairs planted with
3' complementarity to each other, and pairs sharing an internal stretch.
"""
import random

import primer3

SEED = 20261030
COMP = {'A': 'T', 'T': 'A', 'G': 'C', 'C': 'G'}
CONDITIONS = dict(mv_conc=50.0, dv_conc=0.0, dntp_conc=0.0, dna_conc=50.0, temp_c=37.0)


def revcomp(s):
    return ''.join(COMP[c] for c in reversed(s))


def random_seq(rng, n, gc=0.5):
    return ''.join(
        rng.choice('GC') if rng.random() < gc else rng.choice('AT') for _ in range(n)
    )


def primers(rng):
    out = []
    # Random, over the lengths and GC contents a designer meets.
    for _ in range(80):
        out.append(random_seq(rng, rng.randint(18, 27), rng.uniform(0.35, 0.65)))
    for _ in range(25):
        out.append(random_seq(rng, rng.randint(15, 35), 0.8))
    for _ in range(25):
        out.append(random_seq(rng, rng.randint(15, 35), 0.2))
    for _ in range(15):
        out.append(random_seq(rng, rng.randint(8, 17), rng.uniform(0.3, 0.7)))
    for _ in range(10):
        out.append(random_seq(rng, rng.randint(28, 45), rng.uniform(0.3, 0.7)))
    # Planted hairpins: stem, loop, stem's reverse complement, optional tails.
    for _ in range(45):
        stem = random_seq(rng, rng.randint(3, 9), rng.uniform(0.3, 0.8))
        loop = random_seq(rng, rng.randint(3, 8))
        head = random_seq(rng, rng.randint(0, 8))
        tail = random_seq(rng, rng.randint(0, 6))
        out.append(head + stem + loop + revcomp(stem) + tail)
    # Planted 3' self-complementarity: the last k bases pair with an earlier stretch.
    for _ in range(35):
        k = rng.randint(3, 8)
        body = random_seq(rng, rng.randint(14, 22))
        end = random_seq(rng, k)
        pos = rng.randint(0, max(0, len(body) - k))
        body = body[:pos] + revcomp(end) + body[pos + k:]
        out.append(body + end)
    # Internal self-complementary stretches (palindromes) in random flanks.
    for _ in range(25):
        half = random_seq(rng, rng.randint(3, 8))
        out.append(random_seq(rng, rng.randint(4, 9)) + half + revcomp(half)
                   + random_seq(rng, rng.randint(4, 9)))
    # Homopolymers inside and at the ends.
    for base in 'ACGT':
        for run in (4, 5, 6, 8):
            flank = random_seq(rng, 9)
            out.append(flank + base * run + random_seq(rng, 6))
            out.append(base * run + flank + random_seq(rng, 4))
    out += [
        'ACGTACGTACGTACGTACGT', 'ATATATATATATATATATAT', 'GCGCGCGCGCGCGCGCGC',
        'AAAAAAAAAAAAAAAAAAAA', 'GGGGGGGGGGGGGGGGGGGG', 'GAATTCGAATTCGAATTC',
        'CCCGGGAAAATTTCCCGGG', 'GGATCCTTTTTTGGATCC',
    ]
    seen, unique = set(), []
    for p in out:
        if p not in seen:
            seen.add(p)
            unique.append(p)
    return unique


def pairs(rng, seqs):
    out = []
    for _ in range(100):
        out.append((rng.choice(seqs), rng.choice(seqs)))
    # 3' end of one pairs with the other, k bases.
    for _ in range(60):
        a, b = rng.choice(seqs), rng.choice(seqs)
        k = rng.randint(3, 8)
        pos = rng.randint(0, max(0, len(b) - k))
        b = b[:pos] + revcomp(a[-k:]) + b[pos + k:]
        out.append((a, b))
    # An internal stretch of one pairs with an internal stretch of the other.
    for _ in range(40):
        a, b = rng.choice(seqs), rng.choice(seqs)
        k = rng.randint(4, 9)
        i = rng.randint(0, max(0, len(a) - k - 3))
        pos = rng.randint(0, max(0, len(b) - k - 3))
        b = b[:pos] + revcomp(a[i:i + k]) + b[pos + k:]
        out.append((a, b))
    seen, unique = set(), []
    for p in out:
        if p[0] != p[1] and p not in seen:
            seen.add(p)
            unique.append(p)
    return unique


def calc(r):
    return {'dg': round(r.dg / 1000, 3), 'tm': round(r.tm, 2)}


def generate():
    rng = random.Random(SEED)
    seqs = primers(rng)
    rows = []
    for s in seqs:
        rows.append({
            'seq': s,
            'hairpin': calc(primer3.calc_hairpin(s, **CONDITIONS)),
            'homodimer': calc(primer3.calc_homodimer(s, **CONDITIONS)),
        })
    pair_rows = []
    for a, b in pairs(rng, seqs):
        r = primer3.calc_heterodimer(a, b, **CONDITIONS)
        pair_rows.append({'a': a, 'b': b, **calc(r)})
    return {
        'primer3': primer3.__version__,
        'conditions': {'sodiumMM': 50, 'oligoNM': 50, 'magnesiumMM': 0, 'dntpMM': 0, 'tempC': 37},
        'rows': rows,
        'pairs': pair_rows,
    }
