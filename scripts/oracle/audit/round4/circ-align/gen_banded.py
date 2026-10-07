import json, random, sys
from Bio.Align import PairwiseAligner, substitution_matrices
rng = random.Random(int(sys.argv[2]))
def R(n): return ''.join(rng.choice('ACGT') for _ in range(n))
def errs(s,k):
    s=list(s)
    for _ in range(k):
        j=rng.randrange(len(s)); r=rng.random()
        if r<0.6: s[j]=rng.choice([c for c in 'ACGT' if c!=s[j]])
        elif r<0.8: s[j]=''
        else: s[j]=s[j]+rng.choice('ACGT')
    return ''.join(s)
kinds=['lowcx','tandem3','edge_indel','end_ins','segdup','global_partial','ins_both_ends','tandem_end']
cases=[]
for k in range(int(sys.argv[1])):
    kind=kinds[k%len(kinds)]
    if kind=='lowcx':
        dn=rng.choice(['AT','CA','A','GC','AAT']); run=dn*rng.randint(15,80)
        left=R(rng.randint(600,1200)); right=R(rng.randint(600,1200))
        ref=R(500)+left+run+right+R(500)
        run2=dn*max(1,len(run)//len(dn)+rng.choice([-12,-5,-2,3,8,15]))
        read=errs(left[-rng.randint(100,500):]+run2+right[:rng.randint(100,500)],rng.randint(0,10))
    elif kind=='tandem3':
        u=R(rng.randint(15,45)); c=rng.randint(2,4)
        left=R(1000); right=R(1000); ref=R(300)+left+''.join(errs(u,1) if rng.random()<.3 else u for _ in range(c))+right+R(300)
        c2=rng.choice([1,c+1,c+2]); read=errs(left[-rng.randint(80,400):]+u*c2+right[:rng.randint(80,400)],rng.randint(0,8))
    elif kind=='edge_indel':
        ref=R(rng.randint(3000,4000)); d=rng.choice([rng.randint(55,75),rng.randint(240,270),rng.randint(1000,1030)])
        a=rng.randint(100,600); s=rng.randint(0,500); body=ref[s:s+a]+ref[s+a+d:s+a+d+rng.randint(300,700)]
        if rng.random()<0.5: body=ref[s:s+a]+R(d)+ref[s+a:s+a+rng.randint(300,700)]
        read=errs(body,rng.randint(0,15))
    elif kind=='end_ins':
        ref=R(3000); s=rng.randint(0,1500); body=ref[s:s+rng.randint(400,1000)]
        near=rng.randint(1,10); ins=R(rng.randint(20,400))
        body = body[:near]+ins+body[near:] if rng.random()<.5 else body[:len(body)-near]+ins+body[len(body)-near:]
        read=errs(body,rng.randint(0,10))
    elif kind=='segdup':
        seg=R(rng.randint(200,500)); a=R(800); b=R(900); c=R(800)
        ref=a+seg+b+errs(seg,rng.randint(1,6))+c
        which=rng.choice([0,1]); 
        if which==0: read=a[-rng.randint(20,200):]+seg+b[:rng.randint(20,200)]
        else: read=b[-rng.randint(20,200):]+ref[len(a)+len(seg)+len(b):len(a)+len(seg)+len(b)+len(seg)+5]+c[:rng.randint(20,200)]
        read=errs(read,rng.randint(0,6))
    elif kind=='global_partial':
        ref=R(rng.randint(2000,3500)); s=rng.randint(0,len(ref)-800); read=errs(ref[s:s+rng.randint(500,800)],rng.randint(0,10))
    elif kind=='ins_both_ends':
        ref=R(3000); s=rng.randint(0,1500); body=ref[s:s+rng.randint(500,1000)]
        body=R(rng.randint(10,120))+body[:3]+R(rng.randint(20,100))+body[3:-3]+R(rng.randint(20,100))+body[-3:]+R(rng.randint(10,120))
        read=errs(body,rng.randint(0,6))
    elif kind=='tandem_end':
        u=R(rng.randint(30,120)); left=R(1200); right=R(1200)
        ref=left+u+u+right
        read=errs(left[-rng.randint(400,800):]+u+right[:rng.randint(3,25)],rng.randint(0,4))
    cases.append({'id':k,'kind':kind,'ref':ref,'read':read})
al=PairwiseAligner(); al.substitution_matrix=substitution_matrices.load('NUC.4.4'); al.open_gap_score=-10; al.extend_gap_score=-0.5
for c in cases:
    for mode in ('global','local'):
        al.mode=mode; c[mode]=al.score(c['ref'],c['read'])
json.dump(cases,open(sys.argv[3],'w')); print(len(cases))
