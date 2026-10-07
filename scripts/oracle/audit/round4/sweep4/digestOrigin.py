import json, sys
from Bio import Restriction as R
from pydna.dseqrecord import Dseqrecord
COMP = str.maketrans('ACGTacgt', 'TGCAtgca')
rc = lambda s: s.translate(COMP)[::-1]
cases = json.load(open(sys.argv[1]))
n = bad = refused = 0
for c in cases:
    if c.get('missing'): print('missing', c['name']); continue
    s = c['seq']; L = len(s)
    sub = lambda a, b: ''.join(s[i % L] for i in range(a, b))
    ours = []
    for f in c['frags']:
        a, b = f['range']
        k = lambda e: 0 if e[0] == 'blunt' else len(e[1])
        bs = a + (k(f['left']) if f['left'][0] == "5'" else -k(f['left']))
        be = b + (k(f['right']) if f['right'][0] == "5'" else -k(f['right']))
        if f['seq'].upper() != sub(a, b).upper(): print('seq/range mismatch', c['name'])
        # overhang text check: left 5' overhang = top bases a..bs ; 3' overhang = bottom bases bs..a (top coords)
        ol = sub(min(a,bs),max(a,bs)).upper(); orr = sub(min(b,be),max(b,be)).upper()
        if f['left'][1].upper()!=ol or f['right'][1].upper()!=orr: print('overhang text', c['name'], f['left'], ol, f['right'], orr)
        ours.append((f['seq'].upper(), rc(sub(bs, be)).upper()))
    try:
        frs = Dseqrecord(s, circular=True).cut(getattr(R, c['name']))
        theirs = [(str(x.seq.watson).upper(), str(x.seq.crick).upper()) for x in frs]
    except Exception as ex:
        refused += 1; continue
    n += 1
    if sorted(ours) != sorted(theirs):
        bad += 1
        if bad <= 6: print(c['name'], L, c['sites'], '\n ours', ours, '\n pydna', theirs)
print('compared', n, 'bad', bad, 'pydna refused', refused)
