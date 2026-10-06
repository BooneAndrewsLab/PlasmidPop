import sys,json,os,re,warnings; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
warnings.simplefilter('ignore')
from Bio import SeqIO
from raw import parse
from collections import Counter
ours=json.load(open('ours.json')); st=Counter(); probs=[]
def stick(px, tag):
    m=re.search(r'<%s>\s*(-?\d+)'%tag, px or ''); return int(m.group(1)) if m else 0
for o in ours:
    try: r=SeqIO.read(o['file'],'snapgene')
    except Exception as e: probs.append((o['file'],'bio fail',str(e)[:80])); continue
    d=parse(o['file']); L0=len(d['seq'])
    circ=r.annotations.get('topology')=='circular'
    up=stick(d.get('propxml'),'UpstreamStickiness') if not circ else 0; down=stick(d.get('propxml'),'DownstreamStickiness') if not circ else 0
    lo=-up if up<0 else 0; hi=L0-down if down>0 else L0
    if str(r.seq)[lo:hi]!=o['seq']: probs.append((o['file'],'seq'))
    if (o['topology']=='circular')!=circ: probs.append((o['file'],'topo'))
    st['files']+=1
    bf=[f for f in r.features if f.type!='primer_bind']
    of=[f for f in o['features'] if not (f['type']=='primer_bind' and any((q['value'] or '').startswith('sequence: ') for q in f['qualifiers']))]
    bf=[f for f in r.features]  # biopython includes primers as primer_bind
    # match features by order of non-primer features
    bnp=[f for f in r.features if not (f.type=='primer_bind' and 'sequence' not in f.qualifiers and False)]
    L=len(o['seq'])
    def pos_ours(f):
        p=[]
        for s in f['segments']:
            if s['kind']!='range': continue
            p+= [x % L for x in range(s['start'],s['end'])]
        return sorted(p)
    def pos_bio(f):
        p=[int(x)-lo for x in f.location]
        return sorted(x for x in p if 0<=x<L) if not circ else sorted(p)
    bnames=Counter((f.qualifiers.get('label',[''])[0], f.type, tuple(pos_bio(f)), f.location.strand) for f in r.features)
    onames=Counter((f['name'], f['type'], tuple(pos_ours(f)), -1 if f['strand']=='reverse' else 1) for f in o['features'])
    st['feat_bio']+=sum(bnames.values()); st['feat_ours']+=sum(onames.values())
    if bnames!=onames:
        diff=(bnames-onames, onames-bnames)
        probs.append((os.path.basename(o['file']),'feat', [(k[0],k[1],len(k[2]),k[2][:2],k[3]) for k in diff[0]], [(k[0],k[1],len(k[2]),k[2][:2],k[3]) for k in diff[1]]))
print(st); print(len(probs))
for p in probs[:30]: print(p)
