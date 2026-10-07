"""gen / check deletions against a base-identity model. usage: del.py gen out.json N seed | del.py check cases out"""
import json, sys, random, collections
sys.argv_saved = sys.argv
from Bio.Seq import Seq
from Bio.Data import CodonTable
mode = sys.argv[1]
def reading(L, segs, strand):
    pos = []
    for s in segs:
        if s[0] == 'site': continue
        pos += [p % L for p in range(s[0], s[1])]
    return pos[::-1] if strand == 'reverse' else pos
def fp(f):
    rs=[s for s in f['segments'] if s[0]!='site']; return rs[-1][3] if f['strand']=='reverse' else rs[0][2]
def tp(f):
    rs=[s for s in f['segments'] if s[0]!='site']; return rs[0][2] if f['strand']=='reverse' else rs[-1][3]
if mode == 'gen':
    rng = random.Random(int(sys.argv[4])); cases = []
    for _ in range(int(sys.argv[3])):
        L = rng.randint(40, 120); topo = rng.choice(['linear', 'circular'])
        seq = ''.join(rng.choice('ACGT') for _ in range(L))
        feats = []
        for k in range(rng.randint(1, 3)):
            strand = rng.choice(['forward', 'reverse']); s = rng.randrange(L)
            if rng.random() < 0.4:
                segs = [[s, s + rng.randint(5, 14)], [s + 18, s + 18 + rng.randint(5, 14)]]
            else:
                segs = [[s, s + rng.randint(8, 40)]]
            if segs[-1][1] - segs[0][0] >= L - 1: continue
            if topo == 'linear' and segs[-1][1] > L: continue
            segs = [[a - L, b - L] if a >= L else [a, b] for a, b in segs]
            feats.append({'strand': strand, 'segments': [[a, b, False, False] for a, b in segs],
                          'qualifiers': [['codon_start', str(rng.randint(1, 3))]]})
        if not feats: continue
        a = rng.randrange(L); n = rng.randint(1, L // 3)
        b = a + n
        if topo == 'linear': b = min(b, L)
        cases.append({'seq': seq, 'topology': topo, 'features': feats, 'del': [a, b]})
    json.dump(cases, open(sys.argv[2], 'w')); print(len(cases))
else:
    cases = json.load(open(sys.argv[2])); outs = json.load(open(sys.argv[3]))
    prob = collections.Counter(); ex = collections.defaultdict(list); n = 0
    for ci, (c, o) in enumerate(zip(cases, outs)):
        L = len(c['seq']); a, b = c['del']
        gone = {p % L for p in range(a, b)}
        ids = [p for p in range(L) if p not in gone]
        if c['topology'] == 'circular' and b > L:
            # deletion across origin: the product starts after the deleted stretch? derive from sequence
            pass
        exp = ''.join(c['seq'][p] for p in ids)
        if exp != o['sequence']:
            # rotation for circular across origin
            ok = False
            for r in range(len(ids)):
                if ''.join(c['seq'][p] for p in ids[r:] + ids[:r]) == o['sequence']:
                    ids = ids[r:] + ids[:r]; ok = True; break
            if not ok:
                prob['seq'] += 1; continue
        Lp = len(ids)
        for fi, F in enumerate(c['features']):
            R = reading(L, F['segments'], F['strand']); idx = {p: i for i, p in enumerate(R)}
            f0 = int(F['qualifiers'][0][1]) - 1
            gs = [g for g in o['features'] if g['name'] == f'f{fi}']
            kept = [p for p in R if p not in gone]
            if not kept:
                if gs: prob['feature survives with no bases'] += 1
                continue
            for g in gs:
                n += 1
                P = reading(Lp, g['segments'], g['strand'])
                ix = [idx.get(ids[p]) for p in P]
                if None in ix or any(ix[k+1] <= ix[k] for k in range(len(ix)-1)):
                    prob['bases not in source order'] += 1; ex['order'].append((ci, F, g['segments'])); continue
                e5 = ix[0] > 0; e3 = ix[-1] < len(R) - 1
                if fp(g) != e5 or tp(g) != e3:
                    k = 'partial'; prob[k] += 1
                    if len(ex[k]) < 5: ex[k].append((ci, c['del'], c['topology'], L, F, g['segments'], 'exp5', e5, 'exp3', e3))
                # frame: the first codon read should be a source codon (if bases contiguous at start)
                ecs = 1 + ((f0 - ix[0]) % 3)
                if g['codonStart'] != ecs:
                    k = 'codon_start'; prob[k] += 1
                    if len(ex[k]) < 5: ex[k].append((ci, c['del'], c['topology'], L, F, g['segments'], g['codonStart'], ecs))
    print('checked', n); print(dict(prob))
    for k, v in ex.items():
        for e in v[:5]: print(k, e)
