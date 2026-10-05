import json
D='.'
reb=json.load(open('rebase_methylation.json')); enz={e['name']:e for e in json.load(open('enzymes.json'))}
sens=set(json.load(open('sensitive.json')))
for n in ['BstXI','SfiI','SfoI','FokI','AlwNI','PflMI','EcoO109I','BsaHI','BsaBI','FseI','Hpy188I','AlwI','BsmFI','HphI','MboII','AvaII','BanI','Acc65I','NlaIV','EaeI']:
    r=reb.get(n); print(n, enz.get(n,{}).get('site'), 'inlist' if n.lower() in sens else 'NOT', json.dumps(r) if r else None)
print()
# per-site oracle on real sequences
meth=json.load(open('methylation.json')); sites=json.load(open('sites.json'))
MOT={'Dam':('GATC',[1,2]),'Dcm':('CCWGG',[1,3])}
W={'A':'A','C':'C','G':'G','T':'T','W':'AT'}
def pattern(seq,circ,start,L,kind):
    motif,meth_idx=MOT[kind]; n=len(seq); top=[];bot=[]
    for s in range(start-5,start+L+1):
        ok=True
        for j,mb in enumerate(motif):
            p=s+j
            if circ: p%=n
            elif p<0 or p>=n: ok=False;break
            if seq[p].upper() not in W[mb]: ok=False;break
        if ok:
            t=s+meth_idx[0]-start; b=s+meth_idx[1]-start
            if 0<=t<L: top.append(t)
            if 0<=b<L: bot.append(b)
    return sorted(top),sorted(bot)
def verdict(n,kind,top,bot):
    r=reb.get(n)
    if not r: return 'no REBASE entry'
    confs=[c for c in r[kind] if 'raw' not in c]
    if not confs: return f'no REBASE {kind} data'
    for c in confs:
        if sorted(c['top'])==top and sorted(c['bottom'])==bot: return 'REBASE: '+c['effect']+' (exact)'
    for c in confs:
        if c['effect']!='cut' and set(c['top'])<=set(top) and set(c['bottom'])<=set(bot): return 'REBASE: '+c['effect']+' (superset)'
    return 'REBASE: no matching conf '+str([(c['top'],c['bottom'],c['effect']) for c in confs])
for doc in ['pUC19','pBR322','lambda','phiX174']:
    seq=sites[doc]['sequence']; circ=sites[doc]['topology']=='circular'
    print(f'== {doc}: {len(meth[doc]["marks"])} marked sites, {meth[doc]["nAll"]-meth[doc]["nCuttable"]} dropped in dam+/dcm+ ==')
    bad=0
    for m in meth[doc]['marks']:
        L=len(enz[m['enzyme']]['site'])
        for kind in m['marks']:
            top,bot=pattern(seq,circ,m['siteStart'],L,kind)
            v=verdict(m['enzyme'],kind,top,bot)
            flag='' if 'blocked' in v or 'impaired' in v else '  <-- QUESTIONABLE'
            if flag or doc!='lambda': print(f"  {m['enzyme']:9s} site@{m['siteStart']+1:6d} cut@{m['cut']:6d} {kind} top={top} bot={bot} ctx={(seq+seq)[m['siteStart']-4:m['siteStart']+L+4].upper()} {v}{flag}")
