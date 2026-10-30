"""Primer pairs: Primer3's design output and its verdict on ours, for
src/test/oracle/primerPairs.json (item 122, issue #337).

A fixed set of seeded synthetic templates, each with a target. For each:

* Primer3's own design (primer3-py design_primers) with settings that match
  the designer's defaults: primers 18-27 nt, Tm 55-65 C (optimum 60), GC
  35-65 %, at most 3 C apart, at most 4 of one base in a row, 50 mM sodium
  and 500 nM primer with SantaLucia's parameters and salt correction (the
  conditions of our meltingTemperature), a pair flanking the target within
  200 bp each side. The top 5 pairs are recorded.
* Primer3's verdict on each pair OUR designer selected: the pair is handed
  to design_primers as SEQUENCE_PRIMER and SEQUENCE_PRIMER_REVCOMP with the
  same settings. If Primer3 returns the pair, it passes its own criteria
  and its penalty is recorded; if not, it is asked again with
  PRIMER_PICK_ANYWAY for its penalty; the reasons the first run gave (its
  EXPLAIN strings) are recorded.

Our pairs come from src/test/oracle/primerPairsOurs.json, written by
`scripts/oracle/run.sh primer-pairs`, which exports them from the TypeScript
designer. Without that file only Primer3's own design is written.
"""
import json
import os
import random

import primer3

SEED = 20261031
ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
OURS = os.path.join(ROOT, 'src', 'test', 'oracle', 'primerPairsOurs.json')
COUNT = 40
FLANK = 200
TOP = 5


def random_seq(rng, n, gc):
    return ''.join(
        rng.choice('GC') if rng.random() < gc else rng.choice('AT') for _ in range(n)
    )


def templates():
    rng = random.Random(SEED)
    out = []
    for i in range(COUNT):
        gc = rng.choice([0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65])
        n = rng.randint(1000, 1800)
        seq = random_seq(rng, n, gc)
        # Every third template gets the things that make primer design hard.
        if i % 3 == 1:
            # a repeat copied a few hundred bases away
            k = rng.randint(30, 60)
            a = rng.randint(50, n // 2)
            b = rng.randint(n // 2, n - k - 1)
            seq = seq[:b] + seq[a:a + k] + seq[b + k:]
        if i % 3 == 2:
            # a homopolymer and a dinucleotide repeat
            p = rng.randint(100, n - 100)
            seq = seq[:p] + rng.choice('ACGT') * rng.randint(7, 12) + seq[p:]
            q = rng.randint(100, n - 100)
            seq = seq[:q] + rng.choice(['AT', 'GC', 'CA', 'TA']) * rng.randint(8, 14) + seq[q:]
        n = len(seq)
        tlen = rng.randint(100, 400)
        start = rng.randint(FLANK + 30, n - tlen - FLANK - 30)
        out.append({'name': f't{i:02d}', 'gc': gc, 'seq': seq, 'target': [start, start + tlen]})
    return out


GLOBAL = {
    'PRIMER_OPT_SIZE': 21,
    'PRIMER_MIN_SIZE': 18,
    'PRIMER_MAX_SIZE': 27,
    'PRIMER_OPT_TM': 60.0,
    'PRIMER_MIN_TM': 55.0,
    'PRIMER_MAX_TM': 65.0,
    'PRIMER_MIN_GC': 35.0,
    'PRIMER_MAX_GC': 65.0,
    'PRIMER_PAIR_MAX_DIFF_TM': 3.0,
    'PRIMER_MAX_POLY_X': 4,
    'PRIMER_SALT_MONOVALENT': 50.0,
    'PRIMER_SALT_DIVALENT': 0.0,
    'PRIMER_DNTP_CONC': 0.0,
    'PRIMER_DNA_CONC': 500.0,
    'PRIMER_TM_FORMULA': 1,
    'PRIMER_SALT_CORRECTIONS': 1,
}


def seq_args(t):
    start, end = t['target']
    lo = max(0, start - FLANK)
    hi = min(len(t['seq']), end + FLANK)
    return {
        'SEQUENCE_ID': t['name'],
        'SEQUENCE_TEMPLATE': t['seq'],
        'SEQUENCE_TARGET': [start, end - start],
        'SEQUENCE_INCLUDED_REGION': [lo, hi - lo],
    }


def product_range(t):
    start, end = t['target']
    return [[end - start, end - start + 2 * FLANK + 5]]


def sites(res, i):
    """Left and right site of returned pair i, half-open on the top strand."""
    ls, ll = res[f'PRIMER_LEFT_{i}']
    rs, rl = res[f'PRIMER_RIGHT_{i}']
    return [ls, ls + ll], [rs - rl + 1, rs + 1]


def design(t):
    res = primer3.design_primers(
        seq_args(t),
        {**GLOBAL, 'PRIMER_NUM_RETURN': TOP, 'PRIMER_PRODUCT_SIZE_RANGE': product_range(t)},
    )
    pairs = []
    for i in range(res['PRIMER_PAIR_NUM_RETURNED']):
        left, right = sites(res, i)
        pairs.append({
            'left': left,
            'right': right,
            'penalty': round(res[f'PRIMER_PAIR_{i}_PENALTY'], 3),
            'leftTm': round(res[f'PRIMER_LEFT_{i}_TM'], 2),
            'rightTm': round(res[f'PRIMER_RIGHT_{i}_TM'], 2),
            'productSize': res[f'PRIMER_PAIR_{i}_PRODUCT_SIZE'],
        })
    return {
        'pairs': pairs,
        'explain': {
            'left': res.get('PRIMER_LEFT_EXPLAIN', ''),
            'right': res.get('PRIMER_RIGHT_EXPLAIN', ''),
            'pair': res.get('PRIMER_PAIR_EXPLAIN', ''),
        },
    }


def evaluate(t, pair):
    """Primer3's verdict on one pair of ours."""
    args = seq_args(t)
    args['SEQUENCE_PRIMER'] = pair['fwd']
    args['SEQUENCE_PRIMER_REVCOMP'] = pair['rev']
    g = {**GLOBAL, 'PRIMER_NUM_RETURN': 1, 'PRIMER_PRODUCT_SIZE_RANGE': product_range(t)}
    res = primer3.design_primers(args, g)
    passed = res['PRIMER_PAIR_NUM_RETURNED'] > 0
    explain = None
    if not passed:
        # Why it was refused is in this run's EXPLAIN strings; the second run,
        # which takes the pair anyway, is for its penalty and Tm.
        explain = {
            'left': res.get('PRIMER_LEFT_EXPLAIN', ''),
            'right': res.get('PRIMER_RIGHT_EXPLAIN', ''),
            'pair': res.get('PRIMER_PAIR_EXPLAIN', ''),
        }
        res = primer3.design_primers(args, {**g, 'PRIMER_PICK_ANYWAY': 1})
    row = {'passes': passed}
    if res['PRIMER_PAIR_NUM_RETURNED'] > 0:
        row['penalty'] = round(res['PRIMER_PAIR_0_PENALTY'], 3)
        row['leftPenalty'] = round(res['PRIMER_LEFT_0_PENALTY'], 3)
        row['rightPenalty'] = round(res['PRIMER_RIGHT_0_PENALTY'], 3)
        row['leftTm'] = round(res['PRIMER_LEFT_0_TM'], 2)
        row['rightTm'] = round(res['PRIMER_RIGHT_0_TM'], 2)
        row['leftGc'] = round(res['PRIMER_LEFT_0_GC_PERCENT'], 1)
        row['rightGc'] = round(res['PRIMER_RIGHT_0_GC_PERCENT'], 1)
    if explain is not None:
        row['explain'] = explain
    return row


def generate():
    ours = None
    if os.path.exists(OURS):
        with open(OURS, encoding='utf-8') as f:
            ours = {t['name']: t['pairs'] for t in json.load(f)['templates']}
    rows = []
    for t in templates():
        row = {**t, 'primer3': design(t)}
        if ours is not None:
            row['ours'] = [{**p, 'primer3': evaluate(t, p)} for p in ours.get(t['name'], [])]
        rows.append(row)
    return {
        'primer3': primer3.__version__,
        'settings': {**GLOBAL, 'flank': FLANK, 'top': TOP},
        'templates': rows,
    }


if __name__ == '__main__':
    # run.sh primer-pairs: rewrite primerPairs.json alone.
    import generate as g

    g.write('primerPairs.json', generate())
