import { type Enzyme, overhangKind, overhangLength } from '@/core';

/** Where a cut falls, in words, counting bases from the 5' end of the top strand's site. */
function where(cut: number, n: number): string {
  if (cut < 0) return `${-cut} nt before the site`;
  if (cut > n) return `${cut - n} nt past the site`;
  if (cut === 0) return 'before the first base';
  if (cut === n) return 'after the last base';
  return `after base ${cut}`;
}

/** The enzyme written back in notation, as the dialog read it. */
export function notationOf(e: Enzyme): string {
  const n = e.site.length;
  const second = e.secondCut;
  if (second !== undefined) {
    return `(${-e.cutTop}/${-e.cutBottom})${e.site}(${second.cutTop - n}/${second.cutBottom - n})`;
  }
  if (e.cutTop >= 0 && e.cutTop <= n && e.cutBottom >= 0 && e.cutBottom <= n) {
    const marks: [number, string][] = [
      [e.cutTop, '^'],
      [e.cutBottom, '_'],
    ];
    // The later mark first, so the earlier index stays valid as marks go in.
    marks.sort((a, b) => b[0] - a[0] || (a[1] === '_' ? -1 : 1));
    let out = e.site;
    for (const [at, mark] of marks) out = out.slice(0, at) + mark + out.slice(at);
    return out;
  }
  return `${e.site}(${e.cutTop - n}/${e.cutBottom - n})`;
}

/** What the enzyme does to a piece of DNA, as lines for the dialog's preview. */
export function describeEnzyme(e: Enzyme): string[] {
  const n = e.site.length;
  const lines = [
    `Site ${e.site}, ${e.palindromic ? 'palindromic: it reads the same on both strands, so one site is one cut.' : 'not palindromic: it is found on either strand, and cuts the other way round on the reverse one.'}`,
    `Top strand cut: ${where(e.cutTop, n)}.`,
    `Bottom strand cut: ${where(e.cutBottom, n)}.`,
  ];
  const kind = overhangKind(e);
  if (e.secondCut !== undefined) {
    lines.push(
      `Cuts on both sides of the site; the other cut is top ${where(e.secondCut.cutTop, n)}, bottom ${where(e.secondCut.cutBottom, n)}.`,
    );
  }
  if (kind === 'blunt') lines.push('Leaves blunt ends.');
  else {
    const inside = Math.min(e.cutTop, e.cutBottom) >= 0 && Math.max(e.cutTop, e.cutBottom) <= n;
    const bases = inside
      ? ` (${e.site.slice(Math.min(e.cutTop, e.cutBottom), Math.max(e.cutTop, e.cutBottom))})`
      : '';
    lines.push(`Leaves a ${overhangLength(e)}-nt ${kind} overhang${bases}.`);
  }
  return lines;
}
