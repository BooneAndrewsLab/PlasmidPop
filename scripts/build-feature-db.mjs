// Builds the bundled database of common features that Detect features
// matches against (item 59, docs/design/59-detect-features.md).
//
//   node scripts/build-feature-db.mjs            # fetch what is not cached, write the data
//   node scripts/build-feature-db.mjs --offline  # the cache only; fails on a miss
//
// Every sequence is taken from a public NCBI record, never typed in:
//
// - scripts/feature-db/core-parts.json lists the hand-curated core. Each part
//   names an accession and says where in that record it lies: a feature of
//   the record picked by its key and qualifiers, a GenBank location, or a
//   probe (a short known sequence that must occur exactly once in the record,
//   whose bases are then the record's own). The data file cites the
//   accession.version and the location the bases were read from.
// - scripts/feature-db/fpbase-proteins.json lists fluorescent proteins by
//   their FPbase slug. FPbase gives the protein and its GenBank protein
//   accession; the protein record's /coded_by gives the nucleotide CDS, which
//   is fetched and kept only when it translates to FPbase's protein.
//
// Fetched records are cached in scripts/feature-db/.cache (not committed), so
// a rebuild is reproducible and polite to NCBI (at most 3 requests a second).
// Output: src/core/annotate/data/core-parts.json and
// src/core/annotate/data/fpbase.json (CC BY-SA 4.0, see DATA-LICENSES.md).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SPEC_DIR = join(HERE, 'feature-db');
const CACHE = join(SPEC_DIR, '.cache');
const OUT_DIR = join(ROOT, 'src', 'core', 'annotate', 'data');
const OFFLINE = process.argv.includes('--offline');
const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi';

/** Shortest part worth matching: anything shorter turns up by chance. */
const MIN_LENGTH = 15;

// ------------------------------------------------------------------ fetching

let lastRequest = 0;

/**
 * @param {string} key
 * @param {string} url
 * @returns {Promise<string>}
 */
async function cached(key, url) {
  const file = join(CACHE, key.replace(/[^A-Za-z0-9._-]/g, '_'));
  if (existsSync(file)) return readFileSync(file, 'utf8');
  if (OFFLINE) throw new Error(`Not cached: ${key} (${url})`);
  for (let attempt = 1; ; attempt++) {
    const wait = lastRequest + 400 - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequest = Date.now();
    const res = await fetch(url);
    const text = await res.text();
    if (res.ok && text.trim() !== '' && !text.startsWith('{"error"')) {
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(file, text);
      return text;
    }
    if (attempt >= 4) throw new Error(`${url}: HTTP ${res.status} ${text.slice(0, 200)}`);
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
  }
}

/** @param {string} accession */
function fetchGenBank(accession) {
  return cached(
    `nuccore-${accession}.gb`,
    `${EUTILS}?db=nuccore&id=${encodeURIComponent(accession)}&rettype=gbwithparts&retmode=text`,
  );
}

/** @param {string} accession */
function fetchProtein(accession) {
  return cached(
    `protein-${accession}.gp`,
    `${EUTILS}?db=protein&id=${encodeURIComponent(accession)}&rettype=gp&retmode=text`,
  );
}

/** @param {string} slug */
async function fetchFpbase(slug) {
  const text = await cached(
    `fpbase-${slug}.json`,
    `https://www.fpbase.org/api/proteins/?format=json&slug=${encodeURIComponent(slug)}`,
  );
  /** @type {unknown} */
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed) || parsed.length !== 1) throw new Error(`FPbase: no protein ${slug}`);
  /** @type {unknown[]} */
  const list = parsed;
  return /** @type {FpbaseProtein} */ (list[0]);
}

/**
 * @typedef {object} FpbaseProtein
 * @property {string} name
 * @property {string} slug
 * @property {string} uuid
 * @property {string | null} seq
 * @property {string | null} genbank
 * @property {string | null} doi
 * @property {{ em_max: number | null, ex_max: number | null }[]} states
 */

// ------------------------------------------------------------------- GenBank

/**
 * @typedef {object} GbFeature
 * @property {string} key
 * @property {string} location
 * @property {Map<string, string[]>} qualifiers
 *
 * @typedef {object} GbRecord
 * @property {string} version accession.version
 * @property {string} definition
 * @property {boolean} circular
 * @property {string} sequence upper case
 * @property {GbFeature[]} features
 */

/**
 * Just enough of a GenBank reader for NCBI's own output.
 * @param {string} text
 * @returns {GbRecord}
 */
function parseGenBank(text) {
  const lines = text.split('\n');
  const locus = lines[0] ?? '';
  let version = '';
  let definition = '';
  /** @type {GbFeature[]} */
  const features = [];
  let seq = '';
  let section = '';
  /** @type {GbFeature | null} */
  let current = null;
  /** @type {string | null} */
  let qualName = null;
  for (const line of lines) {
    if (/^[A-Z]/.test(line)) {
      section = line.split(/\s+/)[0] ?? '';
      if (section === 'VERSION') version = line.slice(12).trim().split(/\s+/)[0] ?? '';
      if (section === 'DEFINITION') definition = line.slice(12).trim();
      continue;
    }
    if (section === 'DEFINITION' && line.startsWith('            ')) {
      definition += ` ${line.trim()}`;
    } else if (section === 'FEATURES') {
      const key = line.slice(5, 21).trim();
      const body = line.slice(21);
      if (key !== '') {
        current = { key, location: body.trim(), qualifiers: new Map() };
        features.push(current);
        qualName = null;
      } else if (current !== null && body.startsWith('/')) {
        const eq = body.indexOf('=');
        qualName = eq < 0 ? body.slice(1).trim() : body.slice(1, eq);
        const value = eq < 0 ? '' : body.slice(eq + 1).trim();
        const list = current.qualifiers.get(qualName) ?? [];
        list.push(value);
        current.qualifiers.set(qualName, list);
      } else if (current !== null && qualName === null) {
        current.location += body.trim();
      } else if (current !== null && qualName !== null) {
        const list = current.qualifiers.get(qualName) ?? [];
        const last = list.length - 1;
        const sep = qualName === 'translation' ? '' : ' ';
        list[last] = `${list[last] ?? ''}${sep}${body.trim()}`;
      }
    } else if (section === 'ORIGIN') {
      seq += line.replace(/[^A-Za-z]/g, '');
    }
  }
  for (const f of features) {
    for (const [name, values] of f.qualifiers) {
      f.qualifiers.set(
        name,
        values.map((v) => v.replace(/^"/, '').replace(/"$/, '').replace(/""/g, '"')),
      );
    }
  }
  return {
    version,
    definition: definition.replace(/\.$/, ''),
    circular: /\bcircular\b/.test(locus),
    sequence: seq.toUpperCase(),
    features,
  };
}

const COMPLEMENT = /** @type {Record<string, string>} */ ({
  A: 'T',
  C: 'G',
  G: 'C',
  T: 'A',
  N: 'N',
  R: 'Y',
  Y: 'R',
  S: 'S',
  W: 'W',
  K: 'M',
  M: 'K',
  B: 'V',
  V: 'B',
  D: 'H',
  H: 'D',
});

/** @param {string} s */
function reverseComplement(s) {
  let out = '';
  for (let i = s.length - 1; i >= 0; i--) out += COMPLEMENT[s.charAt(i)] ?? 'N';
  return out;
}

/**
 * The bases a location reads, 5′→3′ along the part. Only simple ranges,
 * `join` of ranges (a part over the origin of a circle) and `complement`.
 * @param {string} location
 * @param {string} sequence
 * @returns {string}
 */
function readLocation(location, sequence) {
  const loc = location.replace(/\s+/g, '');
  const comp = /^complement\((.*)\)$/.exec(loc);
  if (comp?.[1] !== undefined) return reverseComplement(readLocation(comp[1], sequence));
  const join = /^join\((.*)\)$/.exec(loc);
  if (join?.[1] !== undefined) {
    return join[1]
      .split(',')
      .map((p) => readLocation(p, sequence))
      .join('');
  }
  const range = /^<?(\d+)\.\.>?(\d+)$/.exec(loc);
  if (range?.[1] === undefined || range[2] === undefined) {
    throw new Error(`Location not supported: ${location}`);
  }
  const a = Number(range[1]);
  const b = Number(range[2]);
  if (a < 1 || b > sequence.length || b < a) throw new Error(`Location out of range: ${location}`);
  return sequence.slice(a - 1, b);
}

// --------------------------------------------------------------- translation

const CODONS = (() => {
  const bases = 'TCAG';
  const aas = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
  /** @type {Map<string, string>} */
  const map = new Map();
  let i = 0;
  for (const a of bases)
    for (const b of bases) for (const c of bases) map.set(a + b + c, aas.charAt(i++));
  return map;
})();

/** @param {string} dna */
function translate(dna) {
  let out = '';
  for (let i = 0; i + 3 <= dna.length; i += 3) out += CODONS.get(dna.slice(i, i + 3)) ?? 'X';
  return out;
}

// -------------------------------------------------------------------- parts

/**
 * @typedef {object} CorePartSpec
 * @property {string} name
 * @property {string} type GenBank feature key the part is annotated as
 * @property {string} category origin, marker, promoter, terminator, tag, …
 * @property {string} accession
 * @property {string} [note]
 * @property {{ feature: string, where?: Record<string, string>, nth?: number }} [select]
 * @property {string} [location]
 * @property {string} [probe]
 * @property {boolean} [allowPartial] a partial (`<`/`>`) record location is fine
 *
 * @typedef {object} BuiltPart
 * @property {string} name
 * @property {string} type
 * @property {string} category
 * @property {string} sequence
 * @property {string} accession
 * @property {string} location
 * @property {string} [note]
 */

/**
 * The feature a spec's `select` picks from a record.
 * @param {GbRecord} rec
 * @param {NonNullable<CorePartSpec['select']>} select
 * @param {string} name for messages
 */
function pickFeature(rec, select, name) {
  const matches = rec.features.filter(
    (f) =>
      f.key === select.feature &&
      Object.entries(select.where ?? {}).every(([q, v]) =>
        (f.qualifiers.get(q) ?? []).some((x) => x === v),
      ),
  );
  const index = select.nth ?? 0;
  const f = matches[index];
  if (f === undefined || (select.nth === undefined && matches.length > 1)) {
    throw new Error(
      `${name}: ${matches.length} ${select.feature} features in ${rec.version} match ${JSON.stringify(select.where ?? {})}`,
    );
  }
  return f;
}

/**
 * Where a probe occurs in a record, as a GenBank location; exactly once.
 * @param {GbRecord} rec
 * @param {string} probe
 * @param {string} name
 */
function locateProbe(rec, probe, name) {
  const p = probe.toUpperCase();
  const n = rec.sequence.length;
  const hay = rec.circular ? rec.sequence + rec.sequence.slice(0, p.length - 1) : rec.sequence;
  /** @type {string[]} */
  const found = [];
  for (const [strand, needle] of /** @type {const} */ ([
    ['+', p],
    ['-', reverseComplement(p)],
  ])) {
    for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
      if (at >= n) break;
      const end = at + p.length;
      const plain = end <= n ? `${at + 1}..${end}` : `join(${at + 1}..${n},1..${end - n})`;
      found.push(strand === '+' ? plain : `complement(${plain})`);
      if (strand === '-' && needle === p) break; // a palindrome, found once already
    }
  }
  const unique = [...new Set(found)];
  if (unique.length !== 1) {
    throw new Error(`${name}: probe found ${unique.length} times in ${rec.version}`);
  }
  return unique[0] ?? '';
}

/**
 * @param {CorePartSpec} spec
 * @returns {Promise<BuiltPart>}
 */
async function buildCorePart(spec) {
  const rec = parseGenBank(await fetchGenBank(spec.accession));
  let location;
  if (spec.select !== undefined) {
    const f = pickFeature(rec, spec.select, spec.name);
    location = f.location;
    if (/[<>]/.test(location) && spec.allowPartial !== true) {
      throw new Error(`${spec.name}: ${location} in ${rec.version} is partial`);
    }
    const expected = f.qualifiers.get('translation')?.[0];
    if (f.key === 'CDS' && expected !== undefined) {
      const protein = translate(readLocation(location, rec.sequence)).replace(/\*$/, '');
      // A first codon other than ATG still makes Met; so does GTG or TTG.
      if (protein.slice(1) !== expected.slice(1)) {
        throw new Error(
          `${spec.name}: ${location} in ${rec.version} does not translate to its /translation`,
        );
      }
    }
  } else if (spec.location !== undefined) {
    location = spec.location;
  } else if (spec.probe !== undefined) {
    location = locateProbe(rec, spec.probe, spec.name);
  } else {
    throw new Error(`${spec.name}: no select, location or probe`);
  }
  const sequence = readLocation(location, rec.sequence);
  if (!/^[ACGT]+$/.test(sequence))
    throw new Error(`${spec.name}: ambiguous bases in ${rec.version}`);
  if (sequence.length < MIN_LENGTH) throw new Error(`${spec.name}: only ${sequence.length} bp`);
  return {
    name: spec.name,
    type: spec.type,
    category: spec.category,
    sequence,
    accession: rec.version,
    location: location.replace(/\s+/g, ''),
    ...(spec.note === undefined ? {} : { note: spec.note }),
  };
}

/**
 * @typedef {object} FpSpec
 * @property {string} slug
 * @property {string} [accession] a GenBank protein accession, when FPbase names none or the wrong one
 *
 * @typedef {object} BuiltFp
 * @property {string} name
 * @property {string} type
 * @property {string} category
 * @property {string} sequence
 * @property {string} accession
 * @property {string} location
 * @property {string} fpbase FPbase page
 * @property {string} [doi] the protein's primary reference, as FPbase gives it
 * @property {number} [emMax]
 */

/**
 * @param {FpSpec} spec
 * @returns {Promise<BuiltFp>}
 */
async function buildFp(spec) {
  const fp = await fetchFpbase(spec.slug);
  const proteinAcc = spec.accession ?? fp.genbank;
  if (proteinAcc === null || proteinAcc === '') throw new Error(`${fp.name}: no GenBank protein`);
  const gp = await fetchProtein(proteinAcc);
  const codedBy = /\/coded_by="([^"]+)"/.exec(gp.replace(/\n\s+/g, ''))?.[1];
  if (codedBy === undefined) throw new Error(`${fp.name}: ${proteinAcc} has no /coded_by`);
  const m = /^(complement\()?([A-Z0-9_]+\.\d+):(.*?)\)?$/.exec(codedBy);
  if (m?.[2] === undefined || m[3] === undefined) {
    throw new Error(`${fp.name}: /coded_by not understood: ${codedBy}`);
  }
  const rec = parseGenBank(await fetchGenBank(m[2]));
  const location = m[1] === undefined ? m[3] : `complement(${m[3]})`;
  if (/[<>]/.test(location)) throw new Error(`${fp.name}: ${location} is partial`);
  const sequence = readLocation(location, rec.sequence);
  const protein = translate(sequence).replace(/\*$/, '');
  const expected = (fp.seq ?? '').toUpperCase();
  if (protein !== expected) {
    throw new Error(`${fp.name}: ${m[2]} ${location} does not translate to FPbase's protein`);
  }
  if (!/^[ACGT]+$/.test(sequence)) throw new Error(`${fp.name}: ambiguous bases`);
  const emMax = fp.states.find((s) => s.em_max !== null)?.em_max ?? undefined;
  return {
    name: fp.name,
    type: 'CDS',
    category: 'fluorescent protein',
    sequence,
    accession: rec.version,
    location,
    fpbase: `https://www.fpbase.org/protein/${fp.slug}/`,
    ...(fp.doi === null || fp.doi === '' ? {} : { doi: fp.doi }),
    ...(emMax === undefined ? {} : { emMax }),
  };
}

// ---------------------------------------------------------------------- main

/**
 * @template S, B
 * @param {readonly S[]} specs
 * @param {(s: S) => Promise<B>} build
 * @param {(s: S) => string} label
 */
async function buildAll(specs, build, label) {
  /** @type {B[]} */
  const out = [];
  /** @type {string[]} */
  const failed = [];
  for (const spec of specs) {
    try {
      out.push(await build(spec));
    } catch (e) {
      failed.push(`  ${label(spec)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { out, failed };
}

/**
 * Two parts with one name, or one sequence under two names, are a slip in
 * the spec; fail rather than ship them.
 * @param {readonly { name: string, sequence: string }[]} parts
 */
function checkUnique(parts) {
  /** @type {string[]} */
  const problems = [];
  const names = new Set();
  /** @type {Map<string, string>} */
  const seqs = new Map();
  for (const p of parts) {
    if (names.has(p.name.toLowerCase())) problems.push(`  duplicate name ${p.name}`);
    names.add(p.name.toLowerCase());
    const key = [p.sequence, reverseComplement(p.sequence)].sort()[0] ?? '';
    const other = seqs.get(key);
    if (other !== undefined) problems.push(`  ${p.name} has the same bases as ${other}`);
    seqs.set(key, p.name);
  }
  return problems;
}

/** @param {string} file */
function readSpec(file) {
  /** @type {unknown} */
  const parsed = JSON.parse(readFileSync(join(SPEC_DIR, file), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || !('parts' in parsed)) {
    throw new Error(`${file}: no "parts"`);
  }
  return parsed.parts;
}

const coreSpecs = /** @type {CorePartSpec[]} */ (readSpec('core-parts.json'));
const fpSpecs = /** @type {FpSpec[]} */ (readSpec('fpbase-proteins.json'));

const core = await buildAll(coreSpecs, buildCorePart, (s) => s.name);
const fps = await buildAll(fpSpecs, buildFp, (s) => s.slug);
const problems = [...core.failed, ...fps.failed, ...checkUnique([...core.out, ...fps.out])];
if (problems.length > 0) {
  console.error(`Feature database not written:\n${problems.join('\n')}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
/**
 * One part per line, so a rebuild's diff shows which parts changed.
 * @param {object} header
 * @param {readonly object[]} parts
 */
function serialise(header, parts) {
  const head = JSON.stringify(header).slice(0, -1);
  return `${head},"parts":[\n${parts.map((p) => JSON.stringify(p)).join(',\n')}\n]}\n`;
}
writeFileSync(
  join(OUT_DIR, 'core-parts.json'),
  serialise(
    {
      source:
        'Hand-curated common parts, each read from the NCBI nucleotide record cited with it (accession.version, GenBank location). Built by scripts/build-feature-db.mjs.',
      licence:
        'NCBI records are free of restrictions on use (https://www.ncbi.nlm.nih.gov/home/about/policies/).',
    },
    core.out,
  ),
);
writeFileSync(
  join(OUT_DIR, 'fpbase.json'),
  serialise(
    {
      source:
        'Fluorescent proteins chosen from FPbase (https://www.fpbase.org), Lambert, T.J. (2019) FPbase: a community-editable fluorescent protein database. Nature Methods 16, 277-278, doi:10.1038/s41592-019-0352-8. Names, protein sequences and references are FPbase data; the DNA is the coding sequence of the NCBI record cited with each, checked to translate to FPbase protein. Built by scripts/build-feature-db.mjs.',
      licence:
        'CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/), as FPbase data is licensed. See DATA-LICENSES.md.',
    },
    fps.out,
  ),
);
const bases = [...core.out, ...fps.out].reduce((n, p) => n + p.sequence.length, 0);
process.stdout.write(
  `Wrote ${core.out.length} core parts and ${fps.out.length} fluorescent proteins (${bases.toLocaleString()} bp) to ${OUT_DIR}\n`,
);
