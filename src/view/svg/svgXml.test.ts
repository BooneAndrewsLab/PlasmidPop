// @vitest-environment jsdom
import { SeqDocument, createFeature, findCutSites, rangeSegment } from '@/core';
import { ENZYMES } from '@/core/analysis/restriction';

import { exportMapSvg } from './exportMap';
import { exportLinearSvg, exportLinearSvgPages } from './exportLinear';

/**
 * Every SVG export must be well-formed XML whatever a user types into a
 * document, feature, qualifier or enzyme name: control characters, NUL,
 * non-characters, lone surrogates, markup and CDATA terminators (#158).
 * The strings are parsed back by a strict XML parser.
 */
const HOSTILE: Readonly<Record<string, string>> = {
  c0: 'a\u0001b\u0008c',
  whitespace: 'a\tb\nc\rd',
  vtff: 'a\u000bb\u000cc',
  nul: 'a\u0000b',
  nonchars: 'a￾b￿c',
  loneHigh: 'a\ud800b',
  loneLow: 'a\udc00b',
  highAtEnd: 'ab\ud83d',
  pair: 'a\u{1F600}b',
  markup: 'A&B <x> "q" \'s\' ]]> &amp;',
  cdata: '<![CDATA[x]]>',
  c1: 'a\u007fb\u0085c\u009fd',
  bidi: 'a‮b​c',
  fdd0: 'a﷐b',
  spaces: '  lead  trail  ',
};

function wellFormed(svg: string): string | null {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const error = parsed.getElementsByTagName('parsererror')[0];
  return error === undefined ? null : error.textContent;
}

describe('SVG export is well-formed XML for hostile names', () => {
  it.each(Object.entries(HOSTILE))('%s', (_key, bad) => {
    const seq = 'ACGT'.repeat(100) + 'GAATTC' + 'ACGT'.repeat(50);
    const features = [
      createFeature({
        id: 'a',
        type: 'CDS',
        name: `F${bad}`,
        segments: [rangeSegment(10, 200)],
        qualifiers: [{ name: 'note', value: `N${bad}` }],
      }),
    ];
    const enzymes = ENZYMES.filter((e) => e.name === 'EcoRI').map((e) => ({
      ...e,
      name: `E${bad}`,
    }));
    const sites = findCutSites(seq, 'circular', enzymes);
    expect(sites.length).toBe(1);
    const circular = SeqDocument.create({
      sequence: seq,
      name: `D${bad}`,
      topology: 'circular',
      features,
    });
    const linear = SeqDocument.create({
      sequence: seq,
      name: `D${bad}`,
      topology: 'linear',
      features,
    });
    const outputs: Record<string, string> = {
      'circular map': exportMapSvg(circular, { cutSites: sites }),
      'linear map': exportMapSvg(linear, { cutSites: sites }),
      'linear view': exportLinearSvg(circular, { cutSites: sites, range: { start: 0, end: 300 } }),
    };
    exportLinearSvgPages(circular, { cutSites: sites }).forEach((p, i) => {
      outputs[`page ${String(i)}`] = p;
    });
    for (const [what, svg] of Object.entries(outputs)) {
      expect(wellFormed(svg), what).toBeNull();
    }
  });

  it('the checker does reject malformed XML', () => {
    expect(
      wellFormed('<svg xmlns="http://www.w3.org/2000/svg"><text>a\u0001b</text></svg>'),
    ).not.toBeNull();
  });
});
