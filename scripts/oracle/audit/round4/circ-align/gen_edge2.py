import json, random, sys
rng = random.Random(int(sys.argv[2]))
def R(n): return ''.join(rng.choice('ACGT') for _ in range(n))
def rc(s): return s[::-1].translate(str.maketrans('ACGTN','TGCAN'))
def seg(ref, start, n):
    L=len(ref); return ''.join(ref[(start+k)%L] for k in range(n))
cases=[]; big=sys.argv[4]=='big'
for k in range(int(sys.argv[1])):
    L=rng.randint(13000,20000) if big else rng.randint(1000,4000); ref=R(L)
    side='start'
    x=rng.randint(1,6); y=rng.randint(800,1200)
    if side=='start':
        body=list(seg(ref,L-x,x+y)); j=rng.randint(x-1,x)
    else:
        body=list(seg(ref,L-y,y+x)); j=rng.randint(y-15,min(y+x-1,y+2))
    body[j]=rng.choice([c for c in 'ACGT' if c!=body[j]])
    read=''.join(body); kind=f'edge_{side}_x{x}_j{j}'
    if rng.random()<0.5: read=rc(read); kind+='_rc'
    cases.append({'id':k,'kind':kind,'ref':ref,'read':read})
json.dump(cases,open(sys.argv[3],'w'))
