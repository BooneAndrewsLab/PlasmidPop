import sys; sys.path.insert(0, sys.argv[1])
from raw import *
from collections import Counter
fa=Counter(); sa=Counter(); rf=Counter(); flags=Counter(); stick=Counter(); qn=Counter(); gc=Counter()
for f in files():
    d=parse(f)
    flags[d.get('flags')]+=1
    px=d.get('propxml','')
    m1=re.search(r'<UpstreamStickiness>(-?\d+)',px); m2=re.search(r'<DownstreamStickiness>(-?\d+)',px)
    stick[(m1 and m1.group(1), m2 and m2.group(1))]+=1
    for ft in d['features']:
        for k,v in ft['attrs'].items():
            fa[k]+=1
        if ft['attrs'].get('type')=='CDS':
            rf[(ft['attrs'].get('readingFrame'), ft['attrs'].get('directionality'))]+=1
            gc[ft['attrs'].get('geneticCode')]+=1
        for s in ft['segs']:
            for k,v in s.items(): sa[(k, v if k in ('type','translated') else '')]+=1
        for q,_ in ft['quals']: qn[q]+=1
print('flags',flags); print('stick',stick); print('featattrs',fa); print('segattrs',sa); print('CDS readingFrame,dir',rf); print('geneticCode',gc); print('quals',qn.most_common(40))
