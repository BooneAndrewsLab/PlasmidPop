import json, collections
cases={c['id']:c for c in json.load(open('cds_cases.json'))}; ts=json.load(open('cds_ts.json'))
st=collections.Counter(); shown=collections.Counter()
L=600
for t in ts:
    c=cases[t['id']]; exp=c['expected']; at=c['at']
    for lab,got in t['res'].items():
        e = exp
        if exp=='silent': e='silent'
        # reads covering: wrapF r0 covers L-250..L+250 ; flat covers 0..280; tail covers 320..600
        if lab=='flat' and at>=280: continue
        if lab=='tail' and at<320: continue
        ok = got==e
        if not ok and lab in('flat','tail') and got=='': ok='straddle?'
        st[(lab, ok if ok is True else ('straddle' if ok=='straddle?' else False))]+=1
        if ok is not True and shown[(c['loc'],lab)]<3:
            shown[(c['loc'],lab)]+=1
            print(lab, c['loc'], 'cs',c['cs'], 'at',at, c['base'], 'exp',repr(e),'got',repr(got), t['cds'][:150])
print(dict(st))
