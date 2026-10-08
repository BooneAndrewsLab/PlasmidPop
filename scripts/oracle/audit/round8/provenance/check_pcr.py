"""Check PCR products (pydna) and their CDS /translation. usage: check_pcr.py cases.json out.json"""
import collections, json, sys
from Bio.Seq import Seq
from pydna.dseqrecord import Dseqrecord
from pydna.amplify import pcr as dpcr

COMP = str.maketrans('ACGTacgt', 'TGCAtgca')
cases = {c['id']: c for c in json.load(open(sys.argv[1]))}
outs = json.load(open(sys.argv[2]))
n = collections.Counter()
probs = collections.Counter()
ex = collections.defaultdict(list)


def rc(s):
    return s.translate(COMP)[::-1]


def rep(k, m):
    probs[k] += 1
    if len(ex[k]) < 6:
        ex[k].append(m)


def q(f, name):
    for k, v in f['qualifiers']:
        if k == name:
            return v
    return None


def reading(segs, strand, L, circ):
    pos = []
    for s in segs:
        pos += [(p % L) if circ else p for p in range(s[0], s[1])]
    return pos[::-1] if strand == 'reverse' else pos


for o in outs:
    c = cases[o['id']]
    tag = f"case {c['id']} {c['topology']}"
    if 'error' in o:
        rep('ERROR', tag + o['error'][:200])
        continue
    if len(o['products']) != 1:
        n['products_%d' % len(o['products'])] += 1
        continue
    P = o['products'][0]
    L = len(c['seq'])
    circ = c['topology'] == 'circular'
    seq = P['seq']
    core = seq[:-1] if c['taq'] else seq
    # pydna
    try:
        t = Dseqrecord(c['seq'], circular=circ)
        prod = dpcr(c['primers'][0], c['primers'][1], t)
        ps = str(prod.seq).upper()
        n['pydna_ok'] += 1
        if ps != core.upper():
            rep('PRODUCT_SEQ', tag + f' pp={core} pydna={ps}')
    except Exception as e:
        n['pydna_fail'] += 1
        U3 = c['seq'] * 3
        fp, rp = c['primers']
        fs0, re0 = c['fs'], c['fs'] + c['span']
        tb = fp + U3[fs0 + c['n_f']: re0 - c['n_r']] + rc(rp)
        n['textbook'] += 1
        if tb.upper() != core.upper():
            rep('PRODUCT_SEQ_TEXTBOOK', tag + f' pp={core} tb={tb}')
        # textbook
        tb = c['primers'][0] + ((c['seq'] + c['seq']) if circ else c['seq'])[
            c['fs'] + len(c['primers'][0]) - 0: 0] if False else None
    tr = P['templateRange']
    fs, span = tr['start'], tr['end'] - tr['start']
    tail = len(P['fwd']['tail'])
    U = (c['seq'] + c['seq']).upper() if circ else c['seq'].upper()
    byname = collections.defaultdict(list)
    for f in P['features']:
        byname[f['name']].append(f)
    for f in c['features']:
        n['cds'] += 1
        R = reading(f['segments'], f['strand'], L, circ)
        rel = [((p - fs) % L) if circ else p - fs for p in R]
        inside = all(0 <= r < span for r in rel)
        # whole only if its reading runs in order inside the product (no wrap inside)
        ftag = f"{tag} {f['name']} {f['strand']} {f['segments']} range={fs},{span}"
        got = byname.get(f['name'], [])
        if inside:
            order = rel if f['strand'] == 'forward' else rel[::-1]
            if order != sorted(order):
                n['wrap_inside'] += 1
                continue
            n['inside'] += 1
            exp = [tail + r for r in rel]
            match = [g for g in got if reading([s for s in g['segments'] if s[0] != 'site'], g['strand'], len(seq), False) == exp]
            if not match:
                rep('WHOLE_CDS_MISSING', ftag + f' got {[g["segments"] for g in got]}')
                continue
            g = match[0]
            prodb = ''.join(seq[p] for p in exp).upper()
            tmplb = ''.join(U[p] for p in R).upper()
            same = prodb == tmplb
            n['same' if same else 'mutated'] += 1
            t0, t1 = q(f, 'translation'), q(g, 'translation')
            if same:
                if t1 != t0:
                    rep('translation_wrongly_dropped' if t1 is None else 'TRANSLATION_CHANGED', ftag)
            else:
                if t1 is not None:
                    # still right? (synonymous)
                    b = prodb if f['strand'] == 'forward' else rc(prodb)
                    rep('STALE_TRANSLATION', ftag)
                else:
                    # dropped: was it synonymous (dropping is conservative)?
                    cs = int(q(f, 'codon_start') or 1)
                    tb = int(q(f, 'transl_table') or 1)
                    pb = prodb if f['strand'] == 'forward' else rc(prodb)
                    body = pb[cs - 1:]
                    body = body[: len(body) - len(body) % 3]
                    p = str(Seq(body).translate(table=tb)) if body else ''
                    p = p[:-1] if p.endswith('*') else p
                    n['dropped_synonymous' if p == t0 else 'dropped_ok'] += 1
        else:
            for g in got:
                n['piece'] += 1
                if q(g, 'translation') is not None:
                    rep('TRANSLATION_ON_PIECE', ftag + f' {g["segments"]}')
    # any kept /translation must match the product's bases
    for g in P['features']:
        t1 = q(g, 'translation')
        if t1 is None:
            continue
        rr = [s for s in g['segments'] if s[0] != 'site']
        R = reading(rr, g['strand'], len(seq), False)
        b = ''.join(seq[p] for p in R).upper()
        if g['strand'] == 'reverse':
            b = b.translate(COMP)
        cs = int(q(g, 'codon_start') or 1)
        tb = int(q(g, 'transl_table') or 1)
        body = b[cs - 1:]
        body = body[: len(body) - len(body) % 3]
        p = str(Seq(body).translate(table=tb)) if body else ''
        p = p[:-1] if p.endswith('*') else p
        n['kept_translation'] += 1
        if p != t1:
            rep('KEPT_TRANSLATION_WRONG', f"{tag} {g['name']} {g['segments']} kept={t1} bio={p}")

print('counts', dict(n))
print('problems', dict(probs))
for k, v in ex.items():
    print('==', k)
    for m in v:
        print('  ', m[:500])
