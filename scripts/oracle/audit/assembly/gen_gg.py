import json, random, os
from Bio.Seq import Seq
from Bio.Restriction import BsaI, BsmBI, BbsI, SapI, Esp3I
from pydna.dseq import Dseq

D = os.path.dirname(os.path.abspath(__file__))
random.seed(42)
comp = str.maketrans('ACGTacgt','TGCAtgca')
def rc(s): return s.translate(comp)[::-1]
def rnd(n): return ''.join(random.choice('ACGT') for _ in range(n))

ENZ = {
 'BsaI':  dict(site='GGTCTC', spacer=1, oh=4, bio=BsaI),
 'BsmBI': dict(site='CGTCTC', spacer=1, oh=4, bio=BsmBI),
 'BbsI':  dict(site='GAAGAC', spacer=2, oh=4, bio=BbsI),
 'SapI':  dict(site='GCTCTTC', spacer=1, oh=3, bio=SapI),
}

def no_site(s, e):
    st = ENZ[e]['site']
    return st not in s and rc(st) not in s

def body(n, e):
    while True:
        s = rnd(n)
        if no_site(s, e): return s

def overhangs(k, L):
    """k distinct, non-palindromic, pairwise >1 mismatch overhangs."""
    out=[]
    while len(out)<k:
        o = rnd(L)
        if o == rc(o): continue
        ok=True
        for p in out:
            if sum(a!=b for a,b in zip(o,p))<=1: ok=False
            if sum(a!=b for a,b in zip(o,rc(p)))<=1: ok=False
        if ok and o not in out: out.append(o)
    return out

def make_part(e, oh_left, oh_right, bodylen, flank=8):
    E = ENZ[e]
    sp = 'A'*E['spacer']
    while True:
        fl, fr = rnd(flank), rnd(flank)
        b = body(bodylen, e)
        s = fl + E['site'] + sp + oh_left + b + oh_right + sp + rc(E['site']) + fr
        # exactly two sites
        if s.count(E['site'])==1 and s.count(rc(E['site']))==1:
            return s, oh_left + b   # kept fragment top strand

cases=[]
def gg_case(name, enzyme, nparts, bodylens, flip=(), rotate=0):
    L = ENZ[enzyme]['oh']
    ohs = overhangs(nparts, L)
    parts=[]; kept=[]
    for i in range(nparts):
        s, k = make_part(enzyme, ohs[i], ohs[(i+1)%nparts], bodylens[i])
        parts.append({'name': f'p{i+1}', 'seq': s}); kept.append(k)
    expected = ''.join(kept)   # circular, starting at kept[0]
    order = list(range(nparts))
    if rotate: order = order[rotate:]+order[:rotate]
    inputs=[]
    for i in order:
        p=dict(parts[i])
        if i in flip: p['seq']=rc(p['seq'])
        inputs.append(p)
    cases.append({'name':name,'enzyme':enzyme,'parts':inputs,'expected':expected,
                  'overhangs':ohs,'keptFirst':kept[order[0]]})

gg_case('bsa-2',  'BsaI', 2, [600, 1200])
gg_case('bsa-3',  'BsaI', 3, [500, 700, 1500])
gg_case('bsa-4',  'BsaI', 4, [400, 500, 600, 2000])
gg_case('bsa-6',  'BsaI', 6, [300,400,500,600,700,2500])
gg_case('bsa-3-flip','BsaI',3,[500,700,1500], flip=(1,))
gg_case('bsa-4-flip2','BsaI',4,[400,500,600,2000], flip=(1,3))
gg_case('bsa-4-rot','BsaI',4,[400,500,600,2000], rotate=2)
gg_case('bsa-4-fliprot','BsaI',4,[400,500,600,2000], flip=(0,2), rotate=1)
gg_case('bsmbi-3','BsmBI',3,[500,700,1500])
gg_case('bsmbi-4-flip','BsmBI',4,[400,500,600,2000], flip=(2,))
gg_case('bbsi-3','BbsI',3,[500,700,1500])
gg_case('bbsi-4-flip','BbsI',4,[400,500,600,2000], flip=(1,))
gg_case('sapi-3','SapI',3,[500,700,1500])
gg_case('sapi-4-flip','SapI',4,[400,500,600,2000], flip=(3,))

# ---- independent oracle: Biopython / pydna cut + overhang walk ----
def oracle(case):
    E = ENZ[case['enzyme']]; bio = E['bio']
    pieces=[]
    for p in case['parts']:
        d = Dseq(p['seq'], circular=False)
        for f in d.cut(bio):
            s = str(f)             # full double-stranded extent as watson
            w = f.watson; c = f.crick
            ov = f.ovhg            # offset of crick 3' end rel watson 5'
            # keep only fragments with two sticky ends and no remaining site
            if bio.search(Seq(f.watson)) or bio.search(Seq(f.crick)): continue
            pieces.append(f)
    return pieces

def frag_tuple(f):
    """(left_overhang, topstrand_between_topcuts, right_overhang) for a 5' overhang frag."""
    # pydna Dseq: watson, crick, ovhg (= position of crick 3'end relative to watson 5'end)
    w = f.watson; c = f.crick; o = f.ovhg
    # left 5' overhang length = -o when o<0?  We'll derive from str repr instead.
    return w, c, o

for case in cases:
    E = ENZ[case['enzyme']]; bio = E['bio']; L=E['oh']
    frs=[]
    for p in case['parts']:
        d = Dseq(p['seq'], circular=False)
        for f in d.cut(bio):
            if bio.search(Seq(f.watson), linear=True) or bio.search(Seq(f.crick), linear=True):
                continue
            frs.append(f)
    case['oracle_frags'] = [{'watson':f.watson,'crick':f.crick,'ovhg':f.ovhg} for f in frs]

json.dump(cases, open(D+'/gg_cases.json','w'))
print('cases', len(cases))
for c in cases:
    print(c['name'], c['enzyme'], 'parts', len(c['parts']), 'expected len', len(c['expected']),
          'oracle frags', len(c['oracle_frags']), [f['ovhg'] for f in c['oracle_frags']])
