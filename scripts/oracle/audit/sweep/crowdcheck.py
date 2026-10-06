import sys, glob, re, json, os
import xml.etree.ElementTree as ET
NS='{http://www.w3.org/2000/svg}'
for f in sorted(glob.glob(sys.argv[1]+'/*.svg')):
    root = ET.parse(f).getroot()
    vb = [float(x) for x in root.get('viewBox').split()]
    W, H = vb[2], vb[3]
    texts = [el for el in root.iter(NS+'text')]
    out_t = []
    for t in texts:
        x, y = float(t.get('x')), float(t.get('y'))
        s = ''.join(t.itertext()); fs = float(t.get('font-size', 12))
        w = len(s) * fs * 0.55
        anc = t.get('text-anchor', 'start')
        x0 = x - (w if anc == 'end' else w/2 if anc == 'middle' else 0); x1 = x0 + w
        if x0 < -1 or x1 > W + 1 or y - fs < -1 or y > H + 1: out_t.append((s, round(x), round(y)))
    pts_out = 0; npts = 0
    for p in root.iter(NS+'path'):
        nums = re.findall(r'([MLA])\s*([^MLAZz]*)', p.get('d',''))
        for cmd, args in nums:
            v = [float(a) for a in re.findall(r'-?[\d.]+(?:e-?\d+)?', args)]
            if cmd in 'ML': xy = list(zip(v[0::2], v[1::2]))
            else: xy = [(v[i+5], v[i+6]) for i in range(0, len(v)-6, 7)]
            for x, y in xy:
                npts += 1
                if x < -1 or x > W+1 or y < -1 or y > H+1: pts_out += 1
    for c in root.iter(NS+'circle'):
        cx, cy, r = float(c.get('cx')), float(c.get('cy')), float(c.get('r'))
        npts += 1
        if cx - r < -1 or cx + r > W + 1: pts_out += 1
    meta = json.load(open(f[:-4]+'.json'))
    labels = [''.join(t.itertext()) for t in texts]
    nfeat = sum(1 for s in labels if s.startswith('feat'))
    ncut = sum(1 for s in labels if re.search(r'\(\d[\d,]*\)$', s))
    print(os.path.basename(f), 'W', W, meta, 'texts', len(texts), 'featLabels', nfeat, 'cutLabels', ncut, 'textOut', len(out_t), out_t[:3], 'ptsOut', pts_out, '/', npts)
