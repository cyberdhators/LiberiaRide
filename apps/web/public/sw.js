// LiberiaRide service worker.
// - Offline shell: page navigations fall back to /offline when the network is down.
//   Nothing else is cached: ride data must always come fresh from the server.
// - Web Push: pushes arrive EMPTY; we fetch the text from /api/push/latest with the
//   user's session cookie and show it. Ride offers stay on screen and vibrate.
const CACHE = "lr-shell-v2"; // bump whenever /offline changes, so installed workers re-cache it
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(new Request(OFFLINE_URL, { cache: "reload" }))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()));
});

async function visibleClient() {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return list.find((c) => c.visibilityState === "visible" && c.focused) || null;
}

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    // App open and in front: let the page refresh itself (it also plays a sound).
    const open = await visibleClient();
    if (open) {
      open.postMessage({ type: "lr:push" });
      return;
    }
    let items = [];
    try {
      const res = await fetch("/api/push/latest", { credentials: "include", cache: "no-store" });
      if (res.ok) items = (await res.json()).items || [];
    } catch { /* offline: show the generic alert below */ }
    if (!items.length) {
      items = [{ id: "generic", kind: "generic", title: "LiberiaRide", body: "You have a new update. Tap to open.", url: "/notifications", urgent: false }];
    }
    await Promise.all(items.map((n) => self.registration.showNotification(n.title, {
      body: n.body || "",
      tag: n.kind === "offer" ? "offer" : `lr-${n.id}`,
      renotify: true,
      requireInteraction: Boolean(n.urgent),
      vibrate: n.kind === "offer" ? [400, 150, 400, 150, 400, 150, 800] : [200, 100, 200],
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: n.url || "/" },
    })));
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        if ("navigate" in c) await c.navigate(url);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
