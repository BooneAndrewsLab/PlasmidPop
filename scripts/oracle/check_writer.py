#!/usr/bin/env python3
"""Reads the GenBank files our writer produced back with Biopython.

src/test/oracle/exportGenBank.test.ts writes each file together with what
it is meant to hold (manifest.json). Biopython, an independent reader, must
see exactly that: the same bases, topology, and for every feature the same
type, strand, extracted sequence and qualifiers. This is how a plasmid saved
from PlasmidPop looks to other tools.

Usage:  npm run oracle:writer
"""
import io
import json
import os
import sys
import warnings

from Bio import SeqIO


def strand_name(strand):
    return {1: 'forward', -1: 'reverse'}.get(strand, 'none')


def read(text):
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter('always')
        record = SeqIO.read(io.StringIO(text), 'genbank')
    return record, caught


def check(directory, entry):
    problems = []
    path = os.path.join(directory, entry['file'])
    with open(path, encoding='utf-8') as f:
        text = f.read()
    try:
        record, caught = read(text)
    except Exception as e:  # noqa: BLE001 - any failure to read is the finding
        problems.append(f'Biopython cannot read it: {str(e).splitlines()[0]}')
        # Carry on with the LOCUS line given a division code, so a header
        # problem does not hide what is wrong further down.
        lines = text.split('\n')
        lines[0] = lines[0][:64].ljust(64) + 'UNK ' + lines[0][64:].strip()
        try:
            record, caught = read('\n'.join(lines))
        except Exception as e2:  # noqa: BLE001
            return problems + [f'not even with a repaired LOCUS line: {e2}']
    # A warning is something stricter tools may refuse outright.
    for w in caught:
        problems.append(f'warning: {str(w.message).splitlines()[0]}')
    if str(record.seq).upper() != entry['sequence']:
        problems.append('sequence differs')
    topology = record.annotations.get('topology', 'linear')
    if topology != entry['topology']:
        problems.append(f"topology {topology}, meant {entry['topology']}")
    if len(record.features) != len(entry['features']):
        return problems + [f"{len(record.features)} features, meant {len(entry['features'])}"]
    for i, (f, want) in enumerate(zip(record.features, entry['features'])):
        at = f"feature {i} ({want['type']})"
        if f.type != want['type']:
            problems.append(f'{at}: type {f.type}')
        if strand_name(f.location.strand) != want['strand']:
            problems.append(f'{at}: strand {strand_name(f.location.strand)}')
        seq = str(f.extract(record.seq)).upper()
        if seq != want['sequence']:
            problems.append(f"{at}: Biopython reads {seq}, meant {want['sequence']}")
        for key, values in want['qualifiers'].items():
            theirs = [str(v) for v in f.qualifiers.get(key, [])]
            if theirs != values:
                problems.append(f'{at}: /{key} {theirs}, meant {values}')
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
            for p in problems:
                print(f'  {p}')
    print(f'{len(manifest) - failures} of {len(manifest)} files read back as meant')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
