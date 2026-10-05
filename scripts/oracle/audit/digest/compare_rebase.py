"""Compare PlasmidPop's parse of REBASE withrefm 610 against Biopython's REBASE-derived table, and
against the raw <3> field re-read independently."""
import json, re
from Bio.Restriction import Restriction_Dictionary as RD
D = '/tmp/claude-9005/-home-matej-code-WebstormProjects-PlasmidPop/0d36857c-4f3e-42c7-b46a-0fa7317cc69d/scratchpad/audit/digest'
pp = json.load(open(f'{D}/rebase_parsed.json'))
print('version', pp['version'], 'n', pp['n'], 'skipped', pp['skipped'])
rd = RD.rest_dict
byname = {e['name']: e for e in pp['enzymes']}

# raw withrefm records
text = open(f'{D}/ref/withrefm.txt', errors='replace').read()
recs = {}
for block in re.split(r'\n(?=<1>)', text):
    m = re.match(r'<1>(\S+)', block)
    if not m: continue
    f = dict(re.findall(r'^<(\d)>(.*)$', block, re.M))
    recs[m.group(1)] = f

mism = 0; n = 0; notinbio = 0
for name, e in byname.items():
    r = rd.get(name)
    if r is None:
        notinbio += 1; continue
    n += 1
    size = r['size']
    exp = (r['site'], r['fst5'], size + r['fst3'] if r['fst3'] is not None else None)
    got = (e['site'], e['cutTop'], e['cutBottom'])
    sec_exp = None if r['scd5'] is None else (r['scd5'], size + r['scd3'])
    sec_got = None if e['secondCut'] is None else (e['secondCut']['cutTop'], e['secondCut']['cutBottom'])
    if exp != got or sec_exp != sec_got:
        mism += 1
        print(f"  {name}: raw<3>={recs.get(name,{}).get('3')!r} PP={got} second={sec_got} | Bio={exp} second={sec_exp} ovhg={r['ovhg']}")
print(f'compared {n} enzymes present in both; {mism} mismatches; {notinbio} PP enzymes not in Biopython')

# Enzymes in Biopython (with known cut) that PP skipped
skipped = [k for k in rd if k not in byname and k in recs]
print(len(skipped), 'Biopython enzymes present in withrefm but not parsed by PP, e.g.:')
for k in skipped[:40]:
    print('  ', k, repr(recs[k].get('3')), 'bio fst5', rd[k]['fst5'])

# Independent re-read of <3> notation for all records with a cut, and compare to PP
def read3(s):
    s = s.strip().upper()
    if not s or '?' in s: return None
    lead = re.match(r'^\((-?\d+)/(-?\d+)\)', s)
    trail = re.search(r'\((-?\d+)/(-?\d+)\)$', s)
    core = re.sub(r'^\(-?\d+/-?\d+\)', '', s); core = re.sub(r'\(-?\d+/-?\d+\)$', '', core)
    bare = core.replace('^', '')
    if lead and trail:
        return (bare, -int(lead.group(1)), -int(lead.group(2)), (len(bare) + int(trail.group(1)), len(bare) + int(trail.group(2))))
    if trail:
        return (bare, len(bare) + int(trail.group(1)), len(bare) + int(trail.group(2)), None)
    if lead:
        return (bare, -int(lead.group(1)), -int(lead.group(2)), None)
    if '^' in core:
        c = core.index('^'); return (bare, c, len(bare) - c, None)
    return None
cnt = 0; d2 = 0
for name, f in recs.items():
    if name.startswith('M.') or name.startswith('V.'): continue
    r3 = read3(f.get('3', ''))
    e = byname.get(name)
    if r3 is None:
        if e is not None: print('  PP kept but my reader says no cut:', name, f.get('3'))
        continue
    if e is None: continue
    cnt += 1
    sec = None if e['secondCut'] is None else (e['secondCut']['cutTop'], e['secondCut']['cutBottom'])
    if (e['site'], e['cutTop'], e['cutBottom'], sec) != r3:
        d2 += 1; print('  reader disagreement', name, f.get('3'), (e['site'], e['cutTop'], e['cutBottom'], sec), r3)
print(f'independent <3> re-read: {cnt} compared, {d2} disagreements')
# Palindromic sites with asymmetric cuts (sanity on notation reading)
odd = [(e['name'], e['site'], e['cutTop'], e['cutBottom']) for e in pp['enzymes'] if e['palindromic'] and e['secondCut'] is None and e['cutTop'] + e['cutBottom'] != len(e['site'])]
print('palindromic with asymmetric cuts:', len(odd), odd[:10])
