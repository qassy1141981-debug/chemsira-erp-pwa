const CACHE = "chemsira-erp-offline-v3";
const CORE = [
  "./index.html",
  "./assets/index-chemsira.js?v=dashboard-profit-373795bd",
  "./assets/index-DqJGh83Z.css?v=restored-20260922",
  "./local-storage-status.js?v=local-save-hidden-20261117",
  "./offline.html",
  "./site.webmanifest",
  "./manifest.webmanifest",
  "./apple-touch-icon.png",
  "./icon/apple-touch-icon.png",
  "./icon/icon-192.png",
  "./icon/icon-512.png",
  "./icon/icon-maskable-192.png",
  "./icon/icon-maskable-512.png",
  "./pwa-192x192.png",
  "./pwa-512x512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request);
    if (cached) return cached;

    try {
      const response = await fetch(event.request);
      if (response.ok && response.type !== "opaque") {
        await cache.put(event.request, response.clone()).catch((error) => {
          console.warn("[ServiceWorker] Could not cache response:", error);
        });
      }
      return response;
    } catch {
      if (event.request.mode === "navigate") {
        const appShell = new URL("./index.html", self.registration.scope).href;
        const offlinePage = new URL("./offline.html", self.registration.scope).href;
        return (await cache.match(appShell)) || (await cache.match(offlinePage)) || Response.error();
      }
      return Response.error();
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith("chemsira-erp-") && key !== CACHE)
        .map((key) => caches.delete(key)),
    ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "FORCE_UPDATE") {
    self.skipWaiting();
  }
});

self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      const isAppInFocus = clientList.some((client) => client.focused);
      if (!isAppInFocus) {
        return self.registration.showNotification(data.title, data.options);
      }
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
       if (clients.openWindow) return clients.openWindow("./");
    }),
  );
});
