import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from raw import parse, files
from collections import Counter
c = Counter(); ex = {}
for f in files():
    d = parse(f)
    L = len(d['seq'])
    for ft in d['features']:
        a = ft['attrs']
        if a.get('type') != 'CDS': continue
        tr = any(q == 'translation' for q, v in ft['quals'])
        cs = [v for q, v in ft['quals'] if q == 'codon_start']
        segs = [s for s in ft['segs'] if s.get('type') != 'gap']
        wrap = any(int(s['range'].split('-')[1]) < int(s['range'].split('-')[0]) for s in segs)
        untrans = any(s.get('translated') == '0' for s in segs)
        k = (a.get('directionality'), a.get('readingFrame'), tuple(cs), tr, len(segs) > 1, wrap, untrans)
        c[k] += 1; ex.setdefault(k, (os.path.basename(f), a.get('name')))
for k, v in sorted(c.items(), key=str): print(v, k, ex[k])
