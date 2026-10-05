import json, random, os
from pydna.dseq import Dseq
from Bio.Restriction import BsaI, SapI, BbsI, BsmBI
D=os.path.dirname(os.path.abspath(__file__))
random.seed(99)
comp=str.maketrans('ACGT','TGCA')
def rc(s): return s.translate(comp)[::-1]
def rnd(n): return ''.join(random.choice('ACGT') for _ in range(n))
SITE={'BsaI':'GGTCTC','BsmBI':'CGTCTC','BbsI':'GAAGAC','SapI':'GCTCTTC'}
SP={'BsaI':1,'BsmBI':1,'BbsI':2,'SapI':1}
def body(n,e):
    while True:
        s=rnd(n)
        if SITE[e] not in s and rc(SITE[e]) not in s: return s
def ohs(k,L):
    out=[]
    while len(out)<k:
        o=rnd(L)
        if o==rc(o) or o in out: continue
        if any(sum(a!=b for a,b in zip(o,p))<=1 or sum(a!=b for a,b in zip(o,rc(p)))<=1 for p in out): continue
        out.append(o)
    return out
cases=[]

# --- circular destination vector + linear inserts ---
def circ_vector_case(name, e, ninsert, rotate_origin=0, origin_in_site=False):
    L=4 if e!='SapI' else 3
    o=ohs(ninsert+1,L); sp='A'*SP[e]
    # vector: backbone + [BsaI site pointing outward at each side of a dropout]
    # circular vector reads:  <backbone>  OH_last  sp' site'(rc)   dropout   site sp  OH_0 ... wait
    # Construct: linear string then circularise.
    backbone = body(2500,e)
    drop = body(300,e)
    # layout (top strand, circular):  OH0 + backbone + OHlast + sp + rc(site) ... no.
    # Cut must release backbone carrying OHlast..OH0.  Use:
    #   [rc(site)+? ] Simpler: dropout flanked by sites pointing INTO the dropout? No:
    #   For GG the vector keeps the backbone and loses the dropout, so the sites sit IN the
    #   dropout, pointing outward into the backbone.
    #   dropout = site + sp + OH0  ... no: cutting leaves OH0 on the backbone side.
    # top strand: ... backbone ... | OHlast | sp | rc(site) | drop | site | sp | OH0 | backbone...
    # forward site before OH0 cuts top after site+sp -> start of OH0  (OH0 on backbone) OK
    # rc(site) after OHlast: reverse site at position r cuts top at r-5 => start of OHlast OK (spacer 1)
    # for spacer 2 (BbsI) offsets shift consistently since we use sp both sides.
    seq = backbone[:1200] + o[-1] + sp + rc(SITE[e]) + drop + SITE[e] + sp + o[0] + backbone[1200:]
    seq = seq[rotate_origin:] + seq[:rotate_origin]
    parts=[{'name':'vector','seq':seq,'circular':True}]
    kept_vec = o[0] + backbone[1200:] + backbone[:1200] + o[-1]   # hmm overhang double count
    # Actually backbone fragment top strand runs from OH0 start round to OHlast start:
    kept_vec = o[0] + backbone[1200:] + backbone[:1200]
    insert_bodies=[]
    for i in range(ninsert):
        b=body(400+100*i,e)
        s = rnd(8)+SITE[e]+sp+o[i+1-1+1]+b+o[i+2 if i+2<len(o) else -1]+sp+rc(SITE[e])+rnd(8)
        insert_bodies.append(None)
    # simpler: inserts chain o[0]->o[1]->...->o[ninsert]=o[-1]
    parts=[{'name':'vector','seq':seq,'circular':True}]
    kept=[kept_vec]
    for i in range(ninsert):
        b=body(400+100*i,e)
        s = rnd(8)+SITE[e]+sp+o[i]+b+o[i+1]+sp+rc(SITE[e])+rnd(8)
        # vector supplies o[0] at its start and expects o[-1]=o[ninsert] at its end
        parts.append({'name':f'ins{i+1}','seq':s,'circular':False})
        kept.append(o[i]+b)
    # vector fragment starts with o[0]; chain: vector(o0.. ends with ohlast? )
    # vector top strand from OH0 start to OHlast start = o[0]+backbone ; right overhang = o[-1]
    # inserts: ins1 left=o[0]?? conflict. Shift inserts to start at o[1].
    parts=[{'name':'vector','seq':seq,'circular':True}]
    kept=[o[0]+backbone[1200:]+backbone[:1200]]
    cur=0
    for i in range(ninsert):
        b=body(400+100*i,e)
        left=o[(i+1)%len(o)] if i+1<len(o) else o[-1]
        right=o[i+2] if i+2<len(o) else o[0]
        parts.append({'name':f'ins{i+1}','seq':rnd(8)+SITE[e]+sp+left+b+right+sp+rc(SITE[e])+rnd(8),'circular':False})
        kept.append(left+b)
    cases.append({'name':name,'enzyme':e,'parts':parts,'expected':''.join(kept)})

# vector's right overhang must equal first insert's left overhang.
# With o = [o0, o1, ..., on]: vector = o0..(right overhang o_n?) — rebuild cleanly below.
cases=[]
def clean_vec_case(name,e,ninsert,rot=0,flip=()):
    L=4 if e!='SapI' else 3
    o=ohs(ninsert+1,L); sp='A'*SP[e]
    backbone=body(2500,e); drop=body(300,e)
    # circular vector top strand: [o_n][sp][rc site][drop][site][sp][o_0] then backbone
    seq = o[-1]+sp+rc(SITE[e])+drop+SITE[e]+sp+o[0]+backbone
    seq = seq[rot:]+seq[:rot]
    kept=[o[0]+backbone]          # vector fragment: left oh o0, right oh o_n
    parts=[{'name':'vector','seq':seq,'circular':True}]
    for i in range(ninsert):
        b=body(400+100*i,e)
        left=o[i+1] if i>0 else o[0]
        # chain: vector right oh = o[-1]; so inserts must run o[-1] -> ... -> o[0]
        pass
    # chain order: vector(o0 -> o_n), ins1(o_n -> o_{n-1}), ... no, keep it simple:
    # relabel: vector left=o0 right=on ; ins_i left = o_{i-1}? Use a fresh list:
    chain = [o[0]] + [o[k] for k in range(1,ninsert+1)]
    # vector: left chain[0], right chain[1]; ins_i: left chain[i], right chain[i+1 mod]
    kept=[chain[0]+backbone]
    seq = chain[1]+sp+rc(SITE[e])+drop+SITE[e]+sp+chain[0]+backbone
    seq = seq[rot:]+seq[:rot]
    parts=[{'name':'vector','seq':seq,'circular':True}]
    for i in range(1,ninsert+1):
        b=body(400+100*i,e)
        left=chain[i]; right=chain[(i+1)%len(chain)]
        s=rnd(8)+SITE[e]+sp+left+b+right+sp+rc(SITE[e])+rnd(8)
        parts.append({'name':f'ins{i}','seq':s,'circular':False})
        kept.append(left+b)
    for i in flip:
        parts[i]['seq']=rc(parts[i]['seq'])
    cases.append({'name':name,'enzyme':e,'parts':parts,'expected':''.join(kept)})

clean_vec_case('vec-circ-1ins','BsaI',1)
clean_vec_case('vec-circ-2ins','BsaI',2)
clean_vec_case('vec-circ-3ins','BsaI',3)
clean_vec_case('vec-circ-3ins-origin-shift','BsaI',3,rot=2)   # origin inside the OH/site region
clean_vec_case('vec-circ-3ins-origin-mid-site','BsaI',3,rot=5)
clean_vec_case('vec-circ-2ins-flip','BsaI',2,flip=(2,))
clean_vec_case('vec-circ-2ins-sapi','SapI',2)
clean_vec_case('vec-circ-2ins-bbsi','BbsI',2)
clean_vec_case('vec-circ-3ins-bsmbi','BsmBI',3)
json.dump(cases, open(D+'/gg2_cases.json','w'))
for c in cases: print(c['name'], c['enzyme'], len(c['parts']), 'expected', len(c['expected']))
