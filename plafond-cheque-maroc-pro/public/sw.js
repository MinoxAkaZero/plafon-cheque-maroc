const APP_VERSION = '__APP_VERSION__';
const CACHE_NAME = `plafond-cheque-maroc-pro-v${APP_VERSION}`;
const FALLBACK_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './cloud-config.js',
  './data/moroccan-holidays.json'
];
const SW_DB_NAME = 'PlafondChequeSWNotifDB';
const SW_STORE_NAME = 'scheduled_queue';

function openSWNotifDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SW_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(SW_STORE_NAME)) {
        db.createObjectStore(SW_STORE_NAME, { keyPath: 'eventKey' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveQueueToSWDB(items) {
  try {
    const db = await openSWNotifDB();
    await new Promise((resolve) => {
      const tx = db.transaction(SW_STORE_NAME, 'readwrite');
      const store = tx.objectStore(SW_STORE_NAME);
      store.clear();
      for (const item of (items || [])) store.put(item);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
    db.close();
  } catch (_) {}
}

async function checkAndFireDueSWNotifications() {
  try {
    const db = await openSWNotifDB();
    const items = await new Promise((resolve) => {
      const tx = db.transaction(SW_STORE_NAME, 'readonly');
      const req = tx.objectStore(SW_STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    const nowMs = Date.now();
    for (const item of items) {
      if (item.fired) continue;
      const schedMs = new Date(item.scheduledAtISO).getTime();
      if (schedMs <= nowMs + 60000) {
        await self.registration.showNotification(item.title, {
          body: item.body,
          icon: './icons/icon-192.png',
          badge: './icons/icon-192.png',
          tag: item.eventKey,
          renotify: false,
          requireInteraction: true,
          data: item.extra || {}
        });
        item.fired = true;
        await new Promise((resolve) => {
          const txW = db.transaction(SW_STORE_NAME, 'readwrite');
          txW.objectStore(SW_STORE_NAME).put(item);
          txW.oncomplete = () => resolve(true);
          txW.onerror = () => resolve(false);
        });
      }
    }
    db.close();
  } catch (_) {}
}

async function loadPrecacheAssets() {
  try {
    const resp = await fetch('./precache-manifest.json', { cache: 'no-store' });
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data.assets) && data.assets.length > 0) return data.assets;
    }
  } catch (_) {}
  return FALLBACK_ASSETS;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    loadPrecacheAssets().then((assets) =>
      caches.open(CACHE_NAME).then((cache) =>
        cache.addAll(assets).catch(() => Promise.allSettled(assets.map((u) => cache.add(u))))
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => k !== CACHE_NAME && caches.delete(k))))
      .then(() => checkAndFireDueSWNotifications())
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SYNC_SCHEDULED_NOTIFICATIONS') {
    event.waitUntil(saveQueueToSWDB(data.notifications || []).then(() => checkAndFireDueSWNotifications()));
  } else if (data.type === 'SHOW_SYSTEM_NOTIFICATION_NOW') {
    const n = data.notification || {};
    event.waitUntil(
      self.registration.showNotification(n.title || 'PlafondChèque Maroc Pro', {
        body: n.body || '',
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        tag: n.eventKey || ('test_' + Date.now()),
        renotify: true,
        requireInteraction: false,
        data: n.extra || {}
      })
    );
  } else if (data.type === 'CHECK_DUE_NOTIFICATIONS') {
    event.waitUntil(checkAndFireDueSWNotifications());
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const extra = event.notification.data || {};
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) {
          c.focus();
          c.postMessage({ type: 'NOTIFICATION_DEEP_LINK', extra });
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached || fetch(event.request).then((resp) => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return resp;
      }).catch(() => cached)
    )
  );
});
