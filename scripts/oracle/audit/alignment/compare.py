import json, sys
from Bio.Align import PairwiseAligner, substitution_matrices
cases = {c['id']: c for c in json.load(open(sys.argv[1]))}
pp = json.load(open(sys.argv[2]))
al = PairwiseAligner(); al.mode='local'
al.substitution_matrix = substitution_matrices.load('NUC.4.4'); al.open_gap_score=-10; al.extend_gap_score=-0.5
def rc(s): return s[::-1].translate(str.maketrans('ACGTNRYKMSWBDHV','TGCANYRMKSWVHDB'))
def variants(aA, aB, startA):
    v=set(); p=startA
    for x,y in zip(aA,aB):
        if x=='-': v.add((p,'ins',y))
        else:
            if y=='-': v.add((p,'del',x))
            elif x!=y: v.add((p,x,y))
            p+=1
    return v
def bio_aln(a,b):
    aln = al.align(a,b)[0]
    s = aln.format('fasta').split('\n')
    seqs=[l for l in s if l and not l.startswith('>')]
    return aln, seqs[0], seqs[1]
rows=[]; below=0; worst=0; diffstrand=0; strandfix=[]
for r in pp:
    c = cases[r['id']]
    a=c['a']; bf=c['b']; br=rc(bf); al.mode=c.get('mode','local')
    sf=al.score(a,bf); sr=al.score(a,br)
    best=max(sf,sr); bstrand='forward' if sf>=sr else 'reverse'
    d = best - r['score']
    rel = d/best if best>0 else 0
    rec={'id':r['id'],'kind':c['kind'],'bio':best,'pp':r['score'],'diff':d,'rel':rel,'strand':r['strand'],'bstrand':bstrand,'raw':r['rawScore'],'edge':r['rawEdge'],'ms':round(r['ms'])}
    if r['strand']!=bstrand and abs(sf-sr)>20: diffstrand+=1; rec['STRANDBUG']=True
    if d>1e-9:
        below+=1; worst=max(worst,rel)
        b = bf if r['strand']=='forward' else br
        aln, A, B = bio_aln(a,b)
        bstart=int(aln.coordinates[0][0])
        vb=variants(A.replace('',''),B,bstart) if False else None
        # bio aligned strings with local only the aligned part
        bA=''.join(A[i] for i in range(len(A))); 
        vB=variants_from = None
        rec['bioSpan']=[int(aln.coordinates[0][0]),int(aln.coordinates[0][-1]),int(aln.coordinates[1][0]),int(aln.coordinates[1][-1])]
        rec['ppSpan']=[r['startA'],r['endA'],r['startB'],r['endB']]
        # variants: build from coordinates
        vb=set(); 
        coords=aln.coordinates
        for k in range(coords.shape[1]-1):
            i0,i1=coords[0][k],coords[0][k+1]; j0,j1=coords[1][k],coords[1][k+1]
            if i1-i0==j1-j0:
                for t in range(i1-i0):
                    if a[i0+t]!=b[j0+t]: vb.add((int(i0+t),a[i0+t],b[j0+t]))
            elif i1==i0: vb.add((int(i0),'ins',b[j0:j1]))
            else: vb.add((int(i0),'del',a[i0:i1]))
        vp=set(); p=r['startA']; aA=r['alignedA']; aB=r['alignedB']; k=0
        while k<len(aA):
            if aA[k]=='-':
                j=k
                while j<len(aA) and aA[j]=='-': j+=1
                vp.add((p,'ins',aB[k:j])); k=j; continue
            if aB[k]=='-':
                j=k
                while j<len(aA) and aB[j]=='-': j+=1
                vp.add((p,'del',aA[k:j])); p+=j-k; k=j; continue
            if aA[k]!=aB[k]: vp.add((p,aA[k],aB[k]))
            p+=1; k+=1
        # restrict to overlap of both spans for comparability
        lo=max(rec['bioSpan'][0],r['startA']); hi=min(rec['bioSpan'][1],r['endA'])
        rec['varOnlyBio']=sorted([v for v in vb-vp if lo<=v[0]<hi])[:10]
        rec['varOnlyPP']=sorted([v for v in vp-vb if lo<=v[0]<hi])[:10]
        rec['nVarDiffInOverlap']=len([v for v in vb^vp if lo<=v[0]<hi])
    rows.append(rec)
json.dump(rows, open(sys.argv[3],'w'), indent=1)
print('cases',len(rows),'below',below,'worst rel %.4f%%'%(100*worst),'strand mismatches',diffstrand)
for x in rows:
    if x['diff']>1e-9 or x.get('STRANDBUG'):
        print({k:x[k] for k in x if k not in('varOnlyBio','varOnlyPP')}, x.get('varOnlyBio'), x.get('varOnlyPP'))
