import json, sys, collections
cases={c['id']:c for c in json.load(open(sys.argv[1]))}
orc={o['id']:o for o in json.load(open(sys.argv[2]))}
ts=json.load(open(sys.argv[3]))
bad=collections.Counter(); n=0
for t in ts:
    c=cases[t['id']]; o=orc[t['id']]; n+=1
    k=c['kind']; L=len(c['ref'])
    if 'error' in t: print('ERR',t['id'],k,t['fast'],t['error'][:120]); bad['err']+=1; continue
    probs=[]
    if abs(t['score']-o['score'])>1e-6: probs.append(f"score {t['score']} vs {o['score']} (2L {o['score2L']})")
    if not t['refOk']: probs.append('refRecon')
    if not t['readOk']: probs.append('readRecon')
    if o['score2L']>o['score']+1e-6: probs.append(f"NOTE 2L better {o['score2L']} > {o['score']}")
    if probs:
        bad[probs[0].split()[0]]+=1
        print(t['id'],k,'L',L,'lenRead',len(c['read']),'fast',t['fast'],t['strand'],t['startA'],t['endA'],'B',t['startB'],t['endB'],t['lenB'],'|',probs)
print('n',n,dict(bad))
