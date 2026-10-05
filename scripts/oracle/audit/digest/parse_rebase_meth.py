"""Parse REBASE's 'Effects of overlapping methylation' pages (damlist CGI) into JSON.
Source: http://rebase.neb.com/cgi-bin/damlist?mM.EcoKDam+sN etc.
Each configuration: site, top-strand methylated indices, bottom-strand methylated indices, effect."""
import re, json, html
D = '/tmp/claude-9005/-home-matej-code-WebstormProjects-PlasmidPop/0d36857c-4f3e-42c7-b46a-0fa7317cc69d/scratchpad/audit/digest'

def parse(path):
    h = open(path, errors='replace').read()
    out = {}
    # split per enzyme row
    parts = re.split(r'<tr valign=top><td><A HREF=/rebase/enz/([^.]+)\.html>', h)
    for i in range(1, len(parts), 2):
        name = parts[i]; body = parts[i + 1]
        site = re.search(r'<font size=2>([A-Z^()/0-9,-]+)</font>', body).group(1)
        confs = []
        for m in re.finditer(r'<pre><font size=2>([^<]*)</font></pre></td>\s*<td align=left width=350>.*?<td width=16% bgcolor=\w+>(\w+)</td>', body, re.S):
            lines = html.unescape(m.group(1)).split('\n')
            # find the top strand line: letters separated by single spaces
            idx = [k for k, l in enumerate(lines) if re.fullmatch(r'\s*(?:[A-Z]\s)*[A-Z]\s*', l) and len(l.strip()) >= 5]
            if len(idx) < 2:
                confs.append({'raw': lines, 'effect': m.group(2)}); continue
            ti, bi = idx[0], idx[1]
            top = lines[ti]
            cols = [k for k, c in enumerate(top) if c != ' ']
            def marks(line):
                res = []
                for mm in re.finditer(r'm\d', line):
                    col = mm.start() + 1  # the digit's column
                    if col in cols: res.append(cols.index(col))
                    else: res.append(('out', (col - cols[0]) / 2))
                return res
            above = ''.join(lines[:ti])  # usually one line
            below = ''.join(lines[bi + 1:])
            confs.append({'top': marks(lines[ti - 1]) if ti > 0 else [], 'bottom': marks(lines[bi + 1]) if bi + 1 < len(lines) else [],
                          'effect': m.group(2), 'seq': top.replace(' ', '')})
        out[name] = {'site': site, 'confs': confs}
    return out

res = {}
for kind, sup in [('Dam', 'N'), ('Dcm', 'N'), ('Dam', 'V'), ('Dcm', 'V')]:
    r = parse(f'{D}/ref/rebase_{kind.lower()}_{sup}.html')
    for n, v in r.items():
        res.setdefault(n, {'site': v['site'], 'Dam': [], 'Dcm': []})
        for c in v['confs']:
            if c not in res[n][kind]: res[n][kind].append(c)
json.dump(res, open(f'{D}/rebase_methylation.json', 'w'), indent=0)
print(len(res), 'enzymes')
for n in ['XbaI', 'BsaI', 'ClaI', 'BamHI', 'StuI', 'ApaI', 'FokI', 'BclI', 'MboI', 'Sau3AI', 'TaqI', 'EcoRII' if 'EcoRII' in res else 'PspGI']:
    if n in res: print(n, json.dumps(res[n]))
