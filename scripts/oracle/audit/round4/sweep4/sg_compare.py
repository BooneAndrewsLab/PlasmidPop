import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from raw import parse
from collections import Counter
ours = json.load(open(sys.argv[1]))
st = Counter(); bad = []
for o in ours:
    if 'error' in o: bad.append((o['file'], o['error'])); continue
    d = parse(o['file'])
    raw = [f for f in d['features'] if f['attrs'].get('type') == 'CDS']
    mine = o['cds']
    # match by name+order among CDS
    if len(raw) != len(mine):
        bad.append((os.path.basename(o['file']), 'count', len(raw), len(mine))); continue
    for rf, of in zip(raw, mine):
        tr = [v for q, v in rf['quals'] if q == 'translation']
        if not tr: continue
        t = tr[0].replace(',', '').rstrip('*')
        p = of['protein'].rstrip('*')
        a = rf['attrs']
        key = (a.get('directionality'), a.get('readingFrame'), len(rf['segs']) > 1)
        st[key] += 1
        if p != t:
            bad.append((os.path.basename(o['file']), of['name'], key, of['codonStart'], 'ours', p[:25], len(p), 'file', t[:25], len(t)))
for k, v in sorted(st.items(), key=str): print(v, k)
print('BAD', len(bad))
for b in bad[:30]: print(b)
