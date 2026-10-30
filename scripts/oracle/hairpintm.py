"""Hairpin melting temperature of designer-like primers from primer3-py, for
src/test/oracle/hairpinTm.json (item 125, issue #345).

Primer3 refuses a primer whose best hairpin melts above PRIMER_MAX_HAIRPIN_TH
(47 C). Our hairpinTm (structure.ts) has to reproduce that Tm, so the data is
what the designer meets: random 18-27 nt windows of seeded synthetic
templates, kept when they fall inside the designer's Tm (55-65 C) and GC
(35-65 %) limits by primer3's own Tm. Each is run through calc_hairpin at the
conditions of the design (50 mM sodium, no magnesium or dNTPs, 500 nM
oligo, 37 C). The first half (even index) is what the enthalpy terms were
fitted on, the second half is held out.
"""
import random

import primer3

SEED = 20261101
COUNT = 800
CONDITIONS = dict(mv_conc=50.0, dv_conc=0.0, dntp_conc=0.0, dna_conc=500.0, temp_c=37.0)
TM = dict(mv_conc=50.0, dv_conc=0.0, dntp_conc=0.0, dna_conc=500.0, tm_method='santalucia',
          salt_corrections_method='santalucia')


def generate():
    rng = random.Random(SEED)
    rows, seen = [], set()
    while len(rows) < COUNT:
        gc = rng.choice([0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65])
        tpl = ''.join(
            rng.choice('GC') if rng.random() < gc else rng.choice('AT') for _ in range(400)
        )
        for _ in range(8):
            n = rng.randint(18, 27)
            p = rng.randint(0, len(tpl) - n)
            s = tpl[p:p + n]
            g = 100 * sum(c in 'GC' for c in s) / n
            if s in seen or not 35 <= g <= 65:
                continue
            if not 55 <= primer3.calc_tm(s, **TM) <= 65:
                continue
            seen.add(s)
            r = primer3.calc_hairpin(s, **CONDITIONS)
            rows.append({'seq': s, 'dg': round(r.dg / 1000, 3), 'dh': round(r.dh / 1000, 2), 'tm': round(r.tm, 2)})
            if len(rows) >= COUNT:
                break
    return {
        'primer3': primer3.__version__,
        'conditions': {'sodiumMM': 50, 'oligoNM': 500, 'magnesiumMM': 0, 'dntpMM': 0, 'tempC': 37},
        'rows': rows,
    }
