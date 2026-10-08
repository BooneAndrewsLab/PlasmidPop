import json, sys, collections
D = '/tmp/claude-9005/-home-matej-code-WebstormProjects-PlasmidPop/5650bcf6-b516-4dd6-b753-3c17ed1cdb04/scratchpad/audit/r7-diff'
tag = sys.argv[1]; verbose = sys.argv[2] if len(sys.argv) > 2 else ''
cnt = collections.Counter(); ex = collections.defaultdict(list)
for s in sys.argv[3:]:
    raw = json.load(open(f'{D}/{tag}-{s}.json'))
    fnd = json.load(open(f'{D}/{tag}-{s}.findings.json'))
    for x in fnd['false_unchanged']:
        case = next(c for c in raw if c['a'] == x['a'] and c['b'] == x['b'])
        oldf = json.loads(x['old'])[0]
        fid = next(f['id'] for f in case['features'] if f['key'] == x['old'])
        ed = next(json.loads(r['key'])[0] for r in case['results'] if r['kind'] == 'editor' and r['fid'] == fid)
        new = json.loads(x['new'])[0]
        La, Lb = len(x['a']), len(x['b'])
        olen = [o[1]-o[0] for o in oldf]; nlen = [n[1]-n[0] for n in new]
        if x['circ'] and len(oldf)==1 and oldf[0][0]==0 and oldf[0][1]==La: cls='WHOLE0'
        elif x['circ'] and any(o==La for o in olen): cls='WHOLE_NZ'
        elif x['circ'] and any(n==Lb for n in nlen): cls='BECOMES_WHOLE'
        elif not x['circ']: cls='LIN'
        else: cls='CIRC'
        dl = max(abs(n-e) for n,e in zip(nlen,[e[1]-e[0] for e in ed]))
        dpos = max(max(abs(n[0]-e[0]),abs(n[1]-e[1])) for n,e in zip(new,ed))
        cnt[cls]+=1
        ex[cls].append(f"s{s} a={x['a']} b={x['b']} ops={[(o['start'],o['end'],o['text']) for o in x['op']]} old={[o[:2] for o in oldf]} ed={[e[:2] for e in ed]} acc={[n[:2] for n in new]} dlen={dl} dpos={dpos}")
print(dict(cnt))
for k in ex:
    if verbose in ('all', k):
        print('==', k); print('\n'.join(ex[k][:int(sys.argv[-0] if False else 40)]))
