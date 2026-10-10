import {
  type CodonUsageTable,
  type RecodeOptions,
  type RecodeStrategy,
  CODON_USAGE_TABLES,
  RECODE_DEFAULTS,
  getEnzyme,
} from '@/core';

/** What the recode controls hold, as typed (#209). Percentages are whole numbers. */
export interface RecodeForm {
  readonly host: string;
  readonly strategy: RecodeStrategy;
  /** Enzyme names, separated by commas or spaces. */
  readonly avoid: string;
  readonly gcWindow: string;
  readonly gcMin: string;
  readonly gcMax: string;
  readonly maxRun: string;
}

export const DEFAULT_RECODE_FORM: RecodeForm = {
  host: CODON_USAGE_TABLES[0]?.id ?? '',
  strategy: 'best',
  avoid: '',
  gcWindow: String(RECODE_DEFAULTS.gcWindow),
  gcMin: String(RECODE_DEFAULTS.gcMin * 100),
  gcMax: String(RECODE_DEFAULTS.gcMax * 100),
  maxRun: String(RECODE_DEFAULTS.maxRun),
};

export type ResolvedForm =
  | { readonly ok: true; readonly host: CodonUsageTable; readonly options: RecodeOptions }
  | { readonly ok: false; readonly error: string };

function whole(text: string, low: number, high: number): number | null {
  if (text.trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= low && n <= high ? n : null;
}

/** The options the form asks for, or what is wrong with it. `hosts` is every table the menu offers. */
export function resolveRecodeForm(
  form: RecodeForm,
  hosts: readonly CodonUsageTable[],
): ResolvedForm {
  const host = hosts.find((h) => h.id === form.host) ?? hosts[0];
  if (host === undefined) return { ok: false, error: 'There is no codon usage table.' };
  const names = form.avoid.split(/[\s,;]+/).filter((n) => n !== '');
  const avoid = [];
  for (const name of names) {
    const enzyme = getEnzyme(name);
    if (enzyme === undefined) return { ok: false, error: `${name} is not an enzyme we know.` };
    avoid.push({ name: enzyme.name, site: enzyme.site });
  }
  const gcWindow = whole(form.gcWindow, 10, 500);
  const gcMin = whole(form.gcMin, 0, 100);
  const gcMax = whole(form.gcMax, 0, 100);
  const maxRun = whole(form.maxRun, 0, 50);
  if (gcWindow === null) return { ok: false, error: 'The GC window is 10 to 500 bases.' };
  if (gcMin === null || gcMax === null) return { ok: false, error: 'GC limits are 0 to 100 %.' };
  if (gcMin > gcMax) return { ok: false, error: 'The lowest GC is above the highest.' };
  if (maxRun === null) return { ok: false, error: 'The longest run is 0 (no limit) to 50 bases.' };
  return {
    ok: true,
    host,
    options: {
      host,
      strategy: form.strategy,
      avoid,
      gcWindow: Math.floor(gcWindow),
      gcMin: gcMin / 100,
      gcMax: gcMax / 100,
      maxRun: Math.floor(maxRun),
    },
  };
}
