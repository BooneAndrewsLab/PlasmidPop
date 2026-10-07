import json,sys,collections
cases={c['id']:c for c in json.load(open(sys.argv[1]))}; ts=json.load(open(sys.argv[2]))
st=collections.Counter()
for t in ts:
    c=cases[t['id']]; want=c[t['mode']]; b=t['banded']
    if b is None: st['null']+=1
    else:
        st[('exact' if b['exact'] else 'inexact')]+=1
        if b['score']<want-1e-6: print('BELOW',t['id'],c['kind'],t['mode'],b,'want',want, 'long',t['long']); st['below_'+str(b['exact'])]+=1
    if t['long']<want-1e-6: print('LONG BELOW',t['id'],c['kind'],t['mode'],t['long'],want); st['longbelow']+=1
    if (b and b['score']>want+1e-6) or t['long']>want+1e-6: print('ABOVE?!',t)
print(dict(st))
