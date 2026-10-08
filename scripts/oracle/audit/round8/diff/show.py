import json,sys,glob
# usage: show.py filter-expr  (x = finding dict, k = list name)
expr=sys.argv[1]; lists=sys.argv[2].split(',') if len(sys.argv)>2 else ['fu']
n=0
for p in sorted(glob.glob('*.findings.json')):
    if p.startswith('t-'): continue
    d=json.load(open(p))
    for k in lists:
        for x in d[k]:
            if eval(expr):
                n+=1
                if n<=int(sys.argv[3] if len(sys.argv)>3 else 30): print(p[:-14],k,json.dumps(x))
print('total',n)
