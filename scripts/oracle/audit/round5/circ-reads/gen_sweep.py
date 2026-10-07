import json, random
random.seed(11)
B='ACGT'
def rc(s): return s[::-1].translate(str.maketrans('ACGTN','TGCAN'))
def rnd(n): return ''.join(random.choice(B) for _ in range(n))
def sub(s,p):
    s=list(s); s[p]=random.choice([b for b in B if b!=s[p]]); return ''.join(s)
refs={}
unit=rnd(9)
refs['r3k']=rnd(3000)
refs['rep']=unit*30+rnd(2700)+unit*3   # tandem 9-mer repeat straddling origin
cases=[];cid=0
for name,ref in refs.items():
    L=len(ref); dd=ref*3
    for m in (900,):
        for back in range(1,41):
            o=L-back
            for v in range(4):
                read=dd[o:o+m]
                if v==1: read=sub(read, back-1)                 # last base before origin
                elif v==2: read=sub(sub(read, max(0,back-7)), min(m-1,back+6)) # break 15-mers across origin
                elif v==3:
                    read=read[:max(0,back-2)]+read[back:]      # 2-base deletion before origin
                for strand in 'FR':
                    rr=read if strand=='F' else rc(read)
                    cases.append(dict(id=cid,ref=name,L=L,o=o,m=m,strand=strand,read=rr)); cid+=1
json.dump(dict(refs=refs,cases=cases),open('reads_cases.json','w')); print(len(cases))
