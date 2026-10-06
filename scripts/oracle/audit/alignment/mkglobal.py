import json,sys
cs=json.load(open('cases_meta.json')); out=[]
for c in cs:
    m=c['meta']
    if c['kind'] in ('revcomp','nrun','lowcomplex'): continue
    fl=m['fl']; b=c['b'][fl[0]:len(c['b'])-fl[1]] if fl[1] else c['b'][fl[0]:]
    a=c['a'][m['s']:m['s']+m['rl']+ (c['a'].find('X')+1)*0]
    if c['kind']=='tandemref': a=c['a'][m['s']:m['s']+m['rl']+400]
    out.append({'id':c['id'],'kind':c['kind'],'a':a,'b':b,'mode':'global'})
json.dump(out,open('gcases.json','w')); print(len(out))
