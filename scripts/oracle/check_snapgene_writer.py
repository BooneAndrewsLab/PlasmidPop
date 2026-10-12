#!/usr/bin/env python3
"""Reads the SnapGene files our writer produced back with Biopython (#204).

src/test/oracle/exportSnapGene.test.ts writes each file together with what it
is meant to hold (manifest.json). Biopython's SnapGene reader, the one
independent reader of the format there is, must see the same stored sequence
and topology, and for every feature the same type, strand, label and the same
bases once extracted. Biopython reads features and primers alike as features,
so the two are compared together, as unordered sets.

Usage:  scripts/oracle/run.sh snapgene-writer
"""
import json
import os
import sys
import warnings

from Bio import SeqIO


def strand_name(strand):
    return {1: 'forward', -1: 'reverse'}.get(strand, 'none')


def check(directory, entry):
    problems = []
    path = os.path.join(directory, entry['file'])
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        try:
            record = SeqIO.read(path, 'snapgene')
        except Exception as e:  # noqa: BLE001 - any failure to read is the finding
            return [f'Biopython cannot read it: {str(e).splitlines()[0]}']
    for w in caught:
        problems.append(f'warning: {str(w.message).splitlines()[0]}')
    if str(record.seq).upper() != entry['sequence']:
        problems.append('sequence differs')
    topology = record.annotations.get('topology', 'linear')
    if topology != entry['topology']:
        problems.append(f"topology {topology}, meant {entry['topology']}")
    left = [(f['type'], f['strand'], f['name'], f['sequence']) for f in entry['features']]
    for f in record.features:
        label = (f.qualifiers.get('label') or [''])[0]
        strand = strand_name(f.location.strand)
        read = str(f.extract(record.seq)).upper()
        key = (f.type, strand, label, read)
        if key in left:
            left.remove(key)
            continue
        # Biopython lists the pieces of a reverse-strand feature that crosses
        # the origin, or is split in two, in forward order, so its extract
        # joins them the wrong way round. Where it is compound and on the
        # reverse strand, the same bases in any order are the same feature.
        if strand == 'reverse' and len(f.location.parts) > 1:
            same = next(
                (m for m in left if m[:3] == key[:3] and sorted(m[3]) == sorted(read)), None
            )
            if same is not None:
                left.remove(same)
                continue
        problems.append(f'Biopython reads a feature we did not mean: {f.type} {strand} {label!r} {read[:30]}')
    for m in left:
        problems.append(f'Biopython does not read the feature we meant: {m[0]} {m[1]} {m[2]!r} {m[3][:30]}')
    return problems


def main():
    directory = sys.argv[1]
    with open(os.path.join(directory, 'manifest.json'), encoding='utf-8') as f:
        manifest = json.load(f)
    failures = 0
    for entry in manifest:
        problems = check(directory, entry)
        if problems:
            failures += 1
            print(f"{entry['label']} ({entry['file']}):")
            for p in problems[:8]:
                print(f'  {p}')
    print(f'{len(manifest) - failures} of {len(manifest)} files read back as meant')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
