/** Registers the app shell cache. Firebase data requests stay network-managed. */
export function registerPwa() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/service-worker.js').catch((error) => {
      console.warn('PWA service worker registration failed.', error);
    });
  }, { once: true });
}
