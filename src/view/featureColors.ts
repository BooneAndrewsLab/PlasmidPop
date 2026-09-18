import { type Feature } from '@/core';

/** Colours by GenBank feature key, used when the file carries no colour of its own. */
const TYPE_COLORS: Readonly<Record<string, string>> = {
  CDS: '#6f9bd1',
  gene: '#7fb069',
  mRNA: '#7acbd6',
  exon: '#7acbd6',
  intron: '#bfc7cc',
  promoter: '#e9a03b',
  terminator: '#d9534f',
  rep_origin: '#a88bd6',
  primer_bind: '#c97ba4',
  misc_feature: '#8fa3b1',
  misc_binding: '#5fb3a1',
  protein_bind: '#5fb3a1',
  regulatory: '#e1b45c',
  enhancer: '#e1b45c',
  RBS: '#d08b3f',
  polyA_signal: '#d08b3f',
  LTR: '#b58e5a',
  repeat_region: '#b5a27a',
  source: '#c9ced3',
  sig_peptide: '#89b8e0',
  misc_RNA: '#7acbd6',
  tRNA: '#7acbd6',
  rRNA: '#7acbd6',
  oriT: '#a88bd6',
  ncRNA: '#7acbd6',
};

const DEFAULT_COLOR = '#9aa5b1';
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Colour for a feature: an explicit colour written by ApE
 * (`/ApEinfo_fwdcolor`, `/ApEinfo_revcolor`) or SnapGene (`/note="color:
 * #rrggbb"`), otherwise by feature type.
 */
export function featureColor(feature: Feature): string {
  const preferred = feature.strand === 'reverse' ? 'ApEinfo_revcolor' : 'ApEinfo_fwdcolor';
  for (const name of [preferred, 'ApEinfo_fwdcolor', 'ApEinfo_revcolor']) {
    const q = feature.qualifiers.find(
      (x) => x.name === name && x.value !== null && HEX.test(x.value.trim()),
    );
    if (q?.value != null) return q.value.trim().toLowerCase();
  }
  for (const q of feature.qualifiers) {
    if (q.name !== 'note' || q.value === null) continue;
    const m = /color:\s*(#[0-9a-f]{6}|#[0-9a-f]{3})/i.exec(q.value);
    if (m?.[1] !== undefined) return m[1].toLowerCase();
  }
  return TYPE_COLORS[feature.type] ?? DEFAULT_COLOR;
}

/** `hex` (#rgb or #rrggbb) as an rgba() string with the given opacity; other strings pass through. */
export function withAlpha(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  if (rgb === null) return hex;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (m?.[1] === undefined) return null;
  let h = m[1];
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

/** Black or white, whichever reads better on `hex`. */
export function contrastingText(hex: string): string {
  const rgb = parseHex(hex);
  if (rgb === null) return '#1c2430';
  const [r, g, b] = rgb;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#1c2430' : '#ffffff';
}
