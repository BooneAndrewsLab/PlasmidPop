import json
dig=json.load(open('digests.json'))
tot=0; bad=0
for key,d in dig.items():
    src=[f for f in d['sourceFeatures'] if f['type']!='source']
    if not src: continue
    L=len(d['sequence']); circ=d['topology']=='circular'
    for fr in d['fragments']:
        rs,re_=fr['range']['start'],fr['range']['end']
        exp=set()
        for f in src:
            segs=[]
            for sg in f['segments']:
                if sg['kind']!='range': segs=None;break
                for sh in ([0,L,-L] if circ else [0]):
                    a=sg['start']+sh; b=sg['end']+sh
                    s=max(a,rs); e=min(b,re_)
                    if s<e: segs.append((s-rs,e-rs))
            if segs: exp.add((f['name'],f['strand'],tuple(sorted(segs))))
        got=set()
        for f in fr['features']:
            got.add((f['name'],f['strand'],tuple(sorted((sg['start'],sg['end']) for sg in f['segments']))))
        tot+=1
        if exp!=got:
            bad+=1
            print(f'{key} fragment {rs}-{re_}:'); print('   expected-only',sorted(exp-got)[:4]); print('   got-only     ',sorted(got-exp)[:4])
print(f'{tot} fragments with features compared, {bad} differ')
