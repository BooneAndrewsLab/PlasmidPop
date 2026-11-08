import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { GUIDE, guidePage } from '@/app/help/guide';
import {
  VALIDATION_MARKER,
  buildValidation,
  countAt,
  fillValidationMarker,
  parseRequirements,
  readValidationInput,
  renderValidationMarkdown,
  summarizeMutationReport,
  thousands,
  type ValidationInput,
} from '../../../scripts/validationTools.mjs';

// The Validation page's generator (item 142, #362). The first block runs it on
// a small fixture, so that a count is shown to come from the data and a missing
// entry is shown to be found. The second runs it on the repository: every file
// under src/test/oracle has an entry, the stamps agree with the pins, and the
// page the app shows names every area with the counts the data gives.

const root = join(import.meta.dirname, '../../..');

const fixture = (over: Partial<ValidationInput> = {}): ValidationInput => ({
  registry: {
    dataDir: 'data',
    areas: [
      {
        id: 'cut',
        title: 'Cutting',
        oracles: [{ name: 'Tool', package: 'tool', stampKey: 'tool' }],
        compares: 'Where it cuts.',
        files: ['cut.json'],
        tests: ['cut.test.ts'],
        counts: [
          { file: 'cut.json', path: 'cases', unit: 'digests' },
          { file: 'cut.json', path: 'cases.*.cuts', unit: 'cuts' },
        ],
      },
      {
        id: 'sim',
        title: 'Simulated',
        oracles: [{ name: 'A known construct', package: null }],
        compares: 'Reads.',
        files: [],
        tests: ['sim.test.ts'],
        counts: [],
      },
    ],
    support: { files: ['x.gbk'], tests: ['helper.ts'] },
  },
  deviations: [
    { area: 'cut', text: 'A | B differ.', kind: 'by design', issue: null, where: 'x' },
    { area: 'cut', text: 'Another.', kind: 'limit', issue: 12, where: 'y' },
  ],
  mutation: {
    score: null,
    floor: null,
    date: null,
    appVersion: null,
    run: null,
    stryker: null,
    counts: null,
    files: [],
    unmeasured: [],
  },
  requirements: new Map([['tool', '2.0']]),
  readData: () => ({ tool: '2.0', cases: [{ cuts: [1, 2, 3] }, { cuts: [4] }, { cuts: [] }] }),
  dataFiles: ['cut.json', 'x.gbk'],
  testFiles: ['cut.test.ts', 'sim.test.ts', 'helper.ts'],
  ...over,
});

describe('countAt', () => {
  const data = { a: [1, 2, 3], b: { x: 1, y: 2 }, c: [{ n: [1] }, { n: [1, 2] }], d: 4 };

  it('counts an array, an object, and what lies under a star', () => {
    expect(countAt(data, 'a')).toBe(3);
    expect(countAt(data, 'b')).toBe(2);
    expect(countAt(data, 'c.*.n')).toBe(3);
  });

  it('refuses a path that is not a count instead of returning zero', () => {
    expect(() => countAt(data, 'missing')).toThrow(/no "missing"/);
    expect(() => countAt(data, 'd')).toThrow(/not an array or object/);
    expect(() => countAt(data, 'd.*')).toThrow(/non-container/);
  });
});

describe('parseRequirements', () => {
  it('reads pins, ignores comments, and lower-cases names', () => {
    const pins = parseRequirements(
      '# a\nBiopython==1.85\n  pydna==5.5.7  # why\nprimer3-py==2.2.0\n',
    );
    expect([...pins]).toEqual([
      ['biopython', '1.85'],
      ['pydna', '5.5.7'],
      ['primer3-py', '2.2.0'],
    ]);
  });
});

describe('buildValidation on a small fixture', () => {
  it('counts from the data it is given', () => {
    const v = buildValidation(fixture());
    expect(v.areas[0]?.counts).toEqual([
      { unit: 'digests', file: 'cut.json', n: 3 },
      { unit: 'cuts', file: 'cut.json', n: 4 },
    ]);
    const more = buildValidation(
      fixture({
        readData: () => ({ tool: '2.0', cases: [{ cuts: [1] }, { cuts: [1] }] }),
      }),
    );
    expect(more.areas[0]?.counts.map((c) => c.n)).toEqual([2, 2]);
  });

  it('takes the version from the pin, and from the stamp where there is no pin', () => {
    expect(buildValidation(fixture()).areas[0]?.oracles[0]).toMatchObject({
      version: '2.0',
      source: 'pin',
    });
    const v = buildValidation(fixture({ requirements: new Map() }));
    expect(v.areas[0]?.oracles[0]).toMatchObject({ version: '2.0', source: 'stamp' });
    expect(v.areas[1]?.oracles[0]).toMatchObject({ version: null, source: null });
  });

  it('reports a stamp that is not the pinned version', () => {
    const v = buildValidation(
      fixture({
        readData: () => ({ tool: '1.0', cases: [] }),
        requirements: new Map([['tool', '2.0']]),
      }),
    );
    expect(v.mismatches).toEqual(['cut: cut.json says tool 1.0, pinned 2.0']);
  });

  it('finds a data file or a test with no entry, and a deviation of no area', () => {
    const v = buildValidation(
      fixture({
        dataFiles: ['cut.json', 'x.gbk', 'new.json'],
        testFiles: ['cut.test.ts', 'sim.test.ts', 'helper.ts', 'new.test.ts'],
        deviations: [{ area: 'nowhere', text: 't', kind: 'k', issue: null, where: 'w' }],
      }),
    );
    expect(v.unlisted).toEqual({ data: ['new.json'], tests: ['new.test.ts'] });
    expect(v.unknownDeviationAreas).toEqual(['nowhere']);
    expect(buildValidation(fixture()).unlisted).toEqual({ data: [], tests: [] });
  });

  it('writes every area, its numbers, its differences, and says when there is no score', () => {
    const md = renderValidationMarkdown(buildValidation(fixture()), 'data');
    expect(md).toContain('### Cutting');
    expect(md).toContain('### Simulated');
    expect(md).toContain('- **Oracle:** Tool, version 2.0.');
    expect(md).toContain('- **Cases:** 3 digests; 4 cuts.');
    expect(md).toContain('no data file for this area is committed');
    expect(md).toContain('- **Known differences:** 2, listed under Known differences below.');
    expect(md).toContain('| Cutting | A / B differ. | by design | none |');
    expect(md).toContain('| Cutting | Another. | limit | #12 |');
    expect(md).toContain('**Not yet recorded.**');
    expect(md).not.toMatch(/Latest score/);
  });
});

describe('the mutation summary', () => {
  const report = {
    framework: { version: '10.0.0' },
    files: {
      'src/core/a.ts': {
        mutants: [
          { status: 'Killed' },
          { status: 'Killed' },
          { status: 'Timeout' },
          { status: 'Survived' },
          { status: 'Ignored' },
        ],
      },
      'src/core/b.ts': { mutants: [{ status: 'Killed' }, { status: 'NoCoverage' }] },
      'src/io/c.ts': { mutants: [{ status: 'Ignored' }] },
    },
  };
  const meta = {
    date: '2026-01-02',
    appVersion: '9.9.9',
    run: 'a test run',
    floor: 90,
    configured: ['src/core/a.ts', 'src/core/b.ts', 'src/core/missing.ts'],
  };

  it('scores as Stryker does and names a configured file the report lacks', () => {
    const s = summarizeMutationReport(report, meta);
    // detected 4 (3 killed, 1 timeout) over 6 counted (1 survived, 1 uncovered)
    expect(s.score).toBeCloseTo(66.67, 2);
    expect(s.files.find((f) => f.file === 'src/core/a.ts')?.score).toBe(75);
    expect(s.files.find((f) => f.file === 'src/io/c.ts')?.score).toBeNull();
    expect(s.counts).toMatchObject({
      Killed: 3,
      Timeout: 1,
      Survived: 1,
      NoCoverage: 1,
      Ignored: 2,
    });
    expect(s.unmeasured).toEqual(['src/core/missing.ts']);
    expect(s.stryker).toBe('10.0.0');
  });

  it('is shown with its date, version and unmeasured files', () => {
    const mutation = summarizeMutationReport(report, meta);
    const md = renderValidationMarkdown(buildValidation(fixture({ mutation })), 'data');
    expect(md).toContain('**Latest score:** 66.67%, against a floor of 90.');
    expect(md).toContain('2026-01-02, for release 9.9.9: a test run, with Stryker 10.0.0');
    expect(md).toContain('`src/core/missing.ts`');
    expect(md).toContain('| `src/core` | 2 | 6 | 66.67% |');
  });
});

describe('thousands', () => {
  it('groups digits the same everywhere', () => {
    expect(thousands(7)).toBe('7');
    expect(thousands(1710)).toBe('1,710');
    expect(thousands(1234567)).toBe('1,234,567');
  });
});

describe('the repository against the Validation page', () => {
  const input = readValidationInput(root);
  const v = buildValidation(input);

  it('has an entry for every file and test under src/test/oracle', () => {
    expect(v.unlisted).toEqual({ data: [], tests: [] });
  });

  it('has a known area for every known difference', () => {
    expect(v.unknownDeviationAreas).toEqual([]);
  });

  it('has oracle data stamped with the pinned versions', () => {
    expect(v.mismatches).toEqual([]);
    const pins = input.requirements;
    expect(pins.get('biopython')).toBeDefined();
    expect(pins.get('pydna')).toBeDefined();
    expect(pins.get('primer3-py')).toBeDefined();
  });

  it('names a version for every oracle that has a package, and counts every area that has data', () => {
    for (const a of v.areas) {
      const spec = input.registry.areas.find((s) => s.id === a.id);
      spec?.oracles.forEach((o, i) => {
        if (o.package != null || o.stampKey !== undefined)
          expect(a.oracles[i]?.version, `${a.id}: ${o.name}`).not.toBeNull();
      });
      if (a.files.some((f) => f.endsWith('.json')))
        expect(a.counts.length, a.id).toBeGreaterThan(0);
      for (const c of a.counts) expect(c.n, `${a.id}: ${c.unit}`).toBeGreaterThan(0);
    }
  });

  it('lists only data files and tests that exist, and every data file is read by one of its tests', () => {
    const read = (t: string): string =>
      readFileSync(
        t.startsWith('src/') ? join(root, t) : join(root, input.registry.dataDir, t),
        'utf8',
      );
    for (const a of input.registry.areas) {
      for (const f of a.files) expect(input.dataFiles, f).toContain(f);
      const texts = a.tests.map(read);
      for (const f of a.files)
        expect(
          texts.some((t) => t.includes(f)),
          `${a.id}: no test of the area mentions ${f}`,
        ).toBe(true);
    }
  });

  it('is on the page the app shows, with every area and the counts the data gives', () => {
    const page = guidePage('18-validation');
    expect(page, 'the guide has the Validation page').toBeDefined();
    expect(GUIDE.at(-1)?.id).toBe('18-validation');
    const md = page?.markdown ?? '';
    expect(md).not.toContain(VALIDATION_MARKER);
    expect(md).not.toContain('<!-- validation-tables -->');
    for (const a of v.areas) {
      expect(md, a.id).toContain(`### ${a.title}`);
      for (const c of a.counts)
        expect(md, `${a.id}: ${c.unit}`).toContain(`${thousands(c.n)} ${c.unit}`);
    }
    for (const d of v.deviations) expect(md).toContain(d.text.slice(0, 40));
    const m = v.mutation;
    expect(md).toContain(
      m.score === null ? 'Not yet recorded' : `**Latest score:** ${m.score.toFixed(2)}%`,
    );
  });

  it('fills the marker of the page source, and only that', () => {
    const source = readFileSync(join(root, 'docs/guide/18-validation.md'), 'utf8');
    expect(source.split(VALIDATION_MARKER)).toHaveLength(2);
    expect(fillValidationMarker(source, 'TABLES')).toContain('TABLES');
    expect(fillValidationMarker('no marker here', 'TABLES')).toBe('no marker here');
  });

  it('records a score only from a summary that carries its numbers', () => {
    const m = v.mutation;
    if (m.score === null) {
      expect(m.counts).toBeNull();
      return;
    }
    const counts = m.counts ?? {};
    const detected = (counts['Killed'] ?? 0) + (counts['Timeout'] ?? 0);
    const total = detected + (counts['Survived'] ?? 0) + (counts['NoCoverage'] ?? 0);
    expect(m.score).toBeCloseTo((100 * detected) / total, 2);
    const fileTotal = m.files.reduce(
      (n, f) => n + f.killed + f.timeout + f.survived + f.noCoverage,
      0,
    );
    expect(fileTotal).toBe(total);
    expect(m.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
