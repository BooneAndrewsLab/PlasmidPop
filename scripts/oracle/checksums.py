"""SEGUID v2 checksums from the seguid package and pydna, for src/test/oracle/seguid.json.

* lsseguid / csseguid: single-stranded, linear and circular, on random
  sequences and on rotations of them (csseguid must not move).
* ldseguid: two strands written 5' to 3' with '-' where one strand stops short,
  i.e. a sticky end, on random duplexes with every mix of overhang kinds.
* cdseguid: circular duplexes, on rotations and on the other strand.
* documents: linear sticky-ended fragments cut by pydna from the pUC19 and
  pBR322 fixtures (top strand and the ends as PlasmidPop describes them) with
  pydna's own Dseq.seguid(); and whole circular molecules.

The third is what documentChecksum must agree with. Module is not called
seguid because that would hide the package.
"""
import seguid as _seguid
from Bio.Restriction import AllEnzymes  # noqa: F401  (resolve enzyme names below)
from pydna.dseq import Dseq
from pydna.dseqrecord import Dseqrecord

import digest
from common import fixture_sequence, random_dna, rc, rng_for, rotate

SEED = 20261009


class seguid_pkg:  # noqa: N801  the package's checksums without their `ldseguid=` prefix
    __version__ = getattr(_seguid, '__version__', 'unknown')

    @staticmethod
    def lsseguid(s):
        return _seguid.lsseguid(s).split('=')[1]

    @staticmethod
    def csseguid(s):
        return _seguid.csseguid(s).split('=')[1]

    @staticmethod
    def ldseguid(w, c):
        return _seguid.ldseguid(w, c).split('=')[1]

    @staticmethod
    def cdseguid(w, c):
        return _seguid.cdseguid(w, c).split('=')[1]


COMP = {'A': 'T', 'T': 'A', 'G': 'C', 'C': 'G'}


def strands(S, a, b, c, d):
    """Top covers [a, n-b), bottom covers [c, n-d), both read 5'->3' and padded with '-'."""
    n = len(S)
    watson = ''.join(S[i] if a <= i < n - b else '-' for i in range(n))
    crick = ''.join(COMP[S[i]] if c <= i < n - d else '-' for i in reversed(range(n)))
    return watson, crick


def single_stranded(rng):
    out = []
    for n in [1, 2, 3, 4, 5, 7, 10, 16, 31, 64, 100, 250, 500]:
        s = random_dna(rng, n)
        out.append({'sequence': s, 'ls': seguid_pkg.lsseguid(s), 'cs': seguid_pkg.csseguid(s)})
    # repeats make the minimal rotation tricky
    for s in ['AAAA', 'ACAC', 'ACGACGACG', 'GATTACA', 'TTTTTTTTTA', 'CGCGCGCG']:
        out.append({'sequence': s, 'ls': seguid_pkg.lsseguid(s), 'cs': seguid_pkg.csseguid(s)})
    for _ in range(12):
        s = random_dna(rng, rng.randint(6, 80))
        k = rng.randint(1, len(s) - 1)
        out.append({'sequence': rotate(s, k), 'ls': seguid_pkg.lsseguid(rotate(s, k)),
                    'cs': seguid_pkg.csseguid(rotate(s, k)), 'rotationOf': s,
                    'csOfOriginal': seguid_pkg.csseguid(s)})
    return out


def duplexes(rng):
    out = []
    for _ in range(30):
        n = rng.randint(12, 60)
        S = random_dna(rng, n)
        # at each end exactly one of: blunt, top short (bottom overhangs), bottom short (top overhangs)
        a = c = b = d = 0
        left = rng.choice(['blunt', 'topShort', 'bottomShort'])
        right = rng.choice(['blunt', 'topShort', 'bottomShort'])
        if left == 'topShort':
            a = rng.randint(1, 5)
        elif left == 'bottomShort':
            c = rng.randint(1, 5)
        if right == 'topShort':
            b = rng.randint(1, 5)
        elif right == 'bottomShort':
            d = rng.randint(1, 5)
        w, k = strands(S, a, b, c, d)
        out.append({'watson': w, 'crick': k, 'ld': seguid_pkg.ldseguid(w, k)})
    for _ in range(10):
        S = random_dna(rng, rng.randint(8, 40))
        w, k = S, rc(S)
        out.append({'watson': w, 'crick': k, 'ld': seguid_pkg.ldseguid(w, k)})
    return out


def circles(rng):
    out = []
    for _ in range(14):
        S = random_dna(rng, rng.randint(8, 120))
        shift = rng.randint(1, len(S) - 1)
        for form in (S, rotate(S, shift), rc(S), rc(rotate(S, shift))):
            out.append({'watson': form, 'crick': rc(form), 'cd': seguid_pkg.cdseguid(form, rc(form))})
    return out


def fragments():
    out = []
    jobs = [
        ('pUC19', 'circular', ['EcoRI', 'HindIII']), ('pUC19', 'circular', ['KpnI', 'SacI']),
        ('pUC19', 'circular', ['PstI', 'BamHI']), ('pUC19', 'circular', ['SmaI', 'NdeI']),
        ('pUC19', 'circular', ['BsaI']), ('pBR322', 'circular', ['EcoRI', 'PstI', 'SalI']),
        ('pBR322', 'circular', ['BsaI', 'FokI']), ('pBR322', 'circular', ['PvuII', 'EcoRV']),
        ('pBR322', 'circular', ['HaeII', 'AvaI']), ('pBR322', 'circular', ['MmeI']),
        ('pUC19', 'linear', ['EcoRI', 'HindIII', 'PstI']), ('pBR322', 'linear', ['BamHI', 'SphI']),
    ]
    for source, topology, names in jobs:
        seq = fixture_sequence(digest.FIXTURES[source])
        record = Dseqrecord(seq, circular=topology == 'circular')
        for f in record.cut(*[digest.enzyme(n) for n in names]):
            if len(f.seq.watson) > 700:
                continue  # the ends are what is under test; keep the file small
            left, right = digest.describe_ends(f.seq)
            value = f.seq.seguid()
            assert value.startswith('ldseguid=')
            out.append({
                'top': str(f.seq.watson).upper(), 'left': left, 'right': right,
                'ld': value.split('=')[1],
            })
            # the same molecule turned over has the same checksum
            g = f.reverse_complement()
            gl, gr = digest.describe_ends(g.seq)
            assert g.seq.seguid() == value
            out.append({'top': str(g.seq.watson).upper(), 'left': gl, 'right': gr,
                        'ld': g.seq.seguid().split('=')[1], 'turnedOver': True})
    return out


def whole_circles():
    out = []
    for fixture in ('L09137.gb', 'J01749.gb', 'NC_001422.1.gb'):
        seq = fixture_sequence(fixture)
        for k in (0, 777):
            s = rotate(seq, k)
            value = Dseq(s, circular=True).seguid()
            assert value.startswith('cdseguid=')
            out.append({'fixture': fixture, 'rotation': k, 'cd': value.split('=')[1]})
    return out


def generate():
    rng = rng_for(SEED)
    return {
        'singleStranded': single_stranded(rng),
        'duplexes': duplexes(rng),
        'circles': circles(rng),
        'fragments': fragments(),
        'wholeCircles': whole_circles(),
        'seguid': seguid_pkg.__version__,
    }
