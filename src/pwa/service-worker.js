importScripts('https://www.gstatic.com/firebasejs/12.16.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCnSXwErj2fO3QmqHr_dWfVtnTu_Vc9h4k',
  authDomain: 'wedding-work-manager-d6628.firebaseapp.com',
  projectId: 'wedding-work-manager-d6628',
  storageBucket: 'wedding-work-manager-d6628.firebasestorage.app',
  messagingSenderId: '1072232660356',
  appId: '1:1072232660356:web:318b463f2167c6e5b831d1',
});
const messaging = firebase.messaging();
const BUILD_ID = '__WWM_BUILD_ID__';
const CACHE_NAME = `wwm-app-shell-${BUILD_ID}`;
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/wwm-logo.png', '/wwm-notification-crown.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

const displayedPushes = new Set();

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const notificationId = data.notificationId || data.deliveryId || payload.messageId || '';
  if (notificationId && displayedPushes.has(notificationId)) return;
  if (notificationId) displayedPushes.add(notificationId);
  return self.registration.showNotification(data.title || 'مدير أعمال الويدينج', {
    body: data.body || '',
    icon: '/wwm-logo.png',
    badge: '/wwm-notification-crown.png',
    tag: notificationId || undefined,
    renotify: false,
    data: { url: data.url || '/', notificationId },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || '/'));
});
