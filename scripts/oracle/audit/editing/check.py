"""Independent oracle for PlasmidPop editing: base-identity model + Biopython translation."""
import json, sys, collections
from Bio.Seq import Seq
from Bio.Data import CodonTable

OUT = sys.argv[1] if len(sys.argv) > 1 else 'single.json'
cases = json.load(open(OUT))
T1 = CodonTable.unambiguous_dna_by_id[1]
COMP = str.maketrans('ACGTacgt', 'TGCAtgca')


def rc(s):
    return s.translate(COMP)[::-1]


def pieces(start, end, L):
    return list(range(start, end)) if end <= L else list(range(start, L)) + list(range(0, end - L))


def seg_positions(seg, L):
    if seg['kind'] != 'range':
        return []
    return [p % L if L else p for p in range(seg['start'], seg['end'])]


def coverage(feat, L):
    """Per segment position lists, forward coordinate order."""
    return [seg_positions(s, L) for s in feat['segments'] if s['kind'] == 'range']


def qual(feat, name):
    for q in feat['qualifiers']:
        if q['name'] == name:
            return q['value']
    return None


def cstart(feat):
    v = qual(feat, 'codon_start')
    return 2 if v == '2' else 3 if v == '3' else 1


def reading(ids_by_seg, strand):
    flat = [x for seg in ids_by_seg for x in seg]
    return flat[::-1] if strand == 'reverse' else flat


def triples(R, cs):
    return [tuple(R[i:i + 3]) for i in range(cs - 1, len(R) - 2, 3)]


def bio_protein(seq, feat):
    L = len(seq)
    text = ''.join(seq[p] for seg in coverage(feat, L) for p in seg)
    if feat['strand'] == 'reverse':
        text = rc(text)
    cs = cstart(feat)
    t = text[cs - 1:]
    rsegs = [s for s in feat['segments'] if s['kind'] == 'range']
    three_partial = (rsegs[0]['partialStart'] if feat['strand'] == 'reverse' else rsegs[-1]['partialEnd'])
    extra = ''
    if len(t) % 3 == 2 and three_partial:
        aa = str(Seq(t[-2:] + 'N').translate(table=1))
        if aa != 'X':
            extra = aa
    t = t[:len(t) // 3 * 3]
    if not t:
        return extra
    prot = str(Seq(t).translate(table=1)) + extra
    five_partial = (rsegs[-1]['partialEnd'] if feat['strand'] == 'reverse' else rsegs[0]['partialStart'])
    if not five_partial and t[:3] in T1.start_codons:
        prot = 'M' + prot[1:]
    return prot


class Model:
    def __init__(self, seq, topo):
        self.cells = [(('o', i), b) for i, b in enumerate(seq)]
        self.topo = topo
        self.modified = set()

    def ids(self):
        return [c[0] for c in self.cells]

    def seq(self):
        return ''.join(c[1] for c in self.cells)

    def delete(self, start, end):
        L = len(self.cells)
        kill = set(p % L for p in range(start, end))
        self.cells = [c for i, c in enumerate(self.cells) if i not in kill]

    def insert(self, p, text, tag):
        L = len(self.cells)
        if self.topo == 'circular' and L:
            p %= L
        new = [((tag, k), b) for k, b in enumerate(text)]
        self.cells = self.cells[:p] + new + self.cells[p:]
        return new

    def substitute(self, p, text):
        L = len(self.cells)
        for k, b in enumerate(text):
            i = (p + k) % L
            self.cells[i] = (self.cells[i][0], b)
            self.modified.add(self.cells[i][0])

    def rotate(self, p):
        self.cells = self.cells[p:] + self.cells[:p]

    def revcomp(self):
        self.cells = [(i, b.translate(COMP)) for i, b in reversed(self.cells)]


def expected_cov(segs_ids, removed, ins_ids, left, right, full_flags, L2pre):
    out = []
    for seg, full in zip(segs_ids, full_flags):
        kept = [x for x in seg if x not in removed]
        if ins_ids:
            # grow when the insertion lands between two consecutive bases of this segment
            grow_at = None
            for j in range(len(kept) - 1):
                if kept[j] == left and kept[j + 1] == right:
                    grow_at = j + 1
            if grow_at is not None:
                kept = kept[:grow_at] + ins_ids + kept[grow_at:]
            elif kept and kept[-1] == left and kept[0] == right and len(kept) == L2pre:
                kept = kept + ins_ids
        if kept:
            out.append(kept)
    return out


stats = collections.Counter()
fails = collections.defaultdict(list)


def fail(kind, n, msg):
    stats['FAIL_' + kind] += 1
    if len(fails[kind]) < 100000:
        fails[kind].append((n, msg))


def frame_check(n, label, R, cs, R2, cs2, removed, modified, inserted):
    T = triples(R, cs)
    T2 = triples(R2, cs2)
    k = 0
    while k < len(R) and R[k] in removed:
        k += 1
    # next disturbance in R after k
    D = len(R)
    for j in range(k, len(R)):
        if R[j] in removed:
            D = j
            break
    insset = set(inserted)
    for j, x in enumerate(R2):
        if x in insset:
            if j == 0:
                D = min(D, k)
            else:
                prev = R2[j - 1]
                if prev in R:
                    D = min(D, R.index(prev) + 1)
            break
    window = set(R[k:D])
    exp = [t for t in T if all(x in window for x in t)]
    if T2[:len(exp)] != exp:
        fail('frame_' + label, n, f'k={k} D={D} cs {cs}->{cs2} lenR={len(R)} lenR2={len(R2)} exp0={exp[:2]} got0={T2[:2]}')
    else:
        stats['frame_ok_' + label] += 1
        if k > 0: stats['frontloss_ok_' + label] += 1
        if k > 0 and any(len(set(f)) for f in []): pass


for case in cases:
    n = case['n']
    if 'createError' in case:
        stats['createError'] += 1
        continue
    if 'error' in case:
        fail('error', n, case.get('error'))
        continue
    kind = case['kind']
    b, a = case['before'], case['after']
    L = len(b['seq'])
    # translateCds vs Biopython on both docs
    for doc in (b, a):
        for f in doc['features']:
            if f['type'] == 'CDS':
                bp = bio_protein(doc['seq'], f)
                if bp != f['protein']:
                    fail('translate', n, (f['id'], bp, f['protein']))
                else:
                    stats['translate_ok'] += 1
    m = Model(b['seq'], b['topology'])
    bf = {f['id']: f for f in b['features']}
    af = {f['id']: f for f in a['features']}
    inserted = []
    left = right = None
    if kind == 'extract':
        reg = case['region']
        pos = pieces(reg['start'], reg['end'], L)
        src_of = {i: p for i, p in enumerate(pos)}
        if a['seq'] != ''.join(b['seq'][p] for p in pos):
            fail('seq_extract', n, '')
        inreg = set(pos)
        for f in a['features']:
            orig = next(o for o in b['features'] if qual(o, 'note') == qual(f, 'note'))
            ocov = coverage(orig, L)
            R = reading([[('o', p) for p in s] for s in ocov], orig['strand'])
            got = [[('o', src_of[p]) for p in s] for s in coverage(f, len(a['seq']))]
            exp_segs = [[x for x in s if x[1] in inreg] for s in [[('o', p) for p in s] for s in ocov]]
            flat_exp = [x for s in exp_segs for x in s]
            flat_got = [x for s in got for x in s]
            if flat_exp != flat_got:
                if sorted(flat_exp) == sorted(flat_got):
                    fail('extract_order', n, (orig['id'], ocov, reg, [s for s in f['segments']]))
                else:
                    fail('extract_cov', n, (orig['id'], flat_exp[:6], flat_got[:6]))
                continue
            stats['extract_cov_ok'] += 1
            if orig['type'] == 'CDS':
                removed = set(R) - set(flat_got)
                R2 = reading(got, f['strand'])
                frame_check(n, 'extract', R, cstart(orig), R2, cstart(f), removed, set(), [])
        continue
    op = case['op']
    if kind == 'delete':
        m.delete(op['range']['start'], op['range']['end'])
    elif kind == 'insert':
        p = op['position']
        ids0 = m.ids()
        pp = p % L if m.topo == 'circular' and L else p
        left = ids0[pp - 1] if pp > 0 else (ids0[-1] if m.topo == 'circular' else None)
        right = ids0[pp] if pp < L else None
        inserted = [c[0] for c in m.insert(p, op['text'], 'i')]
    elif kind == 'replace':
        r = op['range']
        old = r['end'] - r['start']
        text = op['text']
        common = min(old, len(text))
        if common:
            m.substitute(r['start'], text[:common])
        pivot = (r['start'] + common) % L if m.topo == 'circular' and L else r['start'] + common
        if len(text) > old:
            ids0 = m.ids()
            Lc = len(ids0)
            left = ids0[pivot - 1] if pivot > 0 else (ids0[-1] if m.topo == 'circular' else None)
            right = ids0[pivot] if pivot < Lc else None
            inserted = [c[0] for c in m.insert(pivot, text[common:], 'i')]
        elif old > len(text):
            m.delete(pivot, pivot + old - common)
    elif kind == 'setOrigin':
        m.rotate(op['position'])
    elif kind == 'reverseComplement':
        m.revcomp()
    elif kind == 'insertFragment':
        r = op['range']
        before_ids = m.ids()
        m.delete(r['start'], r['end'])
        # paste position: where r.start lands
        rs = r['start'] % L if m.topo == 'circular' and L else r['start']
        kill = set(p % L for p in range(r['start'], r['end'])) if L else set()
        p = sum(1 for i in range(rs) if i not in kill)
        newL = len(m.cells)
        if m.topo == 'circular' and newL:
            p %= newL
        ids0 = m.ids()
        left = ids0[p - 1] if p > 0 else (ids0[-1] if m.topo == 'circular' and ids0 else None)
        right = ids0[p] if p < newL else None
        inserted = [c[0] for c in m.insert(p, case['fragmentSeq'], 'p')]
    if m.seq() != a['seq']:
        fail('seq_' + kind, n, (op, b['seq'], m.seq(), a['seq']))
        continue
    stats['seq_ok_' + kind] += 1
    old_ids = [('o', i) for i in range(L)]
    new_ids = m.ids()
    removed = set(old_ids) - set(new_ids)
    L2 = len(new_ids)
    for fid, f in bf.items():
        segs = coverage(f, L)
        segs_ids = [[old_ids[p] for p in s] for s in segs]
        full_flags = [len(s) == L for s in segs]
        exp = expected_cov(segs_ids, removed, inserted, left, right, full_flags, L2 - len(inserted))
        if kind == 'reverseComplement':
            exp = [s[::-1] for s in exp[::-1]]
        g = af.get(fid)
        if not exp:
            if g is not None:
                fail('cov_should_vanish_' + kind, n, fid)
            else:
                stats['cov_ok_' + kind] += 1
            continue
        if g is None:
            fail('cov_vanished_' + kind, n, (fid, exp))
            continue
        got = [[new_ids[p] for p in s] for s in coverage(g, L2)]
        if [x for s in got for x in s] != [x for s in exp for x in s]:
            fail('cov_' + kind, n, (fid, op, f['segments'], g['segments']))
            continue
        stats['cov_ok_' + kind] += 1
        # qualifiers other than codon_start untouched
        if [q for q in f['qualifiers'] if q['name'] != 'codon_start'] != [q for q in g['qualifiers'] if q['name'] != 'codon_start']:
            fail('qual_' + kind, n, fid)
        expected_strand = f['strand'] if kind != 'reverseComplement' else ('reverse' if f['strand'] == 'forward' else 'forward')
        if g['strand'] != expected_strand:
            fail('strand_' + kind, n, fid)
        if f['type'] == 'CDS':
            R = reading(segs_ids, f['strand'])
            R2 = reading(got, g['strand'])
            frame_check(n, kind, R, cstart(f), R2, cstart(g), removed, m.modified, inserted)
    # pasted features
    if kind == 'insertFragment':
        src = case['src']
        src_pos = pieces(src['start'], src['end'], L)
        for fid, g in af.items():
            if fid in bf:
                continue
            orig = next(o for o in b['features'] if qual(o, 'note') == qual(g, 'note'))
            got = [[new_ids[p] for p in s] for s in coverage(g, L2)]
            if any(x[0] != 'p' for s in got for x in s):
                fail('paste_cov', n, fid)
                continue
            got_src = [[('o', src_pos[x[1]]) for x in s] for s in got]
            ocov = [[('o', p) for p in s] for s in coverage(orig, L)]
            inset = set(('o', p) for p in src_pos)
            flat_exp = [x for s in ocov for x in s if x in inset]
            flat_got = [x for s in got_src for x in s]
            if flat_exp != flat_got:
                fail('paste_cov2', n, (fid, flat_exp[:5], flat_got[:5]))
                continue
            stats['paste_cov_ok'] += 1
            if orig['type'] == 'CDS':
                R = reading(ocov, orig['strand'])
                R2 = reading(got_src, g['strand'])
                frame_check(n, 'paste', R, cstart(orig), R2, cstart(g), set(R) - set(flat_got), set(), [])

for k in sorted(stats):
    print(k, stats[k])
for k, v in fails.items():
    print('==', k)
    for x in v:
        print('  ', x)
