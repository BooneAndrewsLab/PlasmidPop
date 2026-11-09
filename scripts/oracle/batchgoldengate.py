"""The Batch page's Golden Gate constructs, judged without our code, for
src/test/oracle/batchGoldenGate.json (item 143, issue #430).

PlasmidPop's batch is run first, in TypeScript, on seeded destinations, templates
and rows (the tutorial's rows among them) with the default settings, and
exports its primers, amplicons and constructs: `scripts/oracle/run.sh
batch-golden-gate` (which sets ORACLE_EXPORT_BATCH_GG to the file read here).
Nothing below uses its answers except as the thing being judged. For each row:

* the tailed PCR: pydna.amplify.pcr, with PlasmidPop's two primers on the
  template. It must give exactly one product, and the product must be the
  amplicon the designer expected;
* route B, pydna: Dseqrecord.cut(enzyme) on the destination and on the
  amplicon, the backbone (the piece with no site left) joined to the insert
  piece (the one with no site left) by Dseqrecord `+`, which refuses ends that
  do not fit, and looped(). pydna's Assembly takes shared sequence, not sticky
  ends, and does not finish on 4-base overhangs, so it is not used;
* route C, Biopython only: Bio.Restriction.search gives the cuts in the
  destination (circular) and the amplicon (linear); the dropout is the stretch
  between the destination's two cuts that holds both recognition sites, and the
  circle is the destination with it replaced by the amplicon from its left
  overhang to its right one. The overhangs are read off the sequence at those
  cuts, never taken from the design;
* PlasmidPop's construct must be the same circle as both, up to rotation and
  strand; the circle must have no site of the enzyme in it, in particular none
  within a site's reach of either junction; the overhangs read at the
  amplicon's two cuts must be the destination's, in one orientation or the
  other; and each primer must read padding, one recognition site, the spacer
  and the overhang (Bio.Restriction.search on the primer).

A row PlasmidPop does not build because the part carries a site of the enzyme
is confirmed when Biopython finds more than the two tail sites on the
amplicon.

A negative control: the same judgement is made on constructs that are made
wrong on purpose (a base changed, one deleted, one added, a stretch of the
insert turned round, a recognition site planted at a junction); each must be
refused, and a correct construct rotated and read from the other strand must be
accepted. Their outcomes are written to the JSON, and the generator stops if one
is not as it must be.

Rows are written only when every check agrees; any disagreement is printed and
the generator exits without writing, so a difference is reported and never
recorded as a pass.
"""
import hashlib
import json
import os
import sys

import Bio
import pydna
from Bio.Restriction import BsaI, BsmBI
from Bio.Seq import Seq
from pydna.amplify import pcr as pydna_pcr
from pydna.dseqrecord import Dseqrecord
from pydna.primer import Primer

from common import ROOT, rc

OUT = os.path.join(ROOT, 'src', 'test', 'oracle', 'batchGoldenGate.json')
ENZYMES = {'BsaI': BsaI, 'BsmBI': BsmBI}
HEAD = 60
ROUTES = ['pydna-cut-join', 'biopython-splice']


def sha256(text):
    return hashlib.sha256(text.upper().encode()).hexdigest()


def to_construct(j, k, strand, n):
    """Where index j of the reference circle falls in a construct that alignment() matched to it."""
    return (j - k) % n if strand == '+' else (n - 1 - j - k) % n


def alignment(reference, construct):
    """(shift, strand) with construct == reference (or its reverse complement) turned by shift, else None."""
    if len(reference) != len(construct):
        return None
    for strand, ref in (('+', reference), ('-', rc(reference))):
        k = (ref + ref).find(construct)
        if k >= 0:
            return k, strand
    return None


# --- Bio.Restriction readings -----------------------------------------------------


def geometry(enzyme):
    """Recognition site, spacer and overhang length, from Bio.Restriction's own attributes."""
    assert enzyme.ovhg < 0 and enzyme.fst5 > 0, f'{enzyme} is not a 5-prime Type IIS cutter'
    return enzyme.site.upper(), enzyme.fst5 - enzyme.size, -enzyme.ovhg


def cuts(enzyme, text, linear):
    """0-based index of the top-strand cut of every site, and which way the site points."""
    site, spacer, ovh = geometry(enzyme)
    n = len(text)
    out = []
    for p in enzyme.search(Seq(text), linear=linear):
        c = (p - 1) % n
        before = ''.join(text[(c - spacer - len(site) + i) % n] for i in range(len(site)))
        after = ''.join(text[(c + ovh + spacer + i) % n] for i in range(len(site)))
        if before == site:
            way = 'forward'
        elif after == rc(site):
            way = 'reverse'
        else:
            raise AssertionError(f'{enzyme} cut {c} has no site beside it')
        out.append((c, way))
    return sorted(out)


def overhang(text, cut, ovh):
    return ''.join(text[(cut + i) % len(text)] for i in range(ovh))


def site_spans(text, enzyme, circular):
    """(start, end) of every recognition site, both strands, from Bio.Restriction's cuts."""
    site, spacer, ovh = geometry(enzyme)
    out = []
    for c, way in cuts(enzyme, text, linear=not circular):
        if way == 'forward':
            out.append(((c - spacer - len(site)) % len(text), (c - spacer) % len(text)))
        else:
            s = (c + ovh + spacer) % len(text)
            out.append((s, (s + len(site)) % len(text)))
    return out


# --- the three routes -----------------------------------------------------------------


def clean(f, enzyme):
    """A fragment with no recognition site left and a sticky end each side."""
    w = str(f.seq).upper()
    site = enzyme.site.upper()
    if site in w or rc(site) in w:
        return False
    return 'blunt' not in (f.seq.five_prime_end()[0], f.seq.three_prime_end()[0])


def route_pydna(destination, amplicon, enzyme):
    """pydna: cut both, join the two clean pieces, loop. Returns the circle (a string) or raises."""
    backbone = [f for f in Dseqrecord(destination, circular=True).cut(enzyme) if clean(f, enzyme)]
    inserts = [f for f in amplicon.cut(enzyme) if clean(f, enzyme)]
    assert len(backbone) == 1, f'pydna: {len(backbone)} backbone pieces'
    assert len(inserts) == 1, f'pydna: {len(inserts)} insert pieces'
    joined = []
    for piece in (inserts[0], inserts[0].reverse_complement()):
        try:
            joined.append((backbone[0] + piece).looped())
        except TypeError:
            continue
    assert len(joined) == 1, f'pydna: the insert fits the backbone {len(joined)} ways'
    assert joined[0].circular
    return str(joined[0].seq).upper()


def route_biopython(destination, amplicon_text, enzyme):
    """Bio.Restriction coordinates only. Returns (circle, facts)."""
    _, _, ovh = geometry(enzyme)
    n = len(destination)
    dest_cuts = cuts(enzyme, destination, linear=False)
    assert len(dest_cuts) == 2, f'{len(dest_cuts)} {enzyme} sites in the destination'
    spans = site_spans(destination, enzyme, circular=True)
    # the dropout runs from one cut round to the other and holds both sites
    start = None
    for (a, _), (b, _) in (dest_cuts, dest_cuts[::-1]):
        length = (b - a) % n
        if all(((s - a) % n) + ((e - s) % n) <= length for s, e in spans):
            start = (a, b, length)
    assert start is not None, 'no stretch between the cuts holds both sites'
    a, b, length = start
    turned = destination[a:] + destination[:a]
    left, right = turned[:ovh], turned[length : length + ovh]
    backbone = turned[length + ovh :]
    for strand, text in (('as amplified', amplicon_text), ('turned', rc(amplicon_text))):
        found = cuts(enzyme, text, linear=True)
        if len(found) != 2:
            raise AssertionError(f'{len(found)} {enzyme} sites on the amplicon')
        (x, _), (y, _) = found
        if overhang(text, x, ovh) == left and overhang(text, y, ovh) == right:
            circle = text[x : y + ovh] + backbone
            # the junctions, in the circle's own coordinates: the middle of the left
            # overhang and the middle of the right one
            junctions = [ovh // 2, y - x + ovh // 2]
            return circle, {
                'left': left,
                'right': right,
                'strand': strand,
                'junctions': junctions,
                'amplicon_cuts': [x, y],
            }
    raise AssertionError(f'the amplicon\'s overhangs are not the destination\'s ({left}, {right})')


def sites_near(circle, enzyme, junctions, reach):
    """Recognition sites of the enzyme in the circle, and how many reach within `reach` bases of a junction."""
    n = len(circle)
    spans = site_spans(circle, enzyme, circular=True)
    near = 0
    for s, e in spans:
        covered = [(s + q) % n for q in range((e - s) % n or n)]
        if any(min((p - j) % n, (j - p) % n) < reach for p in covered for j in junctions):
            near += 1
    return len(spans), near


def read_tail(primer, enzyme):
    """Bio.Restriction on the primer: (sites found, padding, overhang read after the spacer)."""
    site, spacer, ovh = geometry(enzyme)
    found = cuts(enzyme, primer, linear=True)
    if len(found) != 1 or found[0][1] != 'forward':
        return len(found), None, None
    c = found[0][0]
    return 1, c - spacer - len(site), primer[c : c + ovh]


# --- the judgement -------------------------------------------------------------------------


def judge(batch, row, construct, enzyme_name, junction_hint=None):
    """Every check on one row. Returns (facts, problems); problems is empty when all agree.

    The junctions of the construct are found by matching it to the Biopython circle;
    a control that is wrong on purpose may not match, and gives them as `junction_hint`.
    """
    enzyme = ENZYMES[enzyme_name]
    site, spacer, ovh = geometry(enzyme)
    problems = []
    fwd, rev = row['forward'].upper(), row['reverse'].upper()

    template_name = row['template']
    tpl = next(t for t in batch['templates'] if t['name'] == template_name) if template_name else None
    amplicon_text = row['amplicon'].upper()
    # the PCR: bare-sequence rows have a template of their own (see run_rows), given here
    amplified = pydna_pcr(
        Primer(fwd), Primer(rev), Dseqrecord(tpl['sequence'], circular=tpl['circular']), limit=15
    )
    pcr_text = str(amplified.seq).upper()
    if pcr_text != amplicon_text and rc(pcr_text) != amplicon_text:
        problems.append("the pydna PCR product is not the designer's amplicon")
    facts = {'pcrProducts': 1}

    # the primers' tails
    tails = []
    for name, p in (('forward', fwd), ('reverse', rev)):
        found, padding, read = read_tail(p, enzyme)
        tails.append({'sitesFound': found, 'padding': padding, 'overhang': read})
        # a part PlasmidPop refuses carries a site of its own, which may sit in a primer too
        if found != 1 and construct is not None:
            problems.append(f'{name} primer: {found} {enzyme_name} sites read by Bio.Restriction')
    facts['tails'] = tails

    # the amplicon, read with the forward primer first
    oriented = pcr_text if pcr_text.startswith(fwd) else rc(pcr_text)
    sites_on_amplicon = len(cuts(enzyme, oriented, linear=True))
    facts['sitesOnAmplicon'] = sites_on_amplicon

    if construct is None:
        if sites_on_amplicon <= 2:
            problems.append('PlasmidPop built no circle but the amplicon has no extra site')
        return facts, problems

    # the circles
    try:
        circle_b = route_pydna(batch['destination']['sequence'].upper(), amplified, enzyme)
    except (AssertionError, TypeError) as e:
        problems.append(f'pydna route: {e}')
        circle_b = None
    try:
        circle_c, info = route_biopython(batch['destination']['sequence'].upper(), oriented, enzyme)
    except AssertionError as e:
        problems.append(f'Biopython route: {e}')
        return facts, problems
    construct = construct.upper()
    for label, circle in (('pydna', circle_b), ('Biopython', circle_c)):
        if circle is not None and alignment(circle, construct) is None:
            problems.append(f'PlasmidPop\'s construct is not the {label} circle')
    if circle_b is not None and alignment(circle_b, circle_c) is None:
        problems.append('pydna and Biopython disagree about the circle')

    # no site anywhere in PlasmidPop's own construct, and none at a junction; the
    # junctions are where the Biopython circle puts them, mapped onto the construct
    mapped = alignment(circle_c, construct)
    n = len(construct)
    junctions = list(junction_hint or [])
    if mapped is not None:
        k, strand = mapped
        junctions = [to_construct(j, k, strand, n) for j in info['junctions']]
    total, near = sites_near(construct, enzyme, junctions, len(site))
    facts.update({'sitesInProduct': total, 'sitesAtJunctions': near})
    if total or near:
        problems.append(f'{total} {enzyme_name} sites remain in the construct ({near} at a junction)')

    # the overhangs: the amplicon's equal the destination's; the primers carry them
    left, right = info['left'], info['right']
    f_oh, r_oh = tails[0]['overhang'], rc(tails[1]['overhang'] or '')
    if (f_oh, r_oh) == (left, right):
        facts['orientation'] = 'forward'
    elif (f_oh, r_oh) == (rc(right), rc(left)):
        facts['orientation'] = 'reverse'
    else:
        problems.append(f'primer overhangs {f_oh}/{r_oh} are not the destination\'s {left}/{right}')
    facts['overhangs'] = {'left': f_oh, 'right': r_oh}
    facts['destinationOverhangs'] = {'left': left, 'right': right}
    return facts, problems


# --- the controls -------------------------------------------------------------------------------


def corruptions(construct, circle, junction):
    """Wrong constructs made from a right one: (kind, text, expectedAccepted)."""
    n = len(construct)
    mid = n // 2
    flip = {'A': 'C', 'C': 'G', 'G': 'T', 'T': 'A'}
    k, strand = alignment(circle, construct)
    turned = (circle + circle)[k : k + n] if strand == '+' else (rc(circle) + rc(circle))[k : k + n]
    assert turned == construct
    other = rc(construct[mid:] + construct[:mid])
    letters = list(construct)
    for i, base in enumerate('GGTCTC'):
        letters[(junction + i) % n] = base
    planted = ''.join(letters)
    return [
        ('one base changed', construct[:mid] + flip[construct[mid]] + construct[mid + 1 :], False),
        ('one base deleted', construct[:mid] + construct[mid + 1 :], False),
        ('one base added', construct[:mid] + 'A' + construct[mid:], False),
        (
            'a stretch of 60 bases turned round',
            construct[: mid - 30] + rc(construct[mid - 30 : mid + 30]) + construct[mid + 30 :],
            False,
        ),
        ('a recognition site planted at the junction', planted, False),
        ('the right construct, rotated and read from the other strand', other, True),
    ]


# --- the run ---------------------------------------------------------------------------------------


def generate():
    path = os.environ.get('ORACLE_EXPORT_BATCH_GG')
    if not path or not os.path.exists(path):
        raise SystemExit('run scripts/oracle/run.sh batch-golden-gate (it exports PlasmidPop\'s side first)')
    with open(path, encoding='utf-8') as f:
        exported = json.load(f)
    disagreements = []
    batches = []
    controls = []
    for batch in exported['batches']:
        assert batch['refused'] is None and batch['rowsNotRun'] == 0, batch['id']
        recorded = []
        table = parse_table(batch['table'])
        for row in batch['rows']:
            assert row['status'] == 'designed', (batch['id'], row)
            cells = table[row['name']]
            enzyme_name = row['enzyme']
            assert enzyme_name == batch['enzyme']
            case = {**row, 'template': cells['template']}
            if case['template'] == '':
                # a bare sequence is its own template; the primers anneal to it
                case['template'] = f"bare:{row['name']}"
                batch = {**batch, 'templates': batch['templates'] + [
                    {'name': case['template'], 'sequence': cells['sequence'], 'circular': False}
                ]}
            facts, problems = judge(batch, case, row['construct'], enzyme_name)
            where = f"{batch['id']} {row['name']}"
            if problems:
                disagreements.append((where, problems))
                continue
            built = row['construct'] is not None
            recorded.append({
                'name': row['name'],
                'forward': row['forward'],
                'reverse': row['reverse'],
                'paddings': [len(s['padding']) for s in row['segments']],
                'amplicon': {'length': len(row['amplicon']), 'sha256': sha256(row['amplicon'])},
                'construct': (
                    {'length': len(row['construct']), 'sha256': sha256(row['construct']),
                     'head': row['construct'][:HEAD].upper()}
                    if built else None
                ),
                'warnings': row['warnings'],
                'oracle': {
                    'confirmed': True,
                    'built': built,
                    'routes': ROUTES if built else [],
                    **facts,
                },
            })
            if built and not controls and row['name'] == 'gene_head':
                controls = run_controls(batch, case, row, enzyme_name)
        batches.append({
            'id': batch['id'],
            'kind': batch['kind'],
            'enzyme': batch['enzyme'],
            'destination': batch['destination'],
            'templates': [t for t in batch['templates'] if not t['name'].startswith('bare:')],
            'table': batch['table'],
            'overhangs': batch['overhangs'],
            'rows': recorded,
        })
    if disagreements:
        for where, problems in disagreements:
            print(f'DISAGREEMENT {where}:', *problems, sep='\n  ')
        raise SystemExit(f'{len(disagreements)} rows disagree with the oracle; nothing written')
    assert controls and all(c['accepted'] == c['expectedAccepted'] for c in controls), controls
    # the planted site must be caught by the site check itself, not only by the circle comparison
    planted = next(c for c in controls if c['kind'].startswith('a recognition site'))
    assert any('at a junction)' in r and '(0 at' not in r for r in planted['reasons']), planted
    return {
        'biopython': Bio.__version__,
        'pydna': pydna.__version__,
        'seed': exported['seed'],
        'controls': controls,
        'batches': batches,
    }


def run_controls(batch, case, row, enzyme_name):
    enzyme = ENZYMES[enzyme_name]
    construct = row['construct'].upper()
    circle, info = route_biopython(batch['destination']['sequence'].upper(), orient(case, batch), enzyme)
    # the construct is judged as the rows are; the junction is the one the Biopython circle has
    k, strand = alignment(circle, construct)
    hints = [to_construct(j, k, strand, len(construct)) for j in info['junctions']]
    junction = hints[1] - 3
    out = []
    for kind, text, expected in corruptions(construct, circle, junction):
        facts, problems = judge(batch, case, text, enzyme_name, junction_hint=hints)
        out.append({
            'kind': kind,
            'row': f"{batch['id']} {row['name']}",
            'accepted': not problems,
            'expectedAccepted': expected,
            'reasons': problems,
        })
    return out


def orient(case, batch):
    tpl = next(t for t in batch['templates'] if t['name'] == case['template'])
    amplified = pydna_pcr(
        Primer(case['forward'].upper()), Primer(case['reverse'].upper()),
        Dseqrecord(tpl['sequence'], circular=tpl['circular']), limit=15,
    )
    text = str(amplified.seq).upper()
    return text if text.startswith(case['forward'].upper()) else rc(text)


def parse_table(text):
    """name -> its template and sequence cells, from the CSV the exporter wrote."""
    import csv
    import io

    rows = list(csv.DictReader(io.StringIO(text)))
    return {r['name']: {'template': r['template'], 'sequence': r['sequence']} for r in rows}


def main():
    data = generate()
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=1, sort_keys=True)
        f.write('\n')
    rows = sum(len(b['rows']) for b in data['batches'])
    print(f'wrote {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT) // 1024} KiB), {len(data["batches"])} batches, {rows} rows')
    for c in data['controls']:
        print(f"  control: {c['kind']}: {'accepted' if c['accepted'] else 'refused'}")


if __name__ == '__main__':
    sys.exit(main())
