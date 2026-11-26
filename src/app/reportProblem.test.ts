import { OPEN_FAILURE_REASONS } from '@/io';
import { parseSequenceFile } from '@/io';

import {
  REASON_EXPLANATIONS,
  REPORT_ADDRESS,
  canMailReport,
  classifyContent,
  coarseBrowser,
  failureReport,
  mailtoUrl,
  openFailureFacts,
  reportExtension,
  warningCategory,
  warningFacts,
  warningReport,
} from './reportProblem';

const ENV = {
  version: '1.27.0',
  buildDate: '2026-11-26',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
};
const MARKER = 'SECRETMARKER-xyz';

function decodedBody(url: string): string {
  const q = url.slice(url.indexOf('&body=') + 6);
  return decodeURIComponent(q).replace(/\r\n/g, '\n');
}

describe('the report address', () => {
  it('is a placeholder for now, so the mail link stays off', () => {
    expect(REPORT_ADDRESS.endsWith('.invalid')).toBe(true);
    expect(canMailReport()).toBe(false);
    expect(canMailReport('x@example.invalid')).toBe(false);
    expect(canMailReport('')).toBe(false);
  });
  it('switches the link on for a real address', () => {
    expect(canMailReport('reports@example.org')).toBe(true);
  });
});

describe('failureReport', () => {
  it.each(OPEN_FAILURE_REASONS)(
    'says %s with its fixed sentence and the closing line',
    (reason) => {
      const { subject, body } = failureReport(
        openFailureFacts(reason, { fileName: 'a.gb', bytes: new Uint8Array([65, 66]) }),
        ENV,
      );
      expect(subject).toBe(`PlasmidPop problem report: genbank:${reason} (1.27.0)`);
      expect(body).toContain(`Failure: ${reason}`);
      expect(body).toContain(REASON_EXPLANATIONS[reason]);
      expect(body).toContain('PlasmidPop 1.27.0 (built 2026-11-26)');
      expect(body).toContain('Browser: Firefox on Linux');
      expect(body).toContain('Size: 2 bytes');
      expect(body.endsWith('attach it to this email; nothing was sent automatically.')).toBe(true);
    },
  );

  it('carries line, section and records from a parser failure', () => {
    let error: unknown;
    try {
      parseSequenceFile('>a\nACGT\n>b\nAC*GT!\n', 'x.fa');
    } catch (e) {
      error = e;
    }
    const facts = openFailureFacts('parse-error', { fileName: 'x.fa', text: '>a\n' }, error);
    const { body } = failureReport(facts, ENV);
    expect(body).toContain('Stopped at line: 3');
    expect(body).toContain('Stopped in: sequence');
    expect(body).toContain('Records read before the failure: 1');
  });

  it('names a GenBank sequence failure and says unknown where it does not know', () => {
    let error: unknown;
    try {
      parseSequenceFile(
        'LOCUS       x      4 bp    DNA     linear   UNK 01-JAN-2000\nORIGIN\n        1 ac!g\n//\n',
      );
    } catch (e) {
      error = e;
    }
    expect(
      failureReport(openFailureFacts('parse-error', { fileName: 'x.gb' }, error), ENV).body,
    ).toContain('Stopped in: sequence');
    const body = failureReport(openFailureFacts('other', { fileName: null }), ENV).body;
    expect(body).toContain('Stopped in: unknown');
    expect(body).toContain('Stopped at line: unknown');
    expect(body).toContain('Size: unknown');
  });

  it('never carries the file name, the sequence, the message or the clipboard', () => {
    const text = `${MARKER}\nACGT\n`;
    let error: unknown;
    try {
      parseSequenceFile(text, `${MARKER}.gb`);
    } catch (e) {
      error = e;
    }
    expect((error as Error).message).toContain(MARKER);
    const facts = openFailureFacts(
      'unrecognised-format',
      { fileName: `${MARKER}.gb`, bytes: new TextEncoder().encode(text) },
      error,
    );
    const report = failureReport(facts, ENV);
    const url = mailtoUrl('reports@example.org', report);
    for (const t of [report.subject, report.body, url, decodedBody(url), decodeURIComponent(url)]) {
      expect(t).not.toContain(MARKER);
      expect(t).not.toContain('ACGT');
    }
    expect(JSON.stringify(facts)).not.toContain(MARKER);
  });

  it('keeps the whole mailto URL under 1500 characters, even for the longest values', () => {
    const facts = openFailureFacts('unrecognised-format', { fileName: 'a.gb' });
    const longest = { ...facts, line: 123456789, recordsParsed: 987654, sizeBytes: 9_999_999_999 };
    const report = failureReport(longest, {
      ...ENV,
      userAgent: 'Mozilla/5.0 (iPhone) Safari/605.1 CriOS/1 Edg/1',
    });
    expect(mailtoUrl('problem-reports@plasmidpop.org', report).length).toBeLessThan(1500);
  });
});

describe('the fixed lists', () => {
  it('names an extension only from the list', () => {
    expect(reportExtension('Some.GB')).toBe('gb');
    expect(reportExtension(`${MARKER}.${MARKER}`)).toBe('other');
    expect(reportExtension('noext')).toBe('other');
    expect(reportExtension(null)).toBe('other');
  });
  it('classifies content', () => {
    expect(classifyContent(new TextEncoder().encode('LOCUS x'))).toBe('text');
    expect(classifyContent(new Uint8Array([0x1f, 0x8b, 8]))).toBe('gzipped');
    expect(classifyContent(new Uint8Array([0xff, 0xfe, 0x4c, 0]))).toBe('UTF-16');
    expect(classifyContent(new Uint8Array([0x4c, 0, 0x4f, 0, 0x43, 0, 0x55, 0]))).toBe('UTF-16');
    expect(classifyContent(new Uint8Array([0x50, 0x4b, 3, 4, 1]))).toBe('binary');
    expect(classifyContent(new Uint8Array([1, 0, 5, 5, 7, 7, 7, 9, 9, 9, 9, 9]))).toBe('binary');
  });
  it('reduces a user agent to browser and OS names', () => {
    expect(coarseBrowser('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120')).toBe(
      'Edge on Windows',
    );
    expect(coarseBrowser('')).toBe('other on other');
  });
});

describe('warningReport', () => {
  const warnings = [
    { message: `Feature table: 2 lines were not read: "${MARKER}"`, line: 12 },
    { message: `Feature table: no FEATURES line ${MARKER}`, line: 30 },
    { message: 'Sequence: x', line: 50 },
    { message: `Something new ${MARKER}` },
  ];
  it('lists counts, categories and lines, never the text', () => {
    const report = warningReport(warningFacts(warnings, `${MARKER}.gb`), ENV);
    expect(report.body).toContain('Warnings: 4');
    expect(report.body).toContain('- Feature table: 2, at line 12, 30');
    expect(report.body).toContain('- Sequence: 1, at line 50');
    expect(report.body).toContain('- other: 1');
    const url = mailtoUrl('reports@example.org', report);
    expect(decodeURIComponent(url)).not.toContain(MARKER);
    expect(report.subject).toBe('PlasmidPop problem report: genbank:warnings (1.27.0)');
  });
  it('classifies by how the warning begins', () => {
    expect(warningCategory('Feature table and sequence: a')).toBe('Feature table and sequence');
    expect(warningCategory('Skipped CDS feature: bad')).toBe('Skipped feature');
    expect(warningCategory('???')).toBe('other');
  });
});
