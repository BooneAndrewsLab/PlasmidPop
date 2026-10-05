import json, os, warnings, gzip
warnings.simplefilter('ignore')
from Bio import SeqIO
S = '/tmp/claude-9005/-home-matej-code-WebstormProjects-PlasmidPop/0d36857c-4f3e-42c7-b46a-0fa7317cc69d/scratchpad/audit/translation-io'
d = json.load(open(S + '/out/reads.json'))
print('=== AB1 ===')
for name, ours in d['abi'].items():
    for dir_ in [S + '/biopy/Abi', '/home/matej/code/WebstormProjects/PlasmidPop/fixtures/local/abif']:
        p = f'{dir_}/{name}'
        if os.path.exists(p):
            break
    try:
        rec = SeqIO.read(p, 'abi')
    except Exception as e:
        print(f'{name}: biopython error {type(e).__name__}: {str(e)[:60]} | ours: {ours.get("error", "parsed OK len=%d" % len(ours.get("sequence", "")))}')
        continue
    if 'error' in ours:
        print(f'{name}: OURS error {ours["error"][:100]} | biopython seq len {len(rec.seq)}')
        continue
    raw = rec.annotations['abif_raw']
    bseq = str(rec.seq).upper()
    bq = rec.letter_annotations.get('phred_quality', [])
    ploc = raw.get('PLOC2') or raw.get('PLOC1')
    issues = []
    if bseq != ours['sequence']: issues.append(f'seq differs (bio {len(bseq)} ours {len(ours["sequence"])})')
    if list(bq) != ours['qualities']: issues.append(f'quality differs: bio[:10]={list(bq)[:10]} ours[:10]={ours["qualities"][:10]}')
    if ours['peaks'] is not None and ploc is not None and list(ploc) != ours['peaks']: issues.append('peaks differ')
    if ours['peaks'] is None and ploc is not None: issues.append('ours has no trace but bio has PLOC')
    for k, n in zip('GATC', [9, 10, 11, 12]):
        pass
    fwo = raw.get('FWO_1', b'').decode() if isinstance(raw.get('FWO_1'), bytes) else raw.get('FWO_1')
    if ours['channelLengths']:
        for i, letter in enumerate(fwo or ''):
            data = raw.get(f'DATA{9 + i}')
            if data is not None and (len(data) != ours['channelLengths'][letter] or sum(data) != ours['channelSums'][letter]):
                issues.append(f'channel {letter} differs')
    smpl = raw.get('SMPL1')
    smpl = smpl.decode(errors='replace') if isinstance(smpl, bytes) else smpl
    if (smpl or '').strip() != (ours['description'] or '').strip(): issues.append(f'sample name: bio {smpl!r} ours {ours["description"]!r}')
    print(f'{name}: len {len(bseq)} fwo {fwo} -> {"OK" if not issues else issues} warnings={ours["warnings"]}')

print('\n=== FASTQ ===')
for name, ours in d['fastq'].items():
    p = f'{S}/biopy/Quality/{name}'
    fmt = 'fastq-sanger'
    if 'illumina' in name and 'original_illumina' in name: fmt = 'fastq-illumina'
    if 'solexa' in name and 'original_solexa' in name: fmt = 'fastq-solexa'
    try:
        h = gzip.open(p, 'rt') if name.endswith('.gz') else open(p)
        recs = list(SeqIO.parse(h, fmt))
        berr = None
    except Exception as e:
        recs = None; berr = f'{type(e).__name__}: {str(e)[:70]}'
    if 'error' in ours:
        print(f'{name}: OURS error: {ours["error"][:90]} | biopython: {berr or "%d records" % len(recs)}')
        continue
    if recs is None:
        print(f'{name}: biopython error {berr} | ours parsed {len(ours["records"])} records, warnings={ours["warnings"]}')
        continue
    issues = []
    if len(recs) != len(ours['records']): issues.append(f'count bio {len(recs)} ours {len(ours["records"])}')
    for r, o in zip(recs, ours['records']):
        if str(r.seq) != o['sequence']: issues.append(f'seq {r.id}')
        bq = list(r.letter_annotations.get('phred_quality') or r.letter_annotations.get('solexa_quality'))
        if bq != o['qualities']:
            issues.append(f'qual {r.id}: bio {bq[:6]} ours {o["qualities"][:6]}')
        if r.id != o['name'] and r.description != o['name']: issues.append(f'id bio {r.id!r} ours {o["name"]!r}')
    print(f'{name} [{fmt}]: {len(recs)} recs -> {"OK" if not issues else issues[:3]} warnings={ours["warnings"][:2]}')
