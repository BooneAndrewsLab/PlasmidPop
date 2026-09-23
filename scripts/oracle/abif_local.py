"""Biopython's reading of .ab1 files, as JSON.

`describe` is what generate.py records for the committed fixtures; run as a
script it reads every .ab1 under the directories given, for checking our
reader against real files that cannot be committed:
    scripts/oracle/run.sh abif-local dir...
"""
import glob
import json
import os
import sys
import warnings

from Bio import SeqIO

warnings.simplefilter('ignore')


def text(value):
    return value.decode('latin1') if isinstance(value, bytes) else value


def describe(path, name):
    """What Biopython reads, or the error it raises."""
    try:
        record = SeqIO.read(path, 'abi')
    except Exception as e:  # noqa: BLE001 - the message is the answer
        return {'file': name, 'error': str(e)}
    raw = record.annotations['abif_raw']
    return {
        'file': name,
        'sequence': str(record.seq),
        'qualities': list(record.letter_annotations.get('phred_quality', [])),
        'sample': text(raw.get('SMPL1')),
        'order': text(raw.get('FWO_1')),
        # The raw tags, for the test to check our choice of copy against.
        'raw': {
            key: list(raw[key])
            for key in ['PLOC1', 'PLOC2', 'DATA9', 'DATA10', 'DATA11', 'DATA12']
            if raw.get(key) is not None
        },
    }


def main(roots, out_path):
    paths = sorted(
        {p for root in roots for p in glob.glob(os.path.join(root, '**', '*.ab1'), recursive=True)}
    )
    out = [describe(p, p) for p in paths if not os.path.basename(p).startswith('._')]
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump({'files': out}, f)
    print(f'{len(out)} files read by Biopython')


if __name__ == '__main__':
    main(sys.argv[2:], sys.argv[1])
