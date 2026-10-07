from pydna.dseqrecord import Dseqrecord
from Bio.SeqFeature import SeqFeature, FeatureLocation
from Bio.Restriction import EcoRI
CDS='ATGCGAATTCCGAAACTGTTTGCATGGTAA'
v=Dseqrecord('C'*10+CDS+'G'*20, circular=True)
v.features.append(SeqFeature(FeatureLocation(10,40,1),type='CDS'))
lin,=v.cut(EcoRI)
print('linear frag features', [(str(f.location)) for f in lin.features], len(lin))
ins=Dseqrecord('GAATTC'+'T'*20+'GAATTC')
_,mid,_=ins.cut(EcoRI)
p=(lin+mid).looped()
print('product len',len(p),'features',[str(f.location) for f in p.features])
