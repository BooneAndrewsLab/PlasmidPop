"""r6-diff oracle: optimal-LCS-alignment consistency of feature locations.

O1(lin): a segment [s,e) -> [s2,e2) is consistent iff some minimum-indel (LCS)
alignment path of a->b passes through lattice points (s,s2) and (e,e2).
O1(circ): same, over any rotation pair (ra, rb) whose linear indel distance
equals the unrotated optimum (an edit drawn across the origin), with the
segment unrolled in both rotated frames.
"""
import json
import sys
from functools import lru_cache


def dp(a, b):
    n, m = len(a), len(b)
    f = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        for j in range(m + 1):
            if i == 0 or j == 0:
                f[i][j] = i + j
            elif a[i - 1] == b[j - 1]:
                f[i][j] = f[i - 1][j - 1]
            else:
                f[i][j] = 1 + min(f[i - 1][j], f[i][j - 1])
    g = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n, -1, -1):
        for j in range(m, -1, -1):
            if i == n or j == m:
                g[i][j] = (n - i) + (m - j)
            elif a[i] == b[j]:
                g[i][j] = g[i + 1][j + 1]
            else:
                g[i][j] = 1 + min(g[i + 1][j], g[i][j + 1])
    return f, g


@lru_cache(maxsize=None)
def dist(x, y):
    n, m = len(x), len(y)
    prev = list(range(m + 1))
    for i in range(1, n + 1):
        cur = [i] + [0] * m
        for j in range(1, m + 1):
            cur[j] = prev[j - 1] if x[i - 1] == y[j - 1] else 1 + min(prev[j], cur[j - 1])
        prev = cur
    return prev[m]


@lru_cache(maxsize=None)
def tables(a, b):
    return dp(a, b)


def on_path(a, b, s, s2, e, e2, D):
    if not (0 <= s <= e <= len(a) and 0 <= s2 <= e2 <= len(b)):
        return False
    f, g = tables(a, b)
    if f[s][s2] + g[s][s2] != D or f[e][e2] + g[e][e2] != D:
        return False
    return f[s][s2] + dist(a[s:e], b[s2:e2]) + g[e][e2] == D


def consistent(a, b, circ, seg_old, seg_new):
    s, e = seg_old
    s2, e2 = seg_new
    D = dist(a, b)
    if not circ:
        return on_path(a, b, s, s2, e, e2, D)
    L, M = len(a), len(b)
    for ra in range(L):
        ar = a[ra:] + a[:ra]
        sr = (s - ra) % L
        er = sr + (e - s)
        if er > L:
            continue
        for rb in range(M):
            br = b[rb:] + b[:rb]
            if dist(ar, br) != D:
                continue
            s2r = (s2 - rb) % M
            e2r = s2r + (e2 - s2)
            if e2r > M:
                continue
            if on_path(ar, br, sr, s2r, er, e2r, D):
                return True
    return False


def feat_consistent(a, b, circ, old_key, new_key):
    old = json.loads(old_key)[0]
    new = json.loads(new_key)[0]
    if len(old) != len(new):
        return False
    return all(consistent(a, b, circ, (o[0], o[1]), (n[0], n[1])) for o, n in zip(old, new))


def main(path):
    cases = json.load(open(path))
    stats = dict(cases=len(cases), editor=0, perturb=0, editor_changed=0, fu=0, fc=0)
    false_unchanged, false_changed = [], []
    for c in cases:
        a, b, circ = c['a'], c['b'], c['circ']
        old = {f['id']: f['key'] for f in c['features']}
        for r in c['results']:
            reach = c['reach'].get(r['fid'], {})
            if r['kind'] == 'editor':
                stats['editor'] += 1
                if r['changed']:
                    stats['editor_changed'] += 1
                    false_changed.append(dict(kind='editor', a=a, b=b, circ=circ, op=c['op'], old=old[r['fid']], new=r['key'], o1=feat_consistent(a, b, circ, old[r['fid']], r['key'])))
                continue
            stats['perturb'] += 1
            o1 = feat_consistent(a, b, circ, old[r['fid']], r['key'])
            inreach = r['key'] in reach
            if not r['changed'] and not o1 and not inreach and not r.get('inMulti'):
                if r.get('inMulti') is None: stats['multi_unknown'] = stats.get('multi_unknown', 0) + 1
                stats['fu'] += 1
                false_unchanged.append(dict(a=a, b=b, circ=circ, op=c['op'], old=old[r['fid']], new=r['key'], reach=reach))
            if r['changed'] and o1:
                stats['fc'] += 1
                false_changed.append(dict(kind='perturb-o1', a=a, b=b, circ=circ, op=c['op'], old=old[r['fid']], new=r['key'], inreach=reach.get(r['key'])))
    print(json.dumps(stats))
    json.dump(dict(false_unchanged=false_unchanged, false_changed=false_changed), open(path.replace('.json', '.findings.json'), 'w'), indent=1)


if __name__ == '__main__':
    main(sys.argv[1])
