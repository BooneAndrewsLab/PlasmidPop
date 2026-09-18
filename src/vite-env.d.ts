/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Matomo instance URL; unset means usage statistics are off entirely. */
  readonly VITE_MATOMO_URL?: string;
  readonly VITE_MATOMO_SITE_ID?: string;
}
