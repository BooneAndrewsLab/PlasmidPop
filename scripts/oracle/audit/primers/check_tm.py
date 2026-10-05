import json, math, sys
import primer3
from Bio.SeqUtils import MeltingTemp as mt

D = json.load(open(sys.argv[1]))
conds = D['conditions']
rows = D['rows']

def p3(seq, na, conc, salt='santalucia'):
    # primer3 divides dna_conc by 4 for non-symmetric; PlasmidPop uses ct/4 too.
    try:
        return primer3.calc_tm(seq, mv_conc=na, dv_conc=0.0, dntp_conc=0.0, dna_conc=conc, formamide_conc=0.0, dmso_conc=0.0,
                               tm_method='santalucia', salt_corrections_method=salt)
    except Exception as e:
        return float('nan')

def bio(seq, na, conc, saltcorr=5):
    # Biopython: dnac1/dnac2 in nM; k = dnac1 - dnac2/2 when dnac1>dnac2... with equal → dnac1 - dnac2/2 = conc/4 ... see docs
    try:
        return mt.Tm_NN(seq, nn_table=mt.DNA_NN3, Na=na, K=0, Tris=0, Mg=0, dNTPs=0,
                        dnac1=conc/2, dnac2=conc/2, saltcorr=saltcorr, selfcomp=False)
    except Exception as e:
        return float('nan')

worst = []
n_ok = 0; n = 0
for i, c in enumerate(conds):
    na = c.get('sodiumMM', 50); conc = c.get('oligoNM', 500)
    for row in rows:
        s = row['seq']; tm = row['tm'][i]
        if len(s) < 2: continue
        t3 = p3(s, na, conc)
        tb = bio(s, na, conc)
        n += 1
        d3 = abs(tm - t3) if not math.isnan(t3) else float('nan')
        db = abs(tm - tb) if not math.isnan(tb) else float('nan')
        if (d3 < 0.05 if not math.isnan(d3) else False) or (db < 0.05 if not math.isnan(db) else False):
            n_ok += 1
        worst.append((max(d3 if not math.isnan(d3) else 0, db if not math.isnan(db) else 0), s, c, tm, t3, tb))
worst.sort(key=lambda w: -w[0])
print(f'meltingTemperature vs primer3/biopython: {n} cases, {n_ok} within 0.05 C of at least one oracle')
for w in worst[:15]:
    print(f'  maxdiff={w[0]:.3f} seq={w[1]} cond={w[2]} pp={w[3]:.3f} p3={w[4]:.3f} bio={w[5]:.3f}')

# Distribution of differences vs primer3 only, non-symmetric only
import statistics
diffs = []
for i, c in enumerate(conds):
    na = c.get('sodiumMM', 50); conc = c.get('oligoNM', 500)
    for row in rows:
        s = row['seq']
        if len(s) < 2: continue
        t3 = p3(s, na, conc)
        if not math.isnan(t3): diffs.append(row['tm'][i] - t3)
print('vs primer3: mean diff %.4f, max |diff| %.4f, n=%d' % (statistics.mean(diffs), max(map(abs, diffs)), len(diffs)))

# Q5: PlasmidPop = SantaLucia NN at 1M with whole 500 nM in log (no /4), then Owczarzy 2004 at 150 mM.
# primer3 with dna_conc=2000 gives ct/4=500 nM.  Biopython saltcorr=6 is Owczarzy 2004.
diffs3 = []; diffsb = []; worst = []
for row in rows:
    s = row['seq']
    if len(s) < 2: continue
    q = row['q5']
    t3 = p3(s, 150, 2000, salt='owczarzy')
    tb = bio(s, 150, 2000, saltcorr=6)
    if math.isnan(q) or math.isnan(t3): continue
    diffs3.append(q - t3); diffsb.append(q - tb)
    worst.append((abs(q - t3), s, q, t3, tb))
worst.sort(key=lambda w: -w[0])
print('q5 vs primer3(owczarzy, conc 2000→500): mean %.4f max %.4f n=%d' % (statistics.mean(diffs3), max(map(abs, diffs3)), len(diffs3)))
print('q5 vs biopython(saltcorr 6): mean %.4f max %.4f' % (statistics.mean(diffsb), max(map(abs, diffsb))))
for w in worst[:8]: print('  ', w)

# lowercase/U handling
bad = [r['seq'] for r in rows if len(r['seq']) >= 2 and abs(r['tm'][0] - r['lowerU']) > 1e-9]
print('lowercase/U mismatch cases:', bad[:5], len(bad))
# NaN for short
print('short (<2) results:', [(r['seq'], r['tm'][0]) for r in rows if len(r['seq']) < 2])
print('anneal pairs:', D['annealPairs'])

# Self-complementary handling check: compare symmetric seqs with primer3 (primer3 detects symmetry too)
sym = [r for r in rows if len(r['seq']) % 2 == 0 and all({'A':'T','T':'A','G':'C','C':'G'}[a]==b for a,b in zip(r['seq'], r['seq'][::-1]))]
print('symmetric seqs:', len(sym))
for r in sym[:40]:
    s = r['seq']
    t3 = p3(s, 50, 500)
    tb = mt.Tm_NN(s, nn_table=mt.DNA_NN3, Na=50, dnac1=500, dnac2=0, saltcorr=5, selfcomp=True)
    if abs(r['tm'][0] - t3) > 0.05 and abs(r['tm'][0] - tb) > 0.05:
        print(f'  SYM DIFF {s} pp={r["tm"][0]:.2f} p3={t3:.2f} bio_selfcomp={tb:.2f}')
