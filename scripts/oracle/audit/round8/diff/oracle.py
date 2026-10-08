"""r8-diff oracle: an independent base-identity model of the editor.

Every base of `a` carries an identity. A single replace [st, en) -> text is
applied as the editor documents it (seqDocument.replace): the common prefix
overwrites slots in place (identities kept), then the surplus is inserted at
the pivot or the shortfall deleted from it. A feature segment is the ordered
list of identities it covers; an insertion joins it iff the slots on both
sides of the insertion point are in it; a deletion drops identities. The
carried location is (index of first identity, its length).

A diff verdict "unchanged" for an after-location is right iff SOME single
replace that turns a into b carries the feature there. "Changed" for a
location the cheapest such replace gives is a false changed.
"""
import json
import sys
from collections import defaultdict

sys.path.insert(0, __import__('os').path.dirname(__file__))
from o1 import consistent as o1c  # noqa: E402


def o1(a, b, circ, segs, cand):
    if len(segs) != len(cand):
        return False
    return all(o1c(a, b, circ, s, c) for s, c in zip(segs, cand))


def apply(a, circ, segs, st, en, text):
    """Returns (newseq, [seg identity lists or None per segment]) or None."""
    L = len(a)
    slots = list(range(L))
    bases = list(a)
    seg_ids = []
    for s0, e0 in segs:
        seg_ids.append([x % L for x in range(s0, e0)])
    old = en - st
    common = min(old, len(text))
    for i in range(common):
        bases[(st + i) % L if circ else st + i] = text[i]
    pivot = (st + common) % L if circ and L > 0 else st + common
    nid = L
    if len(text) > old:
        ins = list(range(nid, nid + len(text) - old))
        ins_b = list(text[common:])
        prev = (pivot - 1) % L if circ else pivot - 1
        nxt = pivot if pivot < L else None
        if circ and pivot == L:
            nxt = 0
        new_segs = []
        for ids in seg_ids:
            if prev >= 0 and nxt is not None and prev in ids and nxt in ids:
                i = ids.index(prev)
                if i + 1 < len(ids) and ids[i + 1] == nxt:
                    ids = ids[: i + 1] + ins + ids[i + 1 :]
                else:  # nxt is first, prev last: whole circle
                    assert ids[0] == nxt and ids[-1] == prev, (ids, prev, nxt)
                    ids = ids + ins
            new_segs.append(ids)
        seg_ids = new_segs
        p = pivot if not (circ and pivot == L) else 0
        slots = slots[:p] + ins + slots[p:]
        bases = bases[:p] + ins_b + bases[p:]
    elif len(text) < old:
        k = old - common
        gone = set((pivot + i) % L if circ else pivot + i for i in range(k))
        keep = [i for i in range(L) if i not in gone]
        slots = [slots[i] for i in keep]
        bases = [bases[i] for i in keep]
        seg_ids = [[x for x in ids if x not in gone] or None for ids in seg_ids]
    pos = {sid: i for i, sid in enumerate(slots)}
    Lb = len(slots)
    out = []
    for ids in seg_ids:
        if ids is None:
            out.append(None)
            continue
        s0 = pos[ids[0]]
        # contiguity check
        for j, x in enumerate(ids):
            q = s0 + j
            if circ:
                q %= Lb
            assert q < Lb and slots[q] == x, ('noncontig', ids)
        out.append((s0, s0 + len(ids)))
    return ''.join(bases), out


def carry(a, circ, segs, st, en, text):
    seq, out = apply(a, circ, segs, st, en, text)
    kept = tuple(x for x in out if x is not None)
    return seq, (kept if kept else None)


def all_ops(a, b, circ):
    L, Lb = len(a), len(b)
    ops = []
    if not circ:
        for st in range(0, L + 1):
            if a[:st] != b[:st]:
                break
            for en in range(st, L + 1):
                tEnd = Lb - (L - en)
                if tEnd < st or a[en:] != b[tEnd:]:
                    continue
                text = b[st:tEnd]
                if en == st and text == '':
                    continue
                ops.append((st, en, text))
    else:
        bb = b + b
        aaa = a + a + a
        for st in range(0, L):
            for en in range(st, st + L + 1):
                kept = aaa[en:st + L]
                k = Lb - len(kept)
                if k < 0:
                    continue
                seen = set()
                for o in range(max(Lb, 1)):
                    if bb[o:o + len(kept)] != kept:
                        continue
                    text = bb[o + len(kept):o + len(kept) + k]
                    if text in seen:
                        continue
                    seen.add(text)
                    if en == st and text == '':
                        continue
                    ops.append((st, en, text))
    good = []
    for op in ops:
        seq, _ = apply(a, circ, [], *op)
        if seq == b:
            good.append(op)
    return good


def main(paths):
    stats = defaultdict(int)
    fu, fc, was_bad, model_bad = [], [], [], []
    for path in paths:
        for c in json.load(open(path)):
            a, b, circ, op = c['a'], c['b'], c['circ'], c['op']
            ops = all_ops(a, b, circ)
            mine = (op['start'], op['end'], op['text'])
            stats['cases'] += 1
            if mine not in ops:
                model_bad.append(dict(kind='op-not-found', a=a, b=b, circ=circ, op=op))
                continue
            mincost = min(e - s + len(t) for s, e, t in ops)
            for f in c['feats']:
                segs = [tuple(x) for x in f['segs']]
                reach = {}
                for s_, e_, t_ in ops:
                    _, loc = carry(a, circ, segs, s_, e_, t_)
                    cost = e_ - s_ + len(t_)
                    reach[loc] = min(reach.get(loc, 1e9), cost)
                _, ed = carry(a, circ, segs, *mine)
                got = tuple(tuple(x) for x in f['editor']) if f['editor'] is not None else None
                if ed != got:
                    model_bad.append(dict(kind='carry', a=a, b=b, circ=circ, op=op, segs=segs, model=ed, editor=got))
                stats['feats'] += 1
                if f['editorUnchanged'] is False:
                    stats['editor_changed'] += 1
                    fc.append(dict(old197=f.get('editorUnchanged197'), old198=f.get('editorUnchanged198'), kind='editor', a=a, b=b, circ=circ, op=op, segs=segs, cand=got, cost=reach.get(got), mincost=mincost))
                for v in f['verdicts']:
                    cand, unchanged = v[0], v[1]
                    old = v[2:]
                    cand = tuple(tuple(x) for x in cand)
                    stats['verdicts'] += 1
                    r = reach.get(cand)
                    if unchanged and r is None:
                        whole = circ and len(segs) == 1 and segs[0][1] - segs[0][0] == len(a)
                        cls = 'WHOLE' if whole and len(cand) == 1 and cand[0][1] - cand[0][0] == len(b) else ('LIN' if not circ else 'CIRC')
                        stats['fu_' + cls + ('_o1' if o1(a, b, circ, segs, cand) else '')] += 1
                        fu.append(dict(old=old, o1=o1(a, b, circ, segs, cand), cls=cls, a=a, b=b, circ=circ, op=op, segs=segs, cand=cand, editor=got, removed=got is None, mincost=mincost))
                    if not unchanged and r is not None and r == mincost and cand != got:
                        stats['fc_opt'] += 1
                        fc.append(dict(old=old, kind='opt', a=a, b=b, circ=circ, op=op, segs=segs, cand=cand, cost=r, mincost=mincost))
                was = f['was']
                if was is not None:
                    w = tuple(tuple(x) for x in was)
                    if got is not None and w not in reach:
                        stats['was_bad'] += 1
                        was_bad.append(dict(a=a, b=b, circ=circ, op=op, segs=segs, was=w, editor=got))
                    if got is None and any(x[0] > len(b) or x[1] > x[0] and x[0] >= len(b) for x in w):
                        stats['was_bad_removed'] += 1
                        was_bad.append(dict(a=a, b=b, circ=circ, op=op, segs=segs, was=w, editor=None))
    print(json.dumps(dict(stats)))
    out = paths[0].replace('.json', '.findings.json')
    json.dump(dict(fu=fu, fc=fc, was_bad=was_bad, model_bad=model_bad), open(out, 'w'), indent=1)
    print('model_bad', len(model_bad), '->', out)


if __name__ == '__main__':
    main(sys.argv[1:])
