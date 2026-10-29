/* Kelola Kasir service worker: Web Push only (ADR-0017 §8).
 * Served from the site root so its scope covers the whole dashboard. Deliberately has no `fetch`
 * handler and caches nothing, so a new Pages deploy is never held back by this worker. */

var FALLBACK_TITLE = 'Kelola Kasir';
var FALLBACK_BODY = 'Ada aktivitas baru';

/** Same-origin paths only ("/x", never "//host"); anything else falls back to the dashboard root. */
function safeUrl(url) {
  return typeof url === 'string' && url.charAt(0) === '/' && url.charAt(1) !== '/' ? url : '/';
}

/** Turns a push payload into notification content; unparsable payloads still show a generic one. */
function parsePayload(event) {
  var data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch (_) {
    data = null;
  }
  if (!data || typeof data !== 'object') {
    return { title: FALLBACK_TITLE, options: { body: FALLBACK_BODY, data: { url: '/' } } };
  }
  var options = {
    body: typeof data.body === 'string' ? data.body : FALLBACK_BODY,
    renotify: false,
    requireInteraction: false,
    silent: false,
    icon: '/icons/notif-192.png',
    badge: '/icons/notif-badge-96.png',
    data: { url: safeUrl(data.url) },
  };
  if (typeof data.tag === 'string' && data.tag) options.tag = data.tag;
  return {
    title: typeof data.title === 'string' && data.title ? data.title : FALLBACK_TITLE,
    options: options,
  };
}

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (event) {
  var content = parsePayload(event);
  // Chrome requires every push to show a notification (userVisibleOnly).
  event.waitUntil(self.registration.showNotification(content.title, content.options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
      for (var i = 0; i < windows.length; i++) {
        var client = windows[i];
        if (new URL(client.url).origin === self.location.origin) {
          // The dashboard listens for this message and navigates through its router, without a reload.
          client.postMessage({ type: 'navigate', url: url });
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
