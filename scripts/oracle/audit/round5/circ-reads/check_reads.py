import json, sys
from Bio import Align
from Bio.Align import substitution_matrices
def rc(s): return s[::-1].translate(str.maketrans('ACGTN','TGCAN'))
def aligner(mode):
    a=Align.PairwiseAligner(); a.mode=mode
    a.substitution_matrix=substitution_matrices.load('NUC.4.4')
    a.open_gap_score=-10; a.extend_gap_score=-0.5
    return a
loc=aligner('local')
data=json.load(open('reads_cases.json')); ts={r['id']:r for r in json.load(open('reads_ts.json'))}
bad=0; posdiff=0; n=0
for c in data['cases']:
    ref=data['refs'][c['ref']]; L=c['L']; read=c['read']
    dbl=ref+ref[:L-1]
    sc={s: loc.score(dbl, r) for s,r in (('forward',read),('reverse',rc(read)))}
    best=max(sc.values())
    # rotated oracle: read centred
    r=(c['o']+c['m']//2-L//2)%L
    rot=ref[r:]+ref[:r]
    st='forward' if sc['forward']>=sc['reverse'] else 'reverse'
    q=read if st=='forward' else rc(read)
    rotscore=loc.score(rot,q)
    rotpos=None
    if c['m']<L//2:
        al=loc.align(rot,q)[0]; co=al.coordinates
        rotpos=((co[0][0]+r)%L, int(co[0][-1]-co[0][0]), int(co[1][0]), int(co[1][-1]))
    n+=1
    for path in ('single','batch'):
        t=ts[c['id']][path]
        if not isinstance(t,dict) or 'score' not in t:
            print('ERR',c['id'],path,t); bad+=1; continue
        ok = abs(t['score']-best)<1e-6
        if not ok:
            bad+=1
            print(f"SCORE id={c['id']} ref={c['ref']} L={L} o={c['o']} m={c['m']} strand={c['strand']} {path}: pp={t['score']} oracle={best} rot={rotscore} pp_start={t['startA']} end={t['endA']} B={t['startB']}-{t['endB']}")
        elif rotpos is not None and t['strand']==st and (t['startA']%L, t['endA']-t['startA'], t['startB'], t['endB'])!=rotpos:
            posdiff+=1
            if posdiff<15: print(f"POS id={c['id']} {path} pp=({t['startA']%L},{t['endA']-t['startA']},{t['startB']},{t['endB']}) rot={rotpos} ref={c['ref']}")
    if abs(rotscore-best)>1e-6 and c['m']<L: print('ROT!=DBL',c['id'],rotscore,best)
print('cases',n,'score mismatches',bad,'posdiffs',posdiff)
