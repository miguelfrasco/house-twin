// Service worker: only for plant reminders. Push messages carry no data; the worker asks the
// server what is due (with the owner's session cookie) and shows one notification.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("message", (e) => { if (e.data?.lang) caches.open("ht-prefs").then((c) => c.put("/lang", new Response(e.data.lang))); });
self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    let d = { title: "🪴", body: "Some plants may need water today.", count: 1 };
    try {
      const lang = (await (await caches.open("ht-prefs")).match("/lang").then((r) => r?.text())) || "en";
      d = await (await fetch(`/api/push/summary?lang=${lang === "pt-PT" || lang === "pt" ? "pt" : "en"}`, { credentials: "include" })).json();
    } catch { /* keep the default text */ }
    return self.registration.showNotification(d.title, { body: d.body, icon: "/icon.svg", tag: "ht-plants", silent: !d.count, data: { url: "/?module=plants" } });
  })());
});
self.addEventListener("notificationclick", (e) => { e.notification.close(); e.waitUntil(clients.openWindow(e.notification.data?.url || "/")); });
