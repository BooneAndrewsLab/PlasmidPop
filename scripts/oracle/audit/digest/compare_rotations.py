import json
rot=json.load(open('rotations.json')); L=4361
base=rot['0']
def norm(sites,off): return sorted((s['enzyme'],(s['cut']+off)%L,(s['cutBottom']+off)%L,(s['siteStart']+off)%L,s['strand']) for s in sites)
def normm(marks,off): return sorted((m['enzyme'],(m['siteStart']+off)%L,tuple(m['marks'])) for m in marks)
b=norm(base['sites'],0); bm=normm(base['marks'],0)
print('pBR322 sites at rotation 0:',len(b),'marked:',len(bm))
for off,v in rot.items():
    o=int(off); s=norm(v['sites'],o); m=normm(v['marks'],o)
    ok=s==b; okm=m==bm
    print(f'  rotation {o:5d}: sites {"OK" if ok else "DIFF"} ({len(s)}), methylation marks {"OK" if okm else "DIFF"} ({len(m)})')
    if not ok:
        print('    only base:',sorted(set(b)-set(s))[:5]); print('    only rot :',sorted(set(s)-set(b))[:5])
    if not okm:
        print('    only base:',sorted(set(bm)-set(m))[:5]); print('    only rot :',sorted(set(m)-set(bm))[:5])
