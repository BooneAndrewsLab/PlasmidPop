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

The 'banded' cases are the ones a band around shared words can miss (#167):
a tandem duplication in the read or in the reference, and a long insertion
a few bases from either end of the read, each a Sanger-length read of a
3 kb reference. Both optimal scores are recorded; the banded path has to
reach them, the global one exactly and the local one through either strand.

The 'circular' cases map reads onto a circular reference the way the Align
tab does: reads that run across the origin on either strand, a deletion
before the origin, an insertion at it, reads inside either end, and reads
the length of the whole plasmid. The expected answer is Biopython's local
alignment (both strands tried, the better kept) against the reference
rotated so that the read lies inside it, with the difference regions
(position, reference bases, read bases) it implies. Also covered: a deletion
or insertion just after the origin, which makes the reference span past it
differ from the read's length (#165), on a long and on a short circle. """
import io

from Bio import SeqIO
from Bio.Align import PairwiseAligner, substitution_matrices
from Bio.Seq import Seq
from Bio.SeqFeature import CompoundLocation, SeqFeature, SimpleLocation
from Bio.SeqRecord import SeqRecord

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
    return {'cases': cases, 'long': long_cases, 'circular': circular_cases(), 'banded': banded_cases(),
            'circularScores': circular_score_cases(), 'effects': effect_cases(),
            'circularReads': circular_read_cases()}


def banded_cases():
    """Pairs whose best path leaves the band the shared words give (#167)."""
    rng = rng_for(SEED + 2)
    dna = 'ACGT'
    kinds = ['tandem_read', 'tandem_ref', 'insert_start', 'insert_end']
    cases = []
    for k in range(24):
        kind = kinds[k % len(kinds)]
        noise = rng.choice([0.003, 0.01, 0.02])
        unit = random_dna(rng, rng.randint(20, 300))
        at = rng.randint(400, 800)
        left = random_dna(rng, at)
        right = random_dna(rng, 3000 - at)
        if kind == 'tandem_read':
            ref = left + unit + right
            read = left[-rng.randint(200, 400):] + unit + mutate(rng, unit, 0.02, 0, 0, dna) + right[:rng.randint(200, 600)]
        elif kind == 'tandem_ref':
            ref = left + unit + mutate(rng, unit, 0.02, 0, 0, dna) + right
            read = left[-rng.randint(200, 400):] + unit + right[:rng.randint(200, 600)]
        else:
            ref = left + right
            start = rng.randint(0, 2000)
            body = ref[start:start + rng.randint(500, 1000)]
            near = rng.randint(5, 40)
            ins = random_dna(rng, rng.randint(30, 330))
            if kind == 'insert_start':
                read = body[:near] + ins + body[near:]
            else:
                read = body[:len(body) - near] + ins + body[len(body) - near:]
        read = mutate(rng, read, noise, noise / 2, noise / 2, dna)
        cases.append({
            'kind': kind,
            'a': ref,
            'b': read,
            'global': aligner(False, 'global').score(ref, read),
            'local': max(aligner(False, 'local').score(ref, read), aligner(False, 'local').score(ref, rc(read))),
        })
    return cases


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


def sprinkle(rng, s, k):
    s = list(s)
    for _ in range(k):
        j = rng.randrange(len(s))
        s[j] = rng.choice([x for x in 'ACGT' if x != s[j]])
    return ''.join(s)


def circular_score_cases():
    """Local score of a read on a circle against the doubled reference.

    Biopython aligns the read (both strands, the better kept) to the reference
    written twice, less its last base, so that any read up to the plasmid's
    length plus a little lies inside it. Reads: a tiny circle, a read over half
    of it, a deletion or an insertion before the origin and a deletion just
    after it, a tandem repeat across the origin with a unit lost or gained, and a
    read longer than the circle. Left out: a read starting within 15 bases before the
    origin with a mismatch at the junction, which the banded path (a reference
    over 12 kb, or fast mode) can place one copy along and score too low (#175).
    """
    rng = rng_for(SEED + 2)
    al = aligner(False, 'local')
    kinds = ['tiny', 'half', 'del_origin', 'ins_before', 'tandem_origin', 'whole_plus']
    cases = []
    k = -1
    while len(cases) < 60:
        k += 1
        kind = kinds[k % len(kinds)]
        L = rng.randint(300, 1500)
        ref = random_dna(rng, L)
        if kind == 'tiny':
            L = rng.randint(40, 150)
            ref = random_dna(rng, L)
            o = rng.randint(0, L - 16)
            read = sprinkle(rng, circ_slice(ref, o, rng.randint(L // 2, L)), rng.randint(0, 2))
        elif kind == 'half':
            o = rng.randint(0, L - 16)
            read = sprinkle(rng, circ_slice(ref, o, rng.randint(L // 2, L - 1)), rng.randint(0, 5))
        elif kind == 'whole_plus':
            o = rng.randint(0, L - 16)
            read = sprinkle(rng, circ_slice(ref, o, L + rng.randint(5, 200)), rng.randint(0, 3))
        elif kind == 'del_origin':
            x, y = rng.randint(40, 300), rng.randint(40, 300)
            body = circ_slice(ref, L - x, x + y)
            at = x + rng.choice([0, 1, 2, 3, 5, -1, -2, -3, -5])
            read = sprinkle(rng, body[:at] + body[at + rng.randint(1, 3):], rng.randint(0, 3))
        elif kind == 'ins_before':
            x, y = rng.randint(40, 300), rng.randint(40, 300)
            body = circ_slice(ref, L - x, x + y)
            at = x - rng.choice([1, 2, 3, 5, 8])
            read = sprinkle(rng, body[:at] + random_dna(rng, rng.randint(1, 3)) + body[at:], rng.randint(0, 3))
        else:  # tandem_origin
            unit = random_dna(rng, rng.randint(2, 12))
            tr = unit * rng.randint(4, 12)
            cut = rng.randint(1, len(tr) - 1)
            ref = tr[cut:] + random_dna(rng, L - len(tr)) + tr[:cut]
            L = len(ref)
            x, y = rng.randint(100, 300), rng.randint(100, 300)
            body = circ_slice(ref, L - x - (len(tr) - cut), x + len(tr) + y)
            p = x + rng.randint(0, len(tr) - len(unit))
            read = body[:p] + unit + body[p:] if rng.random() < 0.5 else body[:p] + body[p + len(unit):]
        if rng.random() < 0.5:
            read = rc(read)
        doubled = ref + ref[:L - 1]
        score = max(al.score(doubled, read), al.score(doubled, rc(read)))
        cases.append({'kind': kind, 'ref': ref, 'read': read, 'score': score})
    return cases


def effect_cases():
    """The protein effect of one substitution, read across the origin.

    A 600 bp circle with a CDS across its origin (a join of two or four
    segments, either strand, /codon_start 1 to 3), written as GenBank by Biopython.
    A read from 250 bases before the origin to 250 after it carries one
    substitution at a base near the origin or a segment boundary, forward and
    reverse complemented. The expected 'p.X{n}Y' (or 'silent') is Biopython
    translating the CDS of the plasmid with and without the substitution.
    Left out: reads that start within 15 bases before the origin (#175) and
    insertions just after it (#177).
    """
    rng = rng_for(SEED + 3)
    L = 600
    locs = {
        'fwd_join': [(570, 600, 1), (0, 60, 1)],
        'rev_join': [(570, 600, -1), (0, 60, -1)],
        'fwd_multi': [(540, 560, 1), (580, 600, 1), (0, 30, 1), (40, 70, 1)],
        'rev_multi': [(540, 560, -1), (580, 600, -1), (0, 30, -1), (40, 70, -1)],
        'fwd_short': [(598, 600, 1), (0, 61, 1)],
        'rev_short': [(599, 600, -1), (0, 62, -1)],
    }
    out = []
    for name, parts in locs.items():
        for cs in (1, 2, 3):
            for _ in range(2):
                seq = random_dna(rng, L)
                strand = parts[0][2]
                pieces = [SimpleLocation(a, b, strand=st) for a, b, st in parts]
                if strand == -1:
                    pieces = pieces[::-1]  # Biopython stores complement(join(a,b)) reversed
                loc = CompoundLocation(pieces)
                f = SeqFeature(loc, type='CDS',
                               qualifiers={'codon_start': [str(cs)], 'transl_table': ['11'], 'label': ['g']})
                rec = SeqRecord(Seq(seq), id='T', name='T',
                                annotations={'molecule_type': 'DNA', 'topology': 'circular'}, features=[f])
                handle = io.StringIO()
                SeqIO.write(rec, handle, 'genbank')

                def protein(s):
                    nt = str(f.extract(Seq(s)))
                    return str(Seq(nt[cs - 1:][:(len(nt) - cs + 1) // 3 * 3]).translate(table=11))

                ref_aa = protein(seq)
                order = []  # genomic positions in reading order
                for piece in pieces:
                    r = list(range(piece.start, piece.end))
                    order += r if strand == 1 else r[::-1]
                order = order[cs - 1:]
                near = [p for p in order if min(p, L - p) <= 8 or p in (559, 560, 580, 581, 29, 30, 39, 40)]
                rng.shuffle(near)
                subs = []
                for at in near:
                    idx = order.index(at) // 3
                    if idx == 0 or idx >= len(ref_aa) or len(subs) == 4:
                        continue
                    base = rng.choice([c for c in 'ACGT' if c != seq[at]])
                    mut = protein(seq[:at] + base + seq[at + 1:])
                    diff = [i for i in range(len(ref_aa)) if ref_aa[i] != mut[i]]
                    if not diff:
                        expected = 'silent'
                    else:
                        i = diff[0]
                        x, y = ref_aa[i], mut[i]
                        expected = f'p.{x}{i + 1}*' if y == '*' else f'p.*{i + 1}{y}' if x == '*' else f'p.{x}{i + 1}{y}'
                    subs.append({'at': at, 'base': base, 'expected': expected})
                out.append({'loc': name, 'cs': cs, 'seq': seq, 'genbank': handle.getvalue(), 'subs': subs})
    return out


def read_mutate_near(rng, s, near, count, region):
    """count substitutions, insertions or deletions within region bases of near."""
    s = list(s)
    for _ in range(count):
        p = max(0, min(len(s) - 1, near + rng.randint(-region, region)))
        k = rng.choice('sid')
        if k == 's':
            s[p] = rng.choice([b for b in 'ACGT' if b != s[p]])
        elif k == 'i':
            s.insert(p, rng.choice('ACGT'))
        else:
            del s[p]
    return ''.join(s)


def circular_read_cases():
    """Where a read across the origin maps, and its score, on a circle (#175).

    Three circles (4 kb and 12 kb random, a 3.5 kb one whose ends carry
    a 37 bp tandem repeat) and reads of 600 and 1500 bases that start 25 bases
    before the origin to 5 after it (and a few that centre on it), some with
    substitutions, indels or a mismatch just before the origin, some reverse
    complemented, plus a read of the whole circle and 0, 5 or 40 bases more, and
    one substitution, insertion or deletion exactly at the origin. The score is
    Biopython's local alignment of the read, both strands, against the reference
    written twice less its last base. The position is the local alignment to
    the reference rotated to put the read in the middle, for reads shorter
    than half of it: where the read starts on the circle, how many reference bases it
    spans, and the span of the read. Left out: the document diff (#184).
    """
    rng = rng_for(SEED + 4)
    al = aligner(False, 'local')
    unit = random_dna(rng, 37)
    refs = {
        'rand4k': random_dna(rng, 4000),
        'rand12k': random_dna(rng, 12000),
        'tandem': unit * 8 + random_dna(rng, 3000) + unit * 6,
    }
    cases = []
    for name, ref in refs.items():
        L = len(ref)
        dbl = ref + ref
        reads = []  # (read, offset, kind)
        for m in (600, 1500):
            offs = list(range(L - 25, L)) + list(range(0, 6)) + [L - m // 2, L - m + 3, L - m - 2]
            for k, o in enumerate(offs):
                o %= L
                read = (dbl + dbl)[o:o + m]
                near = (L - o) % L
                variant = k % 4
                if variant == 1:
                    read = read_mutate_near(rng, read, near if near < m else 0, 3, 8)
                elif variant == 2:
                    read = read_mutate_near(rng, read, max(0, near - 3), 1, 2)
                elif variant == 3:
                    read = read_mutate_near(rng, read, rng.randint(0, m - 1), 6, 400)
                reads.append((read, o, 'near_origin'))
        for extra in (0, 5, 40):
            if L < 5000:
                reads.append(((dbl + dbl)[L - 10:L - 10 + L + extra], L - 10, 'whole'))
        for kind in ('ins', 'del', 'sub'):
            body = dbl[L - 300:L + 300]
            if kind == 'ins':
                body = body[:300] + 'T' + body[300:]
            elif kind == 'del':
                body = body[:300] + body[301:]
            else:
                body = body[:300] + ('A' if body[300] != 'A' else 'C') + body[301:]
            reads.append((body, L - 300, 'at_origin_' + kind))
        doubled = ref + ref[:L - 1]
        for read, o, kind in reads:
            if rng.random() < 0.5:
                read = rc(read)
            fwd, rev = al.score(doubled, read), al.score(doubled, rc(read))
            strand = 'forward' if fwd >= rev else 'reverse'
            q = read if strand == 'forward' else rc(read)
            case = {'ref': name, 'read': read, 'kind': kind, 'score': max(fwd, rev), 'strand': strand}
            if len(read) < L // 2:
                r = (o + len(read) // 2 - L // 2) % L
                rot = ref[r:] + ref[:r]
                co = al.align(rot, q)[0].coordinates
                case['position'] = [int((co[0][0] + r) % L), int(co[0][-1] - co[0][0]),
                                    int(co[1][0]), int(co[1][-1])]
            cases.append(case)
    return {'refs': refs, 'cases': cases}
