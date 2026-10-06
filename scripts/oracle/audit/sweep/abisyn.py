import struct, sys, shutil
B = 'bio/repo/Tests/Abi/'
def entries(b):
    n = struct.unpack('>i', b[18:22])[0]; off = struct.unpack('>i', b[26:30])[0]
    out = {}
    for i in range(n):
        e = off + 28*i
        name = b[e:e+4].decode('latin1'); num, typ, sz, cnt, dsz, doff = struct.unpack('>ihhiii', b[e+4:e+24])
        out[(name, num)] = dict(e=e, typ=typ, cnt=cnt, dsz=dsz, doff=doff)
    return out
def data(b, t):
    return b[t['doff']:t['doff']+t['dsz']] if t['dsz'] > 4 else b[t['e']+20:t['e']+20+t['dsz']]
def renum(b, key, new):
    t = entries(b)[key]; b[t['e']+4:t['e']+8] = struct.pack('>i', new)
def write(name, b): open('syn/'+name, 'wb').write(b)
src = bytearray(open(B+'3730.ab1','rb').read())
E = entries(src)
p1, p2 = data(src, E[('PBAS',1)]), data(src, E[('PBAS',2)])
print('3730 PBAS1==PBAS2', p1 == p2, 'PLOC1==PLOC2', data(src,E[('PLOC',1)]) == data(src,E[('PLOC',2)]))
# A: PCON2 hidden, PBAS same -> PCON1 qualities expected
a = bytearray(src); renum(a, ('PCON',2), 99); write('A_noPCON2_same.ab1', a)
# B: PCON2 hidden, PBAS2 one base edited (same length) -> no qualities
b = bytearray(src); renum(b, ('PCON',2), 99)
t = entries(b)[('PBAS',2)]; i = t['doff'] + 10; b[i] = ord('A') if b[i] != ord('A') else ord('C'); write('B_noPCON2_edited.ab1', b)
# C: PCON2 hidden, PBAS1 lowercase copy of PBAS2 -> PCON1 expected (case-insensitive)
c = bytearray(src); renum(c, ('PCON',2), 99)
t = entries(c)[('PBAS',1)]; c[t['doff']:t['doff']+t['dsz']] = bytes(c[t['doff']:t['doff']+t['dsz']]).lower(); write('C_noPCON2_lower1.ab1', c)
# D: PBAS2 hidden entirely: calls from PBAS1, PCON1 own
d = bytearray(src); renum(d, ('PBAS',2), 98); write('D_noPBAS2.ab1', d)
# E: no_smpl1 (PBAS1 != PBAS2) with PCON2 hidden -> no qualities ; with PLOC2 hidden -> PLOC1 used?
s = bytearray(open(B+'no_smpl1.ab1','rb').read()); S = entries(s)
q1, q2 = data(s,S[('PBAS',1)]), data(s,S[('PBAS',2)])
print('no_smpl1 diffs', sum(x!=y for x,y in zip(q1,q2)), 'PLOC equal', data(s,S[('PLOC',1)])==data(s,S[('PLOC',2)]))
e = bytearray(s); renum(e, ('PCON',2), 99); write('E_nosmpl_noPCON2.ab1', e)
f = bytearray(s); renum(f, ('PLOC',2), 99); write('F_nosmpl_noPLOC2.ab1', f)
