"""Pairwise alignments, for src/test/oracle/alignment.json.

Bio.Align.PairwiseAligner is the second opinion on the optimal score of a
global and a local alignment of a seeded set of pairs: DNA under EDNAFULL
(NUC.4.4, which Biopython names that) with gap open -10 and extend -0.5,
protein under BLOSUM62 with -11 and -1. Where the best alignment is unique,
the span of each sequence it covers is recorded as well; where it is not
(tandem repeats, ties, short sequences) only the score is, since which of
several equally good alignments is reported is no one's rule.

The set mixes random pairs, mutated copies, indel-heavy copies, IUPAC codes,
tandem repeats, length 1, local alignments with flanks, and two pairs
of about 3 kb that the banded path of alignLong takes. It left out
banded-local alignments with junk flanks, where the band can score below the
full matrix (#159), and empty sequences, which Biopython refuses to align.
"""
from Bio.Align import PairwiseAligner, substitution_matrices

from common import random_dna, rng_for

SEED = 20261006
PROTEIN = 'ACDEFGHIKLMNPQRSTVWY'
IUPAC = 'ACGTNRYSWKMBDHV'


def aligner(protein, mode):
    al = PairwiseAligner()
    al.mode = mode
    if protein:
        al.substitution_matrix = substitution_matrices.load('BLOSUM62')
        al.open_gap_score, al.extend_gap_score = -11, -1
    else:
        al.substitution_matrix = substitution_matrices.load('NUC.4.4')
        al.open_gap_score, al.extend_gap_score = -10, -0.5
    return al


def random_seq(rng, n, alphabet):
    return ''.join(rng.choice(alphabet) for _ in range(n))


def mutate(rng, s, sub, ins, dele, alphabet, burst=False):
    out = []
    for c in s:
        r = rng.random()
        if r < dele:
            continue
        if r < dele + sub:
            out.append(rng.choice(alphabet))
            continue
        out.append(c)
        if rng.random() < ins:
            out.append(random_seq(rng, rng.choice([1, 1, 2, 5, 12]) if burst else 1, alphabet))
    return ''.join(out) or alphabet[0]


def answer(a, b, protein, mode):
    """Optimal score and, when the best alignment is unique, the spans it covers."""
    al = aligner(protein, mode)
    out = {'score': al.score(a, b)}
    found = al.align(a, b)
    if len(found) == 1:
        c = found[0].coordinates
        out['span'] = [int(c[0][0]), int(c[0][-1]), int(c[1][0]), int(c[1][-1])]
    return out


def case(a, b, protein, kind):
    return {
        'kind': kind,
        'alphabet': 'protein' if protein else 'nucleotide',
        'a': a,
        'b': b,
        'global': answer(a, b, protein, 'global'),
        'local': answer(a, b, protein, 'local'),
    }


def generate():
    rng = rng_for(SEED)
    dna = 'ACGT'
    cases = []
    for _ in range(24):
        a = random_dna(rng, rng.randint(2, 120))
        cases.append(case(a, random_dna(rng, rng.randint(1, 120)), False, 'random'))
    for _ in range(14):
        a = random_dna(rng, rng.randint(20, 300))
        cases.append(case(a, mutate(rng, a, 0.1, 0.02, 0.02, dna), False, 'mutated'))
    for _ in range(10):
        a = random_dna(rng, rng.randint(20, 300))
        cases.append(case(a, mutate(rng, a, 0.05, 0.1, 0.1, dna, burst=True), False, 'indel-heavy'))
    for _ in range(8):
        a = random_seq(rng, rng.randint(5, 80), IUPAC[: rng.randint(5, len(IUPAC))])
        cases.append(case(a, mutate(rng, a, 0.1, 0.03, 0.03, IUPAC), False, 'iupac'))
    for _ in range(6):
        core = random_dna(rng, rng.randint(40, 200))
        b = mutate(rng, core, 0.05, 0.03, 0.03, dna)
        a = random_dna(rng, rng.randint(5, 80)) + core + random_dna(rng, rng.randint(5, 80))
        cases.append(case(a, b, False, 'flanked'))
    for _ in range(8):
        unit = random_dna(rng, rng.randint(1, 4))
        a = unit * rng.randint(2, 15)
        cases.append(case(a, unit * rng.randint(2, 15) + random_dna(rng, rng.randint(0, 3)), False, 'tandem'))
    for a, b in [('A', 'A'), ('A', 'G'), ('A', 'AC'), ('AC', 'T'), ('T', 'AGGT'), ('N', 'A')]:
        cases.append(case(a, b, False, 'short'))
    for _ in range(9):
        a = random_seq(rng, rng.randint(5, 100), PROTEIN)
        cases.append(case(a, mutate(rng, a, 0.2, 0.05, 0.05, PROTEIN), True, 'protein-mutated'))
    for _ in range(4):
        cases.append(
            case(random_seq(rng, rng.randint(5, 80), PROTEIN), random_seq(rng, rng.randint(5, 80), PROTEIN), True, 'protein-random')
        )
    for a, b in [('M', 'M'), ('W', 'A')]:
        cases.append(case(a, b, True, 'protein-short'))

    # Two pairs of about 3 kb for the banded global path (alignBanded).
    long_cases = []
    for _ in range(2):
        ref = random_dna(rng, 3000)
        read = mutate(rng, ref[rng.randint(0, 100): len(ref) - rng.randint(0, 100)], 0.03, 0.01, 0.01, dna, burst=True)
        p = len(read) // 2
        read = read[:p] + read[p + 150:] if len(long_cases) else read
        long_cases.append({'a': ref, 'b': read, 'global': aligner(False, 'global').score(ref, read)})
    return {'cases': cases, 'long': long_cases}
