import json, sys
import primer3
from Bio.Seq import Seq
rows = json.load(open(sys.argv[1]))
C = {'A': 'T', 'T': 'A', 'G': 'C', 'C': 'G'}

def hairpin_stem(s, minloop=3):
    # longest k such that s[i-k+1..i] pairs antiparallel with s[j..j+k-1], j - i - 1 >= minloop, i.e. innermost pair (i,j) with j-i>minloop
    n = len(s); best = 0
    for i in range(n):
        for j in range(i + minloop + 1, n):
            k = 0
            while i - k >= 0 and j + k < n and C[s[i - k]] == s[j + k]:
                k += 1
            best = max(best, k)
    return best

def self_comp(s):
    n = len(s); best = 0
    rc = str(Seq(s).reverse_complement())
    # longest common substring of s and rc  == longest antiparallel complementary stretch
    for i in range(n):
        for j in range(n):
            k = 0
            while i + k < n and j + k < n and s[i + k] == rc[j + k]: k += 1
            best = max(best, k)
    return best

def three_prime(a, b):
    best = 0
    for k in range(1, min(len(a), len(b)) + 1):
        tail = a[-k:]
        rc = str(Seq(tail).reverse_complement())
        if rc in b: best = k
        else: break
    return best

def homopolymer(s):
    best = run = 0; prev = ''
    for c in s:
        run = run + 1 if c == prev else 1; prev = c; best = max(best, run)
    return best

bad = 0
for r in rows:
    s = r['seq']
    exp = (hairpin_stem(s), self_comp(s), three_prime(s, s), homopolymer(s))
    got = (r['hairpin'], r['self'], r['three'], r['homopolymer'])
    if exp != got:
        bad += 1; print('DIFF', s, 'exp(hairpin,self,three,homo)=', exp, 'got=', got)
print(f'{len(rows)} primers, {bad} metric differences')

# Correlation with primer3 thermodynamic hairpin / homodimer dG
import statistics
hp = [(r['hairpin'], primer3.calc_hairpin(r['seq']).dg / 1000) for r in rows if len(r['seq']) >= 12]
hd = [(r['self'], primer3.calc_homodimer(r['seq']).dg / 1000) for r in rows if len(r['seq']) >= 12]
for name, data in (('hairpin stem vs primer3 hairpin dG', hp), ('selfcomp vs primer3 homodimer dG', hd)):
    groups = {}
    for k, dg in data: groups.setdefault(k, []).append(dg)
    print(name, {k: (len(v), round(statistics.mean(v), 2)) for k, v in sorted(groups.items())})
# Flag: primers with stem <= 4 (passes default) but strong primer3 hairpin dG < -3 kcal/mol
strong = [(r['seq'], r['hairpin'], round(primer3.calc_hairpin(r['seq']).dg / 1000, 2), round(primer3.calc_hairpin(r['seq']).tm, 1)) for r in rows if r['hairpin'] <= 4 and primer3.calc_hairpin(r['seq']).dg < -3000]
print('passes hairpin<=4 but primer3 dG < -3 kcal/mol:', len(strong), strong[:5])
weak = [(r['seq'], r['hairpin'], round(primer3.calc_hairpin(r['seq']).dg / 1000, 2)) for r in rows if r['hairpin'] > 4 and primer3.calc_hairpin(r['seq']).dg > -1000]
print('fails hairpin>4 but primer3 dG > -1 kcal/mol:', len(weak), weak[:5])
