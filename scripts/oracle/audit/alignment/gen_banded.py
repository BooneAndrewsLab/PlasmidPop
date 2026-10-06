"""Generate adversarial banded-local cases -> cases.json"""
import json, random, sys
rng = random.Random(int(sys.argv[2]) if len(sys.argv) > 2 else 4242)
N = int(sys.argv[1]) if len(sys.argv) > 1 else 200
D = 'ACGT'
def rnd(n, a=D): return ''.join(rng.choice(a) for _ in range(n))
def rc(s): return s[::-1].translate(str.maketrans('ACGTNRYKMSWBDHV', 'TGCANYRMKSWVHDB'))
def mutate(s, sub, ins, dele, burst=False):
    out = []
    for c in s:
        r = rng.random()
        if r < dele: continue
        if r < dele + sub: out.append(rng.choice(D)); continue
        out.append(c)
        if rng.random() < ins: out.append(rnd(rng.choice([1,1,2,5,12]) if burst else 1))
    return ''.join(out)
cases = []
kinds = ['junkflank','endindel','tandemref','tandemread','lowcomplex','nrun','revcomp','noisy','bigjunk','shortanchor']
for k in range(N):
    kind = kinds[k % len(kinds)]
    L = rng.randint(3000, 9000)
    ref = rnd(L)
    rl = rng.randint(400, 2500)
    s = rng.randint(0, L - rl)
    core = ref[s:s+rl]
    if kind == 'tandemref':
        # duplicate a unit inside ref near the read region
        u0 = s + rng.randint(0, rl//2); ul = rng.randint(20, 300)
        unit = ref[u0:u0+ul]; ref = ref[:u0+ul] + unit*rng.randint(1,3) + ref[u0+ul:]
        core = ref[s:s+rl]
        # read lacks the duplication
        core = core.replace(unit*2, unit, 1) if rng.random()<0.5 else core
    if kind == 'tandemread':
        u0 = rng.randint(0, rl-300); ul = rng.randint(10, 200)
        core = core[:u0+ul] + core[u0:u0+ul]*rng.randint(1,2) + core[u0+ul:]
    if kind == 'lowcomplex':
        p = s + rng.randint(0, rl-100); lc = rng.choice(['A','AT','CAG','GC'])*rng.randint(10,60)
        ref = ref[:p] + lc + ref[p:]; core = ref[s:s+rl+len(lc)]
        core = core.replace(lc, lc[:len(lc)-rng.randint(0,8)] , 1)
    read = mutate(core, 0.02 if kind!='noisy' else 0.06, 0.01 if kind!='noisy' else 0.04, 0.01 if kind!='noisy' else 0.04, burst=True)
    if kind == 'endindel':
        # long indel within 40 bp of an end
        side = rng.random() < 0.5; ln = rng.randint(15, 150); at = rng.randint(5, 40)
        if rng.random() < 0.5:  # deletion in read
            read = read[:at] + read[at+ln:] if side else read[:len(read)-at-ln] + read[len(read)-at:]
        else:
            ins = rnd(ln); read = read[:at] + ins + read[at:] if side else read[:len(read)-at] + ins + read[len(read)-at:]
    if kind == 'nrun':
        p = rng.randint(0, len(read)-50); read = read[:p] + 'N'*rng.randint(1,30) + read[p+rng.randint(0,10):]
        if rng.random()<0.5:
            q = rng.randint(0, len(ref)-30); ref = ref[:q] + 'N'*rng.randint(1,20) + ref[q+5:]
    fl = (rng.randint(0, 120), rng.randint(0, 120))
    if kind in ('junkflank','bigjunk','endindel','noisy','revcomp'):
        m = 400 if kind=='bigjunk' else 150
        fl = (rng.randint(5, m), rng.randint(5, m))
    # junk flanks: partly random, sometimes partially homologous to the ref next to the read
    def flank(n, left):
        if rng.random() < 0.4:
            # mutated adjacent reference (noisy tail of a Sanger read)
            adj = ref[max(0,s-n):s] if left else ref[s+rl:s+rl+n]
            return mutate(adj, 0.25, 0.08, 0.08, burst=True) or rnd(n)
        return rnd(n)
    read = flank(fl[0], True) + read + flank(fl[1], False)
    if kind == 'revcomp': read = rc(read)
    if kind == 'shortanchor':
        read = mutate(read, 0.12, 0.03, 0.03)
    cases.append({'id': k, 'kind': kind, 'a': ref, 'b': read})
json.dump(cases, open(sys.argv[3] if len(sys.argv)>3 else 'cases.json', 'w'))
print(len(cases))
