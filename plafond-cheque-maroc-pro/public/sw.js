const CACHE_NAME = 'plafond-cheque-maroc-pro-v10.1.0';
const ASSETS_TO_CACHE = ['./', './index.html', './gestion_cheques_maroc.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
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
    const tx = db.transaction(SW_STORE_NAME, 'readwrite');
    const store = tx.objectStore(SW_STORE_NAME);
    store.clear();
    for (const item of (items || [])) {
      store.put(item);
    }
    db.close();
  } catch (e) {}
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
        const txW = db.transaction(SW_STORE_NAME, 'readwrite');
        txW.objectStore(SW_STORE_NAME).put(item);
      } else if ('showTrigger' in Notification.prototype && typeof TimestampTrigger !== 'undefined' && !item.triggerScheduled) {
        try {
          await self.registration.showNotification(item.title, {
            body: item.body,
            icon: './icons/icon-192.png',
            badge: './icons/icon-192.png',
            tag: item.eventKey,
            data: item.extra || {},
            showTrigger: new TimestampTrigger(schedMs)
          });
          item.triggerScheduled = true;
          const txT = db.transaction(SW_STORE_NAME, 'readwrite');
          txT.objectStore(SW_STORE_NAME).put(item);
        } catch (err) {}
      }
    }
    db.close();
  } catch (e) {}
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(ASSETS_TO_CACHE).catch(() =>
        Promise.allSettled(ASSETS_TO_CACHE.map((u) => cache.add(u)))
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => k !== CACHE_NAME && caches.delete(k))))
      .then(() => checkAndFireDueSWNotifications())
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SYNC_SCHEDULED_NOTIFICATIONS') {
    event.waitUntil(
      saveQueueToSWDB(data.notifications || []).then(() => checkAndFireDueSWNotifications())
    );
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
  }
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'plafond-cheque-reminders-sync') {
    event.waitUntil(checkAndFireDueSWNotifications());
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'plafond-cheque-reminders-sync') {
    event.waitUntil(checkAndFireDueSWNotifications());
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const extra = event.notification.data || {};
  const params = new URLSearchParams();
  if (extra.targetType) params.set('notifTarget', extra.targetType);
  if (extra.opId) params.set('opId', extra.opId);
  if (extra.trancheId) params.set('trancheId', extra.trancheId);
  if (extra.numCheque) params.set('numCheque', extra.numCheque);
  if (extra.date) params.set('date', extra.date);
  const targetUrl = './index.html' + (params.toString() ? '?' + params.toString() : '');

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({
            type: 'NOTIFICATION_ACTION_CLICK',
            extra
          });
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const net = fetch(event.request).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
