// Service worker: aplikace se otevře i bez signálu (s naposledy načtenými daty).
const CACHE = "mm-v3";
const SHELL = ["./", "index.html", "styles.css", "app.js", "config.js", "manifest.webmanifest", "icons/icon-192.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css", "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js",
  "https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/leaflet-maplibre-gl.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // API a mapové dlaždice vždy ze sítě (data řeší aplikace sama).
  if (url.pathname.includes("/functions/") || url.hostname.endsWith("openfreemap.org")) return;
  const isShell = url.origin === location.origin || url.hostname === "unpkg.com";
  if (!isShell) return;
  // Síť má přednost (ať se aktualizace projeví hned), cache je záloha pro offline.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("./")))
  );
});
