/* Yildiz Avcilari - Service Worker (web push bildirimleri) */
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => {
  let title = "Yıldız Avcıları", body = "Onay bekleyen bir görev var 👀";
  if (e.data) {
    try { const d = e.data.json(); title = d.title || title; body = d.body || body; }
    catch (err) { const t = e.data.text(); if (t) body = t; }
  }
  e.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "yildiz-onay",
    renotify: true,
    data: { url: "/" }
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) { if ("focus" in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  }));
});
