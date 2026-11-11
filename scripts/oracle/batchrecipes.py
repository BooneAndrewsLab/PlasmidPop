"""The Batch page's restriction-sites and homology-ends recipes, and the Golden
Gate extras, judged without our code, for src/test/oracle/batchRecipes.json
(item 145, issue #431; the method of batchgoldengate.py, item 143).

PlasmidPop's batch is run first, in TypeScript, on seeded vectors, templates and
rows (the tutorial's rows among them), and exports its primers, amplicons and
constructs: `scripts/oracle/run.sh batch-recipes` (which sets
ORACLE_EXPORT_BATCH_RECIPES to the file read here). Nothing below uses its
answers except as the thing being judged. For each row:

* the tailed PCR: pydna.amplify.pcr, with PlasmidPop's two primers on the
  template. One product, equal to the amplicon the designer expected;
* the insert, read from the table and the template by the parser below (a
  region as the batch's table writes it), never from the design.

Restriction sites (a pair of Type II enzymes cutting once each in the vector's
cloning region): route B, pydna: the vector cut with the pair, the shorter piece
(the stretch the insert replaces) dropped, the amplicon cut with the pair, its
piece with a sticky end each side joined to the backbone by Dseqrecord `+`
(which refuses ends that do not fit), either way round, and looped(). Route C,
Biopython only: Bio.Restriction.search gives the cuts; the circle is the vector
from the one cut round to the other with the amplicon between its two cuts,
read the way round that puts each enzyme's end at its own cut of the vector.
Both circles must equal PlasmidPop's construct up to rotation and strand; the
amplicon must read padding, the forward site, extra5, the insert, extra3, the
reverse site and padding, each primer one site of its own enzyme; the
construct's sites must be those of the vector outside the stretch plus the two
the junctions rebuild; the orientation PlasmidPop reports must be the one the
ligation allows.

Homology ends (In-Fusion, NEBuilder HiFi, yeast): the amplicon must be the
vector's last `overlap` bases, the insert and the vector's first `overlap`
bases (each kit's published homology: 15, 20, 40 or the batch's own for yeast);
pydna.assembly.Assembly on the linear vector and the amplicon, at that overlap,
must close into a circle, which must equal PlasmidPop's construct and the
vector followed by the insert.

Golden Gate extras: the judge of batchgoldengate.py (the same pydna and
Biopython routes), on batches with a second enzyme in the tube, a per-row enzyme,
extra5/extra3 and per-row overhangs. A row PlasmidPop builds no circle for is
confirmed by the oracle's own reason: pydna with both enzymes in the tube finds
no single backbone, or the part carries a site of the second enzyme, or the
overhangs the row names are not the destination's (both routes refuse to join).

Controls: the same judgement on constructs made wrong on purpose (a base changed,
deleted or added, a stretch turned round, an unwanted site planted at a
junction for restriction); each must be refused and the right construct, rotated
and read from the other strand, accepted.

Rows are written only when every check agrees; any disagreement is printed and
the generator exits without writing.
"""
import csv
import hashlib
import io
import json
import os
import re
import sys

import Bio
import pydna
from Bio import Restriction
from Bio.Restriction import BsaI, BsmBI
from Bio.Seq import Seq
from pydna.amplify import pcr as pydna_pcr
from pydna.assembly import Assembly
from pydna.dseqrecord import Dseqrecord
from pydna.primer import Primer

import batchgoldengate as gg
from common import ROOT, rc

OUT = os.path.join(ROOT, 'src', 'test', 'oracle', 'batchRecipes.json')
HEAD = 60
# The homology each kit's protocol asks the primer tails to carry (In-Fusion: 15 bases,
# NEBuilder HiFi: 15-20, the yeast recombination assembly: 40 unless the batch says).
KIT_OVERLAP = {'in-fusion': 15, 'nebuilder': 20, 'yeast': 40}
PANEL = ['EcoRI', 'BamHI', 'HindIII', 'NcoI', 'XhoI', 'KpnI', 'PstI', 'NdeI', 'NotI']
RS_ROUTES = ['pydna-cut-join', 'biopython-splice']
HE_ROUTES = ['pydna-assembly', 'sequence-join']


def sha256(text):
    return hashlib.sha256(text.upper().encode()).hexdigest()


def enzyme(name):
    return getattr(Restriction, name)


# --- the table: an insert as the row writes it --------------------------------------------


def parse_table(text):
    rows = list(csv.DictReader(io.StringIO(text)))
    return {r['name']: r for r in rows}


def span(spec, n):
    """0-based half-open pieces [(start, end)] of a region cell (`a-b`, `a..b`, join(...)), 1-based inclusive in."""
    pieces = []
    for a, b in re.findall(r'(\d+)(?:-|\.\.)(\d+)', spec):
        pieces.append((int(a) - 1, int(b)))
    assert pieces, f'unreadable region {spec!r}'
    return pieces


def region_text(cell, template):
    """The insert a row asks for, read off the template; the template is None for a bare row."""
    if cell['template'] == '':
        return cell['sequence'].upper()
    seq = template['sequence'].upper()
    spec = cell['region'].strip()
    if spec == '':
        return seq
    reverse = spec.startswith('complement(')
    body = ''.join(seq[a:b] for a, b in span(spec, len(seq)))
    return rc(body) if reverse else body


# --- shared: the PCR ------------------------------------------------------------------------


def pcr_text(fwd, rev, template, designed_amplicon, problems):
    amplified = pydna_pcr(
        Primer(fwd), Primer(rev), Dseqrecord(template['sequence'], circular=template['circular']), limit=15
    )
    text = str(amplified.seq).upper()
    if text != designed_amplicon and rc(text) != designed_amplicon:
        problems.append("the pydna PCR product is not the designer's amplicon")
    oriented = text if text.startswith(fwd) else rc(text)
    # the product with the forward primer first, so that "as amplified" means what it says
    return (amplified if text == oriented else amplified.reverse_complement()), oriented


# --- restriction sites ----------------------------------------------------------------------


def ii_cuts(enz, text, linear):
    """0-based index of the first base after the top-strand cut, for every site (palindromic Type II)."""
    n = len(text)
    return sorted((p - 1) % n for p in enz.search(Seq(text), linear=linear))


def overhang_read(enz, text, c):
    """The bases the cut leaves single-stranded, as the top strand reads them, as a string and a kind."""
    k = abs(enz.ovhg)
    return ('5' if enz.ovhg < 0 else '3', text[c : c + k] if enz.ovhg < 0 else text[c - k : c])


def cut_pieces(dseq, enzymes):
    return dseq.cut(*enzymes)


def sticky_both(f):
    return 'blunt' not in (f.seq.five_prime_end()[0], f.seq.three_prime_end()[0])


def rs_pydna(vector, amplified, e_f, e_r):
    """pydna: the vector cut with both, the shorter piece dropped, the amplicon's sticky piece joined in."""
    pieces = Dseqrecord(vector, circular=True).cut(e_f, e_r)
    assert len(pieces) == 2, f'pydna: the vector falls into {len(pieces)} pieces'
    pieces = sorted(pieces, key=len)
    backbone = pieces[1]
    inserts = [f for f in amplified.cut(e_f, e_r) if sticky_both(f)]
    assert len(inserts) == 1, f'pydna: {len(inserts)} insert pieces'
    joined = []
    for label, piece in (('as amplified', inserts[0]), ('turned', inserts[0].reverse_complement())):
        try:
            joined.append((label, (backbone + piece).looped()))
        except TypeError:
            continue
    assert len(joined) == 1, f'pydna: the insert fits the backbone {len(joined)} ways'
    return str(joined[0][1].seq).upper(), joined[0][0], len(pieces[0])


def rs_biopython(vector, oriented, e_f, e_r):
    """Bio.Restriction coordinates only. Returns (circle, facts)."""
    n = len(vector)
    cf = ii_cuts(e_f, vector, linear=False)
    cr = ii_cuts(e_r, vector, linear=False)
    assert len(cf) == 1 and len(cr) == 1, f'the vector has {len(cf)} {e_f} and {len(cr)} {e_r} sites'
    # the stretch the insert replaces is the shorter way round from one cut to the other
    arcs = {'F': (cr[0] - cf[0]) % n, 'R': (cf[0] - cr[0]) % n}
    first = 'F' if arcs['F'] <= arcs['R'] else 'R'
    a, b = (cf[0], cr[0]) if first == 'F' else (cr[0], cf[0])
    start_enz, end_enz = (e_f, e_r) if first == 'F' else (e_r, e_f)
    length = (b - a) % n
    turned = vector[a:] + vector[:a]
    backbone = turned[length:]
    for label, text in (('as amplified', oriented), ('turned', rc(oriented))):
        fx = ii_cuts(e_f, text, linear=True)
        rx = ii_cuts(e_r, text, linear=True)
        if len(fx) != 1 or len(rx) != 1:
            raise AssertionError(f'{len(fx)} {e_f} and {len(rx)} {e_r} sites on the amplicon')
        ends = sorted([(fx[0], e_f), (rx[0], e_r)], key=lambda t: t[0])
        (x, left_enz), (y, right_enz) = ends
        if left_enz is start_enz and right_enz is end_enz:
            # the ends must fit: the single strand each cut leaves reads the same on both sides
            fit = overhang_read(start_enz, vector, a) == overhang_read(start_enz, text, x) and overhang_read(
                end_enz, vector, b
            ) == overhang_read(end_enz, text, y)
            if not fit:
                continue
            circle = text[x:y] + backbone
            return circle, {
                'orientation': 'forward' if label == 'as amplified' else 'reverse',
                'junctions': [0, y - x],
                'replaced': length,
                'backbone': backbone,
                'insert': text[x:y],
            }
    raise AssertionError("no way round makes the amplicon's ends the vector's")


def panel_counts(text, linear):
    return {name: len(ii_cuts(enzyme(name), text, linear)) for name in PANEL}


def check_sites(construct, circle_info, e_f, e_r, junctions, problems):
    """The construct's sites: the two the junctions rebuild, and the backbone's own, no more."""
    n = len(construct)
    # sites the vector's backbone and the insert piece (the part, its extra bases) have by themselves
    expected = {
        name: a + b
        for (name, a), b in zip(
            panel_counts(circle_info['backbone'], linear=True).items(),
            panel_counts(circle_info['insert'], linear=True).values(),
        )
    }
    found = panel_counts(construct, linear=False)
    for name in PANEL:
        want = expected[name] + (1 if name in (str(e_f), str(e_r)) else 0)
        if found[name] != want:
            problems.append(f'{found[name]} {name} sites in the construct, the vector and the junctions give {want}')
    for enz in (e_f, e_r):
        for c in ii_cuts(enz, construct, linear=False):
            reach = len(enz.site) + 1
            if not any(min((c - j) % n, (j - c) % n) <= reach for j in junctions):
                problems.append(f'{enz} cuts at {c}, away from both junctions')
    return {'sitesInProduct': sum(found.values())}


def tail_read(primer, enz):
    """(sites found, padding, text after the site) of a primer, by Bio.Restriction."""
    c = ii_cuts(enz, primer, linear=True)
    if len(c) != 1:
        return len(c), None, None
    start = c[0] - enz.fst5
    return 1, start, primer[start + len(enz.site) :]


def judge_restriction(batch, row, cell, template, construct, junction_hint=None):
    problems = []
    fwd, rev = row['forward'].upper(), row['reverse'].upper()
    e_f, e_r = enzyme(row['enzymes'][0]), enzyme(row['enzymes'][1])
    extra5 = (cell['left'] or batch['settings'].get('extra5', '')).upper()
    extra3 = (cell['right'] or batch['settings'].get('extra3', '')).upper()
    region = region_text(cell, template)
    amplified, oriented = pcr_text(fwd, rev, template, row['amplicon'].upper(), problems)
    facts = {'pcrProducts': 1}

    # the tails, read by Bio.Restriction, and the amplicon they make
    tails = []
    for label, primer, enz, extra, anneal_from in (
        ('forward', fwd, e_f, extra5, region),
        ('reverse', rev, e_r, rc(extra3), rc(region)),
    ):
        found, padding, after = tail_read(primer, enz)
        tails.append({'sitesFound': found, 'padding': padding})
        if found != 1:
            problems.append(f'{label} primer: {found} {enz} sites')
            continue
        if not after.startswith(extra):
            problems.append(f'{label} primer: the extra bases {extra!r} do not follow the site')
        anneal = after[len(extra) :]
        if len(anneal) < 15 or not anneal_from.startswith(anneal):
            problems.append(f'{label} primer: the 3-prime {len(anneal)} bases are not the insert\'s end')
    facts['tails'] = tails
    if problems:
        return facts, problems
    # padding, site, extra5, insert, extra3, site, padding
    pad_f, pad_r = tails[0]['padding'], tails[1]['padding']
    want = fwd[: pad_f + len(e_f.site)] + extra5 + region + extra3 + rc(rev[pad_r : pad_r + len(e_r.site)]) + rc(rev[:pad_r])
    if oriented != want:
        problems.append('the amplicon is not padding, site, extra5, the insert, extra3, site, padding')
    facts['extra'] = [extra5, extra3]

    vector = batch['vector']['sequence'].upper()
    try:
        circle_b, way, stuffer = rs_pydna(vector, amplified, e_f, e_r)
    except (AssertionError, TypeError) as e:
        problems.append(f'pydna route: {e}')
        circle_b = None
        way = None
    try:
        circle_c, info = rs_biopython(vector, oriented, e_f, e_r)
    except AssertionError as e:
        problems.append(f'Biopython route: {e}')
        return facts, problems
    construct = construct.upper()
    for label, circle in (('pydna', circle_b), ('Biopython', circle_c)):
        if circle is not None and gg.alignment(circle, construct) is None:
            problems.append(f"PlasmidPop's construct is not the {label} circle")
    if circle_b is not None and gg.alignment(circle_b, circle_c) is None:
        problems.append('pydna and Biopython disagree about the circle')
    if way is not None and way != ('as amplified' if info['orientation'] == 'forward' else 'turned'):
        problems.append('pydna and Biopython disagree about the way round the insert goes')
    facts['orientation'] = info['orientation']

    mapped = gg.alignment(circle_c, construct)
    n = len(construct)
    junctions = list(junction_hint or [])
    if mapped is not None:
        k, strand = mapped
        junctions = [gg.to_construct(j, k, strand, n) for j in info['junctions']]
    facts.update(check_sites(construct, info, e_f, e_r, junctions, problems))
    return facts, problems


# --- homology ends ----------------------------------------------------------------------------


def he_overlap(batch, kit):
    if kit == 'yeast':
        return batch['recipe'].get('overlap', KIT_OVERLAP['yeast'])
    return KIT_OVERLAP[kit]


def judge_homology(batch, row, cell, template, construct):
    problems = []
    fwd, rev = row['forward'].upper(), row['reverse'].upper()
    kit = row['kit']
    ov = he_overlap(batch, kit)
    vector = batch['vector']['sequence'].upper()
    region = region_text(cell, template)
    amplified, oriented = pcr_text(fwd, rev, template, row['amplicon'].upper(), problems)
    facts = {'pcrProducts': 1, 'overlap': ov}
    if not fwd.startswith(vector[-ov:]):
        problems.append("the forward primer does not begin with the vector's last bases")
    if not rev.startswith(rc(vector[:ov])):
        problems.append("the reverse primer does not begin with the reverse complement of the vector's first bases")
    if oriented != vector[-ov:] + region + vector[:ov]:
        problems.append("the amplicon is not the vector's end, the insert and the vector's start")
    # pydna: the vector and the amplicon, joined on the overlap
    circles = Assembly([Dseqrecord(vector), amplified], limit=ov).assemble_circular()
    texts = [str(c.seq).upper() for c in circles]
    if not texts:
        problems.append('pydna Assembly makes no circle of the vector and the amplicon')
    joined = vector + region
    construct = construct.upper()
    for t in texts:
        if gg.alignment(joined, t) is None:
            problems.append('a pydna circle is not the vector followed by the insert')
    if gg.alignment(joined, construct) is None:
        problems.append("PlasmidPop's construct is not the vector followed by the insert")
    if texts and gg.alignment(texts[0], construct) is None:
        problems.append("PlasmidPop's construct is not the pydna Assembly's circle")
    return facts, problems, joined


# --- the controls -------------------------------------------------------------------------------


def corruptions(construct, circle, plant=None):
    n = len(construct)
    mid = n // 2
    flip = {'A': 'C', 'C': 'G', 'G': 'T', 'T': 'A'}
    k, strand = gg.alignment(circle, construct)
    other = rc(construct[mid:] + construct[:mid])
    out = [
        ('one base changed', construct[:mid] + flip[construct[mid]] + construct[mid + 1 :], False),
        ('one base deleted', construct[:mid] + construct[mid + 1 :], False),
        ('one base added', construct[:mid] + 'A' + construct[mid:], False),
        (
            'a stretch of 60 bases turned round',
            construct[: mid - 30] + rc(construct[mid - 30 : mid + 30]) + construct[mid + 30 :],
            False,
        ),
    ]
    if plant is not None:
        text, junction = plant
        letters = list(construct)
        for i, base in enumerate(text):
            letters[(junction + i) % n] = base
        out.append(('an unwanted recognition site planted at a junction', ''.join(letters), False))
    out.append(('the right construct, rotated and read from the other strand', other, True))
    return out


# --- the run ----------------------------------------------------------------------------------------


def cells_of(batch):
    table = parse_table(batch['table'])
    templates = {t['name']: t for t in batch['templates']}
    return table, templates


def case_template(cell, templates):
    if cell['template'] == '':
        return {'name': f"bare:{cell['name']}", 'sequence': cell['sequence'].upper(), 'circular': False}
    return templates[cell['template']]


def routes_of(recipe):
    return HE_ROUTES if recipe == 'homology' else RS_ROUTES


def record(row, built, routes, facts):
    return {
        'name': row['name'],
        'forward': row['forward'],
        'reverse': row['reverse'],
        'amplicon': {'length': len(row['amplicon']), 'sha256': sha256(row['amplicon'])},
        'construct': (
            {
                'length': len(row['construct']),
                'sha256': sha256(row['construct']),
                'head': row['construct'][:HEAD].upper(),
            }
            if built
            else None
        ),
        'warnings': row['warnings'],
        'status': 'designed',
        'oracle': {'confirmed': True, 'built': built, 'routes': routes if built else [], **facts},
    }


def judge_golden_gate(batch, row, cell, template, tubes):
    """The judge of item 143 for a row of a Golden Gate batch; `tubes` are every enzyme in the tube."""
    problems = []
    name = row['enzyme']
    construct = row['construct']
    second = batch['recipe'].get('secondEnzyme')
    both = [name] + ([second] if second else [])
    if cell['enzyme']:
        both = [x.strip() for x in cell['enzyme'].split('/')]
        assert both[0] == name, (both, name)
    case = {**row, 'template': template['name']}
    sub = {**batch, 'templates': batch['templates'] + [template], 'enzyme': name, 'destination': {'sequence': batch['vector']['sequence']}}
    destination = batch['vector']['sequence'].upper()
    extra5 = batch['settings'].get('extra5', '').upper()
    extra3 = batch['settings'].get('extra3', '').upper()
    if construct is not None:
        facts, problems = gg.judge(sub, case, construct, name)
        # a second enzyme in the tube must not touch the part or the circle either
        for other in both[1:]:
            e2 = gg.ENZYMES[other]
            cut_amp = len(gg.cuts(e2, row['amplicon'].upper(), linear=True))
            facts['secondEnzymeSites'] = cut_amp
            if cut_amp:
                problems.append(f'{cut_amp} {other} sites on the amplicon, which shares the tube')
            try:
                tube = tube_circle(destination, row, template, both)
                if gg.alignment(tube, construct.upper()) is None:
                    problems.append('pydna, with both enzymes in the tube, makes another circle')
                facts.setdefault('routeTube', True)
            except (AssertionError, TypeError) as e:
                problems.append(f'pydna, both enzymes: {e}')
        # extra bases and the part, as the table writes them, are in the construct
        region = region_text(cell, template)
        left = facts['overhangs']['left'] if 'overhangs' in facts else ''
        right = facts['overhangs']['right'] if 'overhangs' in facts else ''
        circle = construct.upper()
        ring = circle + circle[:200]
        # the designer leaves a stop codon at the region's end out unless the row keeps it (include_stop)
        parts = [region] + ([region[:-3]] if region[-3:] in ('TAA', 'TAG', 'TGA') else [])
        found = [
            i
            for i, part in enumerate(parts)
            if (left + extra5 + part + extra3 + right) in ring
            or rc(left + extra5 + part + extra3 + right) in ring
        ]
        if not found:
            problems.append('the overhangs, extra bases and the part are not in the construct as the table gives them')
        else:
            facts['stopLeftOut'] = bool(found[0])
        facts['extra'] = [extra5, extra3]
        return facts, problems, True
    # no circle: a reason of the oracle's own
    facts = {'pcrProducts': 1}
    amplified = pydna_pcr(
        Primer(row['forward'].upper()),
        Primer(row['reverse'].upper()),
        Dseqrecord(template['sequence'], circular=template['circular']),
        limit=15,
    )
    text = str(amplified.seq).upper()
    if text != row['amplicon'].upper() and rc(text) != row['amplicon'].upper():
        problems.append("the pydna PCR product is not the designer's amplicon")
    reasons = []
    # 1. the part carries a site of an enzyme in the tube (Biopython)
    if any(len(gg.cuts(gg.ENZYMES[e], text, linear=True)) > (2 if e == name else 0) for e in both):
        reasons.append('the amplicon carries a site of an enzyme in the tube beyond its two tail sites')
    # 2. pydna with the tube's enzymes: no single circle; Biopython: the amplicon's overhangs are not the destination's
    pydna_reason = None
    try:
        tube_circle(destination, row, template, both)
    except (AssertionError, TypeError) as e:
        pydna_reason = str(e)
    if pydna_reason is None:
        problems.append('pydna makes a circle where PlasmidPop made none')
    else:
        reasons.append(f'pydna: {pydna_reason}')
    if len(both) == 1:
        try:
            gg.route_biopython(destination, text if text.startswith(row['forward'].upper()) else rc(text), gg.ENZYMES[name])
            problems.append('Biopython splices a circle where PlasmidPop made none')
        except AssertionError as e:
            reasons.append(f'Biopython: {e}')
    if not reasons:
        problems.append('no reason found for the missing circle')
    facts['reason'] = '; '.join(reasons)
    # the overhangs a row names are what the primers carry
    for label, given, primer in (('left', cell['left'], row['forward']), ('right', cell['right'], row['reverse'])):
        if given:
            found = gg.read_tail(primer.upper(), gg.ENZYMES[name])
            want = given.upper() if label == 'left' else rc(given.upper())
            if found[2] != want:
                problems.append(f'the {label} primer carries {found[2]}, not the {given} the row names')
    return facts, problems, False


def tube_circle(destination, row, template, both):
    """pydna: the destination and the amplicon cut with every enzyme of the tube, the one backbone and one insert joined."""
    enzs = [gg.ENZYMES[x] for x in both]
    amplified = pydna_pcr(
        Primer(row['forward'].upper()),
        Primer(row['reverse'].upper()),
        Dseqrecord(template['sequence'], circular=template['circular']),
        limit=15,
    )

    def clean_all(f):
        w = str(f.seq).upper()
        if any(e.site.upper() in w or rc(e.site.upper()) in w for e in enzs):
            return False
        return 'blunt' not in (f.seq.five_prime_end()[0], f.seq.three_prime_end()[0])

    backbone = [f for f in Dseqrecord(destination, circular=True).cut(*enzs) if clean_all(f)]
    inserts = [f for f in amplified.cut(*enzs) if clean_all(f)]
    assert len(backbone) == 1, f'{len(backbone)} backbone pieces without a site, with {" and ".join(both)} in the tube'
    assert len(inserts) == 1, f'{len(inserts)} insert pieces without a site'
    joined = []
    for piece in (inserts[0], inserts[0].reverse_complement()):
        try:
            joined.append((backbone[0] + piece).looped())
        except TypeError:
            continue
    assert len(joined) == 1, f'the insert fits the backbone {len(joined)} ways'
    return str(joined[0].seq).upper()


def generate():
    path = os.environ.get('ORACLE_EXPORT_BATCH_RECIPES')
    if not path or not os.path.exists(path):
        raise SystemExit("run scripts/oracle/run.sh batch-recipes (it exports PlasmidPop's side first)")
    with open(path, encoding='utf-8') as f:
        exported = json.load(f)
    disagreements = []
    batches = []
    controls = []
    for batch in exported['batches']:
        assert batch['refused'] is None and batch['rowsNotRun'] == 0, batch['id']
        recipe = batch['recipe']['recipe']
        table, templates = cells_of(batch)
        recorded = []
        for row in batch['rows']:
            where = f"{batch['id']} {row['name']}"
            if row['status'] != 'designed':
                disagreements.append((where, [f"PlasmidPop did not design the row: {row.get('message')}"]))
                continue
            cell = table[row['name']]
            template = case_template(cell, templates)
            built = row['construct'] is not None
            if recipe == 'restriction':
                assert built, where
                facts, problems = judge_restriction(batch, row, cell, template, row['construct'])
            elif recipe == 'homology':
                assert built, where
                facts, problems, _ = judge_homology(batch, row, cell, template, row['construct'])
            else:
                facts, problems, built = judge_golden_gate(batch, row, cell, template, None)
            if problems:
                disagreements.append((where, problems))
                continue
            routes = routes_of(recipe)
            if recipe == 'golden-gate':
                routes = gg.ROUTES
            recorded.append(record(row, built, routes, facts))
            if built and recipe != 'golden-gate' and not any(c['recipe'] == recipe for c in controls):
                controls += run_controls(batch, recipe, row, cell, template)
        batches.append(
            {
                'id': batch['id'],
                'kind': batch['kind'],
                'recipe': batch['recipe'],
                'settings': batch['settings'],
                'vector': batch['vector'],
                'templates': batch['templates'],
                'table': batch['table'],
                'rows': recorded,
            }
        )
    if disagreements:
        for where, problems in disagreements:
            print(f'DISAGREEMENT {where}:', *problems, sep='\n  ')
        raise SystemExit(f'{len(disagreements)} rows disagree with the oracle; nothing written')
    assert controls and all(c['accepted'] == c['expectedAccepted'] for c in controls), controls
    planted = next(c for c in controls if c['kind'].startswith('an unwanted'))
    assert any('sites in the construct' in r for r in planted['reasons']), planted
    return {
        'biopython': Bio.__version__,
        'pydna': pydna.__version__,
        'seed': exported['seed'],
        'controls': controls,
        'batches': batches,
    }


def run_controls(batch, recipe, row, cell, template):
    construct = row['construct'].upper()
    out = []
    if recipe == 'restriction':
        e_f, e_r = enzyme(row['enzymes'][0]), enzyme(row['enzymes'][1])
        problems = []
        _, oriented = pcr_text(row['forward'].upper(), row['reverse'].upper(), template, row['amplicon'].upper(), problems)
        circle, info = rs_biopython(batch['vector']['sequence'].upper(), oriented, e_f, e_r)
        k, strand = gg.alignment(circle, construct)
        hints = [gg.to_construct(j, k, strand, len(construct)) for j in info['junctions']]
        # a site of a panel enzyme the pair does not use, at the junction
        other = next(e for e in PANEL if e not in (str(e_f), str(e_r)))
        cases = corruptions(construct, circle, plant=(enzyme(other).site, hints[0] - 2))
        for kind, text, expected in cases:
            facts, problems = judge_restriction(batch, row, cell, template, text, junction_hint=hints)
            out.append(control(batch, row, recipe, kind, expected, problems))
    else:
        problems = []
        _, facts_unused, joined = judge_homology(batch, row, cell, template, construct)
        for kind, text, expected in corruptions(construct, joined):
            _, problems, _ = judge_homology(batch, row, cell, template, text)
            out.append(control(batch, row, recipe, kind, expected, problems))
    return out


def control(batch, row, recipe, kind, expected, problems):
    return {
        'kind': kind,
        'recipe': recipe,
        'row': f"{batch['id']} {row['name']}",
        'accepted': not problems,
        'expectedAccepted': expected,
        'reasons': problems,
    }


def main():
    data = generate()
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=1, sort_keys=True)
        f.write('\n')
    rows = sum(len(b['rows']) for b in data['batches'])
    print(f'wrote {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT) // 1024} KiB), {len(data["batches"])} batches, {rows} rows')
    for c in data['controls']:
        print(f"  control: {c['recipe']}: {c['kind']}: {'accepted' if c['accepted'] else 'refused'}")


if __name__ == '__main__':
    sys.exit(main())
