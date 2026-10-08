"""Round-8 PCR provenance probe generator.

usage: gen_pcr.py out.json N seed
Template with CDS (fwd/rev/join, across origin on circles) carrying a
Biopython /translation; a primer pair whose annealing parts may carry
mismatches (5' of the last 13 bases), inside or outside a CDS, with tails.
"""
import json, random, sys
from Bio.Seq import Seq

OUT, N, SEED = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
rng = random.Random(SEED)
OVERLAP = len(sys.argv) > 4
B = 'ACGT'
COMP = str.maketrans('ACGTacgt', 'TGCAtgca')


def rc(s):
    return s.translate(COMP)[::-1]


def rs(n):
    return ''.join(rng.choice(B) for _ in range(n))


def mutate(s, k, protect3):
    s = list(s)
    idx = list(range(0, len(s) - protect3))
    for i in rng.sample(idx, min(k, len(idx))):
        s[i] = rng.choice([b for b in B if b != s[i].upper()])
    return ''.join(s)


def make_case(cid):
    circ = rng.random() < 0.6
    L = rng.randint(150, 400)
    seq = rs(L)
    if rng.random() < 0.3:
        seq = seq.lower()
    # amplicon
    fs = rng.randrange(L) if circ else rng.randrange(0, L // 3)
    n_f = rng.randint(18, 26)
    n_r = rng.randint(18, 26)
    span = rng.randint(n_f + n_r + 10, L - 5 if circ else L - fs)
    if circ and OVERLAP:
        span = L + rng.randint(3, min(n_f, n_r) - 3)
    if not circ and fs + span > L:
        return None
    re_ = fs + span  # unrolled end
    U = seq * 3 if circ else seq
    fanneal = U[fs:fs + n_f].upper()
    ranneal_top = U[re_ - n_r:re_].upper()
    k = rng.choice([0, 0, 1, 1, 2])
    fmut = mutate(fanneal, k, 13) if rng.random() < 0.6 else fanneal
    rmut = mutate(ranneal_top, rng.choice([0, 1, 2]), 0) if rng.random() < 0.5 else ranneal_top
    # rmut mismatches must avoid the reverse primer's 3' end = top-strand 5' end
    rmut = list(rmut)
    for i in range(min(13, len(rmut))):
        rmut[i] = ranneal_top[i]
    rmut = ''.join(rmut)
    ftail = rs(rng.choice([0, 0, 6, 10]))
    rtail = rs(rng.choice([0, 0, 6, 10]))
    fprimer = ftail + fmut
    rprimer = rtail + rc(rmut)
    feats = []
    for fi in range(rng.randint(1, 4)):
        strand = rng.choice(['forward', 'reverse'])
        where = rng.choice(['in', 'in', 'fprimer', 'rprimer', 'any'])
        if where == 'fprimer':
            s = fs + rng.randint(-5, n_f - 3)
        elif where == 'rprimer':
            s = re_ - rng.randint(5, n_r + 5)
        elif where == 'in':
            s = fs + rng.randint(0, max(0, span - 10))
        else:
            s = rng.randrange(L)
        join = rng.random() < 0.25
        if join:
            segs = []
            cur = s
            for _ in range(rng.randint(2, 3)):
                ln = rng.randint(3, 15)
                segs.append([cur, cur + ln])
                cur += ln + rng.randint(2, 8)
        else:
            ln = rng.randint(6, max(7, min(90, span)))
            if where == 'rprimer':
                s = re_ - rng.randint(1, n_r + 3) - ln + rng.randint(0, 10)
            segs = [[s, s + ln]]
        # normalise into [0, L) (may run past L on a circle)
        if segs[0][0] < 0:
            if not circ:
                continue
            segs = [[a + L, b + L] for a, b in segs]
        if segs[0][0] >= L:
            segs = [[a - L, b - L] for a, b in segs]
        if circ:
            if segs[-1][1] - segs[0][0] >= L:
                continue
            segs = [[a - L, b - L] if a >= L else [a, b] for a, b in segs]
        elif segs[-1][1] > L:
            continue
        cs = rng.choice([1, 1, 2, 3])
        table = rng.choice([1, 11])
        Ux = (seq + seq).upper()
        bases = ''.join(Ux[a:b] for a, b in segs)
        if strand == 'reverse':
            bases = rc(bases)
        body = bases[cs - 1:]
        body = body[: len(body) - len(body) % 3]
        q = [['codon_start', str(cs)]]
        if table != 1:
            q.append(['transl_table', str(table)])
        if body:
            p = str(Seq(body).translate(table=table))
            q.append(['translation', p[:-1] if p.endswith('*') else p])
        feats.append({'type': 'CDS', 'name': 'f%d' % fi, 'strand': strand,
                      'segments': [[a, b, False, False] for a, b in segs], 'qualifiers': q})
    if not feats:
        return None
    return {'id': cid, 'seq': seq, 'topology': 'circular' if circ else 'linear',
            'features': feats, 'primers': [fprimer, rprimer], 'taq': rng.random() < 0.2,
            'fs': fs, 'span': span, 'n_f': n_f, 'n_r': n_r}


cases = []
i = 0
while len(cases) < N:
    c = make_case(i)
    i += 1
    if c:
        cases.append(c)
json.dump(cases, open(OUT, 'w'))
print(len(cases), 'cases')
