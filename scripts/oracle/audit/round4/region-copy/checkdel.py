import json, sys, collections
sys.argv=['x','outdel.json']
src_code=open('check.py').read()
ns={}
exec(src_code.split("for c in d:")[0], ns)
reading, five, three = ns['reading'], ns['five'], ns['three']
d=json.load(open('outdel.json'))
prob=collections.Counter(); ex=collections.defaultdict(list); st=collections.Counter()
def bad(k,c,m):
    prob[k]+=1
    if len(ex[k])<3: ex[k].append((m,c['L'],c['circular'],c['region'],c['src']['strand'],c['src']['codonStart'],[(s['start'],s['end'],s['ps'],s['pe']) for s in c['src']['segments']], c.get('out')))
for c in d:
    L,circ=c['L'],c['circular']; rs,re=c['region']; re=min(re,rs+L-1)
    D={p%L for p in range(rs,re)}
    newidx={}; k=0
    for i in range(L):
        if i not in D: newidx[i]=k; k+=1
    src=c['src']; R=reading(src,L,circ)
    keep=[j for j in range(len(R)) if R[j] not in D]
    if not keep:
        if c['out']: bad('not-removed',c,'')
        continue
    if len(c['out'])!=1: bad('count',c,len(c['out'])); continue
    f=c['out'][0]; nL=len(c['exSeq'])
    got=reading(f,nL,circ)
    exp=[newidx[R[j]] for j in keep]
    if got!=exp: bad('bases',c,(exp,got)); continue
    if src['type']!='CDS': continue
    lost=keep[0]
    prefix = keep==list(range(lost,lost+len(keep)))  # deleted = prefix and/or suffix only
    cs=int(src['codonStart'] or 1); gcs=int(f['codonStart'] or 1)
    st['cds']+=1
    if not prefix: st['middle']+=1; continue
    skip=cs-1
    first= skip if lost<=skip else lost+(skip-lost)%3
    if first-lost+1!=gcs: bad('codon_start',c,(first-lost+1,gcs,lost))
    if five(f)!=(lost>0 or five(src)): bad('5p',c,(five(f),lost))
    if keep[-1]<len(R)-1:
        st['3p-trimmed']+=1
        if three(f)!=three(src): st['3p-flag-%s->%s'%(three(src),three(f))]+=1
print(dict(st)); print(dict(prob))
for k,v in ex.items():
    print('==',k)
    for e in v: print('  ',e)
n=0
for c in d:
    if c['src']['type']!='CDS': continue
    L,circ=c['L'],c['circular']; rs,re=c['region']; re=min(re,rs+L-1)
    if not c['out']: continue
    f=c['out'][0]
    if three(c['src']) and not three(f) and n<3:
        n+=1; print(L,circ,(rs,re),c['src']['strand'],[(s['start'],s['end'],s['ps'],s['pe']) for s in c['src']['segments']],'->',[(s['start'],s['end'],s['ps'],s['pe']) for s in f['segments']])
