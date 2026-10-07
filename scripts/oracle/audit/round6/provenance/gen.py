"""Generate cut/ligate cases for the round-5 cut-ligate audit.

Each case: sources (circular plasmids with features), cuts per source (synthetic
CutSites: cut, cutBottom), and assembly plans (fragments in order, flipped or not,
circular or linear). Output JSON consumed by run.test.ts.
"""
import json, random, sys

OUT = sys.argv[1]
N = int(sys.argv[2]) if len(sys.argv) > 2 else 400
rng = random.Random(int(sys.argv[3]) if len(sys.argv) > 3 else 1)

BASES = 'ACGT'
TABLES = [1, 11, 4, 2]
PAL5 = ['AATT', 'GATC', 'TCGA', 'CATG', 'AGCT', 'GC', 'TA']  # palindromic overhangs


def rc(s):
    return s[::-1].translate(str.maketrans('ACGTacgt', 'TGCAtgca'))


def rand_seq(n):
    return ''.join(rng.choice(BASES) for _ in range(n))


def reading(L, segs, strand):
    pos = []
    for s, e in segs:
        pos += [p % L for p in range(s, e)]
    return pos[::-1] if strand == 'reverse' else pos


def make_feature(L, name, kind, ftype='CDS'):
    strand = rng.choice(['forward', 'reverse'])
    segs = []
    if kind == 'simple':
        n = rng.randint(15, max(16, L // 2))
        s = rng.randrange(L)
        segs = [(s, s + n)]  # may wrap: unrolled end > L
    elif kind == 'join':
        nseg = rng.randint(2, 3)
        s = rng.randrange(L)
        cur = s
        for _ in range(nseg):
            n = rng.randint(6, 18)
            segs.append((cur, cur + n))
            cur += n + rng.randint(3, 12)
        if cur - s >= L - 2:
            return None
    # normalise: each segment with start < L
    norm = []
    for a, b in segs:
        if a >= L:
            a, b = a - L, b - L
        norm.append((a, b))
    segs = norm
    total = sum(b - a for a, b in segs)
    cs = rng.choice([1, 1, 2, 3]) if ftype == 'CDS' else None
    f = {'type': ftype, 'name': name, 'strand': strand,
         'segments': [[a, b, False, False] for a, b in segs], 'qualifiers': []}
    if rng.random() < 0.15:
        f['segments'][0][2] = True  # source partial start
    if ftype == 'CDS':
        f['qualifiers'].append(['codon_start', str(cs)])
        t = rng.choice(TABLES)
        if t != 1:
            f['qualifiers'].append(['transl_table', str(t)])
        f['qualifiers'].append(['translation', 'XXXX'])
        f['qualifiers'].append(['note', 'n-' + name])
        # transl_except at a codon inside one segment and not across origin
        if rng.random() < 0.5:
            R = reading(L, [(a, b) for a, b, *_ in f['segments']], strand)
            cands = []
            for i in range(cs - 1, len(R) - 2, 3):
                cod = R[i:i + 3]
                if strand == 'forward':
                    ok = cod[1] == cod[0] + 1 and cod[2] == cod[1] + 1
                else:
                    ok = cod[1] == cod[0] - 1 and cod[2] == cod[1] - 1
                if ok:
                    cands.append(cod)
            if cands:
                cod = rng.choice(cands)
                lo, hi = min(cod) + 1, max(cod) + 1
                loc = f'{lo}..{hi}' if strand == 'forward' else f'complement({lo}..{hi})'
                f['qualifiers'].append(['transl_except', f'(pos:{loc},aa:Sec)'])
    return f


def overlaps_any(pos, used, w=10):
    return any(abs(pos - u) < w for u in used)


STYLES = sys.argv[4].split(',') if len(sys.argv) > 4 else ['synthetic', 'synthetic', 'planted', 'planted', 'twosrc', 'tandem']


def make_case(cid):
    L = rng.randint(70, 180)
    style = rng.choice(STYLES)
    srcs = []
    nsrc = 2 if style == 'twosrc' else 1
    for si in range(nsrc):
        Ls = L if si == 0 else rng.randint(60, 140)
        seq = list(rand_seq(Ls))
        feats = []
        if style == 'tandem' and si == 0:
            # two identical copies, same name/qualifiers, back to back
            n = 30
            s = rng.randrange(Ls)
            strand = rng.choice(['forward', 'reverse'])
            cs = rng.choice(['1', '2', '3'])
            unit = rand_seq(n)
            for k in range(2):
                for j in range(n):
                    seq[(s + k * n + j) % Ls] = unit[j]
                a = (s + k * n) % Ls
                feats.append({'type': 'CDS', 'name': 'tan', 'strand': strand,
                              'segments': [[a, a + n, False, False]],
                              'qualifiers': [['codon_start', cs]]})
        else:
            for fi in range(rng.randint(1, 3)):
                kind = rng.choice(['simple', 'simple', 'join'])
                f = make_feature(Ls, 'f%d' % fi if (style != 'twosrc' or fi > 0) else 'shared', kind)
                if f:
                    feats.append(f)
            if rng.random() < 0.5:
                f = make_feature(Ls, 'misc', 'simple', 'misc_feature')
                if f:
                    feats.append(f)
        if style == 'linear':
            feats = [f for f in feats if all(b <= Ls for a, b, *_ in f['segments'])]
        srcs.append({'seq': ''.join(seq), 'features': feats, 'name': 'src%d' % si,
                     'topology': 'linear' if style == 'linear' else 'circular'})

    cuts = []
    for si, src in enumerate(srcs):
        Ls = len(src['seq'])
        seq = list(src['seq'])
        k = rng.choice([1, 1, 2, 2, 3]) if style != 'twosrc' else 2
        used = []
        cs = []
        if style in ('planted', 'twosrc', 'tandem'):
            # plant one palindromic overhang site at each cut: same overhang everywhere
            if si == 0:
                ov = rng.choice(PAL5 + ['blunt'])
                kind = rng.choice(['5', '3'])
            if style == 'tandem':
                # cut inside each copy at the same offset
                f0 = src['features'][0]['segments'][0][0]
                off = rng.randint(6, 22)
                positions = [(f0 + off) % Ls, (f0 + 30 + off) % Ls]
            else:
                positions = []
                while len(positions) < k:
                    p = rng.randrange(Ls)
                    if not overlaps_any(p, positions, 12) and not overlaps_any(p + Ls, positions, 12) and not overlaps_any(p - Ls, positions, 12):
                        positions.append(p)
            positions.sort()
            for p in positions:
                if ov == 'blunt':
                    cs.append({'cut': p, 'cutBottom': p})
                    continue
                d = len(ov)
                for j in range(d):
                    seq[(p + j) % Ls] = ov[j]
                if kind == '5':
                    cs.append({'cut': p, 'cutBottom': p + d})
                else:
                    cs.append({'cut': p + d, 'cutBottom': p})
        else:
            positions = []
            while len(positions) < k:
                p = rng.randrange(Ls) if style != 'linear' else rng.randrange(8, Ls - 8)
                if not overlaps_any(p, positions, 12) and not overlaps_any(p + Ls, positions, 12) and not overlaps_any(p - Ls, positions, 12):
                    positions.append(p)
            positions.sort()
            for p in positions:
                d = rng.randint(-4, 4)
                cs.append({'cut': p, 'cutBottom': p + d})
        src['seq'] = ''.join(seq)
        # normalise cut into [0, L) as the app would report; cutBottom may be outside
        for c in cs:
            c['d'] = c['cutBottom'] - c['cut']
            c['cut'] %= Ls
            c['cutBottom'] %= Ls
        cuts.append(sorted(cs, key=lambda c: c['cut']))

    plans = []
    n0 = len(cuts[0])
    if style == 'linear':
        nf = n0 + 1
        idx = list(range(nf))
        plans.append({'circular': False, 'parts': [[0, i, False] for i in idx]})
        plans.append({'circular': True, 'parts': [[0, i, False] for i in idx]})
        for a in range(nf):
            for b in range(a + 1, nf + 1):
                plans.append({'circular': False, 'parts': [[0, i, False] for i in range(a, b)]})
        for i in idx:
            plans.append({'circular': False, 'parts': [[0, j, j == i] for j in idx]})
    elif style == 'twosrc':
        # vector = fragment of src0 (the longer one after the 2 cuts), insert = from src1
        for vi in range(2):
            for ii in range(2):
                for fl in (False, True):
                    plans.append({'circular': True, 'parts': [[0, vi, False], [1, ii, fl]]})
                    plans.append({'circular': False, 'parts': [[0, vi, False], [1, ii, fl]]})
    else:
        if n0 == 1:
            plans += [{'circular': True, 'parts': [[0, 0, False]]},
                      {'circular': True, 'parts': [[0, 0, True]]},
                      {'circular': False, 'parts': [[0, 0, False]]},
                      {'empty': True, 'parts': [[0, 0, False]]}]
        else:
            idx = list(range(n0))
            plans.append({'circular': True, 'parts': [[0, i, False] for i in idx]})
            rot = idx[1:] + idx[:1]
            plans.append({'circular': True, 'parts': [[0, i, False] for i in rot]})
            plans.append({'circular': False, 'parts': [[0, i, False] for i in idx]})
            plans.append({'circular': False, 'parts': [[0, i, False] for i in rot]})
            # each fragment closed on itself (dropout religation)
            for i in idx:
                plans.append({'circular': True, 'parts': [[0, i, False]]})
                plans.append({'circular': True, 'parts': [[0, i, True]]})
            # flip one fragment
            for i in idx:
                plans.append({'circular': True, 'parts': [[0, j, j == i] for j in idx]})
            # swap order of two fragments (3 cuts)
            if n0 == 3:
                plans.append({'circular': True, 'parts': [[0, 0, False], [0, 2, False], [0, 1, False]]})
                plans.append({'circular': True, 'parts': [[0, 0, False], [0, 2, False]]})
    return {'id': cid, 'style': style, 'sources': srcs, 'cuts': cuts, 'plans': plans}


cases = [make_case(i) for i in range(N)]
json.dump(cases, open(OUT, 'w'))
print(len(cases), 'cases', sum(len(c['plans']) for c in cases), 'plans')
