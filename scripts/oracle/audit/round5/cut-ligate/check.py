"""Independent base-identity oracle for cut -> (flip) -> ligate feature carrying.

usage: check.py cases.json out.json
"""
import json, sys, re, collections
from Bio.Seq import Seq
from Bio.Data import CodonTable

cases = json.load(open(sys.argv[1]))
outs = {o['id']: o for o in json.load(open(sys.argv[2]))}
VERBOSE = len(sys.argv) > 3

COMP = str.maketrans('ACGTacgt', 'TGCAtgca')


def comp(b):
    return b.translate(COMP)


def table_of(f):
    for n, v in f['qualifiers']:
        if n == 'transl_table':
            return int(v)
    return 1


def cs_of(f):
    for n, v in f['qualifiers']:
        if n == 'codon_start':
            return int(v)
    return 1


def reading(L, segs, strand):
    pos = []
    for s in segs:
        if s[0] == 'site':
            continue
        pos += [p % L for p in range(s[0], s[1])]
    return pos[::-1] if strand == 'reverse' else pos


def five_partial(f):
    rs = [s for s in f['segments'] if s[0] != 'site']
    return rs[-1][3] if f['strand'] == 'reverse' else rs[0][2]


def three_partial(f):
    rs = [s for s in f['segments'] if s[0] != 'site']
    return rs[0][2] if f['strand'] == 'reverse' else rs[-1][3]


def te_codon(f, L):
    """Source transl_except codon positions in reading order, or None."""
    for n, v in f['qualifiers']:
        if n == 'transl_except':
            m = re.match(r'\(pos:(complement\()?(\d+)\.\.(\d+)\)?,aa:(\w+)\)', v)
            a, b = int(m.group(2)) - 1, int(m.group(3))
            ps = list(range(a, b))
            return ps[::-1] if m.group(1) else ps
    return None


def parse_te_product(v, Lp):
    m = re.match(r'\(pos:(complement\()?(.*?)\)?,aa:(\w+)\)$', v)
    if not m:
        return None
    loc = m.group(2)
    ps = []
    for part in re.sub(r'^join\(|\)$', '', loc).split(','):
        if '..' in part:
            a, b = part.split('..')
            ps += list(range(int(a) - 1, int(b)))
        else:
            ps.append(int(part) - 1)
    return ps[::-1] if m.group(1) else ps


def fragment_ids(case, s, i, flipped):
    src = case['sources'][s]
    L = len(src['seq'])
    cuts = case['cuts'][s]
    k = len(cuts)
    c = [x['cut'] for x in cuts]
    d = [x['d'] for x in cuts]
    if src.get('topology') == 'linear':
        cc = [0] + c + [L]
        dd = [0] + d + [0]
        a, b = cc[i], cc[i + 1]
        if not flipped:
            return [(s, p, 1) for p in range(a, b)]
        return [(s, p, -1) for p in reversed(range(a + dd[i], b + dd[i + 1]))]
    a = c[i]
    b = c[(i + 1) % k] if i + 1 < k else c[0] + L
    if b <= a:
        b += L
    if not flipped:
        return [(s, p % L, 1) for p in range(a, b)]
    da, db = d[i], d[(i + 1) % k]
    bot = range(a + da, b + db)
    return [(s, p % L, -1) for p in reversed(bot)]


def translate_codon(cod, t):
    return str(Seq(cod).translate(table=t))


def expect_protein(bases, cs, first_is_start, three_part, t, te_idx):
    tab = CodonTable.unambiguous_dna_by_id[t]
    out = ''
    i = cs - 1
    k = 0
    while i + 3 <= len(bases):
        cod = bases[i:i + 3]
        aa = translate_codon(cod, t)
        if k == 0 and first_is_start and cod in tab.start_codons:
            aa = 'M'
        if i in te_idx:
            aa = 'U'
        out += aa
        i += 3
        k += 1
    if len(bases) - i == 2 and three_part:
        aas = {translate_codon(bases[i:] + x, t) for x in 'ACGT'}
        if len(aas) == 1:
            out += aas.pop()
    return out


problems = collections.Counter()
examples = collections.defaultdict(list)
nchecked = collections.Counter()


def report(kind, msg):
    problems[kind] += 1
    if len(examples[kind]) < 6:
        examples[kind].append(msg)


for case in cases:
    o = outs[case['id']]
    srcs = case['sources']
    # source features: reading lists
    sfeats = []
    for si, src in enumerate(srcs):
        L = len(src['seq'])
        for fi, f in enumerate(src['features']):
            segs = [[a, b, ps, pe] for a, b, ps, pe in f['segments']]
            R = reading(L, segs, f['strand'])
            sfeats.append({'src': si, 'fi': fi, 'f': f, 'R': R, 'idx': {p: n for n, p in enumerate(R)},
                           'f0': cs_of(f) - 1, 'te': te_codon(f, L),
                           'p5': five_partial(f), 'p3': three_partial(f)})
    for pi, (plan, res) in enumerate(zip(case['plans'], o['results'])):
        tag = f"case {case['id']} ({case['style']}) plan {pi} {plan}"
        ids = []
        for s, i, fl in plan['parts']:
            ids += fragment_ids(case, s, i, fl)
        if 'error' in res:
            # incompatible ends are expected for some plans; check compat ourselves
            report('error:' + res['error'][:40], tag)
            continue
        nchecked['plans'] += 1
        seq = res['sequence']
        Lp = len(seq)
        exp = ''.join(srcs[s]['seq'][p] if o_ == 1 else comp(srcs[s]['seq'][p]) for s, p, o_ in ids)
        if exp.upper() != seq.upper():
            report('product sequence', f"{tag}\n exp {exp}\n got {seq}")
            continue
        circ = res['circular']
        pieces = []  # (G, F, indices, product positions)
        chim_cov = collections.defaultdict(set)
        for g in res['features']:
            P = reading(Lp, g['segments'], g['strand'])
            if not P:
                continue
            nchecked['features'] += 1
            idn = [ids[p] for p in P]
            # find source feature
            cands = [sf for sf in sfeats if sf['src'] == idn[0][0] and sf['f']['name'] == g['name']
                     and sf['f']['type'] == g['type'] and idn[0][1] in sf['idx']
                     and (sf['f']['strand'] == g['strand']) == (idn[0][2] == 1)]
            if not cands:
                report('no source feature', f"{tag}\n G={g['name']} {g['segments']} {g['strand']}")
                continue
            best = None
            for sf in cands:
                ok = True
                ix = []
                for (s, p, o_) in idn:
                    if s != sf['src'] or p not in sf['idx'] or (sf['f']['strand'] == g['strand']) != (o_ == 1):
                        ok = False
                        break
                    ix.append(sf['idx'][p])
                if ok and all(ix[n + 1] == ix[n] + 1 for n in range(len(ix) - 1)):
                    best = (sf, ix)
                    break
            if best is None:
                # split into runs that each read one source feature contiguously
                runs = []
                for j, (s_, p_, o_) in enumerate(idn):
                    ok_prev = False
                    if runs:
                        rsf, rix = runs[-1]
                        if s_ == rsf['src'] and p_ in rsf['idx'] and rsf['idx'][p_] == rix[-1] + 1 and (rsf['f']['strand'] == g['strand']) == (o_ == 1):
                            rix.append(rsf['idx'][p_]); ok_prev = True
                    if not ok_prev:
                        c2 = [sf for sf in sfeats if sf['src'] == s_ and sf['f']['name'] == g['name'] and p_ in sf['idx'] and (sf['f']['strand'] == g['strand']) == (o_ == 1)]
                        if not c2:
                            runs = None; break
                        runs.append((c2[0], [c2[0]['idx'][p_]]))
                if runs is not None and len(runs) > 1:
                    srcs_ = {r[0]['src'] for r in runs}
                    fis = {(r[0]['src'], r[0]['fi']) for r in runs}
                    kind = 'cross-source' if len(srcs_) > 1 else ('two features' if len(fis) > 1 else 'same feature, bases dropped')
                    if g['type'] == 'CDS':
                        cs = g['codonStart']
                        j = 0; inframe = True
                        for rsf, rix in runs:
                            for x in rix:
                                if (j - (cs - 1)) % 3 != (x - rsf['f0']) % 3: inframe = False
                                j += 1
                        kind += ', in frame' if inframe else ', OUT OF FRAME'
                    for pp, (s_, p_, o_) in zip(P, idn):
                        for rsf, rix in runs:
                            if rsf['src'] == s_ and p_ in rsf['idx']:
                                chim_cov[id(rsf)].add(pp)
                    report('chimeric rejoin: ' + kind + ' [' + case['style'] + ']', f"{tag}\n G={g['name']} {g['segments']} {g['strand']} runs {[(r[0]['src'], r[0]['fi'], r[1][0], r[1][-1]) for r in runs]}")
                    continue
                sf = cands[0]
                desc = []
                for (s, p, o_) in idn:
                    desc.append(f"{s}:{p}{'+' if o_ == 1 else '-'}:{sf['idx'].get(p) if s == sf['src'] else 'X'}")
                report('false join / non-contiguous reading',
                       f"{tag}\n G={g['name']} {g['segments']} {g['strand']}\n ids={' '.join(desc)}")
                continue
            sf, ix = best
            F = sf['f']
            n = len(sf['R'])
            pieces.append((g, sf, ix, P))
            whole = ix[0] == 0 and ix[-1] == n - 1
            e5 = ix[0] > 0 or sf['p5']
            e3 = ix[-1] < n - 1 or sf['p3']
            if five_partial(g) != e5 or three_partial(g) != e3:
                report('partial marks', f"{tag}\n G={g['name']} {g['segments']} {g['strand']} ix {ix[0]}..{ix[-1]}/{n} exp5 {e5} exp3 {e3}")
            gq = [q for q in g['qualifiers'] if q[0] not in ('codon_start', 'transl_except', 'translation')]
            fq = [q for q in F['qualifiers'] if q[0] not in ('codon_start', 'transl_except', 'translation')]
            if gq != fq:
                report('qualifiers', f"{tag}\n G={gq} F={fq}")
            if F['type'] == 'CDS':
                has_tr = any(q[0] == 'translation' for q in g['qualifiers'])
                if has_tr and not whole:
                    report('stale /translation on clipped piece', f"{tag}\n G={g['segments']}")
                ecs = 1 + ((sf['f0'] - ix[0]) % 3)
                if g['codonStart'] != ecs:
                    report('codon_start', f"{tag}\n G={g['name']} {g['segments']} {g['strand']} ix0 {ix[0]} f0 {sf['f0']} got cs {g['codonStart']} exp {ecs}")
                bases = ''.join(seq[p] if g['strand'] == 'forward' else comp(seq[p]) for p in P)
                first_idx = ix[0] + ecs - 1
                first_is_start = first_idx == sf['f0'] and not sf['p5']
                te_idx = set()
                te_expected = False
                if sf['te'] is not None:
                    tes = [sf['idx'][p] for p in sf['te']]
                    for j in range(len(ix) - 2):
                        if ix[j] == tes[0] and ix[j + 2] == tes[2] and (j - (ecs - 1)) % 3 == 0:
                            te_idx.add(j)
                            te_expected = True
                ep = expect_protein(bases, ecs, first_is_start, e3, table_of(F), te_idx)
                nchecked['cds'] += 1
                if g['protein'] != ep:
                    report('protein' + (' (te straddle)' if sf['te'] is not None and not any(q[0]=='transl_except' for q in g['qualifiers']) else ''), f"{tag}\n G={g['name']} {g['segments']} {g['strand']} cs {g['codonStart']}\n got {g['protein']}\n exp {ep}")
                gte = [q[1] for q in g['qualifiers'] if q[0] == 'transl_except']
                if te_expected and not gte:
                    Ls_ = len(srcs[sf['src']]['seq'])
                    cutsS = case['cuts'][sf['src']]
                    span = set(sf['te'])
                    straddle = any(((x['cut']) % Ls_ in span and (x['cut'] - 1) % Ls_ in span) or ((x['cut'] + x['d']) % Ls_ in span and (x['cut'] + x['d'] - 1) % Ls_ in span) for x in cutsS)
                    report('transl_except lost' + (' (codon straddled a cut)' if straddle else ' (NOT straddled)'), f"{tag}\n G={g['segments']} te {sf['te']} cuts {cutsS}")
                for v in gte:
                    ps = parse_te_product(v, Lp)
                    tid = [ids[p % Lp] for p in ps] if ps else None
                    if tid is None or [t[1] for t in tid] != sf['te']:
                        report('transl_except points at wrong bases', f"{tag}\n {v} -> {tid} src {sf['te']}")
                if g['unused']:
                    report('unused transl_except', f"{tag}\n {g['unused']}")
        # coverage and rejoin
        for sf in sfeats:
            covered = set()
            mine = [pc for pc in pieces if pc[1] is sf]
            for g, _, ix, P in mine:
                covered.update(P)
            covered |= chim_cov[id(sf)]
            want = [p for p in range(Lp) if ids[p][0] == sf['src'] and ids[p][1] in sf['idx']]
            # orientation consistency is implied
            miss = [p for p in want if p not in covered]
            if miss:
                flip = any(x[2] for x in plan['parts'])
                report(f'lost annotation (flipped={flip}, n={min(len(miss),5)})',
                       f"{tag}\n F={sf['f']['name']} {sf['f']['segments']} {sf['f']['strand']} missing product {miss[:8]} of {len(want)}")
            for a in mine:
                for b in mine:
                    if a is b:
                        continue
                    if a[2][-1] + 1 == b[2][0]:
                        pa, pb = a[3][-1], b[3][0]
                        adj = (pb - pa) % Lp in (1, Lp - 1) if circ else abs(pb - pa) == 1
                        if adj:
                            report('missed rejoin', f"{tag}\n {a[0]['segments']} + {b[0]['segments']} {sf['f']['strand']}")

print('checked', dict(nchecked))
for k, v in problems.most_common():
    print(f'== {k}: {v}')
    for e in examples[k][: (6 if VERBOSE else 2)]:
        print('  ', e.replace('\n', '\n   '))
