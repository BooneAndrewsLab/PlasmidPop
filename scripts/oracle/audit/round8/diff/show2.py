import json,sys,glob
pat, expr, lst = sys.argv[1], sys.argv[2], sys.argv[3]
n=0
for p in sorted(glob.glob(pat)):
    d=json.load(open(p))
    for x in d[lst]:
        if eval(expr):
            n+=1
            if n<=int(sys.argv[4] if len(sys.argv)>4 else 40):
                print(p.split('.')[0], {k:v for k,v in x.items() if k not in ('o1',)})
print('total',n)
