"""Helpers shared by the cloning oracles (pcr, assembly, digest, gateway, seguid)."""
import os
import random

from Bio import SeqIO
from Bio.Seq import Seq

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
FIXTURES = os.path.join(ROOT, 'src', 'io', 'fixtures')


def rc(s):
    return str(Seq(s).reverse_complement())


def random_dna(rng, n, gc=0.5):
    return ''.join(
        rng.choice('GC') if rng.random() < gc else rng.choice('AT') for _ in range(n)
    )


def fixture_sequence(name):
    """The bases of the first record of a GenBank fixture, upper case."""
    record = next(SeqIO.parse(os.path.join(FIXTURES, name), 'genbank'))
    return str(record.seq).upper()


def rotate(s, k):
    k %= len(s)
    return s[k:] + s[:k]


def canonical(a, b):
    """True when two circular sequences are the same molecule up to rotation."""
    return len(a) == len(b) and b in a + a


def rng_for(seed):
    return random.Random(seed)
