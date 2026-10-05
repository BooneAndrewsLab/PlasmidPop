import json,sys
comp=str.maketrans('ACGT','TGCA')
def rc(s): return s.translate(comp)[::-1]
cf,of,orf=sys.argv[1],sys.argv[2],sys.argv[3]
cases={c['name']:c for c in json.load(open(cf))}
orc=json.load(open(orf))
out=json.load(open(of))
bad=0
for o in out:
    c=cases[o['name']]; t=c['expected'].upper()
    if o.get('error') or o['problem']:
        print('FAIL',o['name'],o.get('error') or o['problem'], 'usable',o.get('usable'),o.get('dropped')); bad+=1; continue
    p=o['product'].upper()
    ok=len(p)==len(t) and (p in t+t or rc(p) in t+t)
    po=orc[o['name']]['product'].upper()
    oko=len(p)==len(po) and (p in po+po or rc(p) in po+po)
    print(('OK  ' if ok and oko else 'BAD '),o['name'],'len',len(p),'exp',len(t),'vsOracle',oko,o['order'])
    if not(ok and oko):
        bad+=1
        best=max(range(len(t)),key=lambda s: sum(1 for a,b in zip(t[s:]+t[:s],p) if a==b))
        r=t[best:]+t[:best]
        i=next((i for i,(a,b) in enumerate(zip(r,p)) if a!=b),None)
        print('   diff at',i,'of',len(t))
        if i is not None:
            print('   exp',r[max(0,i-14):i+18]); print('   got',p[max(0,i-14):i+18])
print('bad',bad,'of',len(out))
