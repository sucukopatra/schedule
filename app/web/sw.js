/* Service worker: lets the page start from the home screen and keep working
   when bmo is out of reach. The localStorage fallback in app.js has always
   existed but could never be reached, because without the network the HTML
   never loaded in the first place.

   Page files are network-first, not cache-first, so "edit a file on bmo and
   reload" keeps working exactly as before; the cache is only what you get when
   the fetch fails. Bump VERSION to throw away a bad cache. */
'use strict';

var VERSION = 'v1';
var SHELL = 'shell-' + VERSION;
var FONTS = 'fonts-' + VERSION;
var KEEP = [SHELL, FONTS];

/* Enough to render the timetable with nothing but the cache. */
var SHELL_FILES = [
  'index.html',
  'style.css',
  'schedule.js',
  'app.js',
  'manifest.webmanifest',
  'icon.svg'
];

var FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL)
      .then(function (c) { return c.addAll(SHELL_FILES); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return KEEP.indexOf(k) < 0 ? caches.delete(k) : null;
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/* Fresh if possible, cached if not. A navigation that misses falls back to the
   shell, because the request for "/" is not the key "index.html" was stored
   under. */
function networkFirst(req) {
  return caches.open(SHELL).then(function (cache) {
    return fetch(req)
      .then(function (res) {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      })
      .catch(function () {
        return cache.match(req).then(function (hit) {
          if (hit) return hit;
          if (req.mode !== 'navigate') return Response.error();
          return cache.match('index.html').then(function (s) { return s || Response.error(); });
        });
      });
  });
}

/* Google Fonts: show what we have, refresh in the background. Falling back to
   the local stack is survivable, so a miss is not an error. */
function fonts(e) {
  return caches.open(FONTS).then(function (cache) {
    return cache.match(e.request).then(function (hit) {
      var net = fetch(e.request).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) cache.put(e.request, res.clone());
        return res;
      });
      if (hit) {
        e.waitUntil(net.catch(function () { /* keep serving the cached copy */ }));
        return hit;
      }
      return net.catch(function () { return Response.error(); });
    });
  });
}

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);

  /* State is the one thing that must never come from a cache: a stale week
     would be worse than no week, and app.js already handles the server being
     unreachable. Leaving it alone also keeps PUT conflict handling intact. */
  if (url.origin === self.location.origin && /(^|\/)api\//.test(url.pathname)) return;

  if (FONT_HOSTS.indexOf(url.hostname) >= 0) { e.respondWith(fonts(e)); return; }
  if (url.origin !== self.location.origin) return;
  e.respondWith(networkFirst(e.request));
});
