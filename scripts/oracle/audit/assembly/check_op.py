import json, os
from pydna.dseqrecord import Dseqrecord
from pydna.amplify import pcr as pydna_pcr
from pydna.primer import Primer
D=os.path.dirname(os.path.abspath(__file__))
comp=str.maketrans('ACGTacgt','TGCAtgca'); rc=lambda s:s.translate(comp)[::-1]
cases={c['name']:c for c in json.load(open(D+'/op_cases.json'))}
out=json.load(open(D+'/op_out.json'))
KIT={'in-fusion':15,'nebuilder':20}
bad=0
for o in out:
    c=cases[o['name']]; ov=KIT[c['kit']]
    V=c['vector'].upper(); T=c['template'].upper()
    s,e=c['region']['start'],c['region']['end']
    if c['templateCircular'] and e>len(T):
        ins=(T+T)[s:e]
    else:
        ins=T[s:e]
    if o.get('error') or o['problem']:
        print('FAIL',o['name'],o.get('error') or o['problem']); bad+=1; continue
    f=o['forward']; r=o['reverse']
    issues=[]
    # 1. tails
    if f['tail']!=V[-ov:]: issues.append(f"fwd tail {f['tail']} != vector last {ov} {V[-ov:]}")
    if r['tail']!=rc(V[:ov]): issues.append(f"rev tail {r['tail']} != rc(vector first {ov})")
    # 2. tail is 5' of the sequence
    if not f['sequence'].upper().startswith(f['tail']): issues.append('fwd tail not at 5 prime')
    if not r['sequence'].upper().startswith(r['tail']): issues.append('rev tail not at 5 prime')
    # 3. annealing part matches template, right strand
    fa=f['sequence'][len(f['tail']):].upper(); ra=r['sequence'][len(r['tail']):].upper()
    if fa!=ins[:len(fa)]: issues.append('fwd anneal != insert start')
    if ra!=rc(ins[-len(ra):]): issues.append('rev anneal != rc(insert end)')
    if f['annealLength']!=len(fa): issues.append('fwd annealLength mismatch')
    if r['annealLength']!=len(ra): issues.append('rev annealLength mismatch')
    # 4. pydna PCR with these primers
    tmpl=Dseqrecord(c['template'], circular=c['templateCircular'])
    try:
        amp=pydna_pcr(Primer(f['sequence'].upper()), Primer(r['sequence'].upper()), tmpl)
        amp_s=str(amp.seq).upper()
    except Exception as ex:
        amp_s=None; issues.append('pydna pcr: '+str(ex)[:60])
    if amp_s is not None:
        if o['amplicon'] is None or o['amplicon'].upper()!=amp_s:
            issues.append(f"amplicon differs: pp {len(o['amplicon'] or '')} pydna {len(amp_s)}")
        expected_amp = V[-ov:] + ins + V[:ov]
        if amp_s != expected_amp: issues.append(f'pydna amplicon != tail+insert+tail ({len(amp_s)} vs {len(expected_amp)})')
    # 5. product == vector + insert, circular
    exp = V + ins
    p=(o['product'] or '').upper()
    if len(p)!=len(exp) or not (p in exp+exp or rc(p) in exp+exp):
        issues.append(f'product {len(p)} != vector+insert {len(exp)}')
    if o['circular'] is not True: issues.append('product not circular')
    print(('OK  ' if not issues else 'BAD '), o['name'], 'fwd', len(f['sequence']), 'rev', len(r['sequence']),
          'amp', len(o['amplicon'] or ''), 'prod', len(p), ('' if not issues else issues))
    if issues: bad+=1
print('bad',bad,'of',len(out))
