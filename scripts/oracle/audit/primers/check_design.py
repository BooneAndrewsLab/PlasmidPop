import json, sys
from Bio.Seq import Seq
D = json.load(open(sys.argv[1]))

def sub(text, s, e, circular):
    L = len(text)
    if circular:
        return ''.join(text[i % L] for i in range(s, e))
    return text[s:e]

problems = []
npairs = 0; nruns = 0
for run in D['runs']:
    text = D[run['template']]
    L = len(text)
    circ = run['topology'] == 'circular'
    if run['error']:
        problems.append(('ERROR', run['template'], run['topology'], run['target'], run['error']))
        continue
    nruns += 1
    for p in run['pairs']:
        npairs += 1
        fs, fe = p['fSite']['start'], p['fSite']['end']
        rs, re_ = p['rSite']['start'], p['rSite']['end']
        tf = sub(text, fs, fe, circ).upper()
        tr = str(Seq(sub(text, rs, re_, circ).upper()).reverse_complement())
        if tf != p['f']:
            problems.append(('FWD STRING', run['template'], run['topology'], run['target'], p['f'], tf, p['fSite']))
        if tr != p['r']:
            problems.append(('REV STRING', run['template'], run['topology'], run['target'], p['r'], tr, p['rSite']))
        # site inside bounds for linear
        if not circ and (fs < 0 or fe > L or rs < 0 or re_ > L):
            problems.append(('LINEAR OUT OF BOUNDS', run['target'], p['fSite'], p['rSite']))
        # product length
        pl = re_ - fs
        if circ and pl <= 0: pl += L
        if pl != p['productLength']:
            problems.append(('PRODUCT LEN', run['target'], p['fSite'], p['rSite'], p['productLength'], pl))
        # product covers the target
        t = run['target']
        if circ:
            # unrolled: forward start fs(normalized) must be <= t.start (mod), reverse end >= t.end
            # check that target is within [fs, fs+pl) circularly
            def within(x):
                return ((x - fs) % L) <= pl
            if not (within(t['start']) and ((t['end'] - fs) % L <= pl or (t['end'] - fs) % L == 0)):
                problems.append(('TARGET NOT COVERED', run['topology'], t, p['fSite'], p['rSite'], pl))
        else:
            if not (fs <= t['start'] and re_ >= min(t['end'], L)):
                problems.append(('TARGET NOT COVERED', run['topology'], t, p['fSite'], p['rSite']))
        # the primer contains IUPAC codes?
        if any(c not in 'ACGT' for c in p['f'] + p['r']):
            problems.append(('IUPAC IN DESIGNED PRIMER', run['template'], p['f'], p['r']))
        # primers are 18-27 by default (or within relaxed) and Tm inside the window
        lo, hi = (50, 70) if 'minTm' in run['opts'] else (55, 65)
        if not (lo <= p['fTm'] <= hi and lo <= p['rTm'] <= hi):
            problems.append(('TM OUT OF WINDOW', p['f'], p['fTm'], p['r'], p['rTm']))
print('runs', nruns, 'pairs', npairs)
for pr in problems[:40]:
    print(pr)
print('problems:', len(problems))
# Which runs returned no pairs?
for run in D['runs']:
    if run['pairs'] is not None and len(run['pairs']) == 0:
        print('NO PAIRS:', run['template'], run['topology'], run['target'], 'specific' if 'requireSpecific' not in run['opts'] else 'relaxed')
