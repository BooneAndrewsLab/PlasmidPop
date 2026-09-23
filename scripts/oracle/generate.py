#!/usr/bin/env python3
"""Writes Biopython's answers to src/test/oracle/*.json for the oracle tests.

Biopython is an independent, widely used implementation of the same
biology. Whatever it says about a GenBank file, a restriction digest or a
translation is recorded here once, committed, and compared against
PlasmidPop's own answers by ordinary Vitest tests (src/test/oracle/), so CI
never needs Python. Rerun this after upgrading Biopython or adding cases;
a diff in the JSON is a change in what the oracle says.

Every area has two kinds of input:

* static samples — hand-picked edge cases and the real NCBI records in
  src/io/fixtures, so the known-hard cases are always checked;
* random samples — drawn from a fixed seed, so they are reproducible and the
  JSON only changes when this script does.

Usage:  npm run oracle:generate      (sets up the pinned venv)
"""
import glob
import io
import itertools
import json
import os
import random
import sys
import warnings

import Bio
from Bio import SeqIO
from Bio.Data import CodonTable
from Bio.Restriction import AllEnzymes
from Bio.Seq import Seq
from Bio.SeqFeature import (
    AfterPosition,
    BeforePosition,
    CompoundLocation,
    SeqFeature,
    SimpleLocation,
)
from Bio.SeqIO.InsdcIO import _insdc_location_string
from Bio.SeqRecord import SeqRecord

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'src', 'test', 'oracle')
FIXTURES = os.path.join(ROOT, 'src', 'io', 'fixtures')
ENZYME_TABLE = os.path.join(ROOT, 'src', 'core', 'analysis', 'enzymeTable.ts')
SEED = 20260923

# Biopython warns about the tables where a stop codon can also code; the
# oracle records what it does regardless.
warnings.simplefilter('ignore')


def write(name, data):
    path = os.path.join(OUT, name)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({'biopython': Bio.__version__, **data}, f, indent=1, sort_keys=True)
        f.write('\n')
    print(f'wrote {os.path.relpath(path, ROOT)} ({os.path.getsize(path) // 1024} KiB)')


# ------------------------------------------------------------------ GenBank


def strand_name(strand):
    return {1: 'forward', -1: 'reverse'}.get(strand, 'none')


def describe_record(record):
    """What a correct parser must see in `record`, in PlasmidPop's terms."""
    length = len(record.seq)
    features = []
    for f in record.features:
        loc = f.location
        features.append(
            {
                'type': f.type,
                'strand': strand_name(loc.strand),
                'location': _insdc_location_string(loc, length),
                # 0-based half-open parts in Biopython's (biological) order.
                'parts': [[int(p.start), int(p.end), strand_name(p.strand)] for p in loc.parts],
                'sequence': str(f.extract(record.seq)),
                'qualifiers': {k: [str(v) for v in vs] for k, vs in f.qualifiers.items()},
            }
        )
    return {
        'name': record.name,
        'length': length,
        'sequence': str(record.seq),
        'topology': record.annotations.get('topology', 'linear'),
        'features': features,
    }


def parse_case(label, text):
    record = SeqIO.read(io.StringIO(text), 'genbank')
    return {'label': label, 'genbank': text, 'expected': describe_record(record)}


def written_case(label, record):
    """A record Biopython builds and writes, so the text is Biopython's own."""
    out = io.StringIO()
    SeqIO.write(record, out, 'genbank')
    return parse_case(label, out.getvalue())


def genbank_text(seq, topology, feature_lines, name='TEST'):
    """A hand-written GenBank file: feature_lines are the raw FEATURES body."""
    origin = []
    for i in range(0, len(seq), 60):
        chunk = seq[i : i + 60]
        groups = ' '.join(chunk[j : j + 10] for j in range(0, len(chunk), 10))
        origin.append(f'{i + 1:>9} {groups}')
    return '\n'.join(
        [
            f'LOCUS       {name:<16}{len(seq):>11} bp    DNA     {topology:<8} SYN 01-JAN-2000',
            'DEFINITION  Oracle test record.',
            'ACCESSION   TEST',
            'VERSION     TEST',
            'KEYWORDS    .',
            'SOURCE      synthetic',
            '  ORGANISM  synthetic',
            '            other.',
            'FEATURES             Location/Qualifiers',
            *feature_lines,
            'ORIGIN',
            *origin,
            '//',
            '',
        ]
    )


def static_genbank_cases():
    rng = random.Random(SEED + 1)
    seq = ''.join(rng.choice('acgt') for _ in range(120))
    L = len(seq)

    def feat(location, key='misc_feature', *quals):
        lines = [f'     {key:<16}{location}']
        lines += [f'                     {q}' for q in quals]
        return lines

    cases = []

    def add(label, topology, *features):
        lines = [line for f in features for line in f]
        cases.append(parse_case(label, genbank_text(seq, topology, lines)))

    add('simple forward and reverse', 'linear', feat('10..20'), feat('complement(30..45)'))
    add('single base and between-base site', 'linear', feat('7'), feat('50^51'))
    add('partial ends', 'linear', feat('<1..>30'), feat('complement(<40..>60)'), feat('<70..80'))
    add('join forward', 'linear', feat('join(5..10,20..30,40..41)', 'CDS'))
    add('complement of a join', 'linear', feat('complement(join(5..10,20..30))', 'CDS'))
    add(
        'join of complements, biological order',
        'linear',
        feat('join(complement(20..30),complement(5..10))', 'CDS'),
    )
    add('order()', 'linear', feat('order(5..10,20..30)'))
    add('origin-spanning join on a circle', 'circular', feat(f'join(100..{L},1..15)', 'gene'))
    add(
        'origin-spanning complement on a circle',
        'circular',
        feat(f'complement(join(110..{L},1..5))', 'gene'),
    )
    add('whole sequence', 'circular', feat(f'1..{L}', 'source'))
    add(
        'qualifiers: quotes, wrapping, numbers, flags',
        'linear',
        feat(
            '10..40',
            'CDS',
            '/label="my ""quoted"" label"',
            '/note="a long note that goes on and on and on so that it has to',
            'wrap over more than one line of the file"',
            '/codon_start=2',
            '/transl_table=11',
            '/pseudo',
        ),
    )
    add(
        'location wrapped over lines',
        'linear',
        [
            '     CDS             join(1..3,5..7,9..11,13..15,17..19,21..23,25..27,29..31,',
            '                     33..35,37..39)',
        ],
    )

    # Ambiguity codes and an empty record.
    iupac = ''.join(rng.choice('acgtnrykmswbdhv') for _ in range(60))
    cases.append(parse_case('IUPAC bases', genbank_text(iupac, 'linear', feat('complement(3..40)'))))
    cases.append(parse_case('empty sequence', genbank_text('', 'linear', [])))
    return cases


def random_location(rng, L, circular):
    kind = rng.random()
    strand = rng.choice([1, -1])
    if circular and kind < 0.15 and L >= 3:
        # Spanning the origin: the head then the tail, in biological order.
        a = rng.randrange(1, L)
        b = rng.randrange(1, a + 1)
        parts = [SimpleLocation(a, L, strand), SimpleLocation(0, b, strand)]
        return CompoundLocation(parts if strand == 1 else parts[::-1])
    if kind < 0.4 and L >= 6:
        cuts = sorted(rng.sample(range(L + 1), rng.choice([4, 6])))
        parts = [SimpleLocation(cuts[i], cuts[i + 1], strand) for i in range(0, len(cuts), 2)]
        parts = [p for p in parts if p.end > p.start]
        if len(parts) >= 2:
            return CompoundLocation(parts if strand == 1 else parts[::-1])
    a = rng.randrange(0, L)
    b = rng.randrange(a + 1, L + 1)
    start, end = a, b
    if rng.random() < 0.1:
        start = BeforePosition(a)
    if rng.random() < 0.1:
        end = AfterPosition(b)
    return SimpleLocation(start, end, strand)


def random_genbank_cases(n=120):
    rng = random.Random(SEED)
    cases = []
    for i in range(n):
        L = rng.randrange(1, 400)
        circular = rng.random() < 0.6
        alphabet = 'acgt' if rng.random() < 0.8 else 'acgtacgtnrykm'
        record = SeqRecord(
            Seq(''.join(rng.choice(alphabet) for _ in range(L))),
            id=f'R{i}',
            name=f'R{i}',
            description=f'random record {i}',
            annotations={'molecule_type': 'DNA', 'topology': 'circular' if circular else 'linear'},
        )
        for j in range(rng.randrange(0, 8)):
            key = rng.choice(['gene', 'CDS', 'misc_feature', 'promoter', 'primer_bind', 'rep_origin'])
            quals = {'label': [f'f{j}']}
            if rng.random() < 0.3:
                quals['note'] = ['note ' + ' '.join(rng.choice(['alpha', 'beta', '"q"']) for _ in range(20))]
            record.features.append(
                SeqFeature(random_location(rng, L, circular), type=key, qualifiers=quals)
            )
        cases.append(written_case(f'random {i}', record))
    return cases


def fixture_cases():
    cases = []
    for path in sorted(glob.glob(os.path.join(FIXTURES, '*.gb'))):
        with open(path, encoding='utf-8') as f:
            text = f.read()
        record = SeqIO.read(io.StringIO(text), 'genbank')
        cases.append({'label': os.path.basename(path), 'fixture': os.path.basename(path), 'expected': describe_record(record)})
    return cases


# --------------------------------------------------------------- restriction


def our_offsets(enzyme):
    """(cutTop, cutBottom) in PlasmidPop's convention (enzymeTable.ts), or None.

    Biopython's fst5 counts from the site start, fst3 from the site end on
    the bottom strand; enzymes that cut twice, or at an unknown place, have
    no single pair.
    """
    fst5, fst3, scd5, scd3, _ = enzyme.charac
    if fst5 is None or fst3 is None or scd5 is not None or scd3 is not None:
        return None
    return fst5, enzyme.size + fst3


def bundled_names():
    names = []
    with open(ENZYME_TABLE, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line.startswith("['"):
                names.append(line.split("'")[1])
    return names


def cuts_for(enzymes, seq, circular):
    """Top-strand cuts per enzyme, 0-based (the index of the first base after the cut).

    Biopython's search reports one match per position, so where an ambiguous
    non-palindromic site reads as a site on both strands at once (SgrTI's
    CCDS on CCGG) it keeps the forward one and loses the other. Searching
    the reverse complement as well recovers every bottom-strand site with
    Biopython alone: its top-strand cut there is our bottom-strand cut.
    """
    s = Seq(seq)
    rc = s.reverse_complement()
    L = len(seq)
    out = {}
    for e in enzymes:
        found = {p - 1 for p in e.search(s, linear=not circular)}
        if not e.is_palindromic():
            top, bottom = our_offsets(e)
            for p in e.search(rc, linear=not circular):
                cut = L - (p - 1 + bottom - top)
                found.add(cut % L if circular else cut)
        if found:
            out[str(e)] = sorted(found)
    return out


IUPAC_SETS = {
    'A': 'A', 'C': 'C', 'G': 'G', 'T': 'T', 'R': 'AG', 'Y': 'CT', 'S': 'CG', 'W': 'AT',
    'K': 'GT', 'M': 'AC', 'B': 'CGT', 'D': 'AGT', 'H': 'ACT', 'V': 'ACG', 'N': 'ACGT',
}


def concrete(site, rng):
    """One real sequence the (possibly ambiguous) site recognises."""
    return ''.join(rng.choice(IUPAC_SETS[b]) for b in site)


def restriction():
    rng = random.Random(SEED + 2)
    usable = sorted((e for e in AllEnzymes if our_offsets(e) is not None), key=str)
    by_name = {str(e): e for e in usable}
    bundled = bundled_names()
    # Our bundled table, plus a spread of others: Type IIS, interrupted and
    # ambiguous sites, cuts before the site.
    others = [e for e in usable if str(e) not in bundled]
    panel = sorted({*[by_name[n] for n in bundled if n in by_name], *rng.sample(others, 150)}, key=str)

    def definition(e):
        top, bottom = our_offsets(e)
        return {'name': str(e), 'site': str(e.site), 'cutTop': top, 'cutBottom': bottom}

    cases = []
    # Static: real records, both as they are and with the other topology.
    for path in sorted(glob.glob(os.path.join(FIXTURES, '*.gb'))):
        record = SeqIO.read(path, 'genbank')
        seq = str(record.seq).upper()
        topology = record.annotations.get('topology', 'linear')
        cases.append({'label': os.path.basename(path), 'fixture': os.path.basename(path), 'topology': topology, 'cuts': cuts_for(panel, seq, topology == 'circular')})
    # Static: sites straddling the origin and hugging the ends.
    for e in panel:
        top, bottom = our_offsets(e)
        site = concrete(str(e.site), rng)
        filler = ''.join(rng.choice('ACGT') for _ in range(40))
        for split in (1, len(site) // 2, len(site) - 1):
            seq = site[split:] + filler + site[:split]
            cases.append({'label': f'{e} site across the origin at {split}', 'sequence': seq, 'topology': 'circular', 'cuts': cuts_for([e], seq, True)})
        for seq in (site + filler, filler + site, site):
            cases.append({'label': f'{e} site at an end', 'sequence': seq, 'topology': 'linear', 'cuts': cuts_for([e], seq, False)})
    # Random.
    for i in range(40):
        L = rng.randrange(10, 1500)
        seq = ''.join(rng.choice('ACGT') for _ in range(L))
        topology = rng.choice(['circular', 'linear'])
        cases.append({'label': f'random {i}', 'sequence': seq, 'topology': topology, 'cuts': cuts_for(panel, seq, topology == 'circular')})

    write(
        'restriction.json',
        {
            'enzymes': [definition(e) for e in panel],
            'bundled': {n: definition(by_name[n]) if n in by_name else None for n in bundled},
            'cases': cases,
        },
    )


# --------------------------------------------------------------- translation

IUPAC = 'ACGTRYSWKMBDHVN'


def translate_codon(codon, table):
    try:
        return str(Seq(codon).translate(table=table))
    except Exception:  # Biopython refuses some ambiguous codons
        return '?'


def to_stop(seq, table):
    """Biopython will not stop at a stop in tables where a stop can also code (27, 28, 31)."""
    try:
        return str(seq.translate(table=table, to_stop=True))
    except ValueError:
        return None


def translation():
    tables = {}
    for tid, table in sorted(CodonTable.unambiguous_dna_by_id.items()):
        codons = [''.join(c) for c in itertools.product(IUPAC, repeat=3)]
        tables[str(tid)] = {
            'name': table.names[0],
            # Every codon over the IUPAC alphabet, in itertools.product order.
            'aminoAcids': ''.join(translate_codon(c, tid) for c in codons),
            'starts': sorted(table.start_codons),
            'stops': sorted(table.stop_codons),
        }
    rng = random.Random(SEED + 3)
    samples = []
    for i in range(40):
        seq = ''.join(rng.choice('ACGT') for _ in range(rng.randrange(0, 300)))
        tid = rng.choice(sorted(CodonTable.unambiguous_dna_by_id))
        s = Seq(seq[: len(seq) - len(seq) % 3])
        samples.append(
            {
                'sequence': seq,
                'table': tid,
                'protein': str(s.translate(table=tid)),
                'toStop': to_stop(s, tid),
                'reverse': str(Seq(seq).reverse_complement()[: len(s)].translate(table=tid)),
            }
        )
    write('translation.json', {'alphabet': IUPAC, 'tables': tables, 'samples': samples})


def main():
    os.makedirs(OUT, exist_ok=True)
    write(
        'genbank.json',
        {'static': static_genbank_cases(), 'random': random_genbank_cases(), 'fixtures': fixture_cases()},
    )
    restriction()
    translation()


if __name__ == '__main__':
    sys.exit(main())
