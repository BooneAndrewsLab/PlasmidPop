"""Re-classify false-unchanged findings: is the location reachable by one
editor replace followed by a change of origin (#185's 'small rotation')?"""
import json, glob, sys
from collections import Counter
sys.path.insert(0, '.')
from oracle import all_ops, carry

def rot_reach(a, b, circ, segs, cand):
    if not circ:
        return None
    Lb = len(b)
    best = None
    for r in range(Lb):
        rb = b[r:] + b[:r]
        for op in all_ops(a, rb, circ):
            _, loc = carry(a, circ, segs, *op)
            if loc is None:
                continue
            moved = []
            for s, e in loc:
                s2 = (s + r) % Lb
                moved.append((s2, s2 + e - s))
            if tuple(moved) == tuple(cand):
                rr = min(r, Lb - r)
                if best is None or rr < best:
                    best = rr
    return best

if __name__ != "__main__":
    raise SystemExit
cnt = Counter()
rest = []
for p in sorted(glob.glob(sys.argv[1] if len(sys.argv) > 1 else '*.findings.json')):
    if p.startswith('t-'): continue
    for x in json.load(open(p))['fu']:
        cand = tuple(tuple(c) for c in x['cand'])
        segs = [tuple(s) for s in x['segs']]
        r = rot_reach(x['a'], x['b'], x['circ'], segs, cand)
        whole_after = x['circ'] and len(cand) == 1 and cand[0][1] - cand[0][0] == len(x['b'])
        tag = x['cls'] + ('_o1' if x['o1'] else '') + ('_rot%d' % r if r is not None else '') + ('_WA' if whole_after else '') + ('_REM' if x['removed'] else '')
        cnt[x['cls'] + ('_rot' if r is not None else '') + ('_WA' if whole_after else '') + ('_REM' if x['removed'] else '')] += 1
        x['tag'] = tag; x['src'] = p
        if r is None:
            rest.append(x)
print(dict(cnt))
json.dump(rest, open('rest.json', 'w'), indent=0)
for x in rest:
    print(x['src'][:-14], x['tag'], x['a'], x['b'], x['op'], x['segs'], '->', x['cand'], 'editor', x['editor'])
