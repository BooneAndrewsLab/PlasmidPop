import json, sys
from Bio.Align import PairwiseAligner, substitution_matrices
cases = {c['id']: c for c in json.load(open(sys.argv[1]))}
al = PairwiseAligner(); al.mode=sys.argv[3] if len(sys.argv)>3 else 'local'
al.substitution_matrix = substitution_matrices.load('NUC.4.4'); al.open_gap_score=-10; al.extend_gap_score=-0.5
c=cases[int(sys.argv[2])]
aln=al.align(c['a'],c['b'])[0]
co=aln.coordinates
print('len a',len(c['a']),'len b',len(c['b']), 'score', aln.score)
for k in range(co.shape[1]-1):
    i0,i1=co[0][k],co[0][k+1]; j0,j1=co[1][k],co[1][k+1]
    if (i1-i0)!=(j1-j0) and max(i1-i0,j1-j0)>=8: print('gap at ref',i0,'read',j0,'refgap' if i1==i0 else 'readgap', max(i1-i0,j1-j0))
print('start',co[0][0],co[1][0],'diag',co[0][0]-co[1][0],'end',co[0][-1],co[1][-1],'diag',co[0][-1]-co[1][-1])
