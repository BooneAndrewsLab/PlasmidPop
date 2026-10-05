import json, os
from pydna.dseq import Dseq
from Bio.Restriction import BsaI, BsmBI, BbsI, SapI
D=os.path.dirname(os.path.abspath(__file__))
comp=str.maketrans('ACGTacgt','TGCAtgca')
def rc(s): return s.translate(comp)[::-1]
BIO={'BsaI':(BsaI,'GGTCTC'),'BsmBI':(BsmBI,'CGTCTC'),'BbsI':(BbsI,'GAAGAC'),'SapI':(SapI,'GCTCTTC')}
def ends(f):
    k5,o5=f.five_prime_end(); k3,o3=f.three_prime_end()
    return (k5,o5.upper()),(k3,rc(o3.upper()))
def usable(seq,ename,circular):
    enz,site=BIO[ename]; out=[]
    for f in Dseq(seq,circular=circular).cut(enz):
        w=f.watson.upper()
        if site in w or rc(site) in w: continue
        (k5,lo),(k3,ro)=ends(f)
        if k5=='blunt' or k3=='blunt': continue
        out.append(f)
    return out
def assemble(frags):
    first=frags[0]; order=[(0,first,False)]; used={0}
    while len(used)<len(frags):
        _,(_,curR)=ends(order[-1][1])
        nxt=[]
        for i,f in enumerate(frags):
            if i in used: continue
            for g,fl in ((f,False),(f.reverse_complement(),True)):
                (_,gl),_=ends(g)
                if gl==curR: nxt.append((i,g,fl))
        if len(nxt)!=1: return None,('n',len(nxt))
        order.append(nxt[0]); used.add(nxt[0][0])
    _,(_,lastR)=ends(order[-1][1]); (_,firstL),_=ends(first)
    if lastR!=firstL: return None,'noclose'
    return ''.join(o[1].watson.upper() for o in order),[(o[0],o[2]) for o in order]
cases=json.load(open(D+'/gg2_cases.json'))
res={}
for c in cases:
    frs=[]
    for p in c['parts']: frs+=usable(p['seq'],c['enzyme'],p.get('circular',False))
    prod,order=assemble(frs)
    res[c['name']]={'product':prod,'order':order,'nfrag':len(frs)}
    t=c['expected'].upper()
    ok= prod is not None and len(prod)==len(t) and (prod in t+t or rc(prod) in t+t)
    print(c['name'],'frags',len(frs),'len',(len(prod) if prod else None),'exp',len(t),'==',ok,'' if ok else order)
json.dump(res,open(D+'/gg2_oracle.json','w'))
