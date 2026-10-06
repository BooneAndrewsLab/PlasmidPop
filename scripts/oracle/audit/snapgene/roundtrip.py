import sys,json,os,io,warnings; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
warnings.simplefilter('ignore')
from Bio import SeqIO
from raw import parse
from collections import Counter
st=Counter(); probs=[]
for o in json.load(open('ours.json')):
    r=SeqIO.read(io.StringIO(o['genbank']),'genbank')
    if str(r.seq).upper()!=o['seq'].upper(): probs.append((o['file'],'seq'))
    d=parse(o['file'])
    raw=[f for f in d['features'] if f['attrs'].get('type')=='CDS']
    gb=[f for f in r.features if f.type=='CDS']
    ourc=[f for f in o['features'] if f['type']=='CDS']
    if len(gb)!=len(raw): probs.append((os.path.basename(o['file']),'cdscount',len(gb),len(raw))); continue
    for rf,g,oc in zip(raw,gb,ourc):
        t=[v for q,v in rf['quals'] if q=='translation']
        cs=int(g.qualifiers.get('codon_start',['1'])[0]); tt=int(g.qualifiers.get('transl_table',['1'])[0])
        nt=g.location.extract(r.seq)[cs-1:]; nt=nt[:len(nt)//3*3]
        bp=str(nt.translate(table=tt)).rstrip('*')
        op=oc['protein'].rstrip('*')
        st['cds']+=1
        if bp[1:]!=op[1:] or len(bp)!=len(op): probs.append((os.path.basename(o['file']),'bio!=ours',rf['attrs'].get('name'),bp[:15],op[:15]))
        if t:
            tv=t[0].replace(',','').replace('*','')
            if bp.replace('*','')[1:]!=tv[1:]: st['bio!=file']+=1; probs.append((os.path.basename(o['file']),'bio!=file',rf['attrs'].get('name'),rf['attrs'].get('readingFrame'),cs,bp[:12],tv[:12]))
            else: st['ok']+=1
print(st)
for p in probs: print(p)
