import { describeBands } from '../analysis/gel';
import {
  type AssemblyStep,
  type DiagnosticDigest,
  type PcrStep,
  type Protocol,
  type ProtocolStep,
} from './protocol';

/** A protocol written out as a page, as Markdown or as one self-contained HTML file (#215). */

type Block =
  | { readonly t: 'h2' | 'h3'; readonly text: string }
  | { readonly t: 'p'; readonly text: string }
  | { readonly t: 'ul'; readonly items: readonly string[] }
  | {
      readonly t: 'table';
      readonly head: readonly string[];
      readonly rows: readonly (readonly string[])[];
    };

const dash = '–';

function bp(n: number): string {
  return `${n.toLocaleString('en-US')} bp`;
}

function temp(t: number | null): string {
  return t === null || Number.isNaN(t) ? dash : `${t.toFixed(1)} °C`;
}

function seconds(s: number): string {
  return s >= 90 ? `${String(Math.round((s / 60) * 10) / 10)} min` : `${String(s)} s`;
}

function pcrBlocks(step: PcrStep): Block[] {
  const proof = step.polymerase === 'proofreading';
  const ta = step.annealing === null ? 'the annealing temperature' : temp(step.annealing);
  const program = proof
    ? [
        '98 °C for 30 s',
        `30 cycles of 98 °C for 10 s, ${ta} for 20 s, 72 °C for ${seconds(step.extensionSeconds)}`,
        '72 °C for 2 min',
      ]
    : [
        '95 °C for 2 min',
        `30 cycles of 95 °C for 30 s, ${ta} for 30 s, 72 °C for ${seconds(step.extensionSeconds)}`,
        '72 °C for 5 min',
      ];
  return [
    { t: 'h3', text: `PCR: ${step.product} (${bp(step.productLength)})` },
    {
      t: 'table',
      head: ['Component', 'Amount'],
      rows: [
        [`Template: ${step.template} (${bp(step.templateLength)})`, '1–10 ng'],
        [`Forward primer ${step.forward.name}`, '0.5 µM'],
        [`Reverse primer ${step.reverse.name}`, '0.5 µM'],
        [
          proof
            ? 'Proofreading polymerase (Q5, Phusion) with its buffer'
            : 'Taq polymerase with its buffer',
          'as the supplier says',
        ],
        ['dNTPs', '200 µM each'],
      ],
    },
    {
      t: 'p',
      text: `Product ${bp(step.productLength)}. Tm of the annealing part: ${temp(step.tmForward)} forward, ${temp(
        step.tmReverse,
      )} reverse, from the 3′ end of each oligo (a 5′ tail is not counted, and the record does not say where it ends, so a primer over 30 bases is taken to anneal with its last 22). Annealing ${
        step.annealing === null ? 'could not be suggested (ambiguous bases)' : temp(step.annealing)
      }, extension ${seconds(step.extensionSeconds)}.${proof ? '' : ' Taq adds an A to each 3′ end.'}`,
    },
    { t: 'ul', items: program },
  ];
}

function amount(n: number): string {
  return String(n);
}

function assemblyBlocks(step: AssemblyStep): Block[] {
  const anyVolume = step.parts.some((p) => p.microlitres !== null);
  const title: Record<AssemblyStep['kind'], string> = {
    ligation: 'Ligation',
    'golden-gate': 'Golden Gate',
    gibson: 'Gibson / homology assembly',
  };
  const head = ['Part', 'Length', 'ng', 'pmol', ...(anyVolume ? ['µL'] : [])];
  const rows = step.parts.map((p) => [
    `${p.name} (${p.role})`,
    bp(p.length),
    amount(p.ng),
    amount(p.pmol),
    ...(anyVolume
      ? [p.microlitres === null ? 'enter a concentration' : amount(p.microlitres)]
      : []),
  ]);
  const blocks: Block[] = [
    { t: 'h3', text: `${title[step.kind]}: ${step.product} (${bp(step.productLength)})` },
    { t: 'p', text: step.description },
    { t: 'table', head, rows },
    {
      t: 'p',
      text: `Amounts give each insert ${String(step.ratio)} times the vector's molecules (660 g/mol per base pair).${
        step.enzymes.length > 0 ? ` Enzyme: ${step.enzymes.join(', ')} with T4 DNA ligase.` : ''
      }`,
    },
    { t: 'ul', items: step.program },
  ];
  return blocks;
}

function stepBlocks(step: ProtocolStep): Block[] {
  switch (step.kind) {
    case 'pcr':
      return pcrBlocks(step);
    case 'digest':
      return [
        { t: 'h3', text: `Digest: ${step.product} (${bp(step.productLength)})` },
        {
          t: 'p',
          text: `Cut ${step.template} (${bp(step.templateLength)}) with ${
            step.enzymes.length === 0 ? 'no enzyme (an uncut piece)' : step.enzymes.join(' and ')
          }; keep the ${bp(step.productLength)} fragment.`,
        },
        { t: 'ul', items: step.notes },
      ];
    case 'ligation':
    case 'golden-gate':
    case 'gibson':
      return assemblyBlocks(step);
    case 'other':
      return [
        { t: 'h3', text: `${step.product} (${bp(step.productLength)})` },
        { t: 'p', text: step.description },
        ...(step.parts.length > 0
          ? [{ t: 'p', text: `From: ${step.parts.join(', ')}.` } as Block]
          : []),
      ];
  }
}

function diagnosticRows(d: DiagnosticDigest): readonly string[] {
  return [d.enzyme, String(d.cuts), describeBands(d.profile, 8)];
}

function blocks(p: Protocol): Block[] {
  const out: Block[] = [
    {
      t: 'p',
      text: `${bp(p.length)}, ${p.topology}. Built from what the product records of how it was made; the programs are the usual ones for each reaction, so follow your supplier's instructions where they differ.`,
    },
  ];
  for (const c of p.caveats) out.push({ t: 'p', text: c });
  out.push({ t: 'h2', text: 'Oligos to order' });
  if (p.oligos.length === 0)
    out.push({ t: 'p', text: 'None: no step of this product used a primer.' });
  else {
    out.push({
      t: 'table',
      head: ['Name', 'Sequence (5′→3′)', 'Length', 'For', 'My primers'],
      rows: p.oligos.map((o) => [
        o.name,
        o.sequence,
        `${String(o.length)} nt`,
        o.usedFor.join(', '),
        o.inCollection === null ? 'order' : `already there as ${o.inCollection}`,
      ]),
    });
  }
  out.push({ t: 'h2', text: 'Reactions, in order' });
  if (p.steps.length === 0) out.push({ t: 'p', text: 'The record names no reaction.' });
  p.steps.forEach((s, i) => {
    const b = stepBlocks(s);
    const first = b[0];
    if (first?.t === 'h3') b[0] = { t: 'h3', text: `${String(i + 1)}. ${first.text}` };
    out.push(...b);
  });
  out.push({ t: 'h2', text: 'Expected diagnostic digest' });
  if (p.diagnostics.length === 0) {
    out.push({
      t: 'p',
      text: 'No enzyme in the set in use cuts the product between once and six times.',
    });
  } else {
    out.push({
      t: 'table',
      head: ['Enzyme', 'Cuts', 'Bands'],
      rows: p.diagnostics.map(diagnosticRows),
    });
    out.push({
      t: 'p',
      text: 'Clearest first. Band sizes are of the fragments the product gives; a circle left uncut runs supercoiled, not at its size.',
    });
  }
  return out;
}

const mdCell = (s: string): string => s.replace(/\|/g, '\\|');

/** The protocol as Markdown. */
export function protocolToMarkdown(p: Protocol): string {
  const lines: string[] = [`# Protocol: ${p.product}`, ''];
  for (const b of blocks(p)) {
    switch (b.t) {
      case 'h2':
        lines.push(`## ${b.text}`, '');
        break;
      case 'h3':
        lines.push(`### ${b.text}`, '');
        break;
      case 'p':
        lines.push(b.text, '');
        break;
      case 'ul':
        lines.push(...b.items.map((i) => `- ${i}`), '');
        break;
      case 'table':
        lines.push(
          `| ${b.head.map(mdCell).join(' | ')} |`,
          `| ${b.head.map(() => '---').join(' | ')} |`,
          ...b.rows.map((r) => `| ${r.map(mdCell).join(' | ')} |`),
          '',
        );
        break;
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The protocol as one HTML page with its own styles, ready to print. */
export function protocolToHtml(p: Protocol): string {
  const body: string[] = [`<h1>Protocol: ${esc(p.product)}</h1>`];
  for (const b of blocks(p)) {
    switch (b.t) {
      case 'h2':
      case 'h3':
        body.push(`<${b.t}>${esc(b.text)}</${b.t}>`);
        break;
      case 'p':
        body.push(`<p>${esc(b.text)}</p>`);
        break;
      case 'ul':
        body.push(`<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`);
        break;
      case 'table':
        body.push(
          `<table><thead><tr>${b.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows
            .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
            .join('')}</tbody></table>`,
        );
        break;
    }
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Protocol: ${esc(p.product)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;color:#1b1b1b}
table{border-collapse:collapse;margin:.5rem 0 1rem}th,td{border:1px solid #bbb;padding:.25rem .6rem;text-align:left;vertical-align:top}
td:nth-child(2){font-family:ui-monospace,monospace;word-break:break-all}h2{margin-top:2rem;border-bottom:1px solid #bbb}</style>
</head><body>
${body.join('\n')}
</body></html>
`;
}
