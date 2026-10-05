import json, os
D = os.path.dirname(os.path.abspath(__file__))
cases = {c['name']: c for c in json.load(open(D+'/gibson_cases.json'))}
out = json.load(open(D+'/gibson_out.json'))
comp = str.maketrans('ACGT','TGCA')
def rc(s): return s.translate(comp)[::-1]
def rotations_match(prod, target):
    if len(prod) != len(target): return False
    d = target + target
    return prod in d or rc(prod) in d
bad = 0
for o in out:
    c = cases[o['name']]
    if o.get('error') or o['problem']:
        print('FAIL', o['name'], o.get('error') or o['problem']); bad+=1; continue
    p = o['product'].upper()
    tgt = c['target'].upper()
    if c['kind']=='circular':
        ok = rotations_match(p, tgt)
    else:
        ok = p == tgt or p == rc(tgt)
    print(('OK  ' if ok else 'BAD '), o['name'], 'len', len(p), 'exp', len(c['expected']),
          'order', o['order'], 'joins', o['joins'], 'circ', o['circular'])
    if not ok:
        bad+=1
        # locate first divergence against best rotation
        if c['kind']=='circular':
            best=None
            for sh in range(len(tgt)):
                r = tgt[sh:]+tgt[:sh]
                m = sum(1 for a,b in zip(r,p) if a==b)
                if best is None or m>best[0]: best=(m,sh)
            r = tgt[best[1]:]+tgt[:best[1]]
            i = next((i for i,(a,b) in enumerate(zip(r,p)) if a!=b), None)
            print('    best rot', best[1], 'matches', best[0], 'first diff at', i)
            if i is not None:
                print('    exp', r[max(0,i-10):i+15]); print('    got', p[max(0,i-10):i+15])
print('bad', bad, 'of', len(out))
