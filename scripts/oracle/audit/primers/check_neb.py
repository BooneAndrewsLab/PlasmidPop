import json, urllib.request, random, math, time
from Bio.SeqUtils import MeltingTemp as mt
D = json.load(open('tm.json'))
rows = [r for r in D['rows'] if 17 <= len(r['seq']) <= 40 and set(r['seq']) <= set('ACGT')]
random.seed(7); sample = random.sample(rows, 36)
UA = {'User-Agent': 'Mozilla/5.0'}
def api(path):
    req = urllib.request.Request('https://tmapi.neb.com/tm/q5/0.5/' + path, headers=UA)
    return json.load(urllib.request.urlopen(req, timeout=30))['data']
out = []; off = 0
for r in sample:
    d = api(r['seq']); time.sleep(0.3)
    pp = r['q5']; neb = d['tm1']
    gc = sum(c in 'GC' for c in r['seq']) / len(r['seq'])
    flag = '' if round(pp) == neb else '  <-- DIFF'
    if flag: off += 1
    print(f"{r['seq']:42s} len={len(r['seq'])} gc={gc:.2f} pp={pp:6.2f} round={round(pp)} neb={neb}{flag}")
    out.append((r['seq'], pp, neb))
print('primers off by >=1 degree after rounding:', off, 'of', len(sample))
# Ta rule: pairs
pairs = [(sample[i]['seq'], sample[i+1]['seq']) for i in range(0, 20, 2)]
print('\nTa check (NEB ta vs PlasmidPop rule min(round(min)+1, 72)):')
for a, b in pairs:
    d = api(a + '/' + b); time.sleep(0.3)
    pa = next(r['q5'] for r in sample if r['seq'] == a); pb = next(r['q5'] for r in sample if r['seq'] == b)
    rule = min(round(min(pa, pb)) + 1, 72)
    print(f"tm1={d['tm1']} tm2={d['tm2']} ta={d['ta']} | pp q5: {pa:.2f} {pb:.2f} rule={rule} | min(pp)+1={min(pa,pb)+1:.2f}")
