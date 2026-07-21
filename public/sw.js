/* RepoLens no longer uses a service worker. This one-time cleanup worker
 * replaces stale registrations left by older development builds, clears their
 * caches, and then unregisters itself. */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))),
      self.registration.unregister(),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
