"""Compare PlasmidPop's Dam/Dcm model (name list + 'methylated base inside the recognition site')
against REBASE's per-configuration methylation-sensitivity data (damlist CGI, NEB + Thermo enzymes)."""
import json, itertools, re
D = '/tmp/claude-9005/-home-matej-code-WebstormProjects-PlasmidPop/0d36857c-4f3e-42c7-b46a-0fa7317cc69d/scratchpad/audit/digest'
reb = json.load(open(f'{D}/rebase_methylation.json'))
enz = {e['name']: e for e in json.load(open(f'{D}/enzymes.json'))}
sens = set(json.load(open(f'{D}/sensitive.json')))
IUPAC = {'A': 'A', 'C': 'C', 'G': 'G', 'T': 'T', 'R': 'AG', 'Y': 'CT', 'S': 'CG', 'W': 'AT', 'K': 'GT', 'M': 'AC', 'B': 'CGT', 'D': 'AGT', 'H': 'ACT', 'V': 'ACG', 'N': 'ACGT'}
MOTIF = {'Dam': ('GATC', [1, 2]), 'Dcm': ('CCWGG', [1, 3])}

def in_list(n): return n.lower() in sens

print('== A. REBASE configurations vs PlasmidPop verdict (bundled enzymes) ==')
over = []; under = []; outside = []
for name, r in reb.items():
    if name not in enz: continue
    L = len(enz[name]['site'])
    for kind in ('Dam', 'Dcm'):
        for c in r[kind]:
            if 'raw' in c: continue
            marks = c['top'] + c['bottom']
            inside = [m for m in marks if not isinstance(m, list)]
            out = [m for m in marks if isinstance(m, list)]
            pp_blocks = in_list(name) and len(inside) > 0
            eff = c['effect']
            if eff == 'cut' and pp_blocks:
                over.append((name, kind, c))
            if eff in ('blocked', 'impaired') and not pp_blocks:
                (outside if (in_list(name) and not inside) else under).append((name, kind, c, 'in list' if in_list(name) else 'NOT in list'))
print('A1. PP blocks but REBASE says CUT (false block -> site dropped from digest):')
for x in over: print('   ', x)
print('A2. REBASE blocked/impaired but PP does not block:')
for x in under: print('   ', x)
print('A3. REBASE blocked/impaired with methylated base OUTSIDE the recognition site (PP cannot see):')
for x in outside: print('   ', x)

print('\n== B. enzymes in DAM_DCM_SENSITIVE: which kinds REBASE actually lists as blocked/impaired, and which overlaps are geometrically possible ==')
def possible(site, kind):
    """Can a motif overlap the site so that a methylated base (top or bottom) lands inside it, with the site's own bases consistent?"""
    motif, meth = MOTIF[kind]
    res = []
    for start in range(-len(motif) + 1, len(site)):
        ok = True
        for j, mb in enumerate(motif):
            p = start + j
            if 0 <= p < len(site):
                if not (set(IUPAC[site[p]]) & set(IUPAC[mb])): ok = False; break
        if ok and any(0 <= start + k < len(site) for k in meth):
            res.append(start)
    return res
for name in sorted(sens):
    e = enz.get(next((k for k in enz if k.lower() == name), ''), None)
    r = reb.get(next((k for k in reb if k.lower() == name), ''), None)
    if e is None: continue
    reb_kinds = {}
    if r:
        for kind in ('Dam', 'Dcm'):
            effs = {c['effect'] for c in r[kind] if 'raw' not in c}
            reb_kinds[kind] = effs
    poss = {k: len(possible(e['site'].upper(), k)) for k in ('Dam', 'Dcm')}
    flag = ''
    for k in ('Dam', 'Dcm'):
        blocked = any(x in reb_kinds.get(k, set()) for x in ('blocked', 'impaired'))
        if poss[k] and not blocked: flag += f' <-- PP would block on {k} overlap but REBASE lists no {k} block ({reb_kinds.get(k)})'
    print(f"  {e['name']:10s} {e['site']:14s} REBASE={reb_kinds} possible overlaps Dam={poss['Dam']} Dcm={poss['Dcm']}{flag}")

print('\n== C. bundled enzymes REBASE lists as blocked/impaired but NOT in DAM_DCM_SENSITIVE ==')
for name, r in reb.items():
    if name not in enz or in_list(name): continue
    for kind in ('Dam', 'Dcm'):
        effs = [c['effect'] for c in r[kind] if 'raw' not in c]
        if any(x in effs for x in ('blocked', 'impaired')):
            print(f'  {name} {enz[name]["site"]} {kind}: {effs} confs={[ (c["top"], c["bottom"]) for c in r[kind] if "raw" not in c]}')

print('\n== D. REBASE enzymes (not bundled) in DAM_DCM_SENSITIVE: sanity ==')
print('  in list but no bundled entry:', sorted(n for n in sens if not any(k.lower() == n for k in enz)))
