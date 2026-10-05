import json, sys, re, math
from Bio.Data.IUPACData import ambiguous_dna_values as IUPAC
from Bio.Seq import Seq
import primer3

D = json.load(open(sys.argv[1]))
TEXT = D['text'].upper()
L = len(TEXT)
DEF = dict(minAnneal=15, maxMismatches=2, exactThreePrime=5)

def codes(c):
    return set(IUPAC.get(c, ''))

def pairs(template_base, primer_code):
    t = codes(template_base); p = codes(primer_code)
    return len(t) > 0 and t <= p

def clean(p):
    return re.sub(r'[^ACGTRYSWKMBDHVN]', '', p.upper().replace('U', 'T'))

def rc(s):
    return str(Seq(s).reverse_complement())

def tm(s):
    if len(s) < 2 or any(c not in 'ACGT' for c in s): return float('nan')
    return primer3.calc_tm(s, mv_conc=50, dv_conc=0, dntp_conc=0, dna_conc=500, formamide_conc=0, dmso_conc=0,
                           tm_method='santalucia', salt_corrections_method='santalucia')

def base_at(i, circ):
    if circ: return TEXT[i % L]
    if i < 0 or i >= L: return ''
    return TEXT[i]

def run(probe, anchor, step, circ, o):
    mism = 0; best = 0; bestm = 0; perfect = -1
    for i, c in enumerate(probe):
        b = base_at(anchor + step * i, circ)
        if b == '': break
        if pairs(b, c):
            best = i + 1; bestm = mism; continue
        if i < o['exactThreePrime']: return None
        if perfect < 0: perfect = i
        mism += 1
        if mism > o['maxMismatches']: break
    if best < o['minAnneal']: return None
    return dict(length=best, mismatches=bestm, perfect=best if bestm == 0 else perfect)

def resolved(p, start, strand, length, circ, full):
    n = len(p); out = ''
    for j in range(n - length, n):
        code = p[j]
        offset = j - (n - full)
        if strand == 'forward':
            b = base_at(start + offset, circ)
        else:
            b = rc(base_at(start + full - 1 - offset, circ))
        out += code if (code in 'ACGT' or not pairs(b, code)) else b
    return out

def brute(primer, circ, opts):
    o = dict(DEF); o.update(opts)
    p = clean(primer); n = len(p)
    if n < o['minAnneal'] or L == 0: return []
    norm = (lambda i: i % L) if circ else (lambda i: i)
    sites = []
    fwd = p[::-1]
    for e in range(1, L + 1):
        r = run(fwd, e - 1, -1, circ, o)
        if r:
            start = norm(e - r['length'])
            sites.append(dict(range=dict(start=start, end=start + r['length']), strand='forward', annealLength=r['length'], tail=p[:n - r['length']], mismatches=r['mismatches'], perfect=r['perfect']))
    rev = rc(p)
    for s in range(0, L):
        r = run(rev, s, 1, circ, o)
        if r:
            sites.append(dict(range=dict(start=norm(s), end=norm(s) + r['length']), strand='reverse', annealLength=r['length'], tail=p[:n - r['length']], mismatches=r['mismatches'], perfect=r['perfect']))
    for s in sites:
        s['tm'] = tm(resolved(p, s['range']['start'], s['strand'], s['annealLength'], circ, s['annealLength']))
        s['templateTm'] = tm(resolved(p, s['range']['start'], s['strand'], s['perfect'], circ, s['annealLength']))
    return p, sites

def brute_binding(primer, circ, opts):
    maxm = opts.get('maxMismatches', 2); anchor = opts.get('exactThreePrime', 5)
    p = clean(primer); n = len(p)
    if n == 0 or n > L: return []
    scan = TEXT + TEXT[:n - 1] if circ else TEXT
    out = []
    for probe, strand in ((p, 'forward'), (rc(p), 'reverse')):
        for s in range(0, len(scan) - n + 1):
            m = 0; ok = True
            for i in range(n):
                if pairs(scan[s + i], probe[i]): continue
                d = n - 1 - i if strand == 'forward' else i
                if d < anchor: ok = False; break
                m += 1
                if m > maxm: ok = False; break
            if ok: out.append(dict(range=dict(start=s, end=s + n), strand=strand, mismatches=m))
    return out

def key(s):
    return (s['range']['start'], s['range']['end'], s['strand'], s['annealLength'], s['tail'], s['mismatches'])

nres = 0; nsites = 0; bad = []; badtm = []; badbind = []; notidx = []
for res in D['results']:
    circ = res['topology'] == 'circular'
    nres += 1
    p, exp = brute(res['primer'], circ, res['opts']) if clean(res['primer']) and len(clean(res['primer'])) >= dict(DEF, **res['opts'])['minAnneal'] else (clean(res['primer']), [])
    got = res['sites']
    nsites += len(got)
    if not res['sameAsIndexed']: notidx.append((res['topology'], res['opts'], res['name']))
    ek = sorted(key(s) for s in exp); gk = sorted(key(s) for s in got)
    if ek != gk:
        bad.append((res['topology'], res['opts'], res['name'], res['primer'], 'expected', ek, 'got', gk))
        continue
    # primer string cleaned equal
    for g in got:
        if g['primer'] != p: bad.append(('PRIMER CLEAN', res['name'], g['primer'], p))
    # tm comparison
    em = {key(s): s for s in exp}
    for g in got:
        e = em[key(g)]
        for f in ('tm', 'templateTm'):
            a, b = g[f], e[f]
            if (a is None) != (isinstance(b, float) and math.isnan(b)) and not (a is None and math.isnan(b)):
                badtm.append((res['name'], f, a, b)); continue
            if a is not None and not math.isnan(b) and abs(a - b) > 0.01: badtm.append((res['name'], f, a, b, key(g)))
    # binding
    bexp = sorted((b['range']['start'], b['range']['end'], b['strand'], b['mismatches']) for b in brute_binding(res['primer'], circ, res['opts']))
    bgot = sorted((b['range']['start'], b['range']['end'], b['strand'], b['mismatches']) for b in res['binding'])
    if bexp != bgot: badbind.append((res['topology'], res['opts'], res['name'], res['primer'], bexp, bgot))

print(f'{nres} searches, {nsites} sites reported')
print('anneal mismatches with brute force:', len(bad))
for b in bad[:15]: print('  ', b)
print('tm mismatches:', len(badtm))
for b in badtm[:10]: print('  ', b)
print('binding-site mismatches:', len(badbind))
for b in badbind[:15]: print('  ', b)
print('index != walk:', len(notidx), notidx[:10])

# Sanity: the exact primers should each be found exactly where they were taken from
import collections
for res in D['results']:
    if res['opts'] == {} and res['topology'] == 'circular' and (res['name'].startswith('fwd@') or res['name'].startswith('rev@')):
        m = re.match(r'(fwd|rev)@(\d+)\+(\d+)', res['name']); s, ln = int(m.group(2)), int(m.group(3))
        want = ((s % L), (s % L) + ln, 'forward' if m.group(1) == 'fwd' else 'reverse')
        found = [(x['range']['start'], x['range']['end'], x['strand']) for x in res['sites']]
        if want not in found or len(found) != 1:
            print('EXACT PRIMER:', res['name'], 'want', want, 'found', found, [(x['annealLength'], x['tail'], x['mismatches']) for x in res['sites']])
