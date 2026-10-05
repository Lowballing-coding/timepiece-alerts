const CACHE = "timepiece-v50";
const SHELL = ["./", "index.html", "app.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
const TITLES = { on_sale: "Tickets on Sale", on_sale_soon: "On Sale Soon", check: "Check Manually", problem: "Watcher Problem", test: "Test Notification", signup: "New Sign-Up Request" };

self.addEventListener("install", (e) => {
  // One missing file must never stop the service worker installing (push depends on it).
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first (so updates arrive), cache as the offline fallback.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

function saveAlert(alert) {
  return new Promise((resolve) => {
    const req = indexedDB.open("alerts", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("alerts", { keyPath: "id", autoIncrement: true });
    req.onsuccess = () => {
      const tx = req.result.transaction("alerts", "readwrite");
      const store = tx.objectStore("alerts");
      store.add(alert);
      let unseen = 0;
      store.getAll().onsuccess = (ev) => { unseen = ev.target.result.filter((a) => a.seen === false).length; };
      tx.oncomplete = () => resolve(unseen);
      tx.onerror = () => resolve(0);
    };
    req.onerror = () => resolve(0);
  });
}

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {}; }
  const type = TITLES[d.type] ? d.type : "check";
  const late = Math.max(0, Math.round(Number(d.late) || 0));   // minutes late (free month); 0 = instant
  const onSale = late ? `Listed as on sale ${late} minutes ago. Check the tickets on FIXR.` : "Listed as on sale. Check the tickets on FIXR.";
  const body = [d.name, [d.day, d.date].filter(Boolean).join(" "), type === "on_sale_soon" ? "Check it on FIXR." : type === "on_sale" ? onSale : ""].filter(Boolean).join("\n");

  // Always show a notification: iOS revokes the subscription if a push shows nothing.
  e.waitUntil((async () => {
    if (type !== "signup") {   // sign-up requests are for the Admin tab, not the alert history
      const unseen = await saveAlert({ type, name: d.name || "", day: d.day || "", date: d.date || "", url: d.url || "", late, received: Date.now(), seen: false });
      try { await self.navigator.setAppBadge(unseen); } catch {}   // number on the Home Screen icon
    }
    await self.registration.showNotification(TITLES[type], {
      body: body || "Open the app for details.",
      tag: d.url || (type === "signup" ? d.name : "timepiece"),
      renotify: true,
      requireInteraction: type === "on_sale",
      icon: "icon-192.png",
      data: { url: d.url || "", tab: d.tab === "admin" ? "admin" : "" },
    });
    const wins = await self.clients.matchAll({ type: "window" });
    wins.forEach((w) => w.postMessage("refresh"));
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data && e.notification.data.url;
  const tab = (e.notification.data && e.notification.data.tab) || "";
  e.waitUntil(
    url && /^https:\/\/([a-z0-9-]+\.)*fixr\.co\//i.test(url)
      ? self.clients.openWindow(url)
      : self.clients.matchAll({ type: "window" }).then((wins) => {
          if (!wins[0]) return self.clients.openWindow(tab ? `./?tab=${tab}` : "./");
          if (tab) wins[0].postMessage({ tab });   // already open: switch it to the Admin tab
          return wins[0].focus();
        })
  );
});
