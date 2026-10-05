"""Assemblies by pydna, for src/test/oracle/assembly.json.

Every case is built backwards from a known construct, so the right answer is
known by construction, and pydna (which shares no code with PlasmidPop) must
reach the same construct from the same parts; the generator asserts that.

* Gibson: a circular or linear target cut into 2-5 parts that overlap their
  neighbour by 15-40 bp (never more than 60; longer overlaps are issue #134),
  some parts reversed, the parts listed out of order, one overlap straddling
  the origin of the target.
* Golden Gate: BsaI, BsmBI, BbsI and SapI destination vectors with a dropout
  and 1-3 inserts, inserts given reversed, the vector's origin moved through
  its recognition sites. pydna's Dseq.cut finds the fragments and a small
  chaining of their overhangs gives the product.
* In-Fusion and NEBuilder: the 15 and 20 bp tails of the overlap primers
  are fixed by the kit; pydna's pcr must give tail + insert + tail from the
  canonical primers, and Gibson of vector and amplicon must give vector +
  insert. The test then checks the primers PlasmidPop designs against those.
"""
from Bio.Restriction import BbsI, BsaI, BsmBI, SapI
from pydna.amplify import pcr as pydna_pcr
from pydna.assembly import Assembly
from pydna.dseq import Dseq
from pydna.dseqrecord import Dseqrecord
from pydna.primer import Primer

from common import canonical, rc, random_dna, rng_for, rotate

SEED = 20261006


def same_circle(a, b):
    return canonical(a, b) or canonical(a, rc(b))


# --- Gibson ---------------------------------------------------------------


def circular_gibson(rng, name, n, k, overlap, cuts=None, flip=(), shift=0):
    target = random_dna(rng, n)
    cuts = cuts or sorted(rng.sample(range(n), k))
    k = len(cuts)
    parts = []
    for i, start in enumerate(cuts):
        nxt = cuts[(i + 1) % k]
        end = (nxt if nxt > start else nxt + n) + overlap
        parts.append(''.join(target[p % n] for p in range(start, end)))
    order = list(range(k))
    order = order[shift:] + order[:shift]
    given = [rc(parts[i]) if i in flip else parts[i] for i in order]
    return {
        'name': name, 'circular': True, 'parts': given, 'minOverlap': min(15, overlap),
        'target': target, '_natural': parts,
    }


def linear_gibson(rng, name, n, k, overlap, flip=(), shift=0):
    target = random_dna(rng, n)
    cuts = [0] + sorted(rng.sample(range(60, n - 60), k - 1))
    parts = [target[s : (cuts[i + 1] + overlap if i + 1 < k else n)] for i, s in enumerate(cuts)]
    order = list(range(k))
    order = order[shift:] + order[:shift]
    given = [rc(parts[i]) if i in flip else parts[i] for i in order]
    return {
        'name': name, 'circular': False, 'parts': given, 'minOverlap': min(15, overlap),
        'target': target, '_natural': parts,
    }


def check_gibson(case):
    # pydna wants the parts in order and on one strand; the case handed to
    # PlasmidPop may have them shuffled and reversed.
    frags = [Dseqrecord(p, name=f'p{i}') for i, p in enumerate(case.pop('_natural'))]
    asm = Assembly(frags, limit=case['minOverlap'])
    if case['circular']:
        products = {str(r.seq).upper() for r in asm.assemble_circular()}
        ok = any(same_circle(p, case['target']) for p in products)
    else:
        products = {str(r.seq).upper() for r in asm.assemble_linear()}
        ok = case['target'] in products or rc(case['target']) in products
    assert ok, f"pydna does not rebuild Gibson case {case['name']}"


def gibson_cases(rng):
    cases = [
        circular_gibson(rng, 'circ-2-parts-20bp', 1200, 2, 20),
        circular_gibson(rng, 'circ-3-parts-20bp', 1500, 3, 20),
        circular_gibson(rng, 'circ-4-parts-25bp', 2000, 4, 25),
        circular_gibson(rng, 'circ-5-parts-30bp', 2500, 5, 30),
        circular_gibson(rng, 'circ-2-parts-15bp', 1000, 2, 15),
        circular_gibson(rng, 'circ-3-parts-40bp', 1800, 3, 40),
        circular_gibson(rng, 'circ-4-parts-60bp', 2400, 4, 60),
        circular_gibson(rng, 'circ-3-parts-one-reversed', 1500, 3, 25, flip=(1,)),
        circular_gibson(rng, 'circ-4-parts-two-reversed', 2000, 4, 25, flip=(1, 3)),
        circular_gibson(rng, 'circ-3-parts-out-of-order', 1500, 3, 25, shift=1),
        circular_gibson(rng, 'circ-5-parts-reversed-and-shifted', 2500, 5, 30, flip=(2,), shift=2),
        # the overlap of the last and first parts straddles the origin of the target
        circular_gibson(rng, 'circ-3-parts-overlap-across-origin', 1500, 3, 30, cuts=[1485, 400, 900]),
        circular_gibson(rng, 'circ-2-parts-overlap-across-origin', 1200, 2, 24, cuts=[1190, 600]),
        linear_gibson(rng, 'lin-3-parts-25bp', 1500, 3, 25),
        linear_gibson(rng, 'lin-4-parts-25bp', 2000, 4, 25),
        linear_gibson(rng, 'lin-3-parts-shifted', 1500, 3, 25, shift=1),
        linear_gibson(rng, 'lin-4-parts-one-reversed', 2000, 4, 25, flip=(1,)),
        linear_gibson(rng, 'lin-2-parts-40bp', 1200, 2, 40),
    ]
    for c in cases:
        check_gibson(c)
    return cases


# --- Golden Gate -------------------------------------------------------------

ENZYMES = {
    'BsaI': (BsaI, 'GGTCTC', 1, 4),
    'BsmBI': (BsmBI, 'CGTCTC', 1, 4),
    'BbsI': (BbsI, 'GAAGAC', 2, 4),
    'SapI': (SapI, 'GCTCTTC', 1, 3),
}


def clean_body(rng, n, site):
    while True:
        s = random_dna(rng, n)
        if site not in s and rc(site) not in s:
            return s


def overhangs(rng, k, length):
    out = []
    while len(out) < k:
        o = random_dna(rng, length)
        if o == rc(o) or o in out:
            continue
        if any(
            sum(a != b for a, b in zip(o, p)) <= 1 or sum(a != b for a, b in zip(o, rc(p))) <= 1
            for p in out
        ):
            continue
        out.append(o)
    return out


def usable_fragments(seq, circular, enzyme_name):
    enzyme, site, _, _ = ENZYMES[enzyme_name]
    out = []
    for f in Dseq(seq, circular=circular).cut(enzyme):
        w = f.watson.upper()
        if site in w or rc(site) in w:
            continue  # still carries a site: the dropout or a stub
        k5, _ = f.five_prime_end()
        k3, _ = f.three_prime_end()
        if 'blunt' in (k5, k3):
            continue
        out.append(f)
    return out


def ends(f):
    k5, o5 = f.five_prime_end()
    k3, o3 = f.three_prime_end()
    return o5.upper(), rc(o3.upper())


def chain(frags):
    """Join sticky fragments end to end, round a circle; return the product or None."""
    order = [frags[0]]
    used = {0}
    while len(used) < len(frags):
        _, right = ends(order[-1])
        nxt = []
        for i, f in enumerate(frags):
            if i in used:
                continue
            for g in (f, f.reverse_complement()):
                if ends(g)[0] == right:
                    nxt.append((i, g))
        if len(nxt) != 1:
            return None
        used.add(nxt[0][0])
        order.append(nxt[0][1])
    if ends(order[-1])[1] != ends(order[0])[0]:
        return None
    return ''.join(f.watson.upper() for f in order)


def golden_gate_case(rng, name, enzyme_name, n_inserts, rot=0, flip=()):
    _, site, spacer, ohlen = ENZYMES[enzyme_name]
    sp = 'A' * spacer
    o = overhangs(rng, n_inserts + 1, ohlen)
    backbone = clean_body(rng, 500, site)
    dropout = clean_body(rng, 120, site)
    # vector: ... [o_1][sp][rc site][dropout][site][sp][o_0] backbone ...
    vector = o[1] + sp + rc(site) + dropout + site + sp + o[0] + backbone
    vector = rotate(vector, rot)
    parts = [{'name': 'vector', 'sequence': vector, 'circular': True}]
    kept = [o[0] + backbone]
    for i in range(1, n_inserts + 1):
        body = clean_body(rng, 150 + 40 * i, site)
        left, right = o[i], o[(i + 1) % len(o)]
        seq = random_dna(rng, 8) + site + sp + left + body + right + sp + rc(site) + random_dna(rng, 8)
        if i + 1 in flip:
            seq = rc(seq)
        parts.append({'name': f'insert{i}', 'sequence': seq, 'circular': False})
        kept.append(left + body)
    expected = ''.join(kept)
    frags = []
    for p in parts:
        frags += usable_fragments(p['sequence'], p['circular'], enzyme_name)
    product = chain(frags)
    assert product is not None and same_circle(product, expected), f'pydna does not rebuild {name}'
    return {'name': name, 'enzyme': enzyme_name, 'parts': parts, 'expected': expected}


def golden_gate_cases(rng):
    return [
        golden_gate_case(rng, 'bsai-1-insert', 'BsaI', 1),
        golden_gate_case(rng, 'bsai-2-inserts', 'BsaI', 2),
        golden_gate_case(rng, 'bsai-3-inserts', 'BsaI', 3),
        golden_gate_case(rng, 'bsai-3-inserts-origin-in-overhang', 'BsaI', 3, rot=2),
        golden_gate_case(rng, 'bsai-3-inserts-origin-in-site', 'BsaI', 3, rot=5),
        golden_gate_case(rng, 'bsai-2-inserts-origin-before-site', 'BsaI', 2, rot=9),
        golden_gate_case(rng, 'bsai-2-inserts-one-reversed', 'BsaI', 2, flip=(2,)),
        golden_gate_case(rng, 'bsai-3-inserts-all-reversed', 'BsaI', 3, flip=(2, 3, 4)),
        golden_gate_case(rng, 'bsmbi-3-inserts', 'BsmBI', 3),
        golden_gate_case(rng, 'bsmbi-2-inserts-origin-in-site', 'BsmBI', 2, rot=4),
        golden_gate_case(rng, 'bsmbi-2-inserts-reversed', 'BsmBI', 2, flip=(3,)),
        golden_gate_case(rng, 'bbsi-2-inserts', 'BbsI', 2),
        golden_gate_case(rng, 'bbsi-2-inserts-origin-in-site', 'BbsI', 2, rot=6),
        golden_gate_case(rng, 'bbsi-3-inserts-reversed', 'BbsI', 3, flip=(2,)),
        golden_gate_case(rng, 'sapi-2-inserts', 'SapI', 2),
        golden_gate_case(rng, 'sapi-2-inserts-origin-in-site', 'SapI', 2, rot=3),
        golden_gate_case(rng, 'sapi-3-inserts-reversed', 'SapI', 3, flip=(3,)),
    ]


# --- In-Fusion / NEBuilder overlap primers -------------------------------------

TAIL = {'in-fusion': 15, 'nebuilder': 20}


def overlap_case(rng, name, kit, vlen, tlen, start, end, template_circular=False):
    vector = random_dna(rng, vlen)
    template = random_dna(rng, tlen)
    insert = (template + template)[start:end] if end > tlen else template[start:end]
    tail = TAIL[kit]
    amplicon = vector[-tail:] + insert + vector[:tail]
    # canonical primers: the kit's tail over the first and last 22 bases of the insert
    anneal = 22
    fwd = vector[-tail:] + insert[:anneal]
    rev = rc(vector[:tail]) + rc(insert[-anneal:])
    amp = pydna_pcr(Primer(fwd), Primer(rev), Dseqrecord(template, circular=template_circular), limit=15)
    assert str(amp.seq).upper() == amplicon, f'pydna amplicon differs for {name}'
    joined = Assembly([Dseqrecord(vector), Dseqrecord(amplicon)], limit=tail).assemble_circular()
    assert any(same_circle(str(r.seq).upper(), vector + insert) for r in joined), f'pydna Gibson differs for {name}'
    return {
        'name': name,
        'kit': kit,
        'vector': vector,
        'template': template,
        'templateCircular': template_circular,
        'region': {'start': start, 'end': end},
        'amplicon': amplicon,
        'product': vector + insert,
    }


def overlap_cases(rng):
    return [
        overlap_case(rng, 'in-fusion-basic', 'in-fusion', 900, 1500, 300, 800),
        overlap_case(rng, 'nebuilder-basic', 'nebuilder', 900, 1500, 300, 800),
        overlap_case(rng, 'in-fusion-short-insert', 'in-fusion', 900, 1500, 300, 360),
        overlap_case(rng, 'nebuilder-insert-at-start', 'nebuilder', 900, 1500, 0, 600),
        overlap_case(rng, 'nebuilder-insert-at-end', 'nebuilder', 900, 1500, 900, 1500),
        overlap_case(rng, 'nebuilder-circular-template', 'nebuilder', 900, 1500, 300, 800, True),
        overlap_case(rng, 'nebuilder-insert-across-origin', 'nebuilder', 900, 1500, 1300, 1700, True),
        overlap_case(rng, 'in-fusion-insert-across-origin', 'in-fusion', 900, 1500, 1200, 1650, True),
    ]


def generate():
    rng = rng_for(SEED)
    return {
        'gibson': gibson_cases(rng),
        'goldenGate': golden_gate_cases(rng),
        'overlapPrimers': overlap_cases(rng),
    }
