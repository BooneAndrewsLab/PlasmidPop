import pandas as pd, numpy as np, json, random, os
D=os.path.dirname(os.path.abspath(__file__))
comp=str.maketrans('ACGT','TGCA'); rc=lambda s:s.translate(comp)[::-1]
df=pd.read_csv(D+'/T4_18h_37C.csv', index_col=0)
labels=list(df.columns)
M={r:{c:float(v) for c,v in zip(df.columns, row)} for r,row in zip(df.index, df.values)}
def N(a,b):
    return max(M.get(a,{}).get(b,0.0), M.get(b,{}).get(a,0.0))

def set_fidelity(oh):
    known=[o for o in oh if o in M]
    ends=list(dict.fromkeys([e for o in known for e in (o, rc(o))]))
    prod=1.0; per=[]
    for o in known:
        p=rc(o); own=tuple(sorted((o,p)))
        on=N(o,p); off=0.0; seen=set()
        for e in (o,p):
            for x in ends:
                k=tuple(sorted((e,x)))
                if k==own or k in seen: continue
                seen.add(k); off+=N(e,x)
        f=1.0 if on+off==0 else on/(on+off)
        per.append({'overhang':o,'onTarget':on,'offTarget':off,'fidelity':f}); prod*=f
    return {'fidelity':prod,'junctions':per}

# -- reference set from Potapov FileS05 table_02 (10-fragment HF-cycled assembly) --
REAL=['AAGG','ACTC','AGGA','AGTG','ATCA','GCCG','CTGA','GCGA','GGAA']
sets=[{'name':'potapov-s05-9oh','overhangs':REAL}]
# NEB/MoClo standard 4-nt overhangs widely used (Weber 2011 MoClo level 0 fusion sites)
sets.append({'name':'moclo-level0','overhangs':['GGAG','TACT','AATG','AGGT','GCTT','CGCT']})
# Yeast Toolkit (Lee 2015) type overhangs
sets.append({'name':'ytk-8','overhangs':['CCCT','AACG','TATG','ATCC','GGTA','GCTG','TACA','CCGA']})
random.seed(11)
alpha=[''.join(x) for x in __import__('itertools').product('ACGT',repeat=4)]
for n in [4,6,8,10,12,16,20]:
    for k in range(4):
        sets.append({'name':f'rand{n}-{k}','overhangs':random.sample(alpha,n)})
# palindrome-containing
sets.append({'name':'with-palindromes','overhangs':['AATT','GGCC','ACGT','GAGG','TTCA','CATG']})
# set containing an overhang and its reverse complement
sets.append({'name':'oh-and-rc','overhangs':['GGAG','CTCC','AATG','AGGT']})
sets.append({'name':'duplicate','overhangs':['GGAG','GGAG','AATG','AGGT']})
sets.append({'name':'one-off-pair','overhangs':['GGAG','GGAA','AATG','AGGT']})
sets.append({'name':'unknown-len','overhangs':['GGA','GGAG','AATG']})
out={s['name']:set_fidelity(s['overhangs']) for s in sets}
json.dump(sets, open(D+'/fid_sets.json','w'))
json.dump(out, open(D+'/fid_oracle.json','w'))
for s in sets:
    print(f"{s['name']:18s} n={len(s['overhangs']):2d} fidelity={out[s['name']]['fidelity']:.6f}")
