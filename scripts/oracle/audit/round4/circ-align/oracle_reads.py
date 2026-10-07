import json, sys
from Bio.Align import PairwiseAligner, substitution_matrices
def rc(s): return s[::-1].translate(str.maketrans('ACGTN','TGCAN'))
al=PairwiseAligner(); al.substitution_matrix=substitution_matrices.load('NUC.4.4')
al.open_gap_score=-10; al.extend_gap_score=-0.5; al.mode='local'
cases=json.load(open(sys.argv[1])); out=[]
for c in cases:
    ref=c['ref']; L=len(ref); r=c['read']
    d1=ref+ref[:L-1]
    f=al.score(d1,r); b=al.score(d1,rc(r))
    # first-principles circular: span limited to L -> approximate with triple only if read > L
    f2=al.score(ref+ref,r); b2=al.score(ref+ref,rc(r))
    out.append({'id':c['id'],'score':max(f,b),'fwd':f,'rev':b,'score2L':max(f2,b2)})
json.dump(out,open(sys.argv[2],'w')); print('ok',len(out))
