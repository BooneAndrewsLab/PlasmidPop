"""CRISPR guides found with Biopython, for src/test/oracle/crispr.json.

The PAM search here is Bio.SeqUtils.nt_search, which expands the IUPAC codes
of the pattern itself and searches a plain string: an independent matcher,
not a port of ours. Everything else is written straight from the published
description of each nuclease — SpCas9 blunt three bases in from NGG (Jinek
2012), SaCas9 the same from NNGRRT (Ran 2015), AsCas12a staggered after
bases 18 and 23 of a 23 nt spacer 3' of TTTV (Zetsche 2015) — rather than
from src/core/analysis/crispr.ts.

A circle is searched as seq + seq[:W-1] so a window may cross the origin,
and the reverse strand as the reverse complement of the whole molecule. The
fixtures are plain ACGT, so "a base that could match" and "a base that does
match" are the same thing here and the off-target counts are plain Hamming
distances between the spacers of every pair of PAM-adjacent sites.
"""
import os

from Bio.Seq import Seq
from Bio.SeqUtils import nt_search

from common import FIXTURES, fixture_sequence, random_dna, rc, rng_for, rotate

SEED = 20261009

NUCLEASES = {
    'spcas9': {'pam': 'NGG', 'pamSide': '3prime', 'spacerLength': 20, 'cut': {'pamStrand': 17, 'targetStrand': 17}},
    'sacas9': {'pam': 'NNGRRT', 'pamSide': '3prime', 'spacerLength': 21, 'cut': {'pamStrand': 18, 'targetStrand': 18}},
    'ascas12a': {'pam': 'TTTV', 'pamSide': '5prime', 'spacerLength': 23, 'cut': {'pamStrand': 18, 'targetStrand': 23}},
}

MAX_MISMATCHES = 3


def pam_starts(text, pam):
    """Where `pam` matches in `text`, by Biopython's own IUPAC search."""
    found = nt_search(text, pam)[1:]
    return [int(p) for p in found]


def strand_sites(text, length, circular, n):
    """(spacer_at, pam_at, spacer, pam) for every PAM-adjacent window of one strand."""
    W = n['spacerLength'] + len(n['pam'])
    if length < W:
        return []
    read = text + text[: W - 1] if circular else text
    out = []
    for p in pam_starts(read, n['pam']):
        if n['pamSide'] == '3prime':
            spacer_at = p - n['spacerLength']
        else:
            spacer_at = p + len(n['pam'])
        if spacer_at < 0 or spacer_at + n['spacerLength'] > len(read):
            continue
        if p + len(n['pam']) > len(read):
            continue
        # A window must start inside the molecule, and on a line must end in it.
        start = min(spacer_at, p)
        if start >= (length if circular else length - W + 1):
            continue
        out.append((spacer_at, p, read[spacer_at : spacer_at + n['spacerLength']], read[p : p + len(n['pam'])]))
    return sorted(out)


def to_forward(strand, a, width, length, circular):
    if strand == 'forward':
        start = a % length if circular else a
    else:
        start = length - (a + width)
        if circular:
            start %= length
    return [start, start + width]


def boundary(strand, x, length, circular):
    b = x if strand == 'forward' else length - x
    return b % length if circular else b


def guides_of(sequence, circular, n, off_targets=True):
    """Every guide, with its PAM, cut boundaries and off-target counts."""
    length = len(sequence)
    sites = []
    for strand in ('forward', 'reverse'):
        text = sequence if strand == 'forward' else rc(sequence)
        for spacer_at, pam_at, spacer, pam in strand_sites(text, length, circular, n):
            sites.append((strand, spacer_at, pam_at, spacer, pam))

    guides = []
    for strand, spacer_at, pam_at, spacer, pam in sites:
        if set(spacer) - set('ACGT'):
            continue
        pam_cut = boundary(strand, spacer_at + n['cut']['pamStrand'], length, circular)
        target_cut = boundary(strand, spacer_at + n['cut']['targetStrand'], length, circular)
        counts = [0] * (MAX_MISMATCHES + 1)
        if off_targets:
            for other in sites:
                if other[0] == strand and other[1] == spacer_at:
                    continue
                mm = sum(1 for a, b in zip(spacer, other[3]) if a != b)
                if mm <= MAX_MISMATCHES:
                    counts[mm] += 1
        guides.append(
            {
                'range': to_forward(strand, spacer_at, n['spacerLength'], length, circular),
                'strand': strand,
                'spacer': spacer,
                'pam': pam,
                'pamRange': to_forward(strand, pam_at, len(n['pam']), length, circular),
                'cut': [pam_cut, target_cut] if strand == 'forward' else [target_cut, pam_cut],
                'offTargets': counts,
            }
        )
    guides.sort(key=lambda g: (g['range'][0], 0 if g['strand'] == 'forward' else 1))
    return guides


def case(label, sequence, topology, nuclease, off_targets=True, fixture=None):
    n = NUCLEASES[nuclease]
    body = {'label': label, 'topology': topology, 'nuclease': nuclease,
            'guides': guides_of(sequence.upper(), topology == 'circular', n, off_targets)}
    if fixture is None:
        body['sequence'] = sequence
    else:
        body['fixture'] = fixture
    return body


def generate():
    rng = rng_for(SEED)
    cases = [
        # Real plasmids, as they are. pUC19 carries the off-target counts:
        # it is small enough for the all-pairs comparison here.
        case('pUC19 SpCas9', fixture_sequence('L09137.gb'), 'circular', 'spcas9', fixture='L09137.gb'),
        case('pUC19 SaCas9', fixture_sequence('L09137.gb'), 'circular', 'sacas9', fixture='L09137.gb'),
        case('pUC19 AsCas12a', fixture_sequence('L09137.gb'), 'circular', 'ascas12a', fixture='L09137.gb'),
        case('pBR322 SpCas9', fixture_sequence('J01749.gb'), 'circular', 'spcas9', False, 'J01749.gb'),
        case('phiX174 SpCas9', fixture_sequence('NC_001422.1.gb'), 'circular', 'spcas9', False, 'NC_001422.1.gb'),
        # The same molecule opened at another base: the guides must be the same.
        case('pUC19 rotated 1337, SpCas9', rotate(fixture_sequence('L09137.gb'), 1337), 'circular', 'spcas9', False),
        # A linear record, where a window may not run off the end.
        case('U49845 SpCas9 linear', fixture_sequence('U49845.gb'), 'linear', 'spcas9', False, 'U49845.gb'),
    ]
    # Random circles, where the origin lands inside spacers and PAMs.
    for i in range(12):
        seq = random_dna(rng, rng.randrange(40, 300), gc=rng.choice([0.3, 0.5, 0.7]))
        topology = 'circular' if i % 2 == 0 else 'linear'
        cases.append(case(f'random {i}', seq, topology, rng.choice(list(NUCLEASES))))
    return {'maxMismatches': MAX_MISMATCHES, 'nucleases': NUCLEASES, 'cases': cases}
