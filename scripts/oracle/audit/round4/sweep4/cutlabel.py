import json, sys
from Bio.Seq import Seq
from Bio import Restriction as R
cases = json.load(open(sys.argv[1]))
bad = 0; n = 0; origin = 0
for c in cases:
    if c.get('missing'):
        print('missing', c['name']); continue
    e = getattr(R, c['name'])
    s = c['seq']; L = len(s)
    fst5, fst3, scd5, scd3, _ = e.charac
    found = set()
    for p in e.search(Seq(s), linear=False):
        found.add((p - 1) % L)
    if not e.is_palindromic():
        rcs = Seq(s).reverse_complement()
        top, bottom = fst5, e.size + fst3
        for p in e.search(rcs, linear=False):
            found.add((L - (p - 1 + bottom - top)) % L)
    exp = sorted(set((L if x == 0 else x) for x in found))
    ours = sorted(set(x['label'] for x in c['sites']))
    svg = sorted(set(c['svgLabels']))
    n += 1
    if 0 in found: origin += 1
    if exp != ours or (svg and svg != ours) or not svg and ours:
        bad += 1
        if bad < 10: print(c['name'], L, 'bio', exp, 'ours', ours, 'svg', svg)
print('cases', n, 'bad', bad, 'with cut at origin', origin)
