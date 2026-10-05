import pandas as pd, json, os
SD='/home/matej/code/WebstormProjects/PlasmidPop/fixtures/local/potapov2018/Supplemental Data/'
D=os.path.dirname(os.path.abspath(__file__))
comp=str.maketrans('ACGT','TGCA'); rc=lambda s:s.translate(comp)[::-1]

def build(f):
    d=pd.read_excel(SD+f, sheet_name='table_02', header=0, index_col=0)
    seqcol=d.columns[-1]
    seqs=d[seqcol]; d=d.drop(columns=[seqcol])
    d.index=[str(i) for i in d.index]; d.columns=[str(c) for c in d.columns]
    # label -> sequence, dropping junctions the sheet gives no sequence for
    lab2seq={}
    for lab,s in zip(d.index, seqs):
        if isinstance(s,str) and s.strip(): lab2seq[str(lab)]=s.strip().upper()
    keep=[l for l in d.columns if l in lab2seq]
    d=d.loc[keep,keep]
    d.index=[lab2seq[l] for l in d.index]; d.columns=[lab2seq[l] for l in d.columns]
    # junction overhangs = the unprimed labels
    junc=[lab2seq[l] for l in keep if not l.endswith("'")]
    return d, junc

def observed(f):
    t=pd.read_excel(SD+f, sheet_name='table_05', header=0)
    return float(t.iloc[0]['Fraction']), str(t.iloc[0]['Assembly'])

def fid(d, junc):
    N=lambda a,b: max(float(d.loc[a,b]) if a in d.index and b in d.columns else 0.0,
                      float(d.loc[b,a]) if b in d.index and a in d.columns else 0.0)
    ends=list(dict.fromkeys([e for o in junc for e in (o, rc(o))]))
    prod=1.0; per=[]
    for o in junc:
        p=rc(o); own=tuple(sorted((o,p))); on=N(o,p); off=0.0; seen=set()
        for e in (o,p):
            for x in ends:
                k=tuple(sorted((e,x)))
                if k==own or k in seen: continue
                seen.add(k); off+=N(e,x)
        f_=1.0 if on+off==0 else on/(on+off)
        per.append((o,on,off,f_)); prod*=f_
    return prod, per

rows=[]
for f in ['FileS05_HF_cycled.xlsx','FileS11_HF_01h_37C.xlsx','FileS09_DP_cycled.xlsx',
          'FileS10_FP_cycled.xlsx','FileS13_DP_18h_37C.xlsx','FileS14_FP_18h_37C.xlsx',
          'FileS07_LF_cycled.xlsx','FileS12_LF_18h_37C.xlsx']:
    try:
        d,junc=build(f); pr,per=fid(d,junc); obs,asm=observed(f)
        print(f'{f:26s} junctions {len(junc):2d}  predicted {pr:.6f}  observed {obs:.6f}  {asm}')
        rows.append({'file':f,'junctions':junc,'predicted':pr,'observed':obs})
        if f=='FileS05_HF_cycled.xlsx':
            d.index.name='Overhang'; d.to_csv(D+'/potapov_S05_set.csv')
            json.dump({'overhangs':junc,'predicted':pr,'observed':obs},
                      open(D+'/potapov_S05_set.json','w'))
    except Exception as e:
        print(f,'ERR',str(e)[:90])
