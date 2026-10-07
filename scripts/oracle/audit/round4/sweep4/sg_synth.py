import struct, random, json, os, sys
from xml.sax.saxutils import quoteattr
from Bio.Seq import Seq
D = sys.argv[1]
def pk(t, b): return bytes([t]) + struct.pack('>I', len(b)) + b
def write(path, seq, flags, feats):
    cookie = b'SnapGene' + bytes([0, 1, 0, 15, 0, 19])
    b = pk(9, cookie) + pk(0, bytes([flags]) + seq.encode()) + pk(8, b'<AdditionalSequenceProperties/>')
    b += pk(0x0a, ('<?xml version="1.0"?><Features nextValidID="99">' + feats + '</Features>').encode())
    open(path, 'wb').write(b)
def feat(ranges, dirn, rf, cs):
    a = f'<Feature recentID="0" name="x" type="CDS" directionality="{dirn}" allowSegmentOverlaps="0" consecutiveTranslationNumbering="1"'
    if rf is not None: a += f' readingFrame="{rf}"'
    a += '>' + ''.join(f'<Segment range="{r}" color="#ff0000" type="standard" translated="1"/>' for r in ranges)
    if cs is not None: a += f'<Q name="codon_start"><V int="{cs}"/></Q>'
    return a + '</Feature>'
random.seed(3)
L = 300
seq = ''.join(random.choice('ACGT') for _ in range(L))
cases = []
for dirn in ('1', '2'):
    for rf in ('1', '2', '3', '-1', '-2', '-3'):
        for cs in (None, '1', '3'):
            for segs in (['11-100'], ['11-40', '51-100'], ['281-300', '1-40'], ['291-30'], ['271-290', '295-10', '21-60']):
                name = f'{dirn}_{rf}_{cs}_{"_".join(segs)}'
                p = os.path.join(D, name + '.dna')
                write(p, seq, 3, feat(segs, dirn, rf, cs))
                txt = ''
                for r in segs:
                    a, b = map(int, r.split('-'))
                    txt += seq[a-1:b] if b >= a else seq[a-1:] + seq[:b]
                if dirn == '2': txt = str(Seq(txt).reverse_complement())
                f = abs(int(rf))
                body = txt[f-1:]
                body = body[: len(body) // 3 * 3]
                prot = str(Seq(body).translate())
                cases.append(dict(file=p, expected=prot))
json.dump(cases, open(os.path.join(D, 'cases.json'), 'w'))
json.dump([c['file'] for c in cases], open(os.path.join(D, 'files.json'), 'w'))
print(len(cases))
