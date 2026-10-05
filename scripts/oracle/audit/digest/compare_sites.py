"""Differential test: PlasmidPop cut sites / enzyme defs / fragments vs Biopython (Bio.Restriction)."""
import json, sys, collections
from Bio.Seq import Seq
from Bio.Restriction import RestrictionBatch, AllEnzymes
from Bio.Restriction import Restriction_Dictionary as RD

D = '/tmp/claude-9005/-home-matej-code-WebstormProjects-PlasmidPop/0d36857c-4f3e-42c7-b46a-0fa7317cc69d/scratchpad/audit/digest'
enz = json.load(open(f'{D}/enzymes.json'))
sites = json.load(open(f'{D}/sites.json'))
rd = RD.rest_dict

print('== 1. bundled enzyme definitions vs Biopython (REBASE emboss) ==')
bad = 0
for e in enz:
    r = rd.get(e['name'])
    if r is None:
        print('  NOT IN BIOPYTHON:', e['name']); continue
    site = r['site']; size = r['size']
    exp_top = r['fst5']; exp_bot = size + r['fst3'] if r['fst3'] is not None else None
    if e['site'].upper() != site or e['cutTop'] != exp_top or e['cutBottom'] != exp_bot:
        bad += 1
        print(f"  MISMATCH {e['name']}: PP site={e['site']} top={e['cutTop']} bot={e['cutBottom']} | Bio site={site} fst5={r['fst5']} fst3={r['fst3']} -> top={exp_top} bot={exp_bot} ovhg={r['ovhg']}")
print(f'  {len(enz)} enzymes checked, {bad} mismatches')

print('\n== 2. cut positions vs Biopython search ==')
names = [e['name'] for e in enz if e['name'] in rd]
rb = RestrictionBatch(names)
ovhg = {n: rd[n]['ovhg'] for n in names}
IUPAC = set('RYSWKMBDHVN')
total_sites = 0; total_mism = 0
for key, d in sites.items():
    seq = d['sequence']; L = len(seq); circ = d['topology'] == 'circular'
    has_iupac = any(c in IUPAC for c in seq.upper())
    res = rb.search(Seq(seq.upper()), linear=not circ)
    bio = {}
    for e, poss in res.items():
        n = str(e)
        s = set()
        for p in poss:
            c = (p - 1) % L if circ else p - 1
            s.add(c)
        bio[n] = s
    pp = collections.defaultdict(set)
    ovhg_bad = []
    for s in d['sites']:
        c = s['cut']; b = s['cutBottom']
        if not circ and (c <= 0 or c >= L):
            continue  # Biopython drops end cuts on linear
        pp[s['enzyme']].add(c)
        # overhang check: cutBottom - cut should equal -ovhg (mod L folded)
        dd = b - c
        if circ:
            dd = dd % L
            if dd > L / 2: dd -= L
        if dd != -ovhg[s['enzyme']]:
            ovhg_bad.append((s['enzyme'], c, b, dd, -ovhg[s['enzyme']]))
    n_mism = 0
    for n in names:
        a = pp.get(n, set()); b = bio.get(n, set())
        total_sites += len(b)
        if a != b:
            n_mism += 1
            if not has_iupac or len(a ^ b) > 0:
                only_pp = sorted(a - b)[:8]; only_bio = sorted(b - a)[:8]
                print(f"  [{key}] {n}: PP-only {only_pp} ({len(a-b)}) Bio-only {only_bio} ({len(b-a)})")
    total_mism += n_mism
    print(f"  {key}: L={L} {'circ' if circ else 'lin'} iupac={has_iupac} enzymes-with-diff={n_mism} ovhg_bad={len(ovhg_bad)} {ovhg_bad[:3]}")
print(f'  total Biopython sites compared: {total_sites}; enzyme/doc combos differing: {total_mism}')

print('\n== 3. digest fragments vs Biopython catalyse ==')
dig = json.load(open(f'{D}/digests.json'))
for key, d in dig.items():
    doc, enames = key.split('|'); enames = enames.split('+')
    seq = d['sequence'].upper(); circ = d['topology'] == 'circular'; L = len(seq)
    rbb = RestrictionBatch(enames)
    # Biopython catalyse for multiple enzymes: use Analysis? simpler: collect all cut positions and split
    res = rbb.search(Seq(seq), linear=not circ)
    cuts = sorted({(p - 1) % L if circ else p - 1 for ps in res.values() for p in ps})
    if not circ:
        cuts = [c for c in cuts if 0 < c < L]
        bounds = [0] + cuts + [L]
        frags = [seq[a:b] for a, b in zip(bounds, bounds[1:])]
    else:
        frags = [] if not cuts else [(seq + seq)[a:(b if b > a else b + L)] for a, b in zip(cuts, cuts[1:] + [cuts[0] + L])]
        if len(cuts) == 1: frags = [seq[cuts[0]:] + seq[:cuts[0]]]
    pps = [f['sequence'].upper() for f in d['fragments']]
    ok = sorted(frags) == sorted(pps)
    sizes_pp = sorted((len(f) for f in pps), reverse=True)
    print(f"  {key}: {'OK' if ok else 'MISMATCH'} nfrag PP={len(pps)} Bio={len(frags)} sizes={sizes_pp[:12]}")
    if not ok:
        print('    PP sizes ', sorted(map(len, pps), reverse=True)[:15])
        print('    Bio sizes', sorted(map(len, frags), reverse=True)[:15])
    # single-enzyme Biopython catalyse cross-check
    if len(enames) == 1:
        E = getattr(__import__('Bio.Restriction', fromlist=[enames[0]]), enames[0])
        cf = [str(x).upper() for x in E.catalyse(Seq(seq), linear=not circ)]
        if sorted(cf) != sorted(pps):
            print('    catalyse() disagrees too:', sorted(map(len, cf), reverse=True)[:15])
