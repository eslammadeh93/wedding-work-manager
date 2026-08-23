/**
 * Keeps installed copies current without asking people to refresh manually.
 * A waiting worker is activated only after the app goes to the background, so
 * an open order form is never interrupted while someone is typing in it.
 */
export function registerPwa() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

  const start = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js');
      let updatePending = Boolean(registration.waiting);
      let reloadRequested = false;
      const announceUpdate = () => window.dispatchEvent(new Event('wwm-pwa-update-ready'));
      const applyUpdateWhenSafe = () => {
        if (!updatePending || document.visibilityState === 'visible' || !registration.waiting) return;
        reloadRequested = true;
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      };
      const markUpdateReady = () => {
        if (!registration.waiting || !navigator.serviceWorker.controller) return;
        updatePending = true;
        announceUpdate();
        applyUpdateWhenSafe();
      };

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed') markUpdateReady();
        });
      });
      markUpdateReady();
      document.addEventListener('visibilitychange', applyUpdateWhenSafe);
      window.addEventListener('online', () => { void registration.update(); });
      window.setInterval(() => { void registration.update(); }, 60 * 60 * 1000);
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadRequested) window.location.reload();
      });
      void registration.update();
    } catch (error) {
      console.warn('PWA service worker registration failed.', error);
    }
  };

  if (document.readyState === 'complete') void start();
  else window.addEventListener('load', () => { void start(); }, { once: true });
}
