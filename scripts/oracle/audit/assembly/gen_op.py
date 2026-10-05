import json, random, os
D=os.path.dirname(os.path.abspath(__file__)); random.seed(5)
comp=str.maketrans('ACGTacgt','TGCAtgca'); rc=lambda s:s.translate(comp)[::-1]
def rnd(n): return ''.join(random.choice('ACGT') for _ in range(n))
cases=[]
def c(name, vlen, tlen, start, end, kit, tcirc=False, lower=False, vlower=False):
    v=rnd(vlen); t=rnd(tlen)
    if lower: t=t.lower()
    if vlower: v=v.lower()
    cases.append({'name':name,'vector':v,'template':t,'region':{'start':start,'end':end},
                  'kit':kit,'templateCircular':tcirc})
c('inf-basic',3000,2000,500,1200,'in-fusion')
c('neb-basic',3000,2000,500,1200,'nebuilder')
c('inf-small-insert',3000,2000,500,560,'in-fusion')
c('neb-insert-at-start',3000,2000,0,800,'nebuilder')
c('neb-insert-at-end',3000,2000,1200,2000,'nebuilder')
c('inf-lowercase-template',3000,2000,500,1200,'in-fusion',lower=True)
c('inf-lowercase-vector',3000,2000,500,1200,'in-fusion',vlower=True)
c('neb-circ-template',3000,2000,500,1200,'nebuilder',tcirc=True)
c('neb-circ-template-origin',3000,2000,1800,2300,'nebuilder',tcirc=True)  # wraps origin
c('inf-tiny-vector',40,2000,500,1200,'in-fusion')
json.dump(cases, open(D+'/op_cases.json','w'))
print(len(cases))
