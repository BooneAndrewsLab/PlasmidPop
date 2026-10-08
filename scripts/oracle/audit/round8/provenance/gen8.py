"""Round-7 provenance generator: two versions of one plasmid (edited copy / mutant).

usage: gen.py out.json N seed
src0 = random plasmid with features and planted palindromic cut sites;
src1 = src0 with 1-2 edits (sub/ins/del/replace) mostly inside features, same ids.
Plans mix fragments of the two versions, flip/rc/edit them, and ligate.
"""
import json, random, sys

OUT = sys.argv[1]
N = int(sys.argv[2])
rng = random.Random(int(sys.argv[3]))
BASES = 'ACGT'
TABLES = [1, 11, 4, 2]
TRANSFORM_P = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
PAL = ['AATT', 'GATC', 'TCGA', 'CATG', 'AGCT', 'GC', 'TA', 'blunt']


def rand_seq(n):
    return ''.join(rng.choice(BASES) for _ in range(n))


def reading(L, segs, strand):
    pos = []
    for s, e in segs:
        pos += [p % L for p in range(s, e)]
    return pos[::-1] if strand == 'reverse' else pos


def make_feature(L, name, kind, ftype, linear):
    strand = rng.choice(['forward', 'reverse'])
    segs = []
    if kind == 'simple':
        n = rng.randint(15, max(16, L // 2))
        s = rng.randrange(L)
        segs = [(s, s + n)]
    else:
        nseg = rng.randint(2, 3)
        s = rng.randrange(L)
        cur = s
        for _ in range(nseg):
            n = rng.randint(6, 18)
            segs.append((cur, cur + n))
            cur += n + rng.randint(3, 12)
        if cur - s >= L - 2:
            return None
    norm = []
    for a, b in segs:
        if a >= L:
            a, b = a - L, b - L
        norm.append((a, b))
    segs = norm
    if linear and any(b > L for a, b in segs):
        return None
    f = {'type': ftype, 'name': name, 'strand': strand,
         'segments': [[a, b, False, False] for a, b in segs], 'qualifiers': []}
    if rng.random() < 0.1:
        f['segments'][0][2] = True
    if ftype == 'CDS':
        cs = rng.choice([1, 1, 2, 3])
        f['qualifiers'].append(['codon_start', str(cs)])
        t = rng.choice(TABLES)
        if t != 1:
            f['qualifiers'].append(['transl_table', str(t)])
        f['qualifiers'].append(['note', 'n-' + name])
        if rng.random() < 0.5:
            R = reading(L, segs, strand)
            cands = []
            for i in range(cs - 1, len(R) - 2, 3):
                cod = R[i:i + 3]
                d = 1 if strand == 'forward' else -1
                if cod[1] == cod[0] + d and cod[2] == cod[1] + d:
                    cands.append(cod)
            if cands:
                cod = rng.choice(cands)
                lo, hi = min(cod) + 1, max(cod) + 1
                loc = f'{lo}..{hi}' if strand == 'forward' else f'complement({lo}..{hi})'
                f['qualifiers'].append(['transl_except', f'(pos:{loc},aa:Sec)'])
    return f


def near(p, ps, L, w):
    return any(min(abs(p - q), L - abs(p - q)) < w for q in ps)


def make_case(cid):
    linear = rng.random() < 0.15
    L = rng.randint(80, 200)
    seq = list(rand_seq(L))
    feats = []
    for fi in range(rng.randint(1, 3)):
        f = make_feature(L, 'f%d' % fi, rng.choice(['simple', 'simple', 'join']), 'CDS', linear)
        if f:
            feats.append(f)
    if rng.random() < 0.4:
        f = make_feature(L, 'misc', 'simple', 'misc_feature', linear)
        if f:
            feats.append(f)
    # cuts: prefer inside features
    k = rng.choice([1, 2, 2, 3]) if not linear else rng.choice([1, 2])
    ov = rng.choice(PAL)
    kind = rng.choice(['5', '3'])
    positions = []
    tries = 0
    while len(positions) < k and tries < 500:
        tries += 1
        if feats and rng.random() < 0.7:
            f = rng.choice(feats)
            a, b, *_ = rng.choice(f['segments'])
            p = rng.randrange(a, b) % L
        else:
            p = rng.randrange(L)
        if linear and not (8 <= p <= L - 12):
            continue
        if not near(p, positions, L, 14):
            positions.append(p)
    positions.sort()
    cuts = []
    for p in positions:
        if ov == 'blunt':
            cuts.append({'cut': p, 'cutBottom': p})
            continue
        d = len(ov)
        for j in range(d):
            seq[(p + j) % L] = ov[j]
        if kind == '5':
            cuts.append({'cut': p, 'cutBottom': (p + d) % L if not linear else p + d})
        else:
            cuts.append({'cut': (p + d) % L if not linear else p + d, 'cutBottom': p})
    cuts.sort(key=lambda c: c['cut'])
    seq = ''.join(seq)
    topo = 'linear' if linear else 'circular'
    src0 = {'seq': seq, 'features': feats, 'name': 'v1', 'topology': topo, 'translate': True}

    # edits for v2, away from cut sites (+-8), non-wrapping
    edits = []
    cur_len = L
    cut_pos = [c['cut'] for c in cuts]
    cb_pos = [c['cutBottom'] for c in cuts]
    for _ in range(rng.choice([1, 1, 2])):
        for _t in range(200):
            if feats and rng.random() < 0.8:
                f = rng.choice(feats)
                a, b, *_ = rng.choice(f['segments'])
                a0 = rng.randrange(a, b)
            else:
                a0 = rng.randrange(cur_len)
            a0 %= cur_len
            op = rng.choice(['sub', 'sub', 'ins', 'del', 'rep', 'ins3', 'del3'])
            n = rng.randint(1, 6)
            if op == 'sub':
                e, t = a0 + 1, None
            elif op == 'ins':
                e, t = a0, rand_seq(n)
            elif op == 'ins3':
                e, t = a0, rand_seq(3 * rng.randint(1, 3))
            elif op == 'del':
                e, t = a0 + n, ''
            elif op == 'del3':
                e, t = a0 + 3 * rng.randint(1, 2), ''
            else:
                e, t = a0 + n, rand_seq(rng.randint(1, 8))
            if e > cur_len - 1:
                continue
            if any(a0 - 10 < q < e + 10 for q in cut_pos + cb_pos) or any(a0 - 10 < q + cur_len < e + 10 or a0 - 10 < q - cur_len < e + 10 for q in cut_pos):
                continue
            break
        else:
            continue
        if t is None:
            # current base unknown here; TS doc gives it; pick from a full replacement set
            t = rng.choice(BASES)  # may equal old base: then a no-op substitution (fine)
        delta = len(t) - (e - a0)
        edits.append([a0, e, t])
        cur_len += delta
        for c in cuts:
            for key in ('cut', 'cutBottom'):
                if c[key] >= e:
                    c.setdefault('v2_' + key, c[key])
        # map positions after the edit
        cut_pos = [q + delta if q >= e else q for q in cut_pos]
        cb_pos = [q + delta if q >= e else q for q in cb_pos]
    cuts2 = [{'cut': a, 'cutBottom': b} for a, b in zip(cut_pos, cb_pos)]
    for c in cuts:
        c.pop('v2_cut', None)
        c.pop('v2_cutBottom', None)
    src1 = {'name': 'v2', 'derive': 0, 'edits': edits, 'fresh': rng.random() < 0.5}
    if not linear and rng.random() < TRANSFORM_P:
        cuts2 = []
        if rng.random() < 0.5:
            src1 = {'name': 'v2', 'derive': 0, 'edits': [], 'transform': ['rc', 0]}
            for c in cuts:
                cuts2.append({'cut': (L - c['cutBottom']) % L, 'cutBottom': (L - c['cut']) % L})
        else:
            k0 = rng.randrange(1, L)
            src1 = {'name': 'v2', 'derive': 0, 'edits': [], 'transform': ['origin', k0]}
            for c in cuts:
                cuts2.append({'cut': (c['cut'] - k0) % L, 'cutBottom': (c['cutBottom'] - k0) % L})
        cuts2.sort(key=lambda c: c['cut'])
        # fragment index i of v2 must be the same molecule as fragment i of v1
        # rc: fragments come in reverse order and reversed; origin: rotated order
        src1['map'] = True
    plans = []
    nf = len(cuts) if not linear else len(cuts) + 1
    idx = list(range(nf))
    if linear:
        for combo in range(1 << nf):
            plans.append({'circular': False, 'parts': [[(combo >> i) & 1, i, 'n'] for i in idx]})
        for i in idx:
            for v in (0, 1):
                for m in ('ff', 'rcrc'):
                    plans.append({'circular': False, 'parts': [[v if j == i else 1 - v, j, m if j == i else 'n'] for j in idx]})
    elif nf == 1:
        for v in (0, 1):
            for m in ('n', 'f', 'ff', 'rc', 'rcrc', 'doc', 'bt', 'bf', 'btrc', 'bfrc'):
                plans.append({'circular': True, 'parts': [[v, 0, m]]})
            plans.append({'empty': True, 'parts': [[v, 0, 'n']]})
            for _ in range(3):
                plans.append({'circular': True, 'parts': [[v, 0, 'ed', -1, rng.choice(BASES)]]})
    else:
        for combo in range(1 << nf):
            vs = [(combo >> i) & 1 for i in idx]
            plans.append({'circular': True, 'parts': [[vs[i], i, 'n'] for i in idx]})
            rot = idx[1:] + idx[:1]
            plans.append({'circular': True, 'parts': [[vs[i], i, 'n'] for i in rot]})
            if combo in (0, (1 << nf) - 1):
                plans.append({'circular': False, 'parts': [[vs[i], i, 'n'] for i in idx]})
        for i in idx:
            for v in (0, 1):
                plans.append({'circular': True, 'parts': [[v, i, 'n']]})
                for m in ('f', 'ff', 'rc', 'rcrc', 'doc'):
                    plans.append({'circular': True, 'parts': [[v if j == i else rng.randint(0, 1), j, m if j == i else 'n'] for j in idx]})
                plans.append({'circular': True, 'parts': [[v, j, 'ed' if j == i else 'n', -1, rng.choice(BASES)] for j in idx]})
        BLUNTMODES = ['bt', 'bf', 'btrc', 'bfrc', 'rcbt', 'rcbf']
        for combo in range(1 << nf):
            vs = [(combo >> i) & 1 for i in idx]
            for _ in range(3):
                ms = [rng.choice(BLUNTMODES) for _ in idx]
                plans.append({'circular': True, 'parts': [[vs[i], i, ms[i]] for i in idx]})
                plans.append({'circular': False, 'parts': [[vs[i], i, ms[i]] for i in idx]})
        if nf == 3:
            plans.append({'circular': True, 'parts': [[0, 0, 'n'], [1, 2, 'n'], [0, 1, 'n']]})
            plans.append({'circular': True, 'parts': [[1, 0, 'n'], [0, 2, 'n']]})
    if src1.get('map') and nf >= 1:
        for combo in range(1 << nf):
            plans.append({'circular': True, 'parts': [[1, i, 'm'] if (combo >> i) & 1 else [0, i, 'n'] for i in idx]})
    return {'id': cid, 'sources': [src0, src1], 'cuts': [cuts, cuts2], 'plans': plans}


cases = [make_case(i) for i in range(N)]
json.dump(cases, open(OUT, 'w'))
print(len(cases), 'cases', sum(len(c['plans']) for c in cases), 'plans')
