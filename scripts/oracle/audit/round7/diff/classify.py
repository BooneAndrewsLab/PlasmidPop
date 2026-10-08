import json, sys
# usage: classify.py tag seeds...
D = '/tmp/claude-9005/-home-matej-code-WebstormProjects-PlasmidPop/5650bcf6-b516-4dd6-b753-3c17ed1cdb04/scratchpad/audit/r7-diff'
tag = sys.argv[1]
for s in sys.argv[2:]:
    raw = json.load(open(f'{D}/{tag}-{s}.json'))
    fnd = json.load(open(f'{D}/{tag}-{s}.findings.json'))
    for x in fnd['false_unchanged']:
        # find case & editor key
        case = next(c for c in raw if c['a'] == x['a'] and c['b'] == x['b'])
        oldf = json.loads(x['old'])[0]
        fid = next(f['id'] for f in case['features'] if f['key'] == x['old'])
        ed = next(json.loads(r['key'])[0] for r in case['results'] if r['kind'] == 'editor' and r['fid'] == fid)
        new = json.loads(x['new'])[0]
        La = len(x['a'])
        whole = x['circ'] and len(oldf) == 1 and oldf[0][0] == 0 and oldf[0][1] == La
        cls = 'WHOLE' if whole else ('LIN' if not x['circ'] else 'CIRC')
        dl = [ (n[1]-n[0]) - (e[1]-e[0]) for n, e in zip(new, ed)]
        print(f"s{s} {cls} a={x['a']} b={x['b']} op={x['op']} old={[o[:2] for o in oldf]} editor={[e[:2] for e in ed]} accepted={[n[:2] for n in new]} dlen={dl}")
