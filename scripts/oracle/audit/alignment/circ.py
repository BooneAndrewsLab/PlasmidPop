import json, random, sys
from Bio.Align import PairwiseAligner, substitution_matrices
mode = sys.argv[1]
rng = random.Random(99)
def R(n): return ''.join(rng.choice('ACGT') for _ in range(n))
def rc(s): return s[::-1].translate(str.maketrans('ACGTN','TGCAN'))
def mut(s, sub=0.01, indel=0.003):
    o=[]
    for c in s:
        r=rng.random()
        if r<indel: continue
        if r<2*indel: o.append(c); o.append(rng.choice('ACGT')); continue
        if r<2*indel+sub: o.append(rng.choice([x for x in 'ACGT' if x!=c])); continue
        o.append(c)
    return ''.join(o)
def seg(ref, start, n):  # circular slice
    L=len(ref); return ''.join(ref[(start+k)%L] for k in range(n))
if mode=='genlin':
    cases=[]
    for k in range(int(sys.argv[2])):
        L=rng.randint(1500,5000); ref=R(L); n=rng.randint(200,900)
        o = 0 if k%2==0 else L-n
        read=list(mut(ref[o:o+n]))
        # force mismatch at first or last base
        j = 0 if k%4<2 else len(read)-1
        read[j] = 'A' if read[j]!='A' else 'C'
        read=''.join(read)
        if k%3==0: read=rc(read)
        cases.append({'id':k,'kind':'lin_'+('start' if o==0 else 'end')+('_rc' if k%3==0 else ''),'ref':ref,'read':read,'circular':False,'fast':k%5==0,'o':100})
    json.dump(cases,open(sys.argv[3],'w')); print(len(cases)); sys.exit()
if mode=='gen':
    cases=[]; meta=[]
    kinds=['span','span_rc','bigdel_after','bigdel_before','inside_start','inside_end','whole','span_big','span_big_rc','bigins_origin','nearly_whole_del']
    for k in range(int(sys.argv[2])):
        kind=kinds[k%len(kinds)]
        L=rng.randint(2000,6000) if 'big' not in kind else rng.randint(7000,10000)
        ref=R(L); fast=False
        if kind in('span','span_rc'):
            n=rng.randint(300,1500); x=rng.randint(20,n-20); o=L-x; read=mut(seg(ref,o,n))
            if kind=='span_rc': read=rc(read)
        elif kind=='bigdel_after':
            x=rng.randint(30,400); d=rng.randint(50,1200); y=rng.randint(100,700); o=L-x
            read=mut(ref[L-x:]+ref[d:d+y])
        elif kind=='bigdel_before':
            x=rng.randint(100,700); d=rng.randint(50,1200); y=rng.randint(30,400); o=L-x-d
            read=mut(ref[L-x-d:L-d]+ref[:y])
        elif kind=='inside_start':
            n=rng.randint(200,800); o=rng.randint(0,200); read=mut(ref[o:o+n])
            if rng.random()<0.5: read=rc(read)
        elif kind=='inside_end':
            n=rng.randint(200,800); o=L-n-rng.randint(0,50); read=mut(ref[o:o+n])
        elif kind=='whole':
            o=rng.randint(0,L-1); read=mut(seg(ref,o,L))
        elif kind in ('span_big','span_big_rc'):
            n=rng.randint(3000,6000); x=rng.randint(100,n-100); o=L-x; read=mut(seg(ref,o,n),0.03,0.01); fast=rng.random()<0.5
            if kind=='span_big_rc': read=rc(read)
        elif kind=='bigins_origin':
            x=rng.randint(50,400); y=rng.randint(50,400); o=L-x; read=mut(ref[L-x:]+R(rng.randint(20,300))+ref[:y])
        elif kind=='nearly_whole_del':
            # whole plasmid read with a 1.5kb deletion just after the origin, starting just before it
            x=rng.randint(30,300); d=rng.randint(500,1500); o=L-x; read=mut(ref[L-x:]+ref[d:L-x-50])
        cases.append({'id':k,'kind':kind,'ref':ref,'read':read,'circular':True,'fast':fast,'o':o})
    json.dump(cases,open(sys.argv[3],'w')); print(len(cases)); sys.exit()
# compare
cases={c['id']:c for c in json.load(open(sys.argv[2]))}
pp=json.load(open(sys.argv[3]))
al=PairwiseAligner(); al.mode='local'; al.substitution_matrix=substitution_matrices.load('NUC.4.4'); al.open_gap_score=-10; al.extend_gap_score=-0.5
def regions(A,B,start,L):
    out=[]; p=start; cur=None
    for a,b in zip(A,B):
        diff = a!=b
        if diff:
            if cur is None: cur=[p if a!='-' else None, p-1, '', '']  # first ref pos (0-based) or None for insertion
            if a!='-':
                if cur[0] is None: cur[0]=p
                cur[1]=p
            cur[2]+= a if a!='-' else ''; cur[3]+= b if b!='-' else ''
        else:
            if cur is not None: out.append(cur); cur=None
        if a!='-': p+=1
    if cur is not None: out.append(cur)
    res=[]
    for c in out:
        pos = (c[0] if c[0] is not None else c[1])
        res.append(((pos%L)+1, c[2] or '-', c[3] or '-'))
    return res
bad=0; n=0; ties=0; notes=[]
for r in pp:
    c=cases[r['id']]; n+=1
    if 'error' in r: notes.append((r['id'],c['kind'],'ERROR',r['error'])); bad+=1; continue
    ref=c['ref']; L=len(ref); rot=(c['o'] - (0 if c['kind']=='whole' else 20 if c['kind']=='nearly_whole_del' else 100))%L; rr=ref[rot:]+ref[:rot]
    best=None
    for strand,b in (('forward',c['read']),('reverse',rc(c['read']))):
        s=al.score(rr,b)
        if best is None or s>best[0]: best=(s,strand,b)
    s,strand,b=best
    aln=al.align(rr,b)[0]; A,B=[x for x in aln.format('fasta').split('\n') if x and not x.startswith('>')]
    st=int(aln.coordinates[0][0]); en=int(aln.coordinates[0][-1])
    bioReg=regions(A,B,st+rot,L)
    ppReg=regions(r['alignedA'],r['alignedB'],r['startA'],L)
    ppRows=[(x['position'],x['reference'],x['bases'][0] if x['bases'] else None) for x in r['rows']]
    # wiring check: rows vs own alignment
    wiring = ppRows==[(p,a,b2) for p,a,b2 in ppReg]
    rec={'id':r['id'],'kind':c['kind'],'L':L,'readlen':len(c['read']),'bio':s,'pp':r['score'],'bstrand':strand,'pstrand':r['strand'],
         'bioStart1':(st+rot)%L+1,'bioEnd':(en+rot-1)%L+1,'ppStart1':r['startA']%L+1,'ppEnd':(r['endA']-1)%L+1,'range':r['range'],'aLen':r['aLen']}
    ok = abs(s-r['score'])<1e-9 and strand==r['strand'] and rec['bioStart1']==rec['ppStart1'] and rec['bioEnd']==rec['ppEnd'] and set(bioReg)==set(ppReg) and wiring
    if not ok:
        if abs(s-r['score'])<1e-9 and strand==r['strand'] and wiring and len(bioReg)==len(ppReg): ties+=1; rec['tie']=True
        else: bad+=1
        rec['wiring']=wiring; rec['onlyBio']=sorted(set(bioReg)-set(ppReg))[:6]; rec['onlyPP']=sorted(set(ppReg)-set(bioReg))[:6]
        if not wiring: rec['ppRows']=ppRows[:6]; rec['ppReg']=ppReg[:6]
        notes.append(rec)
print('cases',n,'bad',bad,'tie-only diffs',ties)
for x in notes:
    print(json.dumps(x)[:700])
