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

The 'circular' cases map reads onto a circular reference the way the Align
tab does: reads that run across the origin on either strand, a deletion
before the origin, an insertion at it, reads inside either end, and reads
the length of the whole plasmid. The expected answer is Biopython's local
alignment (both strands tried, the better kept) against the reference
rotated so that the read lies inside it, with the difference regions
(position, reference bases, read bases) it implies. Also covered: a deletion
or insertion just after the origin, which makes the reference span past it
differ from the read's length (#165), on a long and on a short circle. Left
out: banded alignments of tandem repeats or of reads ending in a long
insertion (#167).
"""
from Bio.Align import PairwiseAligner, substitution_matrices

from common import random_dna, rc, rng_for

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
    return {'cases': cases, 'long': long_cases, 'circular': circular_cases()}


def circ_slice(ref, start, n):
    return ''.join(ref[(start + k) % len(ref)] for k in range(n))


def read_mutate(rng, s, sub=0.01, indel=0.003):
    out = []
    for c in s:
        r = rng.random()
        if r < indel:
            continue
        if r < 2 * indel:
            out += [c, rng.choice('ACGT')]
        elif r < 2 * indel + sub:
            out.append(rng.choice([x for x in 'ACGT' if x != c]))
        else:
            out.append(c)
    return ''.join(out)


def regions(a, b, start, length):
    """Differences of an alignment as (1-based position on the circle, ref bases, read bases)."""
    out, cur, p = [], None, start
    for x, y in zip(a, b):
        if x != y:
            if cur is None:
                cur = [p, p - 1, '', '']
            if x != '-':
                cur[1] = p
            cur[2] += x if x != '-' else ''
            cur[3] += y if y != '-' else ''
        elif cur is not None:
            out.append(cur)
            cur = None
        if x != '-':
            p += 1
    if cur is not None:
        out.append(cur)
    return [[(c[0] if c[2] else c[1]) % length + 1, c[2] or '-', c[3] or '-'] for c in out]


def circular_cases():
    rng = rng_for(SEED + 1)
    al = aligner(False, 'local')
    kinds = ['span', 'span_rc', 'bigdel_before', 'inside_start', 'inside_end', 'whole', 'whole_rc', 'bigins_origin',
             'del_after', 'del_after_rc', 'del_after_short', 'ins_after']
    cases = []
    k = -1
    while len(cases) < 80:
        k += 1
        kind = kinds[k % len(kinds)]
        L = rng.randint(800, 2500)
        if kind == 'del_after':
            L = rng.randint(1200, 2500)
        elif kind == 'del_after_short':
            L = rng.randint(600, 900)
        ref = random_dna(rng, L)
        if kind in ('span', 'span_rc'):
            n = rng.randint(150, 600)
            x = rng.randint(20, n - 20)
            o, read = L - x, read_mutate(rng, circ_slice(ref, L - x, n))
        elif kind == 'bigdel_before':
            x, d, y = rng.randint(100, 400), rng.randint(50, 400), rng.randint(30, 200)
            o, read = L - x - d, read_mutate(rng, ref[L - x - d:L - d] + ref[:y])
        elif kind == 'inside_start':
            n = rng.randint(150, 500)
            o = rng.randint(0, 200)
            read = read_mutate(rng, ref[o:o + n])
        elif kind == 'inside_end':
            n = rng.randint(150, 500)
            o = L - n - rng.randint(0, 50)
            read = read_mutate(rng, ref[o:o + n])
        elif kind in ('whole', 'whole_rc'):
            o = rng.randint(0, L - 1)
            read = read_mutate(rng, circ_slice(ref, o, L))
        elif kind in ('del_after', 'del_after_rc', 'del_after_short'):
            # A deletion starting at or just after the origin: x bases before it, then reference d..d+y.
            short = kind == 'del_after_short'
            x, d, y = rng.randint(20, 100 if short else 300), rng.randint(5, 300 if short else 600), rng.randint(30, 150 if short else 250)
            o, read = L - x, read_mutate(rng, ref[L - x:] + ref[d:d + y])
        elif kind == 'ins_after':
            x, z, y = rng.randint(30, 300), rng.randint(0, 60), rng.randint(30, 300)
            o, read = L - x, read_mutate(rng, ref[L - x:] + ref[:z] + random_dna(rng, rng.randint(10, 150)) + ref[z:z + y])
        else:  # bigins_origin
            x, y = rng.randint(50, 300), rng.randint(50, 300)
            o, read = L - x, read_mutate(rng, ref[L - x:] + random_dna(rng, rng.randint(20, 200)) + ref[:y])
        if kind.endswith('_rc') or (kind == 'inside_start' and k % 2):
            read = rc(read)
        # Rotate so the read lies inside the reference: at its start, with room before it.
        rot = (o if kind.startswith('whole') else o - 100) % L
        rotated = ref[rot:] + ref[:rot]
        best = None
        for strand, b in (('forward', read), ('reverse', rc(read))):
            score = al.score(rotated, b)
            if best is None or score > best[0]:
                best = (score, strand, b)
        score, strand, b = best
        found = al.align(rotated, b)
        start, end = int(found[0].coordinates[0][0]), int(found[0].coordinates[0][-1])
        case = {'kind': kind, 'ref': ref, 'read': read, 'score': score, 'strand': strand, 'unique': len(found) == 1}
        # Ties between equally good alignments are rare here; the first is recorded.
        aln = found[0]
        a_row, b_row = [r for r in aln.format('fasta').split('\n') if r and not r.startswith('>')]
        case['start'] = (start + rot) % L
        case['last'] = (end - 1 + rot) % L
        case['regions'] = regions(a_row, b_row, start + rot, L)
        cases.append(case)
    return cases
