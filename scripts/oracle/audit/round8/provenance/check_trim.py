"""Independent model of bluntEnds/reverseComplement on a sticky linear doc; diff vs PlasmidPop.

usage: check_trim.py cases.json out.json [v]
"""
import collections, json, sys
from Bio.Seq import Seq

COMP = str.maketrans('ACGTacgtNn', 'TGCAtgcaNn')
cases = {c['id']: c for c in json.load(open(sys.argv[1]))}
outs = json.load(open(sys.argv[2]))
V = len(sys.argv) > 3
n = collections.Counter()
probs = collections.Counter()
ex = collections.defaultdict(list)


def rc(s):
    return s.translate(COMP)[::-1]


def rep(k, msg):
    probs[k] += 1
    if len(ex[k]) < 6:
        ex[k].append(msg)


def flip_end(e):
    return {**e, 'overhang': rc(e['overhang'])}


def blunted(e):
    return e if e['kind'] == 'blunt' else {'kind': 'blunt', 'overhang': '', 'enzyme': e['enzyme']}


def simulate(seq, ends, ops):
    cells = [(i, b) for i, b in enumerate(seq)]
    flipped = False
    left, right = ends['left'], ends['right']
    steps = []
    for op in ops:
        if op in ('bt', 'bf'):
            if right['kind'] == "3'":
                k = min(len(cells), len(right['overhang']))
                cells = cells[: len(cells) - k]
            elif right['kind'] == "5'" and op == 'bf':
                cells = cells + [(None, b) for b in right['overhang']]
            if left['kind'] == "5'" and op == 'bt':
                k = min(len(left['overhang']), len(cells))
                cells = cells[k:]
            left, right = blunted(left), blunted(right)
        else:
            head = left['overhang'] if left['kind'] == "3'" else ''
            tail = right['overhang'] if right['kind'] == "5'" else ''
            ts = len(left['overhang']) if left['kind'] == "5'" else 0
            te = len(right['overhang']) if right['kind'] == "3'" else 0
            cells = [(None, b) for b in head] + cells + [(None, b) for b in tail]
            cells = cells[: len(cells) - te] if te else cells
            cells = cells[ts:]
            cells = [(i, b.translate(COMP)) for i, b in reversed(cells)]
            left, right = flip_end(right), flip_end(left)
            flipped = not flipped
        steps.append(''.join(b for _, b in cells))
    return cells, flipped, steps, {'left': left, 'right': right}


def reading_positions(segs, strand):
    pos = []
    for s in segs:
        pos += list(range(s[0], s[1]))
    return pos[::-1] if strand == 'reverse' else pos


def q(f, name):
    for k, v in f['qualifiers']:
        if k == name:
            return v
    return None


def p5(f):
    s = f['segments']
    return s[0][2] if f['strand'] == 'forward' else s[-1][3]


def p3(f):
    s = f['segments']
    return s[-1][3] if f['strand'] == 'forward' else s[0][2]


for o in outs:
    c = cases[o['id']]
    tag = f"case {c['id']} ops={c['ops']}"
    if 'error' in o:
        rep('ERROR', tag + ' ' + o['error'][:200])
        continue
    n['cases'] += 1
    cells, flipped, steps, ends = simulate(c['seq'], c['ends'], c['ops'])
    got = o['steps'][-1]['seq']
    want = ''.join(b for _, b in cells)
    if got.upper() != want.upper():
        rep('SEQ', tag + f' got {got} want {want}')
        continue
    if got != want:
        rep('seq_case', tag)
    newpos = {i: p for p, (i, _) in enumerate(cells) if i is not None}
    byname = {f['name']: f for f in o['features']}
    for f in c['features']:
        n['features'] += 1
        R = reading_positions(f['segments'], f['strand'])
        surv = [newpos.get(i) for i in R]
        total = len(R)
        lost5 = 0
        while lost5 < total and surv[lost5] is None:
            lost5 += 1
        lost3 = 0
        while lost3 < total - lost5 and surv[total - 1 - lost3] is None:
            lost3 += 1
        keep = surv[lost5: total - lost3]
        if any(x is None for x in keep):
            rep('MODEL_MIDDLE_LOSS', tag)
            continue
        r = byname.get(f['name'])
        ftag = f"{tag} {f['name']} {f['strand']} {f['segments']} cs={q(f,'codon_start')} lost5={lost5} lost3={lost3}"
        if not keep:
            if r is not None:
                rep('FEATURE_SHOULD_BE_GONE', ftag)
            continue
        if r is None:
            rep('FEATURE_LOST', ftag)
            continue
        n['kept'] += 1
        lost = lost5 + lost3
        n['lost>0' if lost else 'lost=0'] += 1
        estrand = ('reverse' if f['strand'] == 'forward' else 'forward') if flipped else f['strand']
        if r['strand'] != estrand:
            rep('STRAND', ftag)
        rr = [s for s in r['segments'] if s[0] != 'site']
        rpos = reading_positions(rr, r['strand'])
        if rpos != keep:
            rep('COVERAGE', ftag + f' got {r["segments"]} want reading {keep[:5]}..{keep[-3:]}')
            continue
        # bases read
        rb = ''.join(got[p] for p in rpos).upper()
        if r['strand'] == 'reverse':
            rb = ''.join(got[p].translate(COMP) for p in rpos).upper()
        ob = ''.join(c['seq'][i] for i in R[lost5: total - lost3]).upper()
        if f['strand'] == 'reverse':
            ob = ''.join(c['seq'][i].translate(COMP) for i in R[lost5: total - lost3]).upper()
        if rb != ob:
            rep('BASES', ftag + f' {rb} vs {ob}')
        cs = int(q(f, 'codon_start') or 1)
        ecs = ((cs - 1 - lost5) % 3) + 1
        gcs = int(q(r, 'codon_start') or 1)
        if gcs != ecs:
            rep('CODON_START', ftag + f' got {gcs} want {ecs}')
        ep5 = p5(f) if lost5 <= cs - 1 else True
        if lost5 == 0:
            ep5 = p5(f)
        ep3 = p3(f) or lost3 > 0
        if p5(r) != ep5:
            rep('partial5', ftag + f' got {p5(r)} want {ep5}')
        if p3(r) != ep3:
            rep('partial3', ftag + f' got {p3(r)} want {ep3}')
        tr0, tr1 = q(f, 'translation'), q(r, 'translation')
        if tr1 is not None:
            n['translation_kept'] += 1
            if lost > 0:
                rep('STALE_TRANSLATION', ftag + f' kept {tr1}')
            elif tr1 != tr0:
                rep('TRANSLATION_CHANGED', ftag)
        elif tr0 is not None and lost == 0:
            rep('translation_wrongly_dropped', ftag)
        # protein from the code vs Biopython over the result's bases
        table = int(q(r, 'transl_table') or 1)
        body = rb[gcs - 1:]
        body = body[: len(body) - len(body) % 3]
        if r['protein'] is not None and body:
            bp = str(Seq(body).translate(table=table))
            pp = r['protein']
            if q(r, 'transl_except') is not None and pp.count('U') == 1 and len(pp) >= len(bp):
                i = pp.index('U')
                if i < len(bp):
                    pp = pp[:i] + bp[i] + pp[i + 1:]
            left = (len(rb) - (gcs - 1)) % 3
            if left and len(pp) == len(bp) + 1 and pp[1:-1] == bp[1:]:
                n['partial_codon_residue'] += 1
            elif pp[1:] != bp[1:] or len(pp) != len(bp):
                rep('PROTEIN', ftag + f' pp={pp} bio={bp}')
            n['protein_checked'] += 1
        te0, te1 = q(f, 'transl_except'), q(r, 'transl_except')
        if te0 is not None:
            import re
            m = re.search(r'(\d+)\.\.(\d+)', te0)
            cod = list(range(int(m.group(1)) - 1, int(m.group(2))))
            np_ = [newpos.get(i) for i in cod]
            if any(x is None for x in np_):
                if te1 is not None:
                    rep('TE_KEPT_ON_LOST_CODON', ftag + f' {te0} -> {te1}')
                else:
                    n['te_dropped_ok'] += 1
            else:
                lo, hi = min(np_) + 1, max(np_) + 1
                rstr = r['strand']
                want = f'(pos:{lo}..{hi},aa:Sec)' if rstr == 'forward' else f'(pos:complement({lo}..{hi}),aa:Sec)'
                if te1 != want:
                    rep('TE_WRONG', ftag + f' {te0} -> {te1} want {want}')
                else:
                    n['te_ok'] += 1
        org = r['origin']
        if lost > 0:
            if org is None:
                rep('ORIGIN_MISSING', ftag)
            elif org['key'] != f['name'] or org['from'] != lost5 or org['to'] != total - lost3:
                rep('ORIGIN_WRONG', ftag + f' got {org} want {lost5},{total - lost3}')
            else:
                n['origin_ok'] += 1
        elif org is not None:
            rep('origin_unexpected', ftag + f' {org}')
    # stray features
    for r in o['features']:
        if r['name'] not in {f['name'] for f in c['features']}:
            rep('EXTRA_FEATURE', tag)

print('counts', dict(n))
print('problems', dict(probs))
for k, v in ex.items():
    print('==', k)
    for m in v:
        print('  ', m[:500])
