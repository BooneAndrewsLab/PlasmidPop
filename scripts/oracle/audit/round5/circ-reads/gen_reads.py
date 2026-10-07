import json, random
random.seed(5)
B='ACGT'
def rc(s): return s[::-1].translate(str.maketrans('ACGTN','TGCAN'))
def rnd(n): return ''.join(random.choice(B) for _ in range(n))
def mutate(s, near, nmut, region=30):
    s=list(s)
    for _ in range(nmut):
        p=max(0,min(len(s)-1, near+random.randint(-region,region)))
        k=random.choice('sid')
        if k=='s': s[p]=random.choice([b for b in B if b!=s[p]])
        elif k=='i': s.insert(p,random.choice(B))
        else: del s[p]
    return ''.join(s)
cases=[]
cid=0
refs=[]
refs.append(('rand4k',rnd(4000)))
refs.append(('rand12k',rnd(12000)))  # banded single path (cells > 25M)
# tandem repeat across origin
unit=rnd(37)
refs.append(('tandem',unit*8 + rnd(3000) + unit*6))
refs.append(('tandem12k', unit*10 + rnd(11000) + unit*10))
for name,ref in refs:
    L=len(ref)
    dd=ref+ref
    for m in (600,1500):
        offs=list(range(L-25,L))+list(range(0,6))+[L-m//2, L-m+3, L-m-2]
        for k,o in enumerate(offs):
            o%=L
            read=(dd+dd)[o:o+m]
            # where origin falls within read
            near=(L-o)%L
            variant=k%4
            if variant==1: read=mutate(read, near if near<m else 0, 3, 8)
            elif variant==2: read=mutate(read, max(0,near-3), 1, 2)  # difference just before origin
            elif variant==3: read=mutate(read, random.randint(0,m-1), 6, 400)
            strand=random.choice('FR')
            if strand=='R': read=rc(read)
            cases.append(dict(id=cid,ref=name,L=L,o=o,m=m,strand=strand,read=read)); cid+=1
    # whole circle or more
    for extra in (0,5,40):
        read=(dd+dd)[L-10:L-10+L+extra] if L<5000 else None
        if read is None: continue
        cases.append(dict(id=cid,ref=name,L=L,o=L-10,m=len(read),strand='F',read=read)); cid+=1
    # indel exactly at origin
    for kind in ('ins','del','sub'):
        for strand in 'FR':
            o=L-300; read=dd[o:o+600]
            j=300
            if kind=='ins': read=read[:j]+'T'+read[j:]
            elif kind=='del': read=read[:j]+read[j+1:]
            else: read=read[:j]+('A' if read[j]!='A' else 'C')+read[j+1:]
            if strand=='R': read=rc(read)
            cases.append(dict(id=cid,ref=name,L=L,o=o,m=len(read),strand=strand,read=read,kind=kind)); cid+=1
json.dump(dict(refs=dict(refs),cases=cases),open('reads_cases.json','w'))
print(len(cases))
