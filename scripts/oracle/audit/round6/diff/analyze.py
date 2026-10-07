import json, sys, collections
sys.path.insert(0, '.')
from oracle import consistent, dist
d = json.load(open(sys.argv[1]))
cat = collections.Counter(); mags = collections.Counter(); ex = {}
for x in d['false_unchanged']:
    a, b, circ = x['a'], x['b'], x['circ']
    old = json.loads(x['old'])[0]; new = json.loads(x['new'])[0]
    # the editor's own result: the reach entry of cost == op cost
    opc = x['op']['end'] - x['op']['start'] + len(x['op']['text'])
    ed = [json.loads(k)[0] for k, c in x['reach'].items() if c <= opc]
    edloc = ed[0] if ed else None
    # which segment differs
    for i, (o, n) in enumerate(zip(old, new)):
        if consistent(a, b, circ, (o[0], o[1]), (n[0], n[1])):
            continue
        # does some optimal-alignment placement exist for each end alone?
        L, M = len(a), len(b)
        st_ok = any(consistent(a, b, circ, (o[0], o[1]), (n[0], e2)) for e2 in range(n[0]+1, n[0]+M+1))
        en_ok = any(consistent(a, b, circ, (o[0], o[1]), (s2, n[1])) for s2 in range(max(0, n[1]-M), n[1]))
        kind = 'joint(start ok & end ok separately)' if st_ok and en_ok else 'start-bad' if not st_ok and en_ok else 'end-bad' if st_ok else 'both-bad'
        kind += ' circ' if circ else ' lin'
        lendiff = (n[1]-n[0]) - ((edloc[i][1]-edloc[i][0]) if edloc and len(edloc) > i else 0)
        cat[kind] += 1
        mags[abs(lendiff)] += 1
        ex.setdefault(kind, []).append((a, b, x['op'], o[:2], n[:2], edloc[i][:2] if edloc and len(edloc)>i else None))
print(cat); print('abs length diff vs editor', sorted(mags.items()))
for k, v in ex.items():
    print(k)
    for e in v[:4]: print('  ', e)
