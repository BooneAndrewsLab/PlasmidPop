"""Single edits to a document, for src/test/oracle/editing.json.

Seeded random documents (linear and circular, 12-90 bp, one to four features:
one to three segments, either strand, wrapping the origin, CDS with
/codon_start 1, 2, 3 or absent) each take one edit: delete, insert, replace,
setOrigin or reverseComplement. The expected answer is recorded per feature:
the bases it reads, in reading order, and for a CDS the codons whose reading
frame the edit leaves alone, with their Biopython translation.

How each part is known without trusting PlasmidPop:

* The edited sequence is Biopython Seq slicing and concatenation wherever the
  edit does not wrap the origin of a circle (a wrapping edit's rotation is the
  editor's own convention, held to the base-identity model below).
* Which bases a feature still covers is a base-identity model: every base
  carries an identity, an edit removes, adds or rewrites bases by identity,
  and a feature keeps the bases of its segments that survive (and grows when
  an insertion lands inside one of its segments).
* For reverseComplement the bases come from SeqRecord.reverse_complement(
  features=True), and for setOrigin from pydna's Dseqrecord.shifted(), each
  extracted with SeqFeature.extract; the model has to agree with them.
* The reading frame: the codons of the original CDS (honouring /codon_start,
  on the strand it reads) that lie wholly inside the first stretch of its
  reading that the edit leaves untouched must still be the first codons of the
  edited CDS, so a delete that cuts into the start has to move /codon_start
  (#160). Biopython translates them.

Left out: copying, extracting and pasting a region, where /codon_start is not
moved and the pieces of a wrapping region can come out in the wrong order
(#162), and the first residue of a CDS whose start was cut off, which can show
M for an internal start-like codon (#163): there either residue is accepted.
"""
import warnings

from Bio.Data import CodonTable
from Bio.Seq import Seq
from Bio.SeqFeature import CompoundLocation, SeqFeature, SimpleLocation
from Bio.SeqRecord import SeqRecord
from pydna.dseqrecord import Dseqrecord

from common import rng_for

warnings.simplefilter('ignore')

SEED = 20261007
TABLE1 = CodonTable.unambiguous_dna_by_id[1]
COMP = str.maketrans('ACGT', 'TGCA')


def rnd_bases(rng, n):
    return ''.join(rng.choice('ACGT') for _ in range(n))


def make_feature(rng, L, circular, i):
    nseg = rng.randint(1, 3)
    span = rng.randint(min(L, nseg * 2), L)
    s = rng.randint(0, L - 1) if circular else rng.randint(0, L - span)
    cuts = {0, span}
    while len(cuts) < nseg * 2:
        cuts.add(rng.randint(1, span - 1))
    cuts = sorted(cuts)
    segments = []
    for k in range(0, len(cuts), 2):
        a, b = s + cuts[k], s + cuts[k + 1]
        if circular and a >= L:
            a, b = a - L, b - L
        segments.append([a, b])
    cds = rng.random() < 0.7
    cs = rng.randint(0, 3) if cds else 0
    return {
        'id': f'f{i}',
        'type': 'CDS' if cds else 'misc_feature',
        'strand': 'forward' if rng.random() < 0.5 else 'reverse',
        'segments': segments,
        'codon_start': cs,
    }


def positions(seg, L):
    return [p % L for p in range(seg[0], seg[1])]


def reading(ids_by_seg, strand):
    flat = [x for seg in ids_by_seg for x in seg]
    return flat[::-1] if strand == 'reverse' else flat


def triples(R, cs):
    return [tuple(R[i:i + 3]) for i in range(max(cs, 1) - 1, len(R) - 2, 3)]


class Model:
    """Bases with identities; the editor's expected behaviour, restated."""

    def __init__(self, seq, circular):
        self.cells = [(('o', i), b) for i, b in enumerate(seq)]
        self.circular = circular

    def ids(self):
        return [c[0] for c in self.cells]

    def seq(self):
        return ''.join(c[1] for c in self.cells)

    def delete(self, start, end):
        L = len(self.cells)
        kill = {p % L for p in range(start, end)}
        self.cells = [c for i, c in enumerate(self.cells) if i not in kill]

    def insert(self, p, text):
        L = len(self.cells)
        if self.circular and L:
            p %= L
        new = [(('i', k), b) for k, b in enumerate(text)]
        self.cells = self.cells[:p] + new + self.cells[p:]
        return [c[0] for c in new]

    def substitute(self, p, text):
        L = len(self.cells)
        for k, b in enumerate(text):
            i = (p + k) % L
            self.cells[i] = (self.cells[i][0], b)

    def rotate(self, p):
        self.cells = self.cells[p:] + self.cells[:p]

    def revcomp(self):
        self.cells = [(i, b.translate(COMP)) for i, b in reversed(self.cells)]


def surviving(segs_ids, removed, inserted, left, right, whole_len):
    """Per segment, the identities it covers after the edit."""
    out = []
    for seg in segs_ids:
        kept = [x for x in seg if x not in removed]
        if inserted:
            grow = None
            for j in range(len(kept) - 1):
                if kept[j] == left and kept[j + 1] == right:
                    grow = j + 1
            if grow is not None:
                kept = kept[:grow] + inserted + kept[grow:]
            elif kept and kept[-1] == left and kept[0] == right and len(kept) == whole_len:
                kept = kept + inserted
        if kept:
            out.append(kept)
    return out


def apply_edit(model, seq, circular, op):
    """Applies op to the model; returns (removed, inserted ids, left, right)."""
    L = len(seq)
    inserted, left, right = [], None, None
    kind = op['type']
    if kind == 'delete':
        model.delete(op['range']['start'], op['range']['end'])
    elif kind == 'insert':
        p = op['position']
        ids0 = model.ids()
        pp = p % L if circular else p
        left = ids0[pp - 1] if pp > 0 else (ids0[-1] if circular else None)
        right = ids0[pp] if pp < L else None
        inserted = model.insert(p, op['text'])
    elif kind == 'replace':
        r, text = op['range'], op['text']
        old = r['end'] - r['start']
        common = min(old, len(text))
        if common:
            model.substitute(r['start'], text[:common])
        pivot = (r['start'] + common) % L if circular else r['start'] + common
        if len(text) > old:
            ids0 = model.ids()
            left = ids0[pivot - 1] if pivot > 0 else (ids0[-1] if circular else None)
            right = ids0[pivot] if pivot < L else None
            inserted = model.insert(pivot, text[common:])
        elif old > len(text):
            model.delete(pivot, pivot + old - common)
    elif kind == 'setOrigin':
        model.rotate(op['position'])
    elif kind == 'reverseComplement':
        model.revcomp()
    removed = {('o', i) for i in range(L)} - set(model.ids())
    return removed, inserted, left, right


def biopython_location(f, L):
    strand = -1 if f['strand'] == 'reverse' else 1
    parts = []
    for a, b in f['segments']:
        if b <= L:
            parts.append(SimpleLocation(a, b, strand))
        else:
            parts += [SimpleLocation(a, L, strand), SimpleLocation(0, b - L, strand)]
    if strand == -1:
        parts = parts[::-1]
    return parts[0] if len(parts) == 1 else CompoundLocation(parts)


def biopython_bases(seq, circular, features, op):
    """Reading-order bases per feature id after revcomp or setOrigin, or None."""
    rec = SeqRecord(
        Seq(seq),
        features=[SeqFeature(biopython_location(f, len(seq)), type=f['type'], id=f['id']) for f in features],
    )
    if op['type'] == 'reverseComplement':
        out = rec.reverse_complement(features=True)
        new_seq = str(out.seq)
        return new_seq, {f.id: str(f.extract(out.seq)) for f in out.features}
    d = Dseqrecord(seq, circular=True)
    d.features = rec.features
    out = d.shifted(op['position'])
    new_seq = str(out.seq)
    return new_seq, {f.id: str(f.extract(Seq(new_seq))) for f in out.features}


def biopython_sequence(seq, circular, op):
    """Expected sequence from Biopython slicing, or None where the edit wraps."""
    s = Seq(seq)
    L = len(seq)
    kind = op['type']
    if kind == 'delete':
        a, b = op['range']['start'], op['range']['end']
        if b > L:
            return str(s[b - L:a])
        return str(s[:a] + s[b:])
    if kind == 'insert':
        return str(s[:op['position']] + Seq(op['text']) + s[op['position']:])
    if kind == 'replace':
        a, b = op['range']['start'], op['range']['end']
        if b > L:
            return None
        return str(s[:a] + Seq(op['text']) + s[b:])
    return None


def first_untouched_triples(R, cs, R2, removed, inserted):
    """Codons of the original reading R that the edit leaves where they were."""
    k = 0
    while k < len(R) and R[k] in removed:
        k += 1
    D = len(R)
    for j in range(k, len(R)):
        if R[j] in removed:
            D = j
            break
    ins = set(inserted)
    for j, x in enumerate(R2):
        if x in ins:
            if j == 0:
                D = min(D, k)
            elif R2[j - 1] in R:
                D = min(D, R.index(R2[j - 1]) + 1)
            break
    window = set(R[k:D])
    return k, [t for t in triples(R, cs) if all(x in window for x in t)]


def protein_of(codons):
    return str(Seq(''.join(codons)).translate(table=1)) if codons else ''


def expectation(seq, circular, features, op, stats):
    L = len(seq)
    model = Model(seq, circular)
    removed, inserted, left, right = apply_edit(model, seq, circular, op)
    new_seq = model.seq()
    bio_seq = biopython_sequence(seq, circular, op)
    if bio_seq is not None:
        assert bio_seq == new_seq, (op, seq)
        stats['seq_bio'] += 1
    bio_bases = {}
    if op['type'] in ('reverseComplement', 'setOrigin'):
        bio_new, bio_bases = biopython_bases(seq, circular, features, op)
        assert bio_new == new_seq, (op, seq)
    base_of = dict(model.cells)
    new_L = len(new_seq)
    out_features, gone = [], []
    for f in features:
        segs_ids = [[('o', p) for p in positions(s, L)] for s in f['segments']]
        exp = surviving(segs_ids, removed, inserted, left, right, new_L - len(inserted))
        strand = f['strand']
        if op['type'] == 'reverseComplement':
            exp = [s[::-1] for s in exp[::-1]]
            strand = 'reverse' if strand == 'forward' else 'forward'
        if not exp:
            gone.append(f['id'])
            continue
        R2 = reading(exp, strand)
        comp = (lambda b: b.translate(COMP)) if strand == 'reverse' else (lambda b: b)
        bases = ''.join(comp(base_of[x]) for x in R2)
        if f['id'] in bio_bases:
            assert bio_bases[f['id']] == bases, (op, f, bases, bio_bases[f['id']])
            stats['bases_bio'] += 1
        rec = {'id': f['id'], 'strand': strand, 'bases': bases}
        if f['type'] == 'CDS':
            R = reading(segs_ids, f['strand'])
            cs = f['codon_start'] or 1
            k, exp_triples = first_untouched_triples(R, cs, R2, removed, inserted)
            codons = [''.join(comp(base_of[x]) for x in t) for t in exp_triples]
            if op['type'] in ('reverseComplement', 'setOrigin'):
                # Same bases, same reading: the whole translation carries over.
                codons = [bases[i:i + 3] for i in range(cs - 1, len(bases) - 2, 3)]
                k = 0
            aa = protein_of(codons)
            first_start = bool(codons) and codons[0] in TABLE1.start_codons
            if aa and k == 0:
                first = ['M' if first_start else aa[0]]
            elif aa:
                # The start was cut off: whether the new first codon reads as M
                # depends on whether the partial flag is set (#163).
                first = sorted({aa[0], 'M'} if first_start else {aa[0]})
            else:
                first = []
            rec['codons'] = codons
            rec['protein'] = aa
            rec['first'] = first
            rec['start_cut'] = k > 0
            stats['cds_cut' if k > 0 else 'cds_whole'] += 1
        out_features.append(rec)
    return {'seq': new_seq, 'features': out_features, 'gone': gone}


def random_op(rng, L, circular):
    kind = rng.choice(['delete'] * 3 + ['insert'] * 2 + ['replace'] * 3 + ['setOrigin', 'reverseComplement'])
    if kind == 'setOrigin' and not circular:
        kind = 'reverseComplement'
    if kind == 'delete':
        if circular:
            start = rng.randint(0, L - 1)
            return {'type': 'delete', 'range': {'start': start, 'end': start + rng.randint(1, L - 1)}}
        start = rng.randint(0, L - 1)
        return {'type': 'delete', 'range': {'start': start, 'end': rng.randint(start + 1, L)}}
    if kind == 'insert':
        pos = rng.randint(0, L - 1) if circular else rng.randint(0, L)
        return {'type': 'insert', 'position': pos, 'text': rnd_bases(rng, rng.randint(1, 7))}
    if kind == 'replace':
        if circular:
            start = rng.randint(0, L - 1)
            end = start + rng.randint(0, L - 1)
        else:
            start = rng.randint(0, L)
            end = rng.randint(start, L)
        return {'type': 'replace', 'range': {'start': start, 'end': end}, 'text': rnd_bases(rng, rng.randint(0, 7))}
    if kind == 'setOrigin':
        return {'type': 'setOrigin', 'position': rng.randint(0, L - 1)}
    return {'type': 'reverseComplement'}


def targeted_cases(rng):
    """Deletes (and replaces) that cut into the start of a CDS, on both strands."""
    cases = []
    for strand in ('forward', 'reverse'):
        for cs in (0, 1, 2, 3):
            for cut in range(1, 8):
                seq = rnd_bases(rng, 90)
                # forward: the start is the left end; reverse: the right end.
                f = {'id': 'f0', 'type': 'CDS', 'strand': strand, 'segments': [[10, 70]], 'codon_start': cs}
                if strand == 'forward':
                    rng_ = {'start': 4, 'end': 10 + cut}
                else:
                    rng_ = {'start': 70 - cut, 'end': 76}
                cases.append((seq, False, [f], {'type': 'delete', 'range': rng_}))
                cases.append((seq, False, [f], {'type': 'replace', 'range': rng_, 'text': rnd_bases(rng, cut % 3)}))
    return cases


# ------------------------------------------------------- region copy, delete

START_CODONS = set(TABLE1.start_codons)


def copy_feature(rng, L, circular):
    """One feature in a small plasmid: one to three segments with gaps, maybe
    across the origin, maybe partial at its ends, either strand."""
    for _ in range(100):
        pos = rng.randrange(L) if circular else rng.randrange(max(1, L - 12))
        limit = pos + L - 1 if circular else L
        segs = []
        for k in range(rng.randint(1, 3)):
            n = 2 + rng.randrange(12)
            if pos + n > limit:
                break
            segs.append([pos, pos + n])
            pos += n + 1 + rng.randrange(4)
        if segs:
            break
    else:
        return None
    segs = [[a - L, b - L] if a >= L else [a, b] for a, b in segs]
    ps = rng.random() < 0.2
    pe = rng.random() < 0.2
    cds = rng.random() >= 0.25
    cs = rng.randint(1, 3) if rng.random() < 0.33 else 0
    return {
        'type': 'CDS' if cds else 'misc_feature',
        'strand': 'forward' if rng.random() < 0.5 else 'reverse',
        'segments': [[a, b, ps and i == 0, pe and i == len(segs) - 1] for i, (a, b) in enumerate(segs)],
        'codon_start': cs,
    }


def copy_region(rng, L, circular):
    mode = rng.randrange(6)
    if mode == 0 and circular:
        rs = rng.randrange(L)
        return rs, rs + L
    if mode == 1:
        return 0, 1 + rng.randrange(L)
    if mode == 2:
        rs = rng.randrange(L)
        return rs, L
    rs = rng.randrange(L)
    return rs, rs + 1 + rng.randrange(L if circular else L - rs)


def source_reading(f, L, circular):
    """Unrolled source positions in reading order, with each one's segment."""
    R, seg_of = [], []
    for i, (a, b, _, _) in enumerate(f['segments']):
        for p in range(a, b):
            R.append(p % L if circular else p)
            seg_of.append((i, p))
    order = list(range(len(R)))
    if f['strand'] == 'reverse':
        order.reverse()
    return [R[j] for j in order], [seg_of[j] for j in order]


def runs_of(idx):
    runs = []
    for j in idx:
        if runs and runs[-1][-1] == j - 1:
            runs[-1].append(j)
        else:
            runs.append([j])
    return runs


def src_ends(f):
    ps = f['segments'][0][2]
    pe = f['segments'][-1][3]
    return (pe, ps) if f['strand'] == 'reverse' else (ps, pe)  # (5', 3')


def cut_inside_segment(seg_of, j, k, L, circular):
    """True when reading bases j and k are neighbours in one segment, not
    across the origin: dropping one of them cuts that segment."""
    (si, p), (sj, q) = seg_of[j], seg_of[k]
    if si != sj or abs(p - q) != 1:
        return False
    return not (circular and max(p, q) % L == 0)


def comp_if(strand, text):
    return text.translate(COMP) if strand == 'reverse' else text


def cds_expectation(f, bases, lost, cut5):
    """/codon_start and the protein of a CDS read from `lost` bases into the source."""
    cs = f['codon_start'] or 1
    skip = cs - 1
    first = skip if lost <= skip else lost + (skip - lost) % 3
    ocs = first - lost + 1
    body = bases[ocs - 1:]
    whole = body[: len(body) // 3 * 3]
    prot = str(Seq(whole).translate(table=1)) if whole else ''
    return ocs, prot, len(body) % 3 == 2


def region_copy_case(rng, stats):
    L = rng.randint(24, 63)
    circular = rng.random() < 0.5
    seq = rnd_bases(rng, L)
    f = copy_feature(rng, L, circular)
    if f is None:
        return None
    rs, re = copy_region(rng, L, circular)
    R, seg_of = source_reading(f, L, circular)
    ext = {p % L: k for k, p in enumerate(range(rs, re))}
    runs = runs_of([j for j in range(len(R)) if R[j] in ext])
    whole_circle = circular and re - rs >= L
    if whole_circle and runs:
        # A feature reading across the cut of a whole-circle region keeps interior
        # partial marks and a join across the new ends (#174): not asserted here.
        step = -1 if f['strand'] == 'reverse' else 1
        for run in runs:
            e = [ext[R[j]] for j in run]
            if any(b - a != step for a, b in zip(e, e[1:])):
                return None
    out = []
    src5, src3 = src_ends(f)
    for run in runs:
        lost = run[0]
        bases = comp_if(f['strand'], ''.join(seq[R[j]] for j in run))
        rec = {
            'min': min(ext[R[j]] for j in run),
            'bases': bases,
            'cut5': lost > 0 and cut_inside_segment(seg_of, lost - 1, lost, L, circular),
            'cut3': run[-1] < len(R) - 1 and cut_inside_segment(seg_of, run[-1], run[-1] + 1, L, circular),
        }
        if f['type'] == 'CDS':
            ocs, prot, tail2 = cds_expectation(f, bases, lost, False)
            exp5 = lost > 0 or src5
            if prot and not exp5 and bases[ocs - 1:ocs + 2] in START_CODONS:
                prot = 'M' + prot[1:]
            rec.update({'codon_start': ocs, 'protein': prot, 'tail2': tail2})
        out.append(rec)
    out.sort(key=lambda r: r['min'])
    return {
        'topology': 'circular' if circular else 'linear',
        'seq': seq,
        'feature': f,
        'region': [rs, re],
        'extract': ''.join(seq[p % L] for p in range(rs, re)),
        'out': out,
    }


def delete_case(rng, stats):
    L = rng.randint(24, 63)
    circular = rng.random() < 0.5
    seq = rnd_bases(rng, L)
    f = copy_feature(rng, L, circular)
    if f is None:
        return None
    rs, re = copy_region(rng, L, circular)
    re = min(re, rs + L - 1)
    kill = {p % L for p in range(rs, re)}
    new_seq = ''.join(b for i, b in enumerate(seq) if i not in kill)
    new_index, k = {}, 0
    for i in range(L):
        if i not in kill:
            new_index[i] = k
            k += 1
    R, _ = source_reading(f, L, circular)
    keep = [j for j in range(len(R)) if R[j] not in kill]
    src5, _ = src_ends(f)
    rec = {'gone': not keep}
    if keep:
        # The bases the feature reads afterwards, from the edited sequence.
        text = ''.join(new_seq[new_index[R[j]]] for j in keep)
        rec['bases'] = comp_if(f['strand'], text)
        prefix = keep == list(range(keep[0], keep[0] + len(keep)))
        if f['type'] == 'CDS' and prefix:
            lost = keep[0]
            ocs, prot, _ = cds_expectation(f, rec['bases'], lost, False)
            rec.update({'codon_start': ocs, 'protein': prot, 'cut5': lost > 0 or src5})
    return {
        'topology': 'circular' if circular else 'linear',
        'seq': seq,
        'feature': f,
        'range': [rs, re],
        'after_seq': new_seq,
        'after': rec,
    }


def generate_region_cases(stats):
    rng = rng_for(SEED + 1)
    copies, deletes = [], []
    # Splits (#169) and regions across the origin are rare among random draws;
    # take all of them up to a quota and fill the rest with the plain cases.
    special, plain = 0, 0
    while special < 120 or plain < 160:
        c = region_copy_case(rng, stats)
        if c is None or not c['out']:
            continue
        rare = len(c['out']) > 1 or c['region'][1] > len(c['seq'])
        if rare and special < 120:
            special += 1
        elif not rare and plain < 160:
            plain += 1
        else:
            continue
        copies.append(c)
        L = len(c['seq'])
        f = c['feature']
        stats['copy'] += 1
        stats['copy_split'] += len(c['out']) > 1
        stats['copy_wrap_region'] += c['region'][1] > L
        stats['copy_wrap_feature'] += any(b > L or a < 0 for a, b, _, _ in f['segments'])
        stats['copy_reverse'] += f['strand'] == 'reverse'
        stats['copy_cds'] += f['type'] == 'CDS'
    # A delete that trims a CDS's start is the case that matters (#160): quota it.
    trimmed, other = 0, 0
    while trimmed < 100 or other < 120:
        c = delete_case(rng, stats)
        if c is None:
            continue
        hit = c['after'].get('cut5') is True and c['feature']['type'] == 'CDS'
        if hit and trimmed < 100:
            trimmed += 1
        elif not hit and other < 120:
            other += 1
        else:
            continue
        deletes.append(c)
        stats['delete'] += 1
    return copies, deletes


def generate():
    rng = rng_for(SEED)
    class Counter(dict):
        def __missing__(self, key):
            return 0

    stats = Counter()
    raw = targeted_cases(rng)
    while len(raw) < 330:
        circular = rng.random() < 0.5
        L = rng.randint(12, 90)
        seq = rnd_bases(rng, L)
        features = [make_feature(rng, L, circular, i) for i in range(rng.randint(1, 4))]
        raw.append((seq, circular, features, random_op(rng, L, circular)))
    cases = []
    for seq, circular, features, op in raw:
        cases.append(
            {
                'topology': 'circular' if circular else 'linear',
                'seq': seq,
                'features': features,
                'op': op,
                'after': expectation(seq, circular, features, op, stats),
            }
        )
    copies, deletes = generate_region_cases(stats)
    return {'cases': cases, 'copies': copies, 'deletes': deletes, 'stats': dict(stats)}
