import struct, random, json, os
from xml.sax.saxutils import quoteattr
S=os.path.dirname(os.path.abspath(__file__)); D=S+'/synth'
def pk(t,b): return bytes([t])+struct.pack('>I',len(b))+b
def write(path, seq, flags, feats='', primers=None, props='<AdditionalSequenceProperties/>'):
    cookie=b'SnapGene'+bytes([0,1,0,15,0,19])
    b=pk(9,cookie)+pk(0,bytes([flags])+seq.encode())+pk(8,props.encode())
    b+=pk(0x0a,('<?xml version="1.0"?><Features nextValidID="99">'+feats+'</Features>').encode())
    if primers is not None: b+=pk(5,('<?xml version="1.0"?><Primers nextValidID="9">'+primers+'</Primers>').encode())
    open(path,'wb').write(b)
def feat(name, ranges, dirn='1', rf=None, cs=None, typ='CDS'):
    a=f'<Feature recentID="0" name={quoteattr(name)} type="{typ}" directionality="{dirn}" allowSegmentOverlaps="0" consecutiveTranslationNumbering="1"'
    if rf is not None: a+=f' readingFrame="{rf}"'
    a+='>'+''.join(f'<Segment range="{r}" color="#ff0000" type="standard" translated="1"/>' for r in ranges)
    if cs is not None: a+=f'<Q name="codon_start"><V int="{cs}"/></Q>'
    return a+'</Feature>'
random.seed(7)
def rnd(n): return ''.join(random.choice('ACGT') for _ in range(n))
cases=[]
# A: frames
L=300; seq=rnd(L)
for dirn in ('1','2'):
  for rf in (None,'1','2','3','-1','-2','-3'):
    for cs in (None,'1','2','3'):
      for segs in (['11-100'], ['11-40','51-100'], ['11-30','41-60','71-100'], ['281-300','1-40'], ['291-30']):
        name=f'A_{dirn}_{rf}_{cs}_{len(segs)}_{segs[0]}'
        p=f'{D}/{name}.dna'.replace(' ','')
        write(p, seq, 3, feat('x', segs, dirn, rf, cs))
        cases.append({'file':p,'kind':'frame','dirn':dirn,'rf':rf,'cs':cs,'segs':segs,'L':L,'circ':True})
# B: sticky clip
L=120; seq=rnd(L)
for up in range(-4,5):
  for down in range(-4,5):
    for dirn in ('1','2'):
      for rf in ('1','2','3') if dirn=='1' else ('-1','-2','-3','2','3'):
        for si,segs in enumerate((['1-120'], ['1-2','4-60','70-120'], ['1-60','61-118','119-120'])):
          name=f'B_{up}_{down}_{dirn}_{rf}_{si}'
          p=f'{D}/{name}.dna'
          props=f'<AdditionalSequenceProperties><UpstreamStickiness>{up}</UpstreamStickiness><DownstreamStickiness>{down}</DownstreamStickiness></AdditionalSequenceProperties>'
          write(p, seq, 2, feat('x', segs, dirn, rf, None), props=props)
          cases.append({'file':p,'kind':'sticky','dirn':dirn,'rf':rf,'segs':segs,'L':L,'up':up,'down':down,'circ':False})
# C: ranges
L=50; seq=rnd(L)
for circ in (True, False):
  for r in ['1-50','50-49','10-9','2-1','1-0','50-1','49-2','0-5','5-5','5-51','51-60','45-55','1-1','50-50','20-10']:
    p=f'{D}/C_{int(circ)}_{r}.dna'
    write(p, seq, 3 if circ else 2, feat('r', [r], '1', None, None, 'misc_feature'))
    cases.append({'file':p,'kind':'range','r':r,'L':L,'circ':circ})
  for loc in ['0-49','10-9','1-0','49-0','49-48','0-0','49-49','0-50','45-4','20-10']:
    for bs in ('0','1'):
      p=f'{D}/P_{int(circ)}_{loc}_{bs}.dna'
      prim=f'<Primer recentID="0" name="p" sequence="ACGT"><BindingSite location="{loc}" boundStrand="{bs}" annealedBases="ACGT" meltingTemperature="50"/></Primer>'
      write(p, seq, 3 if circ else 2, '', prim)
      cases.append({'file':p,'kind':'primer','loc':loc,'bs':bs,'L':L,'circ':circ})
# D: flags
for fl in range(256):
    p=f'{D}/F_{fl}.dna'; write(p, seq, fl)
    cases.append({'file':p,'kind':'flags','flags':fl})
json.dump(cases, open(S+'/cases.json','w')); json.dump([c['file'] for c in cases], open(S+'/in_synth.json','w'))
print(len(cases))
