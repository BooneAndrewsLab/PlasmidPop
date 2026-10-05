"""Oracle comparisons for genetic codes, ambiguous codons, reverse complement,
six-frame translation, ORFs and SEGUID. Reads out/codes.json written by
src/__audit__/translation-io/codes_dump.test.ts."""
import json, re, hashlib, base64, sys
from Bio.Seq import Seq, reverse_complement, complement
from Bio.Data import CodonTable
from Bio.Data.IUPACData import ambiguous_dna_values

S = '/tmp/claude-9005/-home-matej-code-WebstormProjects-PlasmidPop/0d36857c-4f3e-42c7-b46a-0fa7317cc69d/scratchpad/audit/translation-io'
d = json.load(open(S + '/out/codes.json'))
problems = []

# ---------------------------------------------------------------- 1. gc.prt
txt = open(S + '/gc.prt').read()
# strip comments
txt = '\n'.join(l for l in txt.splitlines() if not l.strip().startswith('--'))
blocks = re.findall(r'\{(.*?)\}', txt, re.S)
gc = {}
for b in blocks:
    m_id = re.search(r'\bid\s+(\d+)', b)
    if not m_id:
        continue
    aa = re.search(r'ncbieaa\s+"([^"]+)"', b).group(1)
    st = re.search(r'sncbieaa\s+"([^"]+)"', b).group(1)
    names = re.findall(r'name\s+"([^"]+)"', b.replace('\n', ' '))
    gc[int(m_id.group(1))] = (aa, st, names)
print('gc.prt tables:', sorted(gc))
ship = {c['id']: c for c in d['codes']}
for i, (aa, st, names) in gc.items():
    if i not in ship:
        problems.append(f'table {i} ({names}) in gc.prt but not shipped')
        continue
    if ship[i]['aa'] != aa:
        problems.append(f'table {i} aa mismatch:\n {ship[i]["aa"]}\n {aa}')
    if ship[i]['starts'] != st:
        problems.append(f'table {i} starts mismatch:\n {ship[i]["starts"]}\n {st}')
    if ship[i]['name'] != names[0]:
        problems.append(f'table {i} name: shipped {ship[i]["name"]!r} vs gc.prt {names[0]!r}')
for i in ship:
    if i not in gc:
        problems.append(f'table {i} shipped but not in gc.prt')

# Also vs Biopython's tables
for i in ship:
    t = CodonTable.unambiguous_dna_by_id[i]
    bases = 'TCAG'
    codons = [a + b + c for a in bases for b in bases for c in bases]
    aa = ''.join(t.forward_table.get(k, '*') for k in codons)
    st = ''.join('M' if k in t.start_codons else ('*' if k in t.stop_codons else '-') for k in codons)
    if aa != ship[i]['aa']:
        problems.append(f'table {i} aa differs from Biopython')
    if st != ship[i]['starts']:
        problems.append(f'table {i} starts differ from Biopython: ours {ship[i]["starts"]} bio {st}')

# ---------------------------------------------------------------- 2. ambiguous codons
IUPAC = 'ACGTURYSWKMBDHVN'
codons = [a + b + c for a in IUPAC for b in IUPAC for c in IUPAC]
amb_problems = 0
amb_examples = []
for i in ship:
    t = CodonTable.unambiguous_dna_by_id[i]
    ours = d['ambiguous'][str(i)]
    for k, our in zip(codons, ours):
        # brute-force expansion
        exp = set()
        for a in ambiguous_dna_values[k[0].replace('U', 'T')]:
            for b in ambiguous_dna_values[k[1].replace('U', 'T')]:
                for c in ambiguous_dna_values[k[2].replace('U', 'T')]:
                    exp.add(t.forward_table.get(a + b + c, '*'))
        expect = exp.pop() if len(exp) == 1 else 'X'
        if our != expect:
            amb_problems += 1
            if len(amb_examples) < 10:
                amb_examples.append((i, k, our, expect))
print('ambiguous codon mismatches vs brute force:', amb_problems, amb_examples)
# What would Biopython give for a few ambiguous codons? (B/Z/J)
for k in ['MTT', 'RAT', 'SAR', 'YTG', 'NNN', 'TTY', 'GCN', 'TRA', 'TAR', 'ATH', 'CTN', 'YTR', 'MGR', 'AGR']:
    try:
        bio = str(Seq(k).translate())
    except Exception as e:
        bio = 'ERR:' + type(e).__name__
    print(f'  {k}: ours={d["ambiguous"]["1"][codons.index(k)]} biopython={bio}')
print('lowerCheck:', d['lowerCheck'])

# ---------------------------------------------------------------- 3. reverse complement
rc = d['rc']
exp_upper = str(reverse_complement(Seq(IUPAC.replace('U', 'T')), inplace=False))
# Biopython: reverse_complement of a string with U? use DNA: compare position for U separately
ours = rc['upper']
# U at index 4 -> complement A; in rc string it's at position len-1-4
exp = list(exp_upper)
print('rc upper ours   :', ours)
print('rc upper biopy  :', ''.join(exp))
if ours != ''.join(exp):
    problems.append(f'reverseComplement upper differs: ours {ours} bio {"".join(exp)}')
if rc['lower'] != ''.join(exp).lower():
    problems.append(f'reverseComplement lower differs: ours {rc["lower"]} bio {"".join(exp).lower()}')
exp_c = str(complement(Seq(IUPAC.replace('U', 'T')), inplace=False))
if rc['comp_upper'] != exp_c:
    problems.append(f'complement upper differs: ours {rc["comp_upper"]} bio {exp_c}')
print('rc mixed:', rc['mixed'], ' biopython:', str(Seq('AcGtUrYsWkMbDhVn-.*').replace('U','T').replace('u','t').reverse_complement()))

# ---------------------------------------------------------------- 4. six frame + ORFs
sf_bad = 0
orf_bad = []
for case in d['orfs']:
    seq = case['seq'].upper()
    t = case['table']
    tab = CodonTable.unambiguous_dna_by_id[t]
    L = len(seq)
    rcs = str(Seq(seq).reverse_complement())
    for f in case['sixFrame']:
        fr = f['frame']
        text = seq if fr > 0 else rcs
        off = abs(fr) - 1
        sub = text[off:]
        sub = sub[: len(sub) - len(sub) % 3]
        exp = str(Seq(sub).translate(table=t))
        if exp != f['protein']:
            sf_bad += 1
            print('SIXFRAME MISMATCH', case['seq'][:30], fr, f['protein'][:20], exp[:20])
        if f['stops'] != exp.count('*'):
            sf_bad += 1

    # brute-force ORFs: for each strand text, positions p, start codon, walk to next in-frame stop
    def starts_ok(c):
        if case['atgOnly']:
            return c == 'ATG'
        return c in tab.start_codons

    def is_stop(c):
        return c in tab.stop_codons

    def scan(text):
        found = []
        circ = case['topology'] == 'circular'
        scan_text = text + text if circ else text
        n = len(text)
        # all starts in first copy
        for p in range(n):
            if p + 3 > len(scan_text):
                break
            if not starts_ok(scan_text[p:p + 3]):
                continue
            # walk
            q = p + 3
            stop = None
            while q + 3 <= len(scan_text) and q + 3 - p <= n + 3:  # allow at most one wrap: total length <= n
                c = scan_text[q:q + 3]
                if is_stop(c):
                    stop = q + 3
                    break
                q += 3
            if stop is None:
                continue
            if stop - p > n:
                continue
            codons_n = (stop - p) // 3 - 1
            if codons_n < case['minCodons']:
                continue
            found.append((p, stop))
        # drop nested: same stop (mod n) and a longer ORF exists containing it in same frame
        # PlasmidPop reports only the first start per stop. Group by stop position mod n:
        by_stop = {}
        for p, stop in found:
            key = stop % n if circ else stop
            # pick the one with smallest p in reading order, i.e. longest
            if key not in by_stop or (stop - p) > (by_stop[key][1] - by_stop[key][0]):
                by_stop[key] = (p, stop)
        return sorted(by_stop.values()), sorted(found)

    fwd_dedup, fwd_all = scan(seq)
    rev_dedup, rev_all = scan(rcs)
    exp = set()
    exp_all = set()
    for p, e in fwd_dedup:
        exp.add((p, e, 'forward'))
    for p, e in fwd_all:
        exp_all.add((p, e, 'forward'))
    for p, e in rev_dedup:
        s = (L - e) % L if case['topology'] == 'circular' else L - e
        exp.add((s, s + (e - p), 'reverse'))
    for p, e in rev_all:
        s = (L - e) % L if case['topology'] == 'circular' else L - e
        exp_all.add((s, s + (e - p), 'reverse'))
    ours = set((o['start'], o['end'], o['strand']) for o in case['orfs'])
    if ours != exp:
        missing = exp - ours
        extra = ours - exp
        extra_but_valid = extra & exp_all
        orf_bad.append((case['seq'][:40], case['topology'], case['minCodons'], t, case['atgOnly'], 'missing', sorted(missing), 'extra', sorted(extra), 'extra-but-nested-valid', sorted(extra_but_valid)))
    # also check codons count consistent
    for o in case['orfs']:
        if o['codons'] != (o['end'] - o['start']) // 3 - 1:
            orf_bad.append(('codons count', o))
print('six-frame mismatches:', sf_bad)
print('ORF case mismatches:', len(orf_bad), 'of', len(d['orfs']))
for x in orf_bad:
    print('  ', x)

# ---------------------------------------------------------------- 5. SEGUID
from seguid import lsseguid, csseguid, ldseguid, cdseguid
seg_bad = 0
for c in d['seguids']:
    s = c['seq']
    rcs = str(Seq(s).reverse_complement())
    exp = {
        'ls': lsseguid(s, form='short' if False else 'long').split('=')[1],
        'cs': csseguid(s, form='long').split('=')[1],
        'ld': ldseguid(s, rcs, form='long').split('=')[1],
        'cd': cdseguid(s, rcs, form='long').split('=')[1],
    }
    for k in exp:
        if exp[k] != c[k]:
            seg_bad += 1
            print('SEGUID MISMATCH', k, s[:20], c[k], exp[k])
for c in d['sticky']:
    try:
        exp = ldseguid(c['w'], c['c'], form='long').split('=')[1]
    except Exception as e:
        exp = 'ERR ' + str(e)
    if exp != c['ld']:
        seg_bad += 1
        print('SEGUID sticky MISMATCH', c, exp)
print('SEGUID mismatches:', seg_bad, 'of', len(d['seguids']) * 4 + len(d['sticky']))

print('\n==== PROBLEMS ====')
for p in problems:
    print(p)
print('total problems:', len(problems))
