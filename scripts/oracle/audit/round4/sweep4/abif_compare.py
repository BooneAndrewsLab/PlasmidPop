import json, sys, os
from Bio import SeqIO
d = sys.argv[1]
man = {m['file']: m['expected'] for m in json.load(open(os.path.join(d, 'manifest.json')))}
ours = json.load(open(os.path.join(d, 'ours.json')))
bad = 0
for o in ours:
    f = o['file']; e = man[f]; tag = os.path.basename(f)
    if e.get('error') or o.get('error'):
        if not (e.get('error') and o.get('error')): bad += 1; print('ERR', tag, e, o.get('error'))
        continue
    probs = []
    if o['seq'] != e['seq']: probs.append(f"seq len ours {len(o['seq'])} exp {len(e['seq'])}")
    zero = [0] * len(e['seq'])
    if (o['quals'] or zero) != (e['quals'] or zero): probs.append('quals')
    if o['peaks'] != e['peaks']: probs.append(f"peaks ours {None if o['peaks'] is None else len(o['peaks'])} exp {None if e['peaks'] is None else len(e['peaks'])}")
    # Biopython on the original files
    if tag.endswith('.orig.ab1'):
        r = SeqIO.read(f, 'abi')
        bs = str(r.seq).upper()
        if bs != o['seq']: probs.append('biopython seq differs')
        if r.letter_annotations.get('phred_quality') != o['quals']: probs.append('biopython quals differ')
        pl = r.annotations['abif_raw'].get('PLOC2')
        if pl is not None and list(pl) != o['peaks']: probs.append(f'biopython PLOC2 differs')
    print(('BAD ' if probs else 'ok  ') + tag, '; '.join(probs), o['warnings'] if probs else '')
    bad += bool(probs)
print('bad', bad, 'of', len(ours))
