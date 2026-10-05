import json, random, os
from pydna.dseqrecord import Dseqrecord
from pydna.assembly import Assembly

OUT = os.path.dirname(os.path.abspath(__file__))
random.seed(7)

def rnd(n):
    return ''.join(random.choice('ACGT') for _ in range(n))

cases = []

def circ_case(name, n, k, overlap, flip=(), rot=0):
    """Circular target S; cut into k pieces each carrying `overlap` bases of the next."""
    S = rnd(n)
    cuts = sorted(random.sample(range(n), k))
    parts = []
    for i, st in enumerate(cuts):
        nxt = cuts[(i+1) % k]
        end = (nxt if nxt > st else nxt + n) + overlap
        seq = ''.join(S[p % n] for p in range(st, end))
        parts.append({'name': f'part{i+1}', 'seq': seq})
    # expected product: S rotated so it starts at cuts[0]
    expected = S[cuts[0]:] + S[:cuts[0]]
    order = list(range(k))
    if rot:
        order = order[rot:] + order[:rot]
    inputs = []
    for i in order:
        p = dict(parts[i])
        if i in flip:
            import re
            comp = str.maketrans('ACGT','TGCA')
            p['seq'] = p['seq'].translate(comp)[::-1]
        inputs.append(p)
    cases.append({'name': name, 'kind':'circular', 'parts': inputs,
                  'minOverlap': min(15, overlap), 'expected': expected,
                  'target': S, 'firstPart': parts[order[0]]['name']})

def lin_case(name, n, k, overlap, rot=0, flip=()):
    S = rnd(n)
    cuts = [0] + sorted(random.sample(range(50, n-50), k-1))
    parts = []
    for i, st in enumerate(cuts):
        end = cuts[i+1] + overlap if i+1 < k else n
        parts.append({'name': f'part{i+1}', 'seq': S[st:end]})
    order = list(range(k))
    if rot: order = order[rot:] + order[:rot]
    comp = str.maketrans('ACGT','TGCA')
    inputs = []
    for i in order:
        p = dict(parts[i])
        if i in flip: p['seq'] = p['seq'].translate(comp)[::-1]
        inputs.append(p)
    cases.append({'name': name, 'kind':'linear', 'parts': inputs,
                  'minOverlap': min(15, overlap), 'expected': S, 'target': S,
                  'firstPart': parts[order[0]]['name']})

circ_case('circ-2frag-20ov', 2000, 2, 20)
circ_case('circ-3frag-20ov', 2400, 3, 20)
circ_case('circ-4frag-25ov', 3200, 4, 25)
circ_case('circ-5frag-30ov', 4000, 5, 30)
circ_case('circ-3frag-flip2', 2400, 3, 25, flip=(1,))
circ_case('circ-4frag-flip-2of4', 3200, 4, 25, flip=(1,3))
circ_case('circ-3frag-rot', 2400, 3, 25, rot=1)
circ_case('circ-5frag-flip-rot', 4000, 5, 30, flip=(2,), rot=2)
circ_case('circ-2frag-ov15', 1500, 2, 15)
circ_case('circ-6frag-40ov', 6000, 6, 40)
lin_case('lin-3frag-25ov', 2400, 3, 25)
lin_case('lin-4frag-25ov', 3000, 4, 25)
lin_case('lin-3frag-rot1', 2400, 3, 25, rot=1)
lin_case('lin-3frag-rot2', 2400, 3, 25, rot=2)
lin_case('lin-4frag-flip', 3000, 4, 25, flip=(1,))

# pydna cross-check for the unflipped, unrotated circular ones
for c in cases:
    try:
        frags = [Dseqrecord(p['seq'], name=p['name']) for p in c['parts']]
        asm = Assembly(frags, limit=c['minOverlap'])
        res = asm.assemble_circular() if c['kind']=='circular' else asm.assemble_linear()
        c['pydna'] = sorted({str(r.seq).upper() for r in res}, key=len)[:4]
    except Exception as e:
        c['pydna'] = ['ERR:'+str(e)[:80]]

with open(os.path.join(OUT,'gibson_cases.json'),'w') as f:
    json.dump(cases, f)
print('cases', len(cases))
for c in cases:
    ok = any(len(p)==len(c['expected']) for p in c['pydna'] if not p.startswith('ERR'))
    print(c['name'], 'exp_len', len(c['expected']), 'pydna', [len(p) for p in c['pydna'] if not p.startswith('ERR')] or c['pydna'][:1])
