"""Base-identity oracle for extractRange: every output feature must read exactly
the source bases it kept, in reading order, in the source frame, with partial
flags on exactly the clipped biological ends."""
import json, sys, collections
from Bio.Seq import Seq

d = json.load(open(sys.argv[1]))
problems = collections.Counter()
examples = collections.defaultdict(list)
stats = collections.Counter()


def bad(kind, case, msg):
    problems[kind] += 1
    if len(examples[kind]) < 4:
        examples[kind].append((msg, case))


def reading(f, L, circ):
    R = []
    for s in f['segments']:
        if s['kind'] != 'range':
            continue
        for p in range(s['start'], s['end']):
            R.append(p % L if circ else p)
    if f['strand'] == 'reverse':
        R.reverse()
    return R


def five(f):
    rs = [s for s in f['segments'] if s['kind'] == 'range']
    return rs[-1]['pe'] if f['strand'] == 'reverse' else rs[0]['ps']


def three(f):
    rs = [s for s in f['segments'] if s['kind'] == 'range']
    return rs[0]['ps'] if f['strand'] == 'reverse' else rs[-1]['pe']


def interior_flags(f):
    rs = [s for s in f['segments'] if s['kind'] == 'range']
    out = []
    for i, s in enumerate(rs):
        if s['ps'] and i != 0:
            out.append(('ps', i))
        if s['pe'] and i != len(rs) - 1:
            out.append(('pe', i))
    return out


STARTS = {'ATG', 'CTG', 'TTG'}

for c in d:
    L, circ, seq = c['L'], c['circular'], c['sequence']
    src = c['src']
    rs, re = c['region']
    ext = {}
    for k, p in enumerate(range(rs, re)):
        ext[p % L] = k
    R = reading(src, L, circ)
    K = [j for j in range(len(R)) if R[j] in ext]
    runs = []
    for j in K:
        if runs and runs[-1][-1] == j - 1:
            runs[-1].append(j)
        else:
            runs.append([j])
    out = c['out']
    stats['cases'] += 1
    stats['runs%d' % min(len(runs), 3)] += 1
    if len(runs) != len(out):
        bad('feature-count', c, f'expected {len(runs)} got {len(out)}')
        continue
    # match outputs to runs by reading
    outs = sorted(out, key=lambda f: min(reading(f, len(c['exSeq']), False)))
    runs_sorted = sorted(runs, key=lambda r: min(ext[R[j]] for j in r))
    cs = int(src['codonStart'] or '1')
    for run, f in zip(runs_sorted, outs):
        exp = [ext[R[j]] for j in run]
        got = reading(f, len(c['exSeq']), False)
        if exp != got:
            bad('bases', c, f'exp {exp} got {got}')
            continue
        if f['strand'] != src['strand']:
            bad('strand', c, '')
        lost = run[0]
        exp5 = lost > 0 or five(src)
        exp3 = run[-1] < len(R) - 1 or three(src)
        if five(f) != exp5:
            bad('5p-flag-exp%s' % exp5, c, f'exp {exp5} got {five(f)} out={f["segments"]}')
        if three(f) != exp3:
            bad('3p-flag-exp%s' % exp3, c, f'exp {exp3} got {three(f)} out={f["segments"]}')
        inter = interior_flags(f)
        if inter:
            bad('interior-partial', c, f'{inter} out={f["segments"]}')
        if f['note'] != 'n':
            bad('qualifier-lost', c, '')
        if src['type'] == 'CDS':
            skip = cs - 1
            first = skip if lost <= skip else lost + (skip - lost) % 3
            expcs = first - lost + 1
            gotcs = int(f['codonStart'] or '1')
            if expcs != gotcs:
                bad('codon_start', c, f'exp {expcs} got {gotcs} lost={lost} cs={cs} strand={src["strand"]}')
                continue
            text = ''.join(c['exSeq'][i] for i in got)
            if f['strand'] == 'reverse':
                text = str(Seq(text).reverse_complement()) if False else text
            # text built from extract indices in reading order; reverse strand needs complement
            if f['strand'] == 'reverse':
                text = text.translate(str.maketrans('ACGT', 'TGCA'))
            body = text[gotcs - 1:]
            whole = body[: len(body) // 3 * 3]
            prot = str(Seq(whole).translate()) if whole else ''
            if prot and not five(f) and whole[:3] in STARTS:
                prot = 'M' + prot[1:]
            gp = f['protein'] or ''
            tail = len(body) % 3
            if gp != prot and not (tail == 2 and three(f) and gp[:-1] == prot):
                bad('protein', c, f'exp {prot} got {gp}')
            # translation qualifier policy
            clipped = len(run) < len(R)
            if clipped:
                stats['clipped-cds'] += 1
                if f['translationQ'] is not None:
                    stats['clipped-keeps-translation' + ('-split' if len(runs) > 1 else '-single')] += 1

print(dict(stats))
print(dict(problems))
for k, v in examples.items():
    print('==', k)
    for msg, case in v:
        print('  ', msg)
        print('     L=%d circ=%s region=%s src=%s cs=%s' % (case['L'], case['circular'], case['region'],
              [(s.get('start'), s.get('end'), s.get('ps'), s.get('pe')) for s in case['src']['segments']],
              case['src']['codonStart']), case['src']['strand'])
