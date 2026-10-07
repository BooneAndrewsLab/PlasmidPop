import json, collections
d=json.load(open('out.json'))
cnt=collections.Counter()
for c in d:
    L=c['L']; rs,re=c['region']
    whole = re-rs==L
    inter=False
    for f in c.get('out',[]):
        rr=[s for s in f['segments'] if s['kind']=='range']
        for i,s in enumerate(rr):
            if (s['ps'] and i!=0) or (s['pe'] and i!=len(rr)-1): inter=True
    if inter: cnt['interior whole=%s'%whole]+=1
print(cnt)
