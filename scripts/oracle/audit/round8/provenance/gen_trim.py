"""Round-8 trim probe generator: linear sticky-ended docs, CDS near the tips.

usage: gen_trim.py out.json N seed
Each case: seq, ends, features (CDS fwd/rev/join, codon_start, transl_table,
/translation from Biopython), ops = list of 'bt' | 'bf' | 'rc'.
"""
import json, random, sys
from Bio.Seq import Seq

OUT, N, SEED = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
rng = random.Random(SEED)
B = 'ACGT'
COMP = str.maketrans('ACGTacgt', 'TGCAtgca')


def rc(s):
    return s.translate(COMP)[::-1]


def rs(n):
    return ''.join(rng.choice(B) for _ in range(n))


def reading(seq, segs, strand):
    s = ''.join(seq[a:b] for a, b in segs)
    return rc(s) if strand == 'reverse' else s


def translation(bases, cs, table):
    r = bases[cs - 1:]
    r = r[: len(r) - len(r) % 3]
    p = str(Seq(r).translate(table=table))
    return p[:-1] if p.endswith('*') else p


def make_end():
    kind = rng.choice(["5'", "3'", 'blunt', "5'", "3'"])
    if kind == 'blunt':
        return {'kind': 'blunt', 'overhang': '', 'enzyme': 'X'}
    return {'kind': kind, 'overhang': rs(rng.randint(1, 6)), 'enzyme': 'X'}


def make_case(cid):
    L = rng.randint(50, 140)
    seq = rs(L)
    if rng.random() < 0.3:
        seq = seq.lower()
    left, right = make_end(), make_end()
    # top-strand overhang bases are the sequence's own
    if left['kind'] == "5'":
        seq = left['overhang'] + seq[len(left['overhang']):]
        left['overhang'] = seq[: len(left['overhang'])].upper()
    if right['kind'] == "3'":
        k = len(right['overhang'])
        seq = seq[: L - k] + right['overhang']
        right['overhang'] = seq[L - k:].upper()
    feats = []
    for fi in range(rng.randint(1, 3)):
        strand = rng.choice(['forward', 'reverse'])
        join = rng.random() < 0.3
        # anchor near a tip
        tip = rng.choice(['start', 'end', 'both', 'none'])
        if join:
            nseg = rng.randint(2, 3)
            lens = [rng.randint(1, 15) for _ in range(nseg)]
            gaps = [rng.randint(1, 8) for _ in range(nseg - 1)]
            span = sum(lens) + sum(gaps)
            if span >= L:
                continue
        else:
            span = rng.randint(3, L)
            lens, gaps = [span], []
        if tip == 'start':
            s = rng.randint(0, 6)
        elif tip == 'end':
            s = L - span - rng.randint(0, 6)
        elif tip == 'both':
            s = 0
            if not join:
                span = L - rng.randint(0, 3)
                lens = [span]
        else:
            s = rng.randint(0, L - span)
        s = max(0, min(s, L - sum(lens) - sum(gaps)))
        segs = []
        cur = s
        for i, n in enumerate(lens):
            segs.append([cur, cur + n])
            cur += n + (gaps[i] if i < len(gaps) else 0)
        if segs[-1][1] > L:
            continue
        cs = rng.choice([1, 1, 2, 3])
        table = rng.choice([1, 11, 4])
        p5 = rng.random() < 0.1
        p3 = rng.random() < 0.1
        q = [['codon_start', str(cs)]]
        if table != 1:
            q.append(['transl_table', str(table)])
        bases = reading(seq.upper(), segs, strand)
        if len(bases) >= cs - 1 + 3:
            q.append(['translation', translation(bases, cs, table)])
        R = []
        for a, b in segs:
            R += list(range(a, b))
        if strand == 'reverse':
            R = R[::-1]
        cands = []
        for i in range(cs - 1, len(R) - 2, 3):
            cod = R[i:i + 3]
            d = 1 if strand == 'forward' else -1
            if cod[1] == cod[0] + d and cod[2] == cod[1] + d:
                cands.append(cod)
        if cands and rng.random() < 0.5:
            cod = rng.choice(cands)
            lo, hi = min(cod) + 1, max(cod) + 1
            loc = f'{lo}..{hi}' if strand == 'forward' else f'complement({lo}..{hi})'
            q.append(['transl_except', f'(pos:{loc},aa:Sec)'])
        q.append(['note', 'n%d' % fi])
        segments = [[a, b, False, False] for a, b in segs]
        # partial marks: 5' end is segment 0 start (fwd) or last end (rev)
        if p5:
            if strand == 'forward':
                segments[0][2] = True
            else:
                segments[-1][3] = True
        if p3:
            if strand == 'forward':
                segments[-1][3] = True
            else:
                segments[0][2] = True
        feats.append({'type': 'CDS', 'name': 'f%d' % fi, 'strand': strand,
                      'segments': segments, 'qualifiers': q})
    if not feats:
        return None
    ops = [rng.choice(['bt', 'bf', 'rc']) for _ in range(rng.choice([1, 1, 2, 3]))]
    return {'id': cid, 'seq': seq, 'ends': {'left': left, 'right': right},
            'features': feats, 'ops': ops}


cases = []
i = 0
while len(cases) < N:
    c = make_case(i)
    i += 1
    if c:
        cases.append(c)
json.dump(cases, open(OUT, 'w'))
print(len(cases), 'cases')
