import json, sys, re, math
from Bio.Seq import Seq
from Bio.Data import CodonTable
import primer3

D = json.load(open(sys.argv[1]))
TEXT = D['text']; L = D['L']

def rc(s): return str(Seq(s).reverse_complement())
NAN = float('nan')
def num(x): return NAN if x is None else x
def close(a, b, eps=0.01):
    a = num(a); b = num(b)
    if math.isnan(a) and math.isnan(b): return True
    if math.isnan(a) or math.isnan(b): return False
    return abs(a - b) <= eps
def tm(s):
    s = s.upper()
    if len(s) < 2 or any(c not in 'ACGT' for c in s): return float('nan')
    return primer3.calc_tm(s, mv_conc=50, dv_conc=0, dntp_conc=0, dna_conc=500, formamide_conc=0, dmso_conc=0,
                           tm_method='santalucia', salt_corrections_method='santalucia')
def same_circle(a, b):
    a = a.upper(); b = b.upper()
    return len(a) == len(b) and b in a + a
def stretch(s, e, circ):
    if circ: return ''.join(TEXT[i % L] for i in range(s, e))
    return TEXT[max(s, 0):min(e, L)]

def expected_mutant(rng, ins, circ):
    s, e = rng['start'], rng['end']
    if not circ:
        return TEXT[:s] + ins.upper() + TEXT[e:]
    # circular: positions s..e-1 (mod L) removed, ins placed there. Build as a circle starting at e.
    rest = ''.join(TEXT[i % L] for i in range(e, s + L))  # from e round to s (exclusive) — length L-(e-s)
    return ins.upper() + rest

def find_all(hay, needle):
    return [i for i in range(len(hay)) if hay.startswith(needle, i)]

def simulate_b2b(fwd, rev, fa, ra, circ):
    """Linear product from circular template with back-to-back primers, then blunt self-ligation."""
    text = TEXT.upper(); dbl = text + text
    fan = fwd[-fa:].upper(); ran = rev[-ra:].upper()
    fpos = [i for i in find_all(dbl, fan) if i < L]
    rpos = [i for i in find_all(dbl, rc(ran)) if i < L]
    if len(fpos) != 1 or len(rpos) != 1:
        return None, f'anneal sites fwd={fpos} rev={rpos}'
    f_end = fpos[0] + fa            # top strand position after forward anneal
    r_start = rpos[0]               # top strand position where rev anneal (rc) starts
    between_len = (r_start - f_end) % L
    between = ''.join(text[i % L] for i in range(f_end, f_end + between_len))
    product = fwd.upper() + between + rc(rev.upper())
    return product, None

bad = []; n = 0; nb2b = 0; nqc = 0; tmbad = []
for d in D['designs']:
    if d['error']:
        bad.append(('ERROR', d['doc'], d['method'], d['note'], d['range'], d['error'])); continue
    o = d['out']; circ = d['doc'] == 'circular'; rng = d['range']; ins = d['replacement'].upper()
    n += 1
    exp = expected_mutant(rng, ins, circ)
    # mutant document
    if circ:
        if not same_circle(o['mutant'], exp): bad.append(('MUTANT', d['doc'], d['method'], d['note'], rng, ins, len(o['mutant']), len(exp)))
    else:
        if o['mutant'].upper() != exp.upper(): bad.append(('MUTANT', d['doc'], d['method'], d['note'], rng, ins))
    f = o['forward']; r = o['reverse']
    fs, rs = f['sequence'], r['sequence']
    if d['method'] == 'back-to-back':
        nb2b += 1
        fa, ra = f['annealLength'], r['annealLength']
        # anneal parts equal the template flanks
        if fs[-fa:].upper() != stretch(rng['end'], rng['end'] + fa, circ).upper():
            bad.append(('B2B FWD ANNEAL', d['doc'], d['note'], rng, fs))
        if rs[-ra:].upper() != rc(stretch(rng['start'] - ra, rng['start'], circ)).upper():
            bad.append(('B2B REV ANNEAL', d['doc'], d['note'], rng, rs))
        # tails
        ftail = fs[:-fa]; rtail = rs[:-ra]
        if ftail + rc(rtail) != ins and rc(rtail) + ftail != ins:
            bad.append(('B2B TAILS', d['doc'], d['note'], ins, ftail, rtail))
        if rc(rtail) + ftail != ins:
            bad.append(('B2B TAIL ORDER', d['doc'], d['note'], ins, ftail, rtail))
        # case convention: tails upper, anneal lower (template is lowercase)
        if ftail != ftail.upper() or rtail != rtail.upper() or fs[-fa:] != fs[-fa:].lower() or rs[-ra:] != rs[-ra:].lower():
            bad.append(('B2B CASE', d['doc'], d['note'], fs, rs))
        # Tm claims
        if not close(tm(fs[-fa:]), f['tm']) or not close(tm(rs[-ra:]), r['tm']):
            tmbad.append((d['note'], f['tm'], tm(fs[-fa:]), r['tm'], tm(rs[-ra:])))
        if o['problem'] is None:
            if num(f['tm']) < 60 or num(r['tm']) < 60 or math.isnan(num(f['tm'])) or math.isnan(num(r['tm'])): bad.append(('B2B TM<60 no problem', d['note'], f['tm'], r['tm']))
            # minimal: one shorter is below 60 unless at the 15 floor
            if fa > 15 and tm(fs[-fa:-1]) >= 60: bad.append(('B2B FWD NOT MINIMAL', d['note'], fa, tm(fs[-fa:-1])))
            if ra > 15 and tm(rs[-ra:-1]) >= 60: bad.append(('B2B REV NOT MINIMAL', d['note'], ra, tm(rs[-ra:-1])))
        if circ:
            prod, err = simulate_b2b(fs, rs, fa, ra, circ)
            if err: bad.append(('B2B SIM', d['doc'], d['note'], err))
            elif not same_circle(prod, exp): bad.append(('B2B PRODUCT != MUTANT', d['doc'], d['note'], rng, ins, len(prod), len(exp), prod[:40], exp[:40]))
        # NEB Ta claim
        if o['annealAt'] is not None:
            q = min(num(f['q5Tm']), num(r['q5Tm']))
            if o['annealAt'] != min(round(q) + 1, 72) and o['annealAt'] != min(math.floor(q + 0.5) + 1, 72):
                bad.append(('B2B TA', d['note'], f['q5Tm'], r['q5Tm'], o['annealAt']))
    else:
        nqc += 1
        left = r['annealLength']; right = f['annealLength']
        want = stretch(rng['start'] - left, rng['start'], circ).lower() + ins + stretch(rng['end'], rng['end'] + right, circ).lower()
        if fs != want: bad.append(('QC FWD', d['doc'], d['note'], rng, fs, want))
        if rs != rc(fs): bad.append(('QC REV not rc', d['doc'], d['note'], fs, rs))
        if not circ and (rng['start'] - left < 0 or rng['end'] + right > L):
            bad.append(('QC LINEAR OVERHANG', d['note'], rng, left, right))
        # Agilent formula
        removed = rng['end'] - rng['start']
        mism = sum(1 for a, b in zip(stretch(rng['start'], rng['end'], circ).upper(), ins) if a != b) if removed == len(ins) else 0
        indel = 0 if removed == len(ins) else len(ins)
        N = len(fs) - indel
        gc = sum(1 for c in fs.upper() if c in 'GC') / len(fs) * 100
        agil = 81.5 + 0.41 * gc - 675 / N - (0 if indel else mism / len(fs) * 100)
        if not close(agil, f['tm']): tmbad.append(('QC', d['note'], f['tm'], agil))
        if o['problem'] is None and (num(f['tm']) < 78 or math.isnan(num(f['tm']))): bad.append(('QC TM<78 no problem', d['note'], f['tm']))
        # the QuikChange product (nicked circle = template with primer region written in) equals the mutant
        prod = ins + stretch(rng['end'], rng['start'] + L, circ) if circ else None
        if circ and not same_circle(prod, exp): bad.append(('QC PRODUCT', d['note']))
    # label: 1-based
    lab = o['label']
    if rng['end'] - rng['start'] == 0:
        if not lab.startswith('+' + ins + ' after ' + format(rng['start'], ',')): bad.append(('LABEL INS', d['note'], lab))
    elif ins == '':
        exp_lab = 'Δ' + (format(rng['start'] + 1, ',') if rng['end'] - rng['start'] == 1 else f"{rng['start']+1:,}–{rng['end']:,}")
        if lab != exp_lab: bad.append(('LABEL DEL', d['note'], lab, exp_lab))
    else:
        old = stretch(rng['start'], rng['end'], circ).upper()
        span = format(rng['start'] + 1, ',') if rng['end'] - rng['start'] == 1 else f"{rng['start']+1:,}–{rng['end']:,}"
        if lab != old + span + ins: bad.append(('LABEL SUB', d['note'], lab, old + span + ins, rng))

print(f'{n} designs ({nb2b} back-to-back, {nqc} overlapping)')
print('tm mismatches:', len(tmbad), tmbad[:5])
print('problems:', len(bad))
seen = set()
for b in bad:
    k = b[0]
    print('  ', b)

# ---- protein changes vs Biopython ----
def translate(seq, strand, table, codon_start=1):
    s = seq.upper()
    if strand == 'reverse': s = rc(s)
    s = s[codon_start - 1:]
    s = s[: len(s) - len(s) % 3]
    return str(Seq(s).translate(table=table))

feats = {f['name']: f for f in D['features']}
print('\nfeature translations vs Biopython:')
for f in D['features']:
    seg = f['segs'][0]; cs = 1
    for q in f['qualifiers']:
        if q['name'] == 'codon_start': cs = int(q['value'])
    tbl = f['table']
    seqf = ''.join(TEXT[i % L] for i in range(seg['start'], seg['end']))
    mine = translate(seqf, f['strand'], tbl, cs)
    print(' ', f['name'], f['strand'], 'table', tbl, 'cs', cs, 'match' if mine == f['protein'] else f'DIFF\n   pp={f["protein"]}\n   bio={mine}')

print('\nprotein change claims:')
pbad = 0; pn = 0
for d in D['designs']:
    if d['error'] or d['doc'] != 'circular' or d['method'] != 'back-to-back': continue
    o = d['out']; rng = d['range']; ins = d['replacement'].upper()
    mut = o['mutant']
    mf = {f['name']: f for f in o['mutantFeatures']}
    for f in D['features']:
        seg = f['segs'][0]
        inside = any(seg['start'] <= rng['start'] + k and rng['end'] + k <= seg['end'] for k in (0, L))
        claims = [c for c in o['proteinChanges'] if c.startswith(f['name'] + ' ')]
        if not inside:
            if claims: print('  CLAIM OUTSIDE FEATURE', d['note'], claims); pbad += 1
            continue
        pn += 1
        if not claims: print('  NO CLAIM for change inside', f['name'], d['note'], rng); pbad += 1; continue
        cs = 1
        for q in f['qualifiers']:
            if q['name'] == 'codon_start': cs = int(q['value'])
        before = translate(''.join(TEXT[i % L] for i in range(seg['start'], seg['end'])), f['strand'], f['table'], cs)
        mseg = mf[f['name']]['segs'][0]
        ML = len(mut)
        after = translate(''.join(mut[i % ML] for i in range(mseg['start'], mseg['end'])), f['strand'], f['table'], cs)
        claim = claims[0][len(f['name']) + 1:]
        delta = len(ins) - (rng['end'] - rng['start'])
        ok = True
        if before == after:
            ok = claim == 'no change (silent)'
        elif delta % 3 != 0:
            m = re.match(r'frameshift from (\w)(\d+)$', claim)
            if not m: ok = False
            else:
                i = int(m.group(2)) - 1
                ok = before[i] == m.group(1) and before[:i] == after[:i] and (i >= len(after) or before[i] != after[i])
        else:
            ms = re.findall(r'([A-Z*])(\d+)([A-Z*])', claim)
            if ms and '→' not in claim:
                for a, pos, b in ms:
                    i = int(pos) - 1
                    if not (before[i] == a and after[i] == b): ok = False
                # all other residues equal
                changed = {int(p) - 1 for _, p, _ in ms}
                if len(before) != len(after): ok = False
                else:
                    for i in range(len(before)):
                        if (before[i] != after[i]) != (i in changed): ok = False
            else:
                m = re.match(r'(\d+)(?:–(\d+))? (\S+) → (\S+)$', claim)
                if not m: ok = False
                else:
                    was = '' if m.group(3) == '(none)' else m.group(3); now = '' if m.group(4) == '(none)' else m.group(4)
                    a = int(m.group(1)) - 1; b = int(m.group(2)) if m.group(2) else a + len(was)
                    ok = before[a:b] == was and before[:a] + now + before[b:] == after
        if not ok:
            pbad += 1
            print('  BAD CLAIM', d['note'], rng, ins, f['name'], f['strand'], 'claim=', claim)
            print('     before', before); print('     after ', after)
print(f'protein claims checked: {pn}, bad: {pbad}')

# ---- codon sites ----
print('\ncodon sites:')
cbad = 0
for s in D['sites']:
    pos = s['pos']; site = s['site']
    # expected: first feature (in list order) with a codon there
    exp = None
    for f in D['features']:
        seg = f['segs'][0]; cs = 1
        for q in f['qualifiers']:
            if q['name'] == 'codon_start': cs = int(q['value'])
        st, en = seg['start'], seg['end']
        p = pos if st <= pos < en else (pos + L if st <= pos + L < en else None)
        if p is None: continue
        if f['strand'] == 'forward':
            off = p - st - (cs - 1)
            if off < 0: continue
            idx = off // 3
            span = (st + cs - 1 + 3 * idx, st + cs - 1 + 3 * idx + 3)
            if span[1] > en: continue
            codon = ''.join(TEXT[i % L] for i in range(*span)).upper()
        else:
            off = (en - 1 - (cs - 1)) - p
            if off < 0: continue
            idx = off // 3
            span = (en - (cs - 1) - 3 * (idx + 1), en - (cs - 1) - 3 * idx)
            if span[0] < st: continue
            codon = rc(''.join(TEXT[i % L] for i in range(*span)).upper())
        aa = str(Seq(codon).translate(table=f['table']))
        exp = dict(feature=f['name'], index=idx, span=dict(start=span[0] % L if span[0] >= L else span[0], end=(span[0] % L if span[0] >= L else span[0]) + 3), codon=codon, aminoAcid=aa, strand=f['strand'], table=f['table'])
        break
    if (site is None) != (exp is None):
        cbad += 1; print('  SITE PRESENCE', pos, site, exp); continue
    if site is None: continue
    got = {k: site[k] for k in ('feature', 'index', 'span', 'codon', 'aminoAcid', 'strand', 'table')}
    if got != exp:
        cbad += 1; print('  SITE DIFF', pos, '\n    got', got, '\n    exp', exp)
    # choices
    tbl = CodonTable.unambiguous_dna_by_id[site['table']]
    for aa, ch in s['choices'].items():
        for c in ch:
            tr = '*' if c['codon'] in tbl.stop_codons else tbl.forward_table.get(c['codon'])
            if tr != aa: cbad += 1; print('  CHOICE WRONG AA', pos, site['table'], aa, c)
            fwdc = rc(c['codon']) if site['strand'] == 'reverse' else c['codon']
            if fwdc != c['forward']: cbad += 1; print('  CHOICE FORWARD', c)
            if c['changes'] != sum(1 for a, b in zip(c['codon'], site['codon']) if a != b): cbad += 1; print('  CHOICE CHANGES', c, site['codon'])
        allc = {c for c, a in tbl.forward_table.items() if a == aa} | (set(tbl.stop_codons) if aa == '*' else set())
        if {c['codon'] for c in ch} != allc: cbad += 1; print('  CHOICE SET', pos, site['table'], aa, sorted(c['codon'] for c in ch), sorted(allc))
        fr = [c['fraction'] for c in ch]
        if fr != sorted(fr, reverse=True): cbad += 1; print('  CHOICE ORDER', pos, aa, fr)
    # designR mutant translates to R at the residue
    dr = s['designR']
    f = feats[site['feature']]; seg = f['segs'][0]; cs = 1
    for q in f['qualifiers']:
        if q['name'] == 'codon_start': cs = int(q['value'])
    mut = dr['mutant']
    after = translate(''.join(mut[i % L] for i in range(seg['start'], seg['end'])), f['strand'], f['table'], cs)
    before = f['protein']
    if after[site['index']] != 'R' or len(after) != len(before) or any(a != b for i, (a, b) in enumerate(zip(before, after)) if i != site['index']):
        cbad += 1; print('  DESIGN R FAIL', pos, site, dr['label'], dr['proteinChanges'], '\n   ', before, '\n   ', after)
print('codon site problems:', cbad, 'of', len(D['sites']))
print('qc formula samples:', D['qc'])
