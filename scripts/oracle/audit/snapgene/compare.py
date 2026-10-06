import sys, json, re, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from raw import parse
from Bio.Seq import Seq
from collections import Counter
S=os.path.dirname(os.path.abspath(__file__))
ours=json.load(open(sys.argv[1] if len(sys.argv)>1 else S+'/ours.json'))
stats=Counter(); problems=[]
def stick(px, tag):
    m=re.search(r'<%s>\s*(-?\d+)'%tag, px or ''); return int(m.group(1)) if m else 0
def expected_segments(rng, L, circ):
    a,b=map(int,rng.split('-'))
    if b>=a: return (a-1,b)
    if not circ: return None
    return (a-1, b+L)  # wrap; b==a-1 -> full circle
for o in ours:
    d=parse(o['file']); name=os.path.basename(o['file'])
    if not o['ok']: problems.append((name,'parse fail',o['error'])); continue
    L0=len(d['seq']); circ=bool(d['flags']&1)
    up=stick(d.get('propxml'),'UpstreamStickiness'); down=stick(d.get('propxml'),'DownstreamStickiness')
    if circ: up=down=0
    seq=d['seq']; lo=0; hi=L0
    if down>0: hi=L0-down
    if up<0: lo=-up
    expseq=seq[lo:hi]
    if o['seq']!=expseq: problems.append((name,'seq', len(o['seq']), len(expseq), o['seq']==expseq.upper()))
    stats['seq']+=1
    if o['topology']!=('circular' if circ else 'linear'): problems.append((name,'topology'))
    m=o['methylation']
    if m!={'dam':bool(d['flags']&4),'dcm':bool(d['flags']&8)}: problems.append((name,'meth',d['flags'],m))
    # features
    rawf=[f for f in d['features']]
    ourf=[f for f in o['features'] if f['type']!='primer_bind' or any(r['attrs'].get('type')=='primer_bind' and r['attrs'].get('name')==f['name'] for r in rawf)]
    ourf_nonprimer=[f for f in o['features'] if not (f['type']=='primer_bind' and any(q['name']=='note' and (q['value'] or '').startswith('sequence: ') for q in f['qualifiers']))]
    if len(ourf_nonprimer)!=len(rawf): problems.append((name,'featcount',len(ourf_nonprimer),len(rawf))); continue
    L=len(expseq)
    for rf,of in zip(rawf,ourf_nonprimer):
        stats['feat']+=1
        a=rf['attrs']
        if of['name']!=a.get('name',''): problems.append((name,'fname',of['name'],a.get('name')))
        if of['type']!=a.get('type'): problems.append((name,'ftype',of['type'],a.get('type')))
        st='reverse' if a.get('directionality')=='2' else 'forward'
        if of['strand']!=st: problems.append((name,'strand',a.get('name')))
        segs=[expected_segments(s['range'],L0,circ) for s in rf['segs'] if s.get('type')!='gap']
        # apply clip: shift by lo, clip to [0,L)
        exp=[]
        for s0,e0 in segs:
            s1=max(s0-lo,0); e1=min(e0-lo,L) if not circ else e0-lo
            if e1>s1: exp.append((s1,e1))
        got=[(s['start'],s['end']) for s in of['segments'] if s['kind']=='range']
        if got!=exp: problems.append((name,'segs',a.get('name'),got,exp,[s['range'] for s in rf['segs']]))
        if len(segs)>1: stats['multiseg']+=1
        if any(e>L0 for s,e in segs): stats['origin']+=1
        # translation check
        if a.get('type')=='CDS':
            tr=[v for q,v in rf['quals'] if q=='translation']
            stats['cds']+=1
            if tr:
                t=tr[0].replace(',','').replace('*','')
                p=(of['protein'] or '').rstrip('*')
                key=(st, a.get('readingFrame'), len(segs)>1, any(e>L0 for s,e in segs), lo>0 or hi<L0)
                stats[('cds_tr',)+key]+=1
                if p!=t:
                    problems.append((name,'translation',a.get('name'),key,'ours',p[:30],len(p),'file',t[:30],len(t), [q for q in of['qualifiers'] if q['name']=='codon_start']))
                    stats[('cds_tr_bad',)+key]+=1
    # primers
    rawsites=[(p['attrs'].get('name'),s) for p in d['primers'] for s in p['sites']]
    ourp=[f for f in o['features'] if f['type']=='primer_bind' and any(q['name']=='note' and (q['value'] or '').startswith('sequence: ') for q in f['qualifiers'])]
    # dedupe simplified
    exp=[]; seen=set()
    for nm,s in rawsites:
        a,b=map(int,s['location'].split('-'))
        r=(a,b+1) if b>=a else (a,b+1+L0)
        k=(r,s.get('boundStrand','0'))
        if s.get('simplified')=='1' and k in seen: continue
        seen.add(k)
        s1=max(r[0]-lo,0); e1=min(r[1]-lo,L) if not circ else r[1]-lo
        if e1>s1: exp.append((nm,s1,e1,'reverse' if s.get('boundStrand')=='1' else 'forward'))
    got=[(f['name'],f['segments'][0]['start'],f['segments'][0]['end'],f['strand']) for f in ourp]
    stats['primersites']+=len(exp)
    if sorted(got)!=sorted(exp): problems.append((name,'primers',sorted(set(got)^set(exp))))
for k,v in sorted(stats.items(), key=str): print(k,v)
print('PROBLEMS',len(problems))
for p in problems[:80]: print(p)
