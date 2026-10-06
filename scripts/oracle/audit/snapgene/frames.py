import sys; sys.path.insert(0, sys.argv[1])
from raw import *
for f in files():
    d=parse(f)
    for ft in d['features']:
        a=ft['attrs']
        rf=a.get('readingFrame')
        if rf not in (None,'1','-1') or a.get('geneticCode'):
            cs=[v for q,v in ft['quals'] if q=='codon_start']; tt=[v for q,v in ft['quals'] if q=='transl_table']
            tr=[v for q,v in ft['quals'] if q=='translation']
            print(os.path.basename(f), a.get('name'), a.get('type'), 'rf',rf,'dir',a.get('directionality'),'gc',a.get('geneticCode'),'cs',cs,'tt',tt,[s['range'] for s in ft['segs']], 'tr', (tr[0][:20] if tr else None), len(d['seq']))
