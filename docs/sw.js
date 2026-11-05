// Service worker: aplikace se otevře i bez signálu. Vlastní soubory se vždy ověřují na serveru,
// aby se nikdy nesmíchala stará a nová verze.
const CACHE = "mm-202611051238";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
    // Stránky se znovu nenačítají: zahodilo by to sdílený odkaz. Míchání verzí brání verzované soubory.
  })());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (/supabase\.co$|openfreemap\.org$|uuinstagram\.com$|cdninstagram\.com$/.test(url.hostname)) return;
  const own = url.origin === location.origin;
  const cdn = url.hostname === "unpkg.com" || url.hostname === "cdn.jsdelivr.net";
  if (!own && !cdn) return;
  // Vlastní soubory: vždy se zeptat serveru (no-cache), cache jen jako záloha offline.
  const req = own ? new Request(e.request.url, { cache: "no-cache", credentials: "same-origin" }) : e.request;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("./")))
  );
});
