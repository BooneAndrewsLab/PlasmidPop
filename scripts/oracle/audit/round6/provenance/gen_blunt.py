"""#183 near variants: single/double-cut vectors blunted (fill/trim) and closed. Cases for blunt.test.ts."""
import json, random, sys
from Bio import Restriction as R
from Bio.Seq import Seq
OUT = sys.argv[1]; N = int(sys.argv[2]); rng = random.Random(int(sys.argv[3]))
SINGLE = ['EcoRI','BamHI','KpnI','PstI','SacI','NotI','SmaI','EcoRV','BsaI','BsmBI','SapI','BglI','HindIII','XbaI','NcoI','SphI','ApaI','AatII','PvuI','Acc65I','BstXI']
PAIRS = [('EcoRI','KpnI'),('KpnI','PstI'),('BamHI','SmaI'),('BsaI','EcoRI'),('SacI','XbaI'),('ApaI','NotI'),('BsmBI','SapI')]
def site_of(e):
    s = getattr(R, e).elucidate()
    return getattr(R, e).site
def concrete(site):
    amb = {'N':'ACGT','R':'AG','Y':'CT','W':'AT','S':'CG','K':'GT','M':'AC'}
    return ''.join(rng.choice(amb.get(c, c)) for c in site)
def rs(n): return ''.join(rng.choice('ACGT') for _ in range(n))
cases = []
while len(cases) < N:
    enz = [rng.choice(SINGLE)] if rng.random() < 0.6 else list(rng.choice(PAIRS))
    L = rng.randrange(150, 260)
    seq = list(rs(L))
    poss = []
    for i, e in enumerate(enz):
        site = concrete(site_of(e))
        p = (i * L // 2 + rng.randrange(30, L // 2 - 30)) % L
        seq[p:p+len(site)] = list(site)
        seq = seq[:L]
        poss.append(p)
    seq = ''.join(seq)[:L]
    rb = R.RestrictionBatch(enz)
    hits = rb.search(Seq(seq), linear=False)
    if any(len(v) != 1 for v in hits.values()):
        continue
    # CDS across the first site (sometimes the second)
    k = rng.randrange(len(enz)); p = poss[k]
    a = p - rng.randrange(6, 40); b = p + rng.randrange(10, 45)
    a %= L; length = (b - (p - (p - a) % L)) 
    start = a; end = a + rng.randrange(25, 80)
    strand = rng.choice(['forward','reverse'])
    cs = rng.choice([1,1,2,3])
    segs = [[start, end]] if end <= L else [[start, L], [0, end - L]]
    feats = [{'type':'CDS','name':'g','strand':strand,'segments':[[s,e,False,False] for s,e in segs],
              'qualifiers':[['codon_start',str(cs)],['transl_table','11']] if cs>1 else [['transl_table','11']]}]
    cases.append({'id': len(cases), 'seq': seq, 'enzymes': enz, 'features': feats, 'method': rng.choice(['fill','trim'])})
json.dump(cases, open(OUT,'w')); print(len(cases))
