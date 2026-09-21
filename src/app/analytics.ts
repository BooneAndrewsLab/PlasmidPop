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
 */

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
  track(category: string, action: string, name?: string): void {
    if (!this.enabled) return;
    this.push(
      name === undefined
        ? ['trackEvent', category, action]
        : ['trackEvent', category, action, name],
    );
  }

  private push(entry: PaqEntry): void {
    const g = globalThis as { _paq?: PaqEntry[] };
    g._paq ??= [];
    g._paq.push(entry);
  }
}

export const analytics = new Analytics(readConfig(), doNotTrack());
