"""Independent raw SnapGene packet parser (oracle)."""
import struct, sys, json, re, glob, os
import xml.etree.ElementTree as ET

def packets(b):
    i=0; out=[]
    while i < len(b):
        t=b[i]; n=struct.unpack('>I', b[i+1:i+5])[0]
        out.append((t, b[i+5:i+5+n])); i+=5+n
    return out

def parse(path):
    b=open(path,'rb').read()
    P=packets(b)
    d={'file':path}
    for t,p in P:
        if t==0:
            d['flags']=p[0]; d['seq']=p[1:].decode('ascii')
        elif t==0x0a:
            d['featxml']=p.decode('utf-8')
        elif t==0x05:
            d['primxml']=p.decode('utf-8')
        elif t==0x08:
            d['propxml']=p.decode('utf-8')
    d['types']=sorted(set(t for t,_ in P))
    feats=[]
    if 'featxml' in d:
        root=ET.fromstring(d['featxml'])
        for f in root.iter('Feature'):
            segs=[]
            for s in f.findall('Segment'):
                segs.append(dict(s.attrib))
            quals=[]
            for q in f.findall('Q'):
                for v in q.findall('V'):
                    quals.append((q.get('name'), v.get('text', v.get('int', v.get('predef')))))
                if not q.findall('V'): quals.append((q.get('name'), None))
            feats.append({'attrs':dict(f.attrib),'segs':segs,'quals':quals})
    d['features']=feats
    prims=[]
    if 'primxml' in d:
        root=ET.fromstring(d['primxml'])
        for pr in root.iter('Primer'):
            prims.append({'attrs':dict(pr.attrib),'sites':[dict(s.attrib) for s in pr.findall('BindingSite')]})
    d['primers']=prims
    return d

def files():
    return sorted(glob.glob(os.path.expanduser('~/Programs/snapgene_8.2.2_linux')+'/**/*.dna', recursive=True))
