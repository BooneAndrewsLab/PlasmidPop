"""Make edited AB1 variants and write the expected calls/qualities/peaks for each.

Expected rule (the AB1 spec + #159/#168): calls = PBAS2 else PBAS1; qualities/peaks
from the same copy when its count matches; else from the other copy only if its calls
are the same bases; else none.
"""
import json, struct, sys, os, glob
OUT = sys.argv[1]; srcs = sys.argv[2:]

def directory(b):
    count = struct.unpack('>i', b[18:22])[0]; start = struct.unpack('>i', b[26:30])[0]
    ents = []
    for k in range(count):
        at = start + 28 * k
        name = b[at:at+4].decode('latin1'); num, et, es, cnt, size = struct.unpack('>ihhii', b[at+4:at+20])
        off = at + 20 if size <= 4 else struct.unpack('>i', b[at+20:at+24])[0]
        ents.append(dict(at=at, name=name, num=num, et=et, es=es, count=cnt, size=size, off=off))
    return ents

def get(b, ents, key):
    for e in ents:
        if f"{e['name']}{e['num']}" == key: return e
    return None

def data(b, e): return b[e['off']:e['off'] + e['size']]

def rename(b, e, new='ZZZZ'):
    b[e['at']:e['at']+4] = new.encode()

def replace(b, e, payload, count):
    off = len(b); b.extend(payload)
    struct.pack_into('>i', b, e['at'] + 12, count)
    struct.pack_into('>i', b, e['at'] + 16, len(payload))
    struct.pack_into('>i', b, e['at'] + 20, off)

def calls_of(b, e):
    return data(b, e).decode('latin1').upper().replace('\0', '').replace(' ', '')

def expected(b):
    ents = directory(b)
    c = get(b, ents, 'PBAS2') or get(b, ents, 'PBAS1')
    if c is None: return dict(error=True)
    seq = calls_of(b, c); pref = c['num']; oth = 1 if pref == 2 else 2
    def match(name):
        own = get(b, ents, f'{name}{pref}')
        if own and own['count'] == len(seq): return own
        alt = get(b, ents, f'{name}{oth}')
        if not alt or alt['count'] != len(seq): return None
        oc = get(b, ents, f'PBAS{oth}')
        return alt if oc and calls_of(b, oc) == seq else None
    q = match('PCON'); p = match('PLOC')
    quals = list(data(b, q)[:len(seq)]) if q else None
    peaks = None
    if p:
        w = 2 if p['et'] == 4 else 4
        raw = data(b, p)
        peaks = [int.from_bytes(raw[i*w:(i+1)*w], 'big', signed=(w == 4)) for i in range(p['count'])]
    return dict(seq=seq, quals=quals, peaks=peaks)

manifest = []
for path in srcs:
    base = os.path.basename(path)
    orig = bytearray(open(path, 'rb').read())
    if orig[:4] != b'ABIF': continue
    ents = directory(orig)
    b1, b2 = get(orig, ents, 'PBAS1'), get(orig, ents, 'PBAS2')
    info = {k: (get(orig, ents, k) or {}).get('count') for k in ('PBAS1','PBAS2','PCON1','PCON2','PLOC1','PLOC2')}
    same = b1 and b2 and calls_of(orig, b1) == calls_of(orig, b2)
    print(base, info, 'PBAS1==PBAS2' if same else 'differ')
    variants = {'orig': bytearray(orig)}
    if b2 and get(orig, ents, 'PLOC2') and len(calls_of(orig, b2)) > 20:
        s2 = calls_of(orig, b2)
        # same length, insertion + deletion, PLOC2/PCON2 dropped -> other copy must NOT be used
        indel = s2[:5] + 'A' + s2[5:10] + s2[11:]
        v = bytearray(orig); e = directory(v)
        replace(v, get(v, e, 'PBAS2'), indel.encode(), len(indel)); rename(v, get(v, e, 'PLOC2'), 'ZLOC'); 
        if get(v, e, 'PCON2'): rename(v, get(v, e, 'PCON2'), 'ZCON')
        variants['indel_noown'] = v
        # PBAS2 identical to PBAS1, own PLOC2/PCON2 dropped -> other copy used
        if b1:
            v = bytearray(orig); e = directory(v)
            s1 = calls_of(orig, b1)
            replace(v, get(v, e, 'PBAS2'), s1.encode(), len(s1)); rename(v, get(v, e, 'PLOC2'), 'ZLOC')
            if get(v, e, 'PCON2'): rename(v, get(v, e, 'PCON2'), 'ZCON')
            variants['same_noown'] = v
            # same as above, lowercase other copy
            v2 = bytearray(v); e2 = directory(v2)
            replace(v2, get(v2, e2, 'PBAS1'), s1.lower().encode(), len(s1))
            variants['same_noown_lower1'] = v2
        # shorter edited calls with its own PLOC2/PCON2 of matching length
        cut = s2[:-7]
        v = bytearray(orig); e = directory(v)
        replace(v, get(v, e, 'PBAS2'), cut.encode(), len(cut))
        pl = get(v, e, 'PLOC2'); w = 2 if pl['et'] == 4 else 4
        replace(v, pl, bytes(data(orig, pl)[: len(cut) * w]), len(cut))
        pc = get(v, e, 'PCON2')
        if pc: replace(v, pc, bytes(data(orig, pc)[: len(cut)]), len(cut))
        variants['shorter_own'] = v
        # own PLOC2 of the wrong length (corrupt), calls same as PBAS1 -> PLOC1
        if b1 and same:
            v = bytearray(orig); e = directory(v)
            pl = get(v, e, 'PLOC2'); replace(v, pl, bytes(data(orig, pl)[:-4]), pl['count'] - 2 if pl['et']==4 else pl['count'] - 1)
            variants['own_wronglen'] = v
        # trailing NUL in PBAS2 (count+1), PLOC2/PCON2 unchanged
        v = bytearray(orig); e = directory(v)
        replace(v, get(v, e, 'PBAS2'), s2.encode() + b'\0', len(s2) + 1)
        variants['pbas2_trailing_nul'] = v
        # PBAS2 absent -> PBAS1 copy
        v = bytearray(orig); e = directory(v); rename(v, get(v, e, 'PBAS2'), 'ZBAS')
        variants['no_pbas2'] = v
    for name, v in variants.items():
        f = os.path.join(OUT, f'{base}.{name}.ab1')
        open(f, 'wb').write(v)
        manifest.append(dict(file=f, expected=expected(v)))
json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'))
print(len(manifest), 'files')
