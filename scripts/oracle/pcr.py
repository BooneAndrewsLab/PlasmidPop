"""PCR products, for src/test/oracle/pcr.json.

Each case is built from a template and primers whose positions we chose, so
the textbook product is known by construction:

    product = forward primer + template between the primers + revcomp(reverse primer)

with the template slice taken round the circle on a circular template. That
formula is also what pydna.amplify.pcr computes; wherever pydna accepts the
case (one site per primer) the generator asserts that it agrees, and records
whether it did. Cases it refuses (a primer with two sites) keep the textbook
answer.
"""
from pydna.amplify import pcr as pydna_pcr
from pydna.dseqrecord import Dseqrecord
from pydna.primer import Primer

from common import fixture_sequence, random_dna, rc, rng_for

SEED = 20261005


def cyclic(text, start, n):
    L = len(text)
    return ''.join(text[(start + i) % L] for i in range(n))


def mutate(rng, s, at):
    other = rng.choice([c for c in 'ACGT' if c != s[at]])
    return s[:at] + other + s[at + 1:]


def textbook(text, circular, fs, flen, rs, rlen, fprimer, rprimer):
    """fs..fs+flen is where the forward primer's 3' part sits, rs..rs+rlen the reverse's."""
    L = len(text)
    if circular:
        span = (rs + rlen - fs) % L or L
        if span < flen + rlen:
            span += L
    else:
        span = rs + rlen - fs
    middle = cyclic(text, fs + flen, span - flen - rlen)
    return fprimer + middle + rc(rprimer)


def build(case_id, text, circular, fs, flen, rs, rlen, ftail='', rtail='', fmut=None, rmut=None, rng=None):
    fanneal = text[fs % len(text):][:flen] if fs + flen <= len(text) else cyclic(text, fs, flen)
    ranneal = rc(cyclic(text, rs, rlen))
    if fmut is not None:
        fanneal = mutate(rng, fanneal, fmut)
    if rmut is not None:
        ranneal = mutate(rng, ranneal, rmut)
    fprimer, rprimer = ftail + fanneal, rtail + ranneal
    want = textbook(text, circular, fs, flen, rs, rlen, fprimer, rprimer)
    case = {
        'id': case_id,
        'circular': circular,
        'primers': [{'name': 'F', 'sequence': fprimer}, {'name': 'R', 'sequence': rprimer}],
        'product': want,
    }
    try:
        amp = pydna_pcr(Primer(fprimer), Primer(rprimer), Dseqrecord(text, circular=circular), limit=15)
        got = str(amp.seq).upper()
        assert got == want, f'{case_id}: pydna {len(got)} bp disagrees with the textbook {len(want)} bp'
        case['pydna'] = True
    except (ValueError, TypeError, IndexError) as exc:  # pydna found no or several products
        case['pydna'] = False
        case['pydnaRefused'] = type(exc).__name__
    return case


def generate():
    rng = rng_for(SEED)
    fixtures = {'L09137.gb': fixture_sequence('L09137.gb'), 'J01749.gb': fixture_sequence('J01749.gb')}
    cases = []

    def add(case, text, fixture=None):
        if fixture is not None:
            case['fixture'] = fixture
        else:
            case['template'] = text
        cases.append(case)

    # 1. Plain primers, random linear and circular templates, optional 5' tails.
    for i in range(24):
        L = rng.randint(300, 700)
        text = random_dna(rng, L)
        circular = i % 2 == 1
        flen, rlen = rng.randint(18, 28), rng.randint(18, 28)
        fs = rng.randint(0, L - 260)
        rs = fs + flen + rng.randint(20, 150)
        ftail = random_dna(rng, rng.randint(5, 20)) if rng.random() < 0.5 else ''
        rtail = random_dna(rng, rng.randint(5, 20)) if rng.random() < 0.5 else ''
        add(build(f'plain-{i}', text, circular, fs, flen, rs, rlen, ftail, rtail), text)

    # 2. Circular, the product spans the origin.
    for i in range(14):
        L = rng.randint(400, 600)
        text = random_dna(rng, L)
        flen = rlen = rng.randint(20, 26)
        fs = L - rng.randint(40, 100)
        rs = rng.randint(30, 120)  # past the origin
        ftail = random_dna(rng, 10) if i % 2 == 0 else ''
        rtail = random_dna(rng, 12) if i % 3 == 0 else ''
        add(build(f'origin-{i}', text, True, fs, flen, rs, rlen, ftail, rtail), text)

    # 3. Mismatches in the annealing part, well clear of the 3' end.
    for i in range(16):
        L = 700
        text = random_dna(rng, L)
        flen = rlen = 26
        fs, rs = 100, 420
        add(
            build(
                f'mismatch-{i}', text, i % 2 == 0, fs, flen, rs, rlen,
                'GAATTC' if i % 3 == 0 else '', 'GGATCC' if i % 3 == 1 else '',
                fmut=rng.randint(0, flen - (16 if i % 2 == 0 else 8)),
                rmut=rng.randint(0, rlen - (16 if i % 2 == 0 else 8)) if i % 4 else None,
                rng=rng,
            ),
            text,
        )

    # 4. Inverse PCR round a circle (back to back), and primers inserting bases.
    for i in range(6):
        L = 600
        text = random_dna(rng, L)
        at = 150 + i * 60
        flen = rlen = 22
        insert = random_dna(rng, 9 + i) if i % 2 else ''
        add(build(f'inverse-{i}', text, True, at, flen, at - rlen, rlen, insert, ''), text)

    # 5. The real plasmids: across the origin of pUC19 and pBR322, and elsewhere.
    for fixture, picks in (
        ('L09137.gb', [(2600, 150), (300, 700), (1500, 2400), (2000, 900)]),
        ('J01749.gb', [(4250, 120), (2000, 3000), (100, 4000), (3900, 600)]),
    ):
        text = fixtures[fixture]
        for j, (fs, rs) in enumerate(picks):
            for circular in (True, False):
                if not circular and rs < fs:
                    continue
                add(
                    build(
                        f'{fixture[:-3]}-{j}-{"circ" if circular else "lin"}', text, circular,
                        fs, 24, rs, 24, 'ACGTAC' if j % 2 else '', '', rng=rng,
                    ),
                    text, fixture,
                )
    return {'cases': cases}
