import json, sys, collections
from Bio import Restriction as R
from Bio.Seq import Seq
from pydna.dseqrecord import Dseqrecord
cases = {c['id']: c for c in json.load(open(sys.argv[1]))}
outs = json.load(open(sys.argv[2]))
V = len(sys.argv) > 3
prob = collections.Counter(); ex = collections.defaultdict(list)
def rep(k, m):
    prob[k] += 1
    if len(ex[k]) < 4: ex[k].append(m)
def rc(s): return str(Seq(s).reverse_complement())
def rot_eq(a, b):
    return len(a) == len(b) and (a in b + b or rc(a) in b + b)
def reading(seq, f):
    L = len(seq); s2 = seq + seq
    parts = []
    for a, b, *_ in f['segments']:
        parts.append(s2[a:b] if b <= L else s2[a:b])
    r = ''.join(parts)
    return rc(r) if f['strand'] == 'reverse' else r
n = 0
for o in outs:
    if 'error' in o: continue
    c = cases[o['id']]; seq = c['seq']
    rec = Dseqrecord(seq, circular=True)
    frags = rec.cut(*[getattr(R, e) for e in c['enzymes']])
    big = [f for f in frags if o['fragment'].upper() in str(f.seq).upper() or rc(o['fragment'].upper()) in str(f.seq).upper()]
    big = big[0] if big else max(frags, key=len)
    d = big.seq
    d2 = d.T4('ACGT') if c['method'] == 'fill' else d.mung()
    prod = str(d2.looped()).upper()
    for key in ('closed', 'closedGb'):
        p = o[key]
        if p is None: rep('null product '+key, o['id']); continue
        n += 1
        if not rot_eq(p['sequence'].upper(), prod):
            rep('product seq vs pydna '+key, f"{o['id']} {c['enzymes']} {c['method']} ours {len(p['sequence'])} pydna {len(prod)}")
        F = c['features'][0]
        orig = reading(seq, F)
        cs = int(dict(F['qualifiers']).get('codon_start', '1'))
        for g in p['features']:
            r = reading(p['sequence'], g)
            whole = not any(s[2] or s[3] for s in g['segments'])
            if len(r) >= 10 and r.upper() not in orig.upper():
                rep('non-contiguous reading '+key, f"{o['id']} {c['enzymes']} {c['method']} {g['segments']} {g['strand']}")
            if r.upper() == orig.upper() and not whole:
                rep('missed rejoin '+key, f"{o['id']} {c['enzymes']} {c['method']}")
            if whole and r.upper() != orig.upper():
                q = dict(g['qualifiers'])
                gcs = int(q.get('codon_start','1'))
                # whole marks allowed only if it starts at original reading start or within skip, and ends at original end
                i = orig.upper().find(r.upper())
                if not (i <= cs - 1 and i + len(r) == len(orig)):
                    rep('unmarked partial '+key, f"{o['id']} {c['enzymes']} {c['method']} {g['segments']} i={i} len {len(r)}/{len(orig)}")
            # protein: from codon_start in our feature
            q = dict(g['qualifiers']); gcs = int(q.get('codon_start','1'))
            prot = str(Seq(r[gcs-1:][:len(r[gcs-1:])//3*3]).translate(table=11))
            ours = g['protein'] or ''
            extra = len(ours) - len(prot)
            if ours[1:len(prot)] != prot[1:] or extra not in (0, 1) or (extra == 1 and len(r[gcs-1:]) % 3 != 2):
                rep('protein '+key, f"{o['id']} ours {ours} bio {prot}")
            # frame: codon_start must keep original frame
            i = orig.upper().find(r.upper())
            if len(r) >= 10 and i >= 0 and (i + gcs - 1 - (cs - 1)) % 3 != 0:
                rep('frame '+key, f"{o['id']} {g['segments']} cs {gcs} i {i} ocs {cs}")
print('checked products', n)
for k, v in prob.items():
    print('==', k, v)
    for m in ex[k]: print('   ', m)
