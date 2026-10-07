import json,re,collections,sys
d=json.load(open(sys.argv[1]))
d=[x for x in d if 'desc' in x and not x['desc'].startswith('rot')]
def amb(x):
    s=x['seq'];L=len(s);c=x['circular']
    g=lambda i: s[i%L] if c else (s[i] if 0<=i<L else None)
    m=re.match(r'ins (\w+)@(\d+)',x['desc'])
    if m:
        t,p=m.group(1),int(m.group(2))
        return t[-1]==g(p-1) or t[0]==g(p)
    m=re.match(r'(del|rep) \[(\d+),(\d+)\)->"(\w*)"',x['desc'])
    k,a,b,t=m.group(1),int(m.group(2)),int(m.group(3)),m.group(4)
    old=''.join(g(i) or '' for i in range(a,b))
    if k=='rep' and t:
        if old[:1]==t[:1] or old[-1:]==t[-1:]: return True
        if len(t)!=len(old) and (t[-1]==g(a-1) or t[0]==g(b) or old[0]==g(b) or old[-1]==g(a-1)): return True
        if len(t)!=len(old) and (set(t)&set(old)): return 'maybe'
        return False
    return g(a-1)==g(b-1) or g(a)==g(b)
u={}
for x in d: u.setdefault((x['seq'],x['desc'],x['f']),x)
cnt=collections.Counter()
for x in u.values():
    a=amb(x); cnt[(x['desc'][:3],a)]+=1
    if a is not True:
        print(a,x['f'],x['circular'],'L',x['L'],x['desc'],'before',[(s['start'],s['end']) for s in x['before']],'after',[(s['start'],s['end']) for s in x['after']] if x['after'] else None,'exp',x['expected'],'got',x['got']); print('  ',x['seq']); print('  ',x['newSeq'])
print(cnt)
