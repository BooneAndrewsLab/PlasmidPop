/**
 * Usage statistics via a self-hosted Matomo instance.
 *
 * Nothing is sent unless the instance URL and site id were set at build time
 * (`VITE_MATOMO_URL`, `VITE_MATOMO_SITE_ID`) and the browser does not send a
 * Do-Not-Track signal. Events carry only coarse actions ("opened genbank",
 * "ran ligation"); never sequence content, file names or other scientific
 * data. The tracker runs cookieless; IP anonymisation is an instance setting.
 *
 * The page URL is reported without its fragment, deliberately and with a
 * test: a share link carries the whole document after the `#`, and Matomo
 * sends `window.location.href` whole unless it is told otherwise. Both the
 * belt (`setCustomUrl` for this page view) and the braces
 * (`discardHashTag`, which covers any later one) are set.
 *
 * What may be sent is `EVENTS`, below, and nothing else: `track` accepts a
 * category and action only from it. The list is also what "unused" is read
 * against — a feature that never shows up in the Events report is on it and
 * was not used (item 38, `docs/design/38-usage-events.md`).
 */

import { type EditOp } from '@/core';

export interface AnalyticsConfig {
  /** Matomo instance URL, with trailing slash. */
  readonly url: string;
  readonly siteId: string;
}

interface Env {
  readonly VITE_MATOMO_URL?: string;
  readonly VITE_MATOMO_SITE_ID?: string;
}

/** Reads the build-time config; `null` when unset, so the tracker is a no-op. */
export function readConfig(env: Env = import.meta.env): AnalyticsConfig | null {
  const url = env.VITE_MATOMO_URL?.trim() ?? '';
  const siteId = env.VITE_MATOMO_SITE_ID?.trim() ?? '';
  if (url === '' || siteId === '') return null;
  return { url: url.endsWith('/') ? url : `${url}/`, siteId };
}

/** True when the browser asks not to be tracked; nothing is sent then. */
export function doNotTrack(nav: Partial<Navigator> = globalThis.navigator): boolean {
  const flag = nav.doNotTrack ?? (globalThis as { doNotTrack?: string }).doNotTrack;
  return flag === '1' || flag === 'yes';
}

/** Every kind of edit, by the name `EditOp` gives it; exhaustive by `Record`. */
const EDIT_OPS: Readonly<Record<EditOp['type'], true>> = {
  insert: true,
  delete: true,
  replace: true,
  insertFragment: true,
  reverseComplement: true,
  setOrigin: true,
  setTopology: true,
  setEnds: true,
  bluntEnds: true,
  setMethylation: true,
  rename: true,
  setMetadata: true,
  addFeature: true,
  updateFeature: true,
  removeFeature: true,
};

/**
 * Everything the app may report, as category → actions. The event name,
 * where there is one, is a fixed label: a file format, a panel, a view, a
 * key binding, a guide page, the app version. Never anything the user typed
 * or anything read from a document.
 */
export const EVENTS = {
  /** Once per visit: `start` (the version), `layout` (desktop/phone), `display` (browser/standalone). */
  app: ['start', 'layout', 'display'],
  file: ['open', 'open-failed', 'new', 'download', 'compare', 'export'],
  share: ['copy', 'open'],
  /** Which sidebar tab the user opened. */
  panel: ['open'],
  /** The view switcher, the toolbar toggles and the Format menu options. */
  view: ['mode', 'toggle', 'format'],
  find: ['open'],
  /** The kind of edit only: never where, how long, or what bases. */
  edit: [...(Object.keys(EDIT_OPS) as EditOp['type'][]), 'undo', 'redo'],
  edits: ['baseline'],
  history: ['jump'],
  enzymes: ['show', 'import', 'import-clear'],
  primers: ['design'],
  align: ['run'],
  cloning: [
    'ligate',
    'open-fragment',
    'gibson',
    'golden-gate',
    'pcr',
    'mutagenesis',
    'gateway',
    'overlap-primers',
  ],
  /** A key binding was used; the name is the binding, e.g. `alt+c`. */
  shortcut: ['use'],
  /** Which page of the guide was read. */
  help: ['page'],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type EventCategory = keyof typeof EVENTS;
export type EventAction<C extends EventCategory> = (typeof EVENTS)[C][number];

/** The key bindings reported under `shortcut`. */
export type Shortcut =
  | 'alt+c'
  | 'alt+t'
  | 'alt+r'
  | 'alt+e'
  | 'alt+s'
  | 'alt+l'
  | 'alt+digit'
  | 'ctrl+s'
  | 'ctrl+f'
  | 'ctrl+z'
  | 'ctrl+shift+arrow';

/**
 * A file extension reduced to the formats the app knows, so a name the user
 * gave a file can never reach the tracker through its extension.
 */
export function formatOfFileName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const ext = dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
  if (['gb', 'gbk', 'genbank', 'gbff', 'ape'].includes(ext)) return 'genbank';
  if (['fa', 'fasta', 'fna', 'fas', 'ffn', 'faa'].includes(ext)) return 'fasta';
  if (ext === 'dna') return 'snapgene';
  if (ext === 'ab1' || ext === 'abi') return 'abif';
  if (['fastq', 'fq', 'gz'].includes(ext)) return 'fastq';
  if (ext === 'geneious') return 'geneious';
  return 'other';
}

/** How the page is running: an installed PWA or a browser tab. */
function displayMode(): 'standalone' | 'browser' {
  const media = globalThis.matchMedia as ((q: string) => MediaQueryList) | undefined;
  return media?.('(display-mode: standalone)').matches === true ? 'standalone' : 'browser';
}

type PaqEntry = readonly (string | number | boolean)[];

/** This page, with any fragment cut off. Nothing of a share link is reportable. */
export function trackableUrl(href: string = globalThis.location.href): string {
  const hash = href.indexOf('#');
  return hash === -1 ? href : href.slice(0, hash);
}

/** Loads the Matomo script. Separated so tests can stub it. */
function injectScript(url: string): void {
  const doc = globalThis.document;
  const script = doc.createElement('script');
  script.async = true;
  script.src = `${url}matomo.js`;
  doc.head.appendChild(script);
}

export class Analytics {
  readonly enabled: boolean;
  /** What `trackOnce` has sent in this page load. */
  private readonly sent = new Set<string>();

  constructor(
    config: AnalyticsConfig | null,
    dnt: boolean,
    load: (url: string) => void = injectScript,
  ) {
    this.enabled = config !== null && !dnt;
    if (config === null || !this.enabled) return;
    this.push(['disableCookies']);
    this.push(['setDoNotTrack', true]);
    this.push(['setTrackerUrl', `${config.url}matomo.php`]);
    this.push(['setSiteId', config.siteId]);
    this.push(['discardHashTag', true]);
    this.push(['setCustomUrl', trackableUrl()]);
    this.push(['trackPageView']);
    this.push(['enableLinkTracking']);
    load(config.url);
  }

  /**
   * Records a coarse usage event. `name` must be a fixed label (a format,
   * a mode), never user data.
   */
  track<C extends EventCategory>(category: C, action: EventAction<C>, name?: string): void {
    if (!this.enabled) return;
    this.push(
      name === undefined
        ? ['trackEvent', category, action]
        : ['trackEvent', category, action, name],
    );
  }

  /**
   * Records the event the first time it happens in this page load and
   * ignores it after that. For things done often — edits, toggles, tab
   * switches — where what is worth knowing is whether a visit used them at
   * all: Matomo's "unique events" then reads as visits, one person toggling
   * a switch a hundred times counts once, and a visit sends a handful of
   * requests rather than one per click.
   */
  trackOnce<C extends EventCategory>(category: C, action: EventAction<C>, name?: string): void {
    if (!this.enabled) return;
    const key = `${category}\u0000${action}\u0000${name ?? ''}`;
    if (this.sent.has(key)) return;
    this.sent.add(key);
    this.track(category, action, name);
  }

  /** A key binding was used; once per binding per visit. */
  shortcut(binding: Shortcut): void {
    this.trackOnce('shortcut', 'use', binding);
  }

  /**
   * What kind of visit this is: the version, the phone layout or the
   * desktop one, and whether the app is installed. Called once, from the
   * app's first render, which is where the layout is known.
   */
  start(version: string, phone: boolean): void {
    this.trackOnce('app', 'start', version);
    this.trackOnce('app', 'layout', phone ? 'phone' : 'desktop');
    this.trackOnce('app', 'display', displayMode());
  }

  private push(entry: PaqEntry): void {
    const g = globalThis as { _paq?: PaqEntry[] };
    g._paq ??= [];
    g._paq.push(entry);
  }
}

export const analytics = new Analytics(readConfig(), doNotTrack());
