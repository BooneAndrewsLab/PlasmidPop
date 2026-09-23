/// <reference types="vite/client" />

/** The release this build is, from package.json (`define` in vite.config.ts). */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Matomo instance URL; unset means usage statistics are off entirely. */
  readonly VITE_MATOMO_URL?: string;
  readonly VITE_MATOMO_SITE_ID?: string;
}
