import json, os, sys
from Bio.Seq import Seq
from collections import Counter
S=os.path.dirname(os.path.abspath(__file__))
cases=json.load(open(S+'/cases.json')); ours={o['file']:o for o in json.load(open(S+'/ours_synth.json'))}
STARTS={'ATG','TTG','CTG'}
st=Counter(); probs=[]
def tr(codons): return ''.join(str(Seq(c).translate()) for c in codons)
def cmp_protein(p, codons):
    e=tr(codons)
    if len(p)!=len(e): return False
    if p[1:]!=e[1:]: return False
    return p[:1]==e[:1] or (p[:1]=='M' and codons[0] in STARTS)
def raw_seq(c):
    import struct
    b=open(c['file'],'rb').read(); i=0
    while i<len(b):
        t=b[i]; n=struct.unpack('>I',b[i+1:i+5])[0]
        if t==0: return b[i+6:i+5+n].decode()
        i+=5+n
for c in cases:
    o=ours[c['file']]; k=c['kind']; st[k]+=1
    if not o['ok']: probs.append((k,os.path.basename(c['file']),'FAIL',o['error'][:100])); continue
    seq=raw_seq(c); L=len(seq)
    if k=='frame':
        rf=c['rf']; cs=c['cs']
        exp_cs = abs(int(rf)) if rf is not None else (int(cs) if cs else 1)
        pos=[]
        for r in c['segs']:
            a,b=map(int,r.split('-'))
            pos+= [x%L for x in range(a-1, b if b>=a else b+L)]
        if c['dirn']=='2': pos=pos[::-1]
        text=''.join(seq[p] for p in pos)
        if c['dirn']=='2': text=''.join({'A':'T','C':'G','G':'C','T':'A'}[x] for x in text)
        codons=[text[i:i+3] for i in range(exp_cs-1, len(text)-2, 3)]
        f=[f for f in o['features'] if f['type']=='CDS'][0]
        q=[x['value'] for x in f['qualifiers'] if x['name']=='codon_start']
        got_cs=int(q[0]) if q else 1
        if got_cs!=exp_cs or not cmp_protein(f['protein'], codons):
            st['frame_bad']+=1
            probs.append((k,os.path.basename(c['file']),'cs got',got_cs,'exp',exp_cs))
    elif k=='sticky':
        up,down=c['up'],c['down']
        lo=-up if up<0 else 0; hi=L-down if down>0 else L
        if o['seq']!=seq[lo:hi]: probs.append((k,os.path.basename(c['file']),'seq')); continue
        f=[f for f in o['features'] if f['type']=='CDS']
        rf=abs(int(c['rf']))
        pos=[]
        for r in c['segs']:
            a,b=map(int,r.split('-')); pos+=list(range(a-1,b))
        if c['dirn']=='2': pos=pos[::-1]
        cods=[pos[i:i+3] for i in range(rf-1, len(pos)-2, 3)]
        surv=[cd for cd in cods if all(lo<=p<hi for p in cd)]
        def base(p,rev):
            x=seq[p]; return {'A':'T','C':'G','G':'C','T':'A'}[x] if rev else x
        codons=[''.join(base(p,c['dirn']=='2') for p in cd) for cd in surv]
        if not f: probs.append((k,os.path.basename(c['file']),'no CDS')); continue
        p=f[0]['protein']
        # also check segments
        exp_segs=[]
        for r in c['segs']:
            a,b=map(int,r.split('-')); s1=max(a-1,lo)-lo; e1=min(b,hi)-lo
            if e1>s1: exp_segs.append((s1,e1))
        got_segs=[(s['start'],s['end']) for s in f[0]['segments']]
        ok=cmp_protein(p,codons) and got_segs==exp_segs
        st['sticky_ok' if ok else 'sticky_bad']+=1
        if not ok: probs.append((k,os.path.basename(c['file']),'ours',p,'exp',tr(codons),got_segs,exp_segs, [x for x in f[0]['qualifiers'] if x['name']=='codon_start']))
    elif k=='range' or k=='primer':
        circ=c['circ']
        a,b=map(int,(c['r'] if k=='range' else c['loc']).split('-'))
        if k=='range':
            valid = 1<=a<=L and 1<=b<=L and (b>=a or circ)
            exp=None if not valid else ((a-1,b) if b>=a else (a-1,a-1+L) if b==a-1 else (a-1,b+L))
        else:
            valid = 0<=a<L and 0<=b<L and (b>=a or circ)
            exp=None if not valid else ((a,b+1) if b>=a else (a,a+L) if b==a-1 else (a,b+1+L))
        fs=[f for f in o['features']]
        got=None if not fs else (fs[0]['segments'][0]['start'],fs[0]['segments'][0]['end'])
        strand_ok = not fs or k=='range' or fs[0]['strand']==('reverse' if c['bs']=='1' else 'forward')
        if got!=exp or not strand_ok: probs.append((k,os.path.basename(c['file']),'got',got,'exp',exp, o['warnings']))
        if exp is None and not o['warnings']: probs.append((k,os.path.basename(c['file']),'no warning'))
    elif k=='flags':
        fl=c['flags']
        if o['topology']!=('circular' if fl&1 else 'linear') or o['methylation']!={'dam':bool(fl&4),'dcm':bool(fl&8)}:
            probs.append((k,fl,o['topology'],o['methylation']))
print(st); print(len(probs))
seen=Counter()
for p in probs:
    seen[(p[0],)+tuple(str(x) for x in p[2:5])]+=1
for p in probs: print(p)
