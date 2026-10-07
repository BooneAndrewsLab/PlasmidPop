import json, random, io
from Bio.Seq import Seq
from Bio.SeqRecord import SeqRecord
from Bio.SeqFeature import SeqFeature, SimpleLocation, CompoundLocation
from Bio import SeqIO
rng=random.Random(5)
L=600
def R(n): return ''.join(rng.choice('ACGT') for _ in range(n))
locs={
 'fwd_join':[(570,600,1),(0,60,1)],
 'rev_join':[(570,600,-1),(0,60,-1)],
 'fwd_multi':[(540,560,1),(580,600,1),(0,30,1),(40,70,1)],
 'rev_multi':[(540,560,-1),(580,600,-1),(0,30,-1),(40,70,-1)],
 'fwd_short':[(598,600,1),(0,61,1)],
 'rev_short':[(599,600,-1),(0,62,-1)],
}
cases=[]; cid=0
for name,parts in locs.items():
  for cs in (1,2,3):
    for rep in range(2):
        seq=R(L)
        strand=parts[0][2]
        sl=[SimpleLocation(a,b,strand=s) for a,b,s in parts]
        if strand==-1: sl=sl[::-1]  # Biopython: complement(join(a,b)) stored as reversed parts
        loc=CompoundLocation(sl)
        f=SeqFeature(loc,type='CDS',qualifiers={'codon_start':[str(cs)],'transl_table':['11'],'label':['g']})
        rec=SeqRecord(Seq(seq),id='T',name='T',annotations={'molecule_type':'DNA','topology':'circular'},features=[f])
        h=io.StringIO(); SeqIO.write(rec,h,'genbank'); gb=h.getvalue()
        nt=str(f.extract(rec.seq)); ref_aa=str(Seq(nt[cs-1:][:(len(nt)-cs+1)//3*3]).translate(table=11))
        # genomic positions in reading order
        pos=[]
        for p in sl:
            r=list(range(p.start,p.end))
            pos += r if strand==1 else r[::-1]
        pos=pos[cs-1:]
        near=[p for p in pos if min(p, L-p) <= 8 or p in (559,560,580,581,29,30,39,40)]
        for at in near:
            k=pos.index(at); idx=k//3
            if idx==0 or idx>=len(ref_aa): continue
            for _ in range(1):
                b=rng.choice([c for c in 'ACGT' if c!=seq[at]])
                mseq=seq[:at]+b+seq[at+1:]
                mnt=str(f.extract(Seq(mseq))); maa=str(Seq(mnt[cs-1:][:(len(mnt)-cs+1)//3*3]).translate(table=11))
                diff=[i for i in range(len(ref_aa)) if ref_aa[i]!=maa[i]]
                if not diff: exp='silent'
                else:
                    i=diff[0]; x=ref_aa[i]; y=maa[i]
                    exp = f'p.{x}{i+1}*' if y=='*' else (f'p.*{i+1}{y}' if x=='*' else f'p.{x}{i+1}{y}')
                cases.append({'id':cid,'loc':name,'cs':cs,'gb':gb,'seq':seq,'at':at,'base':b,'expected':exp,'loc_str':str(loc)}); cid+=1
json.dump(cases,open('cds_cases.json','w')); print(len(cases))
print(cases[0]['gb'].split('FEATURES')[1][:400])
print([c['gb'].split('CDS')[1].split('\n')[0] for c in cases if c['loc']=='rev_multi'][:1])
