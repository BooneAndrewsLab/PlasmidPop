import json, sys, glob, re, os
import xml.etree.ElementTree as ET
try:
    import lxml.etree as LX
except ImportError:
    LX = None
D = sys.argv[1]
nasty = json.load(open(f'{D}/nasty.json'))  # json loads lone surrogates as surrogate code points
def valid(c):
    o = ord(c)
    return o in (9, 10, 13) or 0x20 <= o <= 0xD7FF or 0xE000 <= o <= 0xFFFD or o >= 0x10000
def strip(s):
    # emulate: pairs are kept; json gives separate surrogates for pairs? python json combines valid pairs
    return ''.join(c for c in s if valid(c))
fails = 0; n = 0
for key, bad in nasty.items():
    exp = strip(bad).replace('\r\n', '\n').replace('\r', '\n')
    for f in sorted(glob.glob(f'{D}/*-{key}*.svg')):
        n += 1
        raw = open(f, 'rb').read()
        try:
            root = ET.fromstring(raw)
        except Exception as e:
            print('ETREE FAIL', f, e); fails += 1; continue
        if LX is not None:
            try: LX.fromstring(raw)
            except Exception as e: print('LXML FAIL', f, e); fails += 1
        texts = [''.join(el.itertext()) for el in root.iter() if el.tag.endswith('}text') or el.tag.endswith('}title') or el.tag.endswith('}desc')]
        base = os.path.basename(f)
        want = ['F'] + (['E'] if 'page' not in base or True else []) + ['D']
        for p in ['F', 'E', 'D']:
            target = p + exp
            # map shows doc name as title text; names may be fitted with ellipsis
            hit = any(target in t for t in texts)
            if not hit:
                # whitespace-normalised compare (SVG rendering collapses) + truncated label
                cand = [t for t in texts if t.startswith(p + exp[:1]) or t.startswith(p)]
                print(f'MISSING {base} {p}{exp!r}; candidates={cand[:4]!r}')
print('files', n, 'fails', fails, 'lxml', LX is not None)
