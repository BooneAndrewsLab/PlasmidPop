"""Round-7 provenance oracle: content/base-identity checks of every product feature.

usage: check.py cases.json out.json [verbose]
A rejoined feature (one that is not a part's feature shifted into the product)
must be a run of some source version's same-named feature: same genomic bases
(exons and introns), same exon structure, honest partial flags, consistent
codon_start and /transl_except; any /translation must equal Biopython's
reading of the product bases (or be the source's own, over the same bases).
"""
import json, sys, re, collections
from Bio.Seq import Seq
from Bio.Data import CodonTable

cases = {c['id']: c for c in json.load(open(sys.argv[1]))}
outs = json.load(open(sys.argv[2]))
VERBOSE = len(sys.argv) > 3
COMP = str.maketrans('ACGTNacgtn', 'TGCANtgcan')


def q(f, name, default=None):
    for n, v in f['qualifiers']:
        if n == name:
            return v
    return default


def rsegs(f):
    return [s for s in f['segments'] if s[0] != 'site']


def p5(f):
    rs = rsegs(f)
    return rs[-1][3] if f['strand'] == 'reverse' else rs[0][2]


def p3(f):
    rs = rsegs(f)
    return rs[0][2] if f['strand'] == 'reverse' else rs[-1][3]


def layout(f, seq, circ):
    """genomic bases 5'->3', exon mask, reading positions."""
    L = len(seq)
    rs = rsegs(f)
    a, b = rs[0][0], rs[-1][1]
    if b < a:
        b += L
    # unroll segments so they increase
    segs = []
    base = 0
    prev = None
    for s, e, *_ in rs:
        s += base
        e += base
        if prev is not None and s < prev:
            s += L
            e += L
            base += L
        segs.append((s, e))
        prev = e
    a, b = segs[0][0], segs[-1][1]
    pos = list(range(a, b))
    exon = [any(s <= p < e for s, e in segs) for p in pos]
    pos = [p % L for p in pos]
    if f['strand'] == 'reverse':
        pos = pos[::-1]
        exon = exon[::-1]
    g = ''.join(seq[p] for p in pos).upper()
    if f['strand'] == 'reverse':
        g = g.translate(COMP)
    reading = [p for p, e in zip(pos, exon) if e]
    bases = ''.join(c for c, e in zip(g, exon) if e)
    return g, exon, reading, bases, pos


def te_positions(f, L):
    v = q(f, 'transl_except')
    if v is None:
        return None
    m = re.match(r'\(pos:(complement\()?(.*?)\)?,aa:(\w+)\)$', v)
    if not m:
        return 'bad'
    ps = []
    for part in re.sub(r'^join\(|\)$', '', m.group(2)).split(','):
        if '..' in part:
            x, y = part.split('..')
            ps += list(range(int(x) - 1, int(y)))
        else:
            ps.append(int(part) - 1)
    return [p % L for p in ps]


def te_index(f, reading, L):
    ps = te_positions(f, L)
    if ps is None or ps == 'bad':
        return ps
    idx = sorted(reading.index(p) for p in ps if p in reading)
    if len(idx) != 3 or idx[2] - idx[0] != 2:
        return 'bad'
    return idx[0]


def expect_protein(bases, cs, first_m, three_part, t, te_i):
    tab = CodonTable.unambiguous_dna_by_id[t]
    out = ''
    i = cs - 1
    k = 0
    while i + 3 <= len(bases):
        cod = bases[i:i + 3]
        try:
            aa = str(Seq(cod).translate(table=t))
        except Exception:
            aa = 'X'
        if k == 0 and first_m and cod in tab.start_codons:
            aa = 'M'
        if te_i == i:
            aa = 'U'
        out += aa
        i += 3
        k += 1
    if len(bases) - i == 2 and three_part:
        aas = {str(Seq(bases[i:] + x).translate(table=t)) for x in 'ACGT'}
        if len(aas) == 1:
            out += aas.pop()
    return out


def info(f, seq, circ):
    g, exon, reading, bases, pos = layout(f, seq, circ)
    L = len(seq)
    cs = int(q(f, 'codon_start', '1'))
    t = int(q(f, 'transl_table', '1'))
    return {'g': g, 'exon': exon, 'reading': reading, 'bases': bases, 'pos': pos,
            'cs': cs, 't': t, 'p5': p5(f), 'p3': p3(f), 'te': te_index(f, reading, L),
            'tr': q(f, 'translation'), 'name': f['name'], 'type': f['type'], 'f': f}


problems = collections.Counter()
examples = collections.defaultdict(list)
n = collections.Counter()
missed_kind = collections.Counter()
carried_modes = collections.Counter()


def report(kind, msg):
    problems[kind] += 1
    if len(examples[kind]) < 5:
        examples[kind].append(msg)


def match_source(fi, S, mism):
    """offset a where fi's genomic run sits in S's, or None."""
    G, g = S['g'], fi['g']
    if len(g) > len(G):
        return None
    best = None
    for a in range(len(G) - len(g) + 1):
        if S['exon'][a:a + len(g)] != fi['exon']:
            continue
        mm = sum(1 for x, y in zip(G[a:a + len(g)], g) if x != y)
        if mm > mism:
            continue
        # exon bases before a
        ea = sum(S['exon'][:a])
        # #186: losing only skipped (codon_start) bases keeps the 5' end as it was
        skip = S['cs'] - 1 if S['type'] == 'CDS' else 0
        if not fi['p5'] and (S['p5'] or not (a == 0 or (ea <= skip and S['type'] == 'CDS'))):
            continue
        if not fi['p3'] and (a + len(g) != len(G) or S['p3']):
            continue
        if fi['type'] == 'CDS':
            if a == 0:
                if fi['cs'] != S['cs']:
                    continue
            elif (ea + fi['cs'] - 1) % 3 != (S['cs'] - 1) % 3:
                continue
        cand = (mm, not (a == 0 and len(g) == len(G)), a, ea)
        if best is None or cand < best:
            best = cand
    return None if best is None else (best[2], best[3], best[0])


for o in outs:
    case = cases[o['id']]
    srcs = o['sources']
    sinfo = collections.defaultdict(list)
    for vi, s in enumerate(srcs):
        for f in s['features']:
            sinfo[f['name']].append((vi, info(f, s['seq'], s['circular'])))
    for plan, r in zip(case['plans'], o['results']):
        modes = [p[2] for p in plan['parts']]
        if 'error' in r:
            n['error'] += 1
            continue
        n['products'] += 1
        seq = r['sequence']
        L = len(seq)
        circ = r['circular']
        # part features shifted into the product
        shifted = set()
        off = 0
        for part in r['parts']:
            for pf in part['features']:
                rs = rsegs(pf)
                if not rs:
                    continue
                ff = dict(pf)
                ff['segments'] = [[s + off, e + off, a, b] for s, e, a, b in rs]
                ff['qualifiers'] = []
                try:
                    _, _, rd, _, _ = layout(ff, seq, circ)
                    shifted.add((pf['name'], tuple(rd)))
                except Exception:
                    pass
            off += len(part['sequence'])
        mism = 1 if 'ed' in modes else 0
        for f in r['features']:
            if not rsegs(f):
                continue
            fi = info(f, seq, circ)
            rejoined = (f['name'], tuple(fi['reading'])) not in shifted
            tag = f"case {o['id']} plan {modes} circ={plan.get('circular')} feat {f['name']} {f['strand']} {f['segments']} cs={fi['cs']} origin={f['origin']}"
            if rejoined:
                n['rejoined'] += 1
                whole = not fi['p5'] and not fi['p3']
                n['rejoined_whole' if whole else 'rejoined_partial'] += 1
                hit = None
                for vi, S in sinfo.get(f['name'], []):
                    m = match_source(fi, S, mism)
                    if m is not None:
                        key = (m[2], not (m[0] == 0 and len(fi['g']) == len(S['g'])))
                        if hit is None or key < hit[3]:
                            hit = (vi, S, m, key)
                if hit is None:
                    report('FALSE_JOIN', tag + ' bases ' + fi['g'][:60])
                    continue
                vi, S, (a, ea, mm), _k = hit
                whole = a == 0 and len(fi['g']) == len(S['g'])
                if whole and mm:
                    report('WHOLE_JOIN_OVER_CHANGED_BASES', tag)
                if mm:
                    n['rejoined_partial_over_edit'] += 1
                # transl_except
                ste = S['te']
                if ste is not None and ste != 'bad':
                    rel = ste - ea
                    inside = 0 <= rel and rel + 3 <= len(fi['bases'])
                    if inside and fi['te'] != rel:
                        report('TE_WRONG' if fi['te'] is not None else 'te_missing', tag + f' te={fi["te"]} want {rel}')
                    if not inside and fi['te'] not in (None,):
                        report('TE_EXTRA', tag)
                elif fi['te'] is not None:
                    report('TE_EXTRA', tag)
                if not whole and fi['tr'] is not None:
                    report('TRANSLATION_ON_PIECE', tag)
            # /translation check for every CDS
            if f['type'] == 'CDS':
                te_i = fi['te'] if isinstance(fi['te'], int) else None
                exp = expect_protein(fi['bases'], fi['cs'], not fi['p5'], fi['p3'], fi['t'], te_i)
                pp = f['protein']
                if pp is not None and pp != exp:
                    report('oracle_vs_pp_protein', tag + f' pp={pp} exp={exp}')
                n['cds'] += 1
                if fi['tr'] is not None:
                    n['cds_with_translation'] += 1
                    want = exp[:-1] if exp.endswith('*') else exp
                    if fi['tr'] != want:
                        faithful = any(S['bases'] == fi['bases'] and S['tr'] == fi['tr'] for _, S in sinfo.get(f['name'], []))
                        if faithful:
                            n['stale_translation_faithful'] += 1
                        elif rejoined:
                            report('BAD_TRANSLATION_REJOIN', tag + f' tr={fi["tr"]} want={want}')
                        else:
                            report('bad_translation_carried', tag + f' tr={fi["tr"]} want={want}'); carried_modes[tuple(sorted(set(modes)))] += 1
        # missed rejoin (low): a source version's whole feature present base-for-base,
        # covered by >=2 pieces of that name and by no whole feature
        names = collections.defaultdict(list)
        for f in r['features']:
            if rsegs(f):
                names[f['name']].append(f)
        for name, fs in names.items():
            if len(fs) < 2 or not any(x['origin'] for x in fs):
                continue
            wholes = [x for x in fs if not p5(x) and not p3(x)]
            for vi, S in sinfo.get(name, []):
                if S['p5'] or S['p3']:
                    continue
                pieceset = set()
                for x in fs:
                    if x['origin']:
                        pieceset |= set(info(x, seq, circ)['reading'])
                Sread = set(S['reading'])
                # does the product carry S's genomic bases where the pieces lie?
                cov = [x for x in fs if x['origin']]
                found = False
                for strand in ('forward', 'reverse'):
                    G = S['g']
                    text = (seq + seq[:len(G)]) if circ else seq
                    tt = text.upper() if strand == 'forward' else text.upper().translate(COMP)[::-1]
                    start = tt.find(G)
                    while start != -1:
                        if strand == 'forward':
                            gpos = [(start + i) % L for i in range(len(G))]
                        else:
                            N = len(tt)
                            gpos = [(N - 1 - (start + i)) % L for i in range(len(G))]
                        ex = [p for p, e in zip(gpos, S['exon']) if e]
                        if set(ex) <= pieceset and len(cov) >= 2:
                            found = True
                        start = tt.find(G, start + 1)
                if found and not wholes:
                    vers = sorted(set(p[0] for p in plan['parts']))
                    ms = sorted(set(modes))
                    ov = case['sources'][0].get('features') and r['parts'][0]['left'].get('overhang')
                    report('missed_rejoin(low)', f"case {o['id']} plan {modes} {name} v{vi}")
                    missed_kind[(tuple(vers), tuple(ms), r['parts'][0]['left']['kind'])] += 1
                    break

print('counts', dict(n))
print('problems', dict(problems))
for k,v in sorted(missed_kind.items(), key=lambda x:-x[1]): print('  missed', k, v)
for k, v in examples.items():
    print('==', k)
    for m in v:
        print('  ', m[:400])
print('carried by modes', dict(carried_modes))
