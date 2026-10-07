"""Digests and ligations by pydna and Bio.Restriction, for src/test/oracle/digest.json.

restriction.json already pins where each enzyme cuts. This pins what a digest
makes of it: the top-strand sequence of every fragment, how its two ends
look (kind of overhang and its bases read along the top strand), and what
joining fragments gives, all from pydna's Dseq.cut and Dseq + / looped(). The
fragment ends are read off pydna's watson, crick and ovhg directly rather
than through its helper functions.

Left out on purpose: host methylation (dam/dcm; issue #135) and enzymes imported
from REBASE (issue #136).
"""
import hashlib

from Bio import Restriction
from Bio.Data.IUPACData import ambiguous_dna_values
from Bio.Seq import Seq
from pydna.dseqrecord import Dseqrecord

from common import fixture_sequence, random_dna, rc, rng_for, rotate

SEED = 20261007
FIXTURES = {
    'pUC19': 'L09137.gb',
    'pBR322': 'J01749.gb',
    'phiX174': 'NC_001422.1.gb',
    'AF177870': 'AF177870.gb',
    'U49845': 'U49845.gb',
}


def sha(top):
    return hashlib.sha1(top.upper().encode()).hexdigest()[:12]


def describe_ends(dseq):
    """Both ends of a pydna Dseq as PlasmidPop describes them: kind and overhang along the top strand."""
    w = str(dseq.watson).upper()
    c = str(dseq.crick).upper()
    ovhg = dseq.ovhg
    # the crick strand starts (at its 3' end) -ovhg bases to the right of watson's 5' end
    if ovhg < 0:
        left = {'kind': "5'", 'overhang': w[:-ovhg]}
    elif ovhg > 0:
        left = {'kind': "3'", 'overhang': rc(c[-ovhg:])}
    else:
        left = {'kind': 'blunt', 'overhang': ''}
    crick_end = len(c) - ovhg  # where the crick strand ends on the right, in watson coordinates
    if crick_end < len(w):
        right = {'kind': "3'", 'overhang': w[crick_end:]}
    elif crick_end > len(w):
        right = {'kind': "5'", 'overhang': rc(c[: crick_end - len(w)])}
    else:
        right = {'kind': 'blunt', 'overhang': ''}
    # the helper functions must agree on the kinds
    k5, _ = dseq.five_prime_end()
    k3, _ = dseq.three_prime_end()
    want = {'blunt': 'blunt', "5'": "5'", "3'": "3'"}
    assert want[k5] == left['kind'] and want[k3] == right['kind'], 'ends disagree with pydna helpers'
    return left, right


def fragment_record(dseq):
    top = str(dseq.watson).upper()
    left, right = describe_ends(dseq)
    return {'length': len(top), 'sha': sha(top), 'left': left, 'right': right}


def enzyme(name):
    return getattr(Restriction, name)


def record_for(key, seq, circular):
    return Dseqrecord(seq, circular=circular)


# (source, topology, rotation, enzymes)
DIGESTS = [
    ('pUC19', 'circular', 0, ['EcoRI']),
    ('pUC19', 'circular', 0, ['HindIII']),
    ('pUC19', 'circular', 0, ['EcoRI', 'HindIII']),
    ('pUC19', 'circular', 0, ['KpnI', 'SacI']),
    ('pUC19', 'circular', 0, ['PstI']),
    ('pUC19', 'circular', 0, ['BamHI', 'SmaI']),
    ('pUC19', 'circular', 0, ['AlwNI']),
    ('pUC19', 'circular', 0, ['BsaI']),
    ('pUC19', 'circular', 0, ['HaeII']),
    ('pUC19', 'circular', 0, ['NdeI', 'AatII', 'SphI']),
    ('pUC19', 'circular', 0, ['XbaI', 'HincII']),
    ('pUC19', 'circular', 2680, ['EcoRI']),
    ('pUC19', 'circular', 2685, ['EcoRI', 'HindIII']),
    ('pUC19', 'circular', 400, ['BsaI']),
    ('pUC19', 'linear', 0, ['EcoRI', 'HindIII']),
    ('pUC19', 'linear', 0, ['HaeII', 'PstI']),
    ('pUC19', 'linear', 0, ['AlwNI', 'NdeI']),
    ('pBR322', 'circular', 0, ['EcoRI', 'BamHI', 'PstI', 'SalI']),
    ('pBR322', 'circular', 0, ['EcoRI', 'PstI']),
    ('pBR322', 'circular', 0, ['HindIII', 'AvaI']),
    ('pBR322', 'circular', 0, ['MspI']),
    ('pBR322', 'circular', 0, ['HinfI']),
    ('pBR322', 'circular', 0, ['TaqI']),
    ('pBR322', 'circular', 0, ['HaeII']),
    ('pBR322', 'circular', 0, ['PvuII', 'EcoRV']),
    ('pBR322', 'circular', 0, ['BsaI']),
    ('pBR322', 'circular', 0, ['BsaI', 'PvuI']),
    ('pBR322', 'circular', 0, ['FokI']),
    ('pBR322', 'circular', 0, ['BglI']),
    ('pBR322', 'circular', 0, ['MmeI']),
    ('pBR322', 'circular', 0, ['BpmI', 'BsgI']),
    ('pBR322', 'circular', 0, ['SfiI']),
    ('pBR322', 'circular', 0, ['EcoO109I', 'DrdI']),
    ('pBR322', 'circular', 1500, ['AvaI', 'HincII']),
    ('pBR322', 'circular', 4300, ['PstI', 'SalI']),
    ('pBR322', 'linear', 0, ['EcoRI', 'PstI']),
    ('pBR322', 'linear', 0, ['FokI', 'TaqI']),
    ('pBR322', 'linear', 0, ['MspI']),
    ('phiX174', 'circular', 0, ['HaeIII']),
    ('phiX174', 'circular', 0, ['PstI', 'AccI', 'HincII']),
    ('phiX174', 'circular', 0, ['BsaI', 'BsmBI', 'BbsI', 'SapI']),
    ('phiX174', 'circular', 5000, ['HaeIII']),
    ('phiX174', 'linear', 0, ['HaeIII']),
    ('phiX174', 'linear', 0, ['AluI', 'HinfI']),
    ('AF177870', 'linear', 0, ['EcoRI', 'BamHI', 'XhoI']),
    ('AF177870', 'linear', 0, ['HaeIII']),
    ('AF177870', 'linear', 0, ['BsaI', 'BsmBI', 'BbsI', 'SapI']),
]


def source_sequence(source, rotation):
    seq = fixture_sequence(FIXTURES[source])
    return rotate(seq, rotation) if rotation else seq


def digest_cases():
    cases = []
    for source, topology, rotation, names in DIGESTS:
        seq = source_sequence(source, rotation)
        rec = Dseqrecord(seq, circular=topology == 'circular')
        frags = rec.cut(*[enzyme(n) for n in names])
        records = sorted((fragment_record(f.seq) for f in frags), key=lambda r: (r['sha'], r['length']))
        cases.append({
            'source': source, 'fixture': FIXTURES[source], 'topology': topology,
            'rotation': rotation, 'enzymes': names, 'fragments': records,
        })
    return cases


# --- cuts at the origin of a circle ----------------------------------------------

ORIGIN_LABEL_ENZYMES = ['EcoRI', 'BsaI', 'BsmBI', 'SapI', 'BbsI', 'MmeI', 'FokI', 'BglI',
                        'SfiI', 'PstI', 'KpnI', 'SmaI', 'HgaI', 'AlwNI', 'EarI', 'BseRI']
ORIGIN_DIGEST_ENZYMES = ['EcoRI', 'BsaI', 'BsmBI', 'SapI', 'BbsI', 'FokI', 'BglI', 'PstI',
                         'KpnI', 'SmaI', 'HgaI', 'AlwNI', 'MlyI', 'BtsI']


def random_site(rng, e):
    site = ''.join(rng.choice(ambiguous_dna_values[c]) for c in str(e.site))
    return site if rng.random() < 0.5 else rc(site)


def top_cuts(e, seq):
    """0-based cut positions on the top strand of a circle, both orientations
    of the site, by Bio.Restriction (search is 1-based: the first base after the cut)."""
    L = len(seq)
    found = {(p - 1) % L for p in e.search(Seq(seq), linear=False)}
    if not e.is_palindromic():
        # a site on the bottom strand cuts the top strand `bottom - top` bases the other way
        top5, bottom = e.charac[0], e.size + e.charac[1]
        for p in e.search(Seq(seq).reverse_complement(), linear=False):
            found.add((L - (p - 1 + bottom - top5)) % L)
    return sorted(found)


def origin_sequence(rng, e, sites, t, bottom_anchor):  # t: 0..4, the turn from the cut
    """A random circle with `sites` sites, turned so a cut lands within two
    bases of the origin (both strands' cuts are used as the anchor)."""
    filler = lambda n: random_dna(rng, n)
    lin = random_site(rng, e) + filler(rng.randint(30, 60))
    if sites == 2:
        lin += random_site(rng, e) + filler(rng.randint(30, 60))
    L = len(lin)
    cuts = top_cuts(e, lin)
    if not cuts:
        return None
    anchor = cuts[0]
    if bottom_anchor and e.ovhg:
        anchor -= e.ovhg  # the bottom-strand cut, in top-strand coordinates
    rot = (anchor + t - 2) % L
    return rotate(lin, rot)


def origin_cases():
    rng = rng_for(SEED + 2)
    labels, digests = [], []
    for name in ORIGIN_LABEL_ENZYMES:
        e = enzyme(name)
        for t in range(12):
            seq = origin_sequence(rng, e, 1, rng.randint(0, 4), t % 2 == 1)
            if seq is None:
                continue
            L = len(seq)
            cuts = top_cuts(e, seq)
            labels.append({'enzyme': name, 'seq': seq,
                           'cuts': sorted(L if c == 0 else c for c in cuts),
                           'at_origin': 0 in cuts})
    for name in ORIGIN_DIGEST_ENZYMES:
        e = enzyme(name)
        for t in range(12):
            seq = origin_sequence(rng, e, 1 + t % 2, rng.randint(0, 4), t % 4 >= 2)
            if seq is None:
                continue
            try:
                frags = Dseqrecord(seq, circular=True).cut(e)
            except Exception:
                continue  # pydna refuses overlapping adjacent cuts
            digests.append({
                'enzyme': name, 'seq': seq,
                'fragments': sorted((fragment_record(f.seq) for f in frags),
                                    key=lambda r: (r['sha'], r['length'])),
            })
    return labels, digests


# --- ligation ------------------------------------------------------------------


def pick(frags, length):
    found = [f for f in frags if len(f.seq.watson) == length]
    assert len(found) == 1, f'{len(found)} fragments of {length}'
    return found[0]


def join(parts, circular):
    """Join pydna fragments in order, turning each over when it does not fit; returns (flips, product)."""
    flips = [False]
    acc = parts[0]
    for p in parts[1:]:
        try:
            acc = acc + p
            flips.append(False)
        except TypeError:
            acc = acc + p.reverse_complement()
            flips.append(True)
    if circular:
        acc = acc.looped()
    return flips, acc


def ligation_case(name, circular, specs, orient=None):
    """specs: [(source, topology, rotation, enzymes, which)] with which = 'largest' | 'smallest' | index."""
    parts, refs = [], []
    for source, topology, rotation, names, which in specs:
        seq = source_sequence(source, rotation)
        frags = Dseqrecord(seq, circular=topology == 'circular').cut(*[enzyme(n) for n in names])
        frags = sorted(frags, key=lambda f: len(f.seq.watson))
        assert frags, f'{names} does not cut {source}'
        if which == 'internal':  # the one piece with a cut at both ends
            inner = [g for g in frags if 'blunt' not in (g.seq.five_prime_end()[0], g.seq.three_prime_end()[0])]
            f = inner[0]
        elif which == 'largest':
            f = frags[-1]
        elif which == 'smallest':
            f = frags[0]
        else:
            f = frags[which]
        assert sum(len(g.seq.watson) == len(f.seq.watson) for g in frags) == 1
        parts.append(f)
        refs.append({
            'fixture': FIXTURES[source], 'topology': topology, 'rotation': rotation,
            'enzymes': names, 'length': len(f.seq.watson),
        })
    if orient is not None:
        parts = [p.reverse_complement() if o else p for p, o in zip(parts, orient)]
    flips, product = join(parts, circular)
    flips = [bool(a) != bool(b) for a, b in zip(flips, orient or [False] * len(parts))]
    case = {'name': name, 'circular': circular, 'parts': refs, 'flips': flips}
    top = str(product.seq.watson).upper() if not circular else str(product.seq).upper()
    # the product by its SEGUID, which says the same molecule whichever way round and from
    # wherever a circle is read (the SEGUID tests pin the checksum itself)
    case['seguid'] = product.seq.seguid().split('=')[1]
    case['length'] = len(top)
    if not circular:
        case['ends'] = dict(zip(('left', 'right'), describe_ends(product.seq)))
    return case


def ligation_cases():
    puc = lambda en, w: ('pUC19', 'circular', 0, en, w)  # noqa: E731
    pbr = lambda en, w: ('pBR322', 'circular', 0, en, w)  # noqa: E731
    phix = lambda en, w: ('phiX174', 'circular', 0, en, w)  # noqa: E731
    u49 = lambda en, w: ('U49845', 'linear', 0, en, w)  # noqa: E731
    cases = [
        # EcoRI/HindIII directional cloning, vector then insert, insert turned over when needed
        ligation_case('ecori-hindiii-directional', True, [puc(['EcoRI', 'HindIII'], 'largest'), pbr(['EcoRI', 'HindIII'], 'smallest')]),
        ligation_case('ecori-hindiii-insert-reversed', True, [puc(['EcoRI', 'HindIII'], 'largest'), pbr(['EcoRI', 'HindIII'], 'smallest')], [False, True]),
        # BamHI and BglII leave the same 5' GATC: a hybrid site that neither recuts
        ligation_case('bamhi-bglii-hybrid', True, [puc(['BamHI'], 0), u49(['BglII'], 'internal')]),
        ligation_case('bamhi-bglii-hybrid-reversed', True, [puc(['BamHI'], 0), u49(['BglII'], 'internal')], [False, True]),
        ligation_case('bamhi-bcli-bglii-hybrid', True, [puc(['BamHI'], 0), u49(['BclI', 'BglII'], 'internal')]),
        ligation_case('bamhi-sau3ai-insert', True, [puc(['BamHI'], 0), u49(['Sau3AI'], 'smallest')]),
        # blunt ends join either way round
        ligation_case('blunt-smai-pvuii-ecorv', True, [puc(['SmaI'], 0), pbr(['PvuII', 'EcoRV'], 'smallest')]),
        ligation_case('blunt-smai-pvuii-ecorv-reversed', True, [puc(['SmaI'], 0), pbr(['PvuII', 'EcoRV'], 'smallest')], [False, True]),
        ligation_case('blunt-ecorv-hincii', True, [pbr(['EcoRV'], 0), phix(['HincII'], 'smallest')]),
        # 3' overhangs
        ligation_case('pstI-self-closure', True, [puc(['PstI'], 0)]),
        ligation_case('pstI-self-closure-flipped', True, [puc(['PstI'], 0)], [True]),
        ligation_case('kpni-saci-directional', True, [puc(['KpnI', 'SacI'], 'largest'), puc(['KpnI', 'SacI'], 'smallest')]),
        ligation_case('pstI-sali-two-piece', True, [pbr(['PstI', 'SalI'], 'largest'), pbr(['PstI', 'SalI'], 'smallest')]),
        # Type IIS: the fragment keeps the overhang the enzyme made away from its site
        ligation_case('bsai-self-closure', True, [pbr(['BsaI'], 0)]),
        ligation_case('bsai-self-closure-flipped', True, [pbr(['BsaI'], 0)], [True]),
        ligation_case('bsmbi-self-closure', True, [pbr(['BsmBI'], 0)]),
        ligation_case('sapi-self-closure', True, [phix(['SapI'], 0)]),
        ligation_case('sapi-self-closure-flipped', True, [phix(['SapI'], 0)], [True]),
        # origin inside the fragment: a rotated vector
        ligation_case('ecori-hindiii-origin-between', True, [('pUC19', 'circular', 2685, ['EcoRI', 'HindIII'], 'largest'), pbr(['EcoRI', 'HindIII'], 'smallest')]),
        # linear products keep their ends
        ligation_case('linear-ecori-pstI-fragments', False, [pbr(['EcoRI', 'PstI'], 'smallest'), pbr(['EcoRI', 'PstI'], 'largest')], [False, False]),
        ligation_case('linear-hindiii-ecori-vector-insert', False, [puc(['EcoRI', 'HindIII'], 'smallest'), pbr(['EcoRI', 'HindIII'], 'smallest')]),
    ]
    return cases


def generate():
    labels, origin = origin_cases()
    return {'digests': digest_cases(), 'ligations': ligation_cases(),
            'originLabels': labels, 'originDigests': origin}
