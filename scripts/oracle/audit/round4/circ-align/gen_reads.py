import json, random, sys
rng = random.Random(int(sys.argv[2]) if len(sys.argv)>2 else 7)
def R(n): return ''.join(rng.choice('ACGT') for _ in range(n))
def rc(s): return s[::-1].translate(str.maketrans('ACGTN','TGCAN'))
def seg(ref, start, n):
    L=len(ref); return ''.join(ref[(start+k)%L] for k in range(n))
def sprinkle(s, k):
    s=list(s)
    for _ in range(k):
        j=rng.randrange(len(s)); s[j]=rng.choice([x for x in 'ACGT' if x!=s[j]])
    return ''.join(s)
cases=[]
N=int(sys.argv[1])
for k in range(N):
    kind=['indel_origin','half','whole_plus','tiny','edge_mm','tandem_origin'][k%6]
    L=rng.randint(800,4000); ref=R(L)
    if kind=='indel_origin':
        x=rng.randint(40,400); y=rng.randint(40,400)
        body=seg(ref,L-x,x+y)  # origin at index x
        d=rng.choice([0,1,2,3,5,-1,-2,-3,-5])
        at=x+d
        ln=rng.randint(1,3)
        if rng.random()<0.5: body=body[:at]+body[at+ln:]; sub='del'
        else: body=body[:at]+R(ln)+body[at:]; sub='ins'
        read=sprinkle(body, rng.randint(0,3)); kind+=f'_{sub}{ln}@{d}'
    elif kind=='half':
        n=rng.randint(L//2, L-1); o=rng.randint(0,L-1); read=sprinkle(seg(ref,o,n), rng.randint(0,5))
    elif kind=='whole_plus':
        n=L+rng.randint(5,200); o=rng.randint(0,L-1); read=sprinkle(seg(ref,o,n), rng.randint(0,3))
    elif kind=='tiny':
        L=rng.randint(40,150); ref=R(L); n=rng.randint(L//2, L); o=rng.randint(0,L-1); read=sprinkle(seg(ref,o,n),rng.randint(0,2))
    elif kind=='edge_mm':
        x=rng.randint(1,3); y=rng.randint(100,300)
        body=list(seg(ref,L-x,x+y))
        j=rng.choice([x-1,x]); body[j]=rng.choice([c for c in 'ACGT' if c!=body[j]])
        read=''.join(body)
    elif kind=='tandem_origin':
        unit=R(rng.randint(2,12)); reps=rng.randint(4,12)
        tr=unit*reps; cut=rng.randint(1,len(tr)-1)
        ref=tr[cut:]+R(L-len(tr))+tr[:cut]  # tandem repeat straddling origin
        L=len(ref)
        # read with one unit deleted or inserted, spanning origin
        x=rng.randint(100,300); y=rng.randint(100,300)
        body=seg(ref,L-x-(len(tr)-cut),x+len(tr)+y)
        p=x+rng.randint(0,len(tr)-len(unit))
        if rng.random()<0.5: body=body[:p]+body[p+len(unit):]
        else: body=body[:p]+unit+body[p:]
        read=body
    if rng.random()<0.5: read=rc(read); kind+='_rc'
    cases.append({'id':k,'kind':kind,'ref':ref,'read':read})
json.dump(cases,open(sys.argv[3] if len(sys.argv)>3 else 'cases.json','w'))
print(len(cases))
