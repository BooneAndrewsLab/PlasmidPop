"""Compare PlasmidPop digest fragment ends and ligation products against pydna (Dseq cut / + / looped)."""
import json
from pydna.dseq import Dseq
from pydna.dseqrecord import Dseqrecord
from Bio.Restriction import EcoRI, HindIII, BamHI, BglII, PstI, SmaI, PvuII, EcoRV, BsaI, KpnI, SacI
from Bio.Seq import Seq
D = '/tmp/claude-9005/-home-matej-code-WebstormProjects-PlasmidPop/0d36857c-4f3e-42c7-b46a-0fa7317cc69d/scratchpad/audit/digest'
lig = json.load(open(f'{D}/ligations.json'))
dig = json.load(open(f'{D}/digests.json'))
sites = json.load(open(f'{D}/sites.json'))
pUC19 = sites['pUC19']['sequence'].upper(); pBR322 = sites['pBR322']['sequence'].upper(); lam = sites['lambda']['sequence'].upper()

def rot_equal(a, b):
    a = a.upper(); b = b.upper()
    return len(a) == len(b) and a in (b + b)

def rc(s): return str(Seq(s).reverse_complement())

def rot_equal_either(a, b):
    return rot_equal(a, b) or rot_equal(rc(a), b)

def pp_frag_to_dseq(f):
    """PlasmidPop fragment -> pydna Dseq. PP sequence = top strand from top cut to top cut.
    pydna Dseq(watson, crick, ovhg): ovhg = number of bases the crick strand 5' end extends past the watson 5' end
    (positive => crick 5' overhang on left i.e. watson starts later; negative => watson 5' overhang)."""
    seq = f['seq'] if 'seq' in f else f['sequence']
    left, right = f['left'], f['right']
    top = seq.upper()
    # bottom strand coverage in top coords: [bstart, bend)
    bstart = 0; bend = len(top)
    if left['kind'] == "5'": bstart = len(left['overhang'])          # top has 5' overhang on left: bottom starts later
    elif left['kind'] == "3'": bstart = -len(left['overhang'])        # bottom has 3' overhang extending left of top
    if right['kind'] == "5'": bend = len(top) + len(right['overhang'])  # bottom extends past top on right (bottom 5' overhang)
    elif right['kind'] == "3'": bend = len(top) - len(right['overhang'])  # top 3' overhang; bottom stops short
    # top-strand bases of the full double-stranded region
    full = (left['overhang'].upper() if left['kind'] == "3'" else '') + top + (right['overhang'].upper() if right['kind'] == "5'" else '')
    off = len(left['overhang']) if left['kind'] == "3'" else 0
    bottom_top_coords = full[bstart + off: bend + off]
    crick = rc(bottom_top_coords)
    ovhg = bstart  # crick 5' end position relative to watson 5' end in top coords: positive if watson starts earlier... pydna: ovhg = len(crick)-len(watson) when...? use constructor semantics below
    # pydna: Dseq(watson, crick, ovhg): ovhg is "the length of the 5' overhang of the crick strand": positive if crick extends beyond watson on the left (in top coords, bottom starts before top), i.e. -bstart
    return Dseq(top, crick, ovhg=-bstart)

def report(name, pp_product, dseq_product, circular=True):
    s = str(dseq_product.seq) if hasattr(dseq_product, 'seq') else str(dseq_product)
    ok = rot_equal(pp_product, s) if circular else pp_product.upper() == s.upper()
    print(f"  {name}: {'OK' if ok else 'MISMATCH'} len PP={len(pp_product)} pydna={len(s)}")
    if not ok:
        print('    PP   ', pp_product[:80]); print('    pydna', s[:80])
    return ok

print('== fragment ends vs pydna cut ==')
# pUC19 EcoRI+HindIII fragments
for key, enzs in [('pUC19|EcoRI+HindIII', [EcoRI, HindIII]), ('pBR322|EcoRI+PstI', [EcoRI, PstI]), ('pUC19|KpnI+SacI', [KpnI, SacI]), ('pBR322|BsaI+PvuI', None)]:
    d = dig[key]
    if enzs is None: continue
    rec = Dseqrecord(d['sequence'].upper(), circular=d['topology'] == 'circular')
    frags = rec.cut(*enzs)
    pyd = {}
    for f in frags:
        pyd[str(f.seq.watson).upper()] = f.seq
    for f in d['fragments']:
        ds = pp_frag_to_dseq(f)
        w = ds.watson.upper()
        match = pyd.get(w)
        if match is None:
            print(f"  {key}: PP fragment {len(w)} not among pydna watson strands {sorted(len(x) for x in pyd)}")
            continue
        same = (ds.watson.upper() == str(match.watson).upper() and ds.crick.upper() == str(match.crick).upper() and ds.ovhg == match.ovhg)
        print(f"  {key} frag {len(w)}: ends {'OK' if same else 'MISMATCH'} PP ovhg={ds.ovhg} pydna ovhg={match.ovhg} | PP ends {f['left']['kind']} {f['left']['overhang']} / {f['right']['kind']} {f['right']['overhang']}")
        if not same:
            print('    PP   crick', ds.crick[:30], '...', ds.crick[-30:]); print('    pydna crick', str(match.crick)[:30], '...', str(match.crick)[-30:])

print('\n== ligations vs pydna ==')
# a. pUC19 EcoRI/HindIII vector + pBR322 EcoRI/HindIII insert
v = max(Dseqrecord(pUC19, circular=True).cut(EcoRI, HindIII), key=len)
i = min(Dseqrecord(pBR322, circular=True).cut(EcoRI, HindIII), key=len)
try:
    prod = (v + i).looped()
except Exception as ex:
    prod = (v + i.reverse_complement()).looped()
report('EcoRI/HindIII pUC19+pBR322', lig['ecoHind']['product'], prod)

# b. BamHI vector + lambda BglII fragment (both orientations)
v = Dseqrecord(pUC19, circular=True).cut(BamHI)[0]
lf = [f for f in Dseqrecord(lam, circular=False).cut(BglII)]
ins_pp = lig['bamBgl']['ins']['seq'].upper()
cand = [f for f in lf if str(f.seq.watson).upper() == ins_pp]
print('  BglII insert found in pydna cut:', len(cand), 'pydna ovhg', cand[0].seq.ovhg if cand else None, 'PP ends', lig['bamBgl']['ins']['left'], lig['bamBgl']['ins']['right'])
ins = cand[0]
p1 = (v + ins).looped(); p2 = (v + ins.reverse_complement()).looped()
report('BamHI+BglII', lig['bamBgl']['product'], p1)
report('BamHI+BglII flipped', lig['bamBgl']['productFlipped'], p2)
# hybrid site should not be re-cut by BamHI nor BglII, and product has 1 BamHI, 1 BglII? Count sites in product
ps = str(p1.seq).upper()
print('  product BamHI sites:', ps.count('GGATCC') + (ps+ps[:5]).count('GGATCC') - ps.count('GGATCC'), 'BglII:', (ps+ps[:5]).count('AGATCT'), 'hybrid GGATCT/AGATCC:', (ps+ps[:5]).count('GGATCT'), (ps+ps[:5]).count('AGATCC'))
print('  BamHI x EcoRI compatible per PP:', lig['bamEco_compatible'])
try:
    bad = Dseqrecord(pUC19, circular=True).cut(EcoRI)[0] + ins
    print('  pydna EcoRI+BglII join: allowed?!')
except Exception as ex:
    print('  pydna refuses EcoRI+BglII join:', type(ex).__name__)

# c. PstI self
v = Dseqrecord(pUC19, circular=True).cut(PstI)[0]
report('PstI self-close', lig['pst_self']['product'], v.looped())
report('PstI self-close flipped', lig['pst_self_flipped']['product'], v.reverse_complement().looped())
print('  PstI frag PP', lig['pst_self']['frag']['left'], lig['pst_self']['frag']['right'], 'pydna ovhg', v.seq.ovhg, 'watson len', len(v.seq.watson), 'PP len', len(lig['pst_self']['frag']['seq']))
fl = lig['pst_self_flipped']['frag']
print('  PstI flipped frag watson == pydna rc watson:', fl['seq'].upper() == str(v.reverse_complement().seq.watson).upper(), fl['left'], fl['right'])

# d. blunt
v = Dseqrecord(pUC19, circular=True).cut(SmaI)[0]
ins = min(Dseqrecord(pBR322, circular=True).cut(PvuII, EcoRV), key=len)
report('blunt SmaI + PvuII/EcoRV', lig['blunt']['product'], (v + ins).looped())
report('blunt flipped', lig['blunt']['productFlipped'], (v + ins.reverse_complement()).looped())

# e. BsaI self
v = Dseqrecord(pBR322, circular=True).cut(BsaI)[0]
report('BsaI self-close', lig['bsa_self']['product'], v.looped())
report('BsaI self-close flipped', lig['bsa_self_flipped']['product'], v.reverse_complement().looped())
print('  BsaI frag PP ends', lig['bsa_self']['frag']['left'], lig['bsa_self']['frag']['right'], 'pydna ovhg', v.seq.ovhg, 'len', len(v.seq.watson), len(lig['bsa_self']['frag']['seq']))

# f. linear ligation of lambda EcoRI frags 0+1 and 0+flip(1)
lf = Dseqrecord(lam, circular=False).cut(EcoRI)
a, b = lf[0], lf[1]
p = a + b
print('  linear EcoRI 0+1: watson equal:', lig['linear']['product'].upper() == str(p.seq.watson).upper(), 'pydna full len', len(p.seq), 'watson len', len(p.seq.watson), 'PP len', len(lig['linear']['product']), 'pydna ovhg', p.seq.ovhg, 'crick tail', str(p.seq.crick)[:6])
try:
    p = a + b.reverse_complement()
    print('  linear EcoRI 0+flip(1): watson equal:', lig['linear_flipped']['product'].upper() == str(p.seq.watson).upper(), len(p.seq.watson), len(lig['linear_flipped']['product']))
except Exception as ex:
    print('  pydna refuses 0+flip(1):', ex)
print('  linear product ends PP:', lig['linear']['ends'])

# g. partial digest sanity: all fragments are substrings of seq+seq, sizes consistent with cut set
pd = lig['partial_haeII']
cuts = sorted({s['cut'] for s in sites['pUC19']['sites'] if s['enzyme'] == 'HaeII'})
L = len(pUC19)
exp = set()
n = len(cuts)
for i in range(n):
    for k in range(1, n + 1):
        j = (i + k) % n
        end = cuts[j] if cuts[j] > cuts[i] else cuts[j] + L
        if k == n: end = cuts[i] + L
        exp.add(((pUC19 + pUC19)[cuts[i]:end], k - 1))
got = {(f['seq'].upper(), f['uncut']) for f in pd}
print(f'  partial HaeII circular: {len(got)} fragments, expected {len(exp)}, equal={got == exp}')
pdl = lig['partial_haeII_linear']
stops = [0] + cuts + [L]
exp = {(pUC19[stops[i]:stops[j]], j - i - 1) for i in range(len(stops)) for j in range(i + 1, len(stops))}
got = {(f['seq'].upper(), f['uncut']) for f in pdl}
print(f'  partial HaeII linear: {len(got)} fragments, expected {len(exp)}, equal={got == exp}')
