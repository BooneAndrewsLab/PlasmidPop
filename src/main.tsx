import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { analytics } from './app/analytics';
import { App } from './app/App';
import { openFile } from './app/openFile';
import { editorStore } from './app/state/editorStore';
import { PHONE_QUERY } from './app/state/layout';
import './styles.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root element #root not found');
}

analytics.start(__APP_VERSION__, window.matchMedia(PHONE_QUERY).matches);

// Offline support: the service worker is generated at build time (vite-plugin-pwa).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Offline caching is a convenience; the app works without it.
    });
  });
}

// Installed PWA: files opened from the OS arrive through the launch queue.
interface LaunchParams {
  readonly files: readonly FileSystemFileHandle[];
}
interface LaunchQueue {
  setConsumer: (consumer: (params: LaunchParams) => void) => void;
}
const launchQueue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
launchQueue?.setConsumer((params) => {
  const [handle] = params.files;
  if (handle === undefined) return;
  // The handle is only read from: a document is not bound to its file.
  handle
    .getFile()
    .then((file) => openFile(file))
    .catch(() => {
      editorStore.fail(`Could not open "${handle.name}".`);
    });
});

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
