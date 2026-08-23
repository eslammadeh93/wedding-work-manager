/**
 * Detects installed PWA updates for every signed-in account. The waiting
 * worker is activated only when the user explicitly chooses "Update now".
 */
export function registerPwa() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

  const start = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js');
      let updatePending = Boolean(registration.waiting);
      let reloadRequested = false;
      const announceUpdate = () => window.dispatchEvent(new Event('wwm-pwa-update-ready'));
      const applyUpdateNow = () => {
        if (!updatePending || !registration.waiting) return;
        reloadRequested = true;
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        // A controllerchange is expected. The fallback still gives the user a
        // fresh complete application start if a browser delays that event.
        window.setTimeout(() => {
          if (reloadRequested) window.location.reload();
        }, 4000);
      };
      const markUpdateReady = () => {
        if (!registration.waiting || !navigator.serviceWorker.controller) return;
        updatePending = true;
        announceUpdate();
      };

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed') markUpdateReady();
        });
      });
      markUpdateReady();
      window.addEventListener('wwm-pwa-apply-update', applyUpdateNow);
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
