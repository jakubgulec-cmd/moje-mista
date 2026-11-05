/* global L, APP_CONFIG */
const API = APP_CONFIG.apiBase;
const KEY_STORE = "mm.appKey";
const CACHE_STORE = "mm.places";

const state = {
  places: [],
  categories: [],
  filter: new Set(),      // prázdné = všechny kategorie
  hideVisited: false,
  me: null,               // { lat, lng, acc }
  markers: new Map(),     // id -> L.Marker
  pickFor: null,          // id místa, kterému se klepnutím do mapy nastavuje poloha
};

// ---------- pomocné funkce ----------
const $ = (sel) => document.querySelector(sel);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

const cat = (id) => state.categories.find((c) => c.id === id) ?? { id: "other", label: "Jiné", emoji: "📍", color: "#343a40" };

function distanceKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function fmtDist(km) {
  if (km < 1) return `${Math.round(km * 100) * 10} m`;
  if (km < 10) return `${km.toFixed(1).replace(".", ",")} km`;
  return `${Math.round(km).toLocaleString("cs-CZ")} km`;
}
const distTo = (p) => (state.me && p.lat != null ? distanceKm(state.me, p) : null);
const hasPos = (p) => p.lat != null && p.lng != null;
const navUrl = (p) => hasPos(p)
  ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`
  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.name, p.city].filter(Boolean).join(", "))}`;

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2800);
}

// ---------- API ----------
const getKey = () => localStorage.getItem(KEY_STORE);

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "x-app-key": getKey() ?? "", ...(opts.headers ?? {}) },
  });
  if (res.status === 401) { showGate(); throw new Error("Neplatný klíč"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Chyba ${res.status}`);
  return data;
}

async function loadPlaces() {
  try {
    const data = await api("/places");
    state.places = data.places;
    state.categories = data.categories;
    localStorage.setItem(CACHE_STORE, JSON.stringify(data));
  } catch (e) {
    const cached = localStorage.getItem(CACHE_STORE);
    if (cached && !state.places.length) {
      const data = JSON.parse(cached);
      state.places = data.places;
      state.categories = data.categories;
      toast("Offline – zobrazuji uložená data");
    } else if (!/klíč/.test(e.message)) toast(`Nepodařilo se načíst místa: ${e.message}`);
  }
  render();
}

async function patchPlace(id, patch) {
  const { place } = await api(`/places/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  state.places = state.places.map((p) => (p.id === id ? place : p));
  render();
  return place;
}

// ---------- mapa ----------
const map = L.map("map", { zoomControl: false, attributionControl: true }).setView([49.8, 15.5], 7);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
let meMarker = null, meCircle = null, fittedOnce = false;

function pinIcon(p) {
  const c = cat(p.category);
  const cls = ["pin", p.geo_precision === "approx" && "approx", p.visited && "visited"].filter(Boolean).join(" ");
  return L.divIcon({
    className: "",
    html: `<div class="${cls}" style="--c:${c.color}"><span>${c.emoji}</span></div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 38],
    popupAnchor: [0, -36],
  });
}

function visiblePlaces() {
  return state.places.filter((p) =>
    (state.filter.size === 0 || state.filter.has(p.category)) && !(state.hideVisited && p.visited));
}

function popupContent(p) {
  const c = cat(p.category);
  const d = distTo(p);
  const select = h("select", {
    "aria-label": "Změnit typ",
    onchange: async (e) => { await patchPlace(p.id, { category: e.target.value }); toast("Typ změněn"); },
  }, state.categories.map((k) => h("option", { value: k.id, selected: k.id === p.category }, `${k.emoji} ${k.label}`)));

  return h("div", { class: "pop" },
    h("h3", {}, p.name),
    h("div", { class: "meta" }, `${c.emoji} ${c.label}`, p.city ? ` · ${p.city}` : "", d != null ? ` · ${fmtDist(d)}` : ""),
    p.description && h("p", {}, p.description),
    p.geo_precision === "approx" && h("div", { class: "warn" }, "⚠️ Poloha je jen přibližná"),
    h("div", { class: "row" },
      h("a", { class: "btn btn-primary btn-small", href: navUrl(p), target: "_blank", rel: "noopener" }, "🧭 Navigovat"),
      p.source_url && h("a", { class: "btn btn-small", href: p.source_url, target: "_blank", rel: "noopener" }, "▶️ Reelsko"),
      h("button", {
        class: "btn btn-small",
        onclick: async () => { await patchPlace(p.id, { visited: !p.visited }); toast(p.visited ? "Označeno jako nenavštívené" : "Navštíveno ✔"); },
      }, p.visited ? "↩️ Nenavštíveno" : "✔️ Navštíveno"),
    ),
    h("div", { class: "row" },
      select,
      h("button", { class: "btn btn-small", onclick: () => startPick(p.id) }, "📌 Upravit polohu"),
      h("button", { class: "btn btn-small btn-danger", onclick: () => removePlace(p) }, "🗑️ Smazat"),
    ),
  );
}

function renderMarkers() {
  const visible = new Set(visiblePlaces().filter(hasPos).map((p) => p.id));
  for (const [id, m] of state.markers) {
    if (!visible.has(id)) { m.remove(); state.markers.delete(id); }
  }
  for (const p of state.places) {
    if (!visible.has(p.id)) continue;
    let m = state.markers.get(p.id);
    if (!m) {
      m = L.marker([p.lat, p.lng]).addTo(map);
      state.markers.set(p.id, m);
    }
    const wasOpen = m.isPopupOpen();
    m.setLatLng([p.lat, p.lng]).setIcon(pinIcon(p));
    m.unbindPopup().bindPopup(() => popupContent(p), { maxWidth: 300 });
    if (wasOpen) m.openPopup();
  }
  if (!fittedOnce && visible.size) {
    fittedOnce = true;
    const pts = state.places.filter((p) => visible.has(p.id)).map((p) => [p.lat, p.lng]);
    map.fitBounds(pts, { padding: [60, 60], maxZoom: 14 });
  }
}

function renderChips() {
  const box = $("#chips");
  box.replaceChildren();
  const counts = {};
  for (const p of state.places) counts[p.category] = (counts[p.category] ?? 0) + 1;

  box.append(h("button", {
    class: `chip ${state.filter.size === 0 ? "on" : ""}`,
    onclick: () => { state.filter.clear(); render(); },
  }, "Vše", h("span", { class: "count" }, state.places.length)));

  for (const c of state.categories) {
    if (!counts[c.id]) continue;
    box.append(h("button", {
      class: `chip ${state.filter.has(c.id) ? "on" : ""}`,
      style: `--c:${c.color}`,
      onclick: () => { state.filter.has(c.id) ? state.filter.delete(c.id) : state.filter.add(c.id); render(); },
    }, `${c.emoji} ${c.label}`, h("span", { class: "count" }, counts[c.id])));
  }

  box.append(h("button", {
    class: `chip ${state.hideVisited ? "on" : ""}`,
    onclick: () => { state.hideVisited = !state.hideVisited; render(); },
  }, state.hideVisited ? "🙈 Bez navštívených" : "👁️ I navštívené"));
}

function render() {
  renderChips();
  renderMarkers();
  if (!$("#sheet").hidden && currentSheet === "list") openList();
}

// ---------- poloha ----------
let watchId = null;
function startLocate(center = true) {
  if (!("geolocation" in navigator)) return toast("Prohlížeč neumí zjistit polohu");
  let first = center;
  if (watchId != null) {
    if (state.me) map.flyTo([state.me.lat, state.me.lng], Math.max(map.getZoom(), 14));
    return;
  }
  $("#btn-locate").classList.add("active");
  watchId = navigator.geolocation.watchPosition((pos) => {
    state.me = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
    const ll = [state.me.lat, state.me.lng];
    if (!meMarker) {
      meMarker = L.marker(ll, { icon: L.divIcon({ className: "", html: '<div class="me-dot"></div>', iconSize: [18, 18] }), zIndexOffset: 1000 }).addTo(map);
      meCircle = L.circle(ll, { radius: state.me.acc, color: "#1a73e8", weight: 1, fillOpacity: 0.08 }).addTo(map);
    } else {
      meMarker.setLatLng(ll);
      meCircle.setLatLng(ll).setRadius(state.me.acc);
    }
    if (first) { first = false; map.flyTo(ll, Math.max(map.getZoom(), 14)); }
  }, (err) => {
    $("#btn-locate").classList.remove("active");
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    toast(err.code === 1 ? "Přístup k poloze je zakázaný – povol ho v nastavení" : "Polohu se nepodařilo zjistit");
  }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
}

// ---------- spodní panel ----------
let currentSheet = null;
function openSheet(name, title, ...content) {
  currentSheet = name;
  $("#sheet-title").textContent = title;
  $("#sheet-body").replaceChildren(...content);
  $("#sheet").hidden = false;
  $("#backdrop").hidden = false;
}
function closeSheet() {
  currentSheet = null;
  $("#sheet").hidden = true;
  $("#backdrop").hidden = true;
}

function focusPlace(p) {
  closeSheet();
  if (!hasPos(p)) return startPick(p.id);
  if (state.filter.size && !state.filter.has(p.category)) state.filter.clear();
  if (state.hideVisited && p.visited) state.hideVisited = false;
  render();
  map.flyTo([p.lat, p.lng], 16);
  setTimeout(() => state.markers.get(p.id)?.openPopup(), 600);
}

function placeItem(p) {
  const c = cat(p.category);
  const d = distTo(p);
  return h("li", { class: `item ${p.visited ? "visited" : ""}`, style: `--c:${c.color}` },
    h("div", { class: "e" }, c.emoji),
    h("button", { class: "txt", onclick: () => focusPlace(p) },
      h("div", { class: "name" }, p.name),
      h("div", { class: "sub" }, [c.label, p.city, !hasPos(p) && "bez polohy"].filter(Boolean).join(" · ")),
    ),
    d != null ? h("div", { class: "dist" }, fmtDist(d)) : null,
    h("a", { class: "btn btn-small", href: navUrl(p), target: "_blank", rel: "noopener", "aria-label": "Navigovat" }, "🧭"),
  );
}

let listSort = "near";
function openList() {
  const items = visiblePlaces().slice();
  const sortNear = listSort === "near" && state.me;
  items.sort((a, b) => sortNear
    ? (distTo(a) ?? Infinity) - (distTo(b) ?? Infinity)
    : new Date(b.created_at) - new Date(a.created_at));
  const seg = h("div", { class: "seg" },
    h("button", { class: `btn btn-small ${listSort === "near" ? "on" : ""}`, onclick: () => { listSort = "near"; if (!state.me) startLocate(false); openList(); } }, "📍 Nejblíž"),
    h("button", { class: `btn btn-small ${listSort === "new" ? "on" : ""}`, onclick: () => { listSort = "new"; openList(); } }, "🕒 Nejnovější"),
  );
  openSheet("list", `Místa (${items.length})`, seg,
    items.length ? h("ul", { class: "list" }, items.map(placeItem)) : h("p", { class: "muted" }, "Zatím tu nic není. Přidej první reelsko tlačítkem ＋ nebo přes Telegram bota."));
}

function openRecommend() {
  if (!state.me) startLocate(false);
  const candidates = state.places.filter((p) => !p.visited && hasPos(p));
  const counts = {};
  for (const p of candidates) counts[p.category] = (counts[p.category] ?? 0) + 1;

  const grid = h("div", { class: "grid" },
    h("button", { class: "tile", disabled: !candidates.length, onclick: () => recommend(null) },
      h("span", { class: "e" }, "🎲"), "Cokoli", h("span", { class: "count" }, candidates.length)),
    state.categories.filter((c) => counts[c.id]).map((c) =>
      h("button", { class: "tile", onclick: () => recommend(c.id) },
        h("span", { class: "e" }, c.emoji), c.label, h("span", { class: "count" }, counts[c.id]))),
  );
  openSheet("recommend", "Na co máš chuť?",
    h("p", { class: "muted" }, state.me ? "Doporučím nenavštívená místa nejblíž tobě." : "Zjišťuji polohu… Bez ní doporučím nejnovější uložená místa."),
    grid);
}

function recommend(categoryId) {
  let pool = state.places.filter((p) => !p.visited && hasPos(p) && (!categoryId || p.category === categoryId));
  if (state.me) pool.sort((a, b) => distTo(a) - distTo(b));
  else pool.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  // U "Cokoli" vyber náhodně z nejbližších, ať to není pořád totéž.
  if (!categoryId && pool.length > 1) {
    const near = pool.slice(0, 8);
    const pick = near[Math.floor(Math.random() * near.length)];
    pool = [pick, ...pool.filter((p) => p !== pick)];
  }
  const [top, ...rest] = pool;
  if (!top) return toast("Tady nic nenavštíveného nemáš");
  const c = cat(top.category);
  const d = distTo(top);
  openSheet("recommend", categoryId ? `${c.emoji} ${c.label}` : "🎲 Tip pro tebe",
    h("div", { class: "stack" },
      h("div", { class: "result ok" },
        h("div", { style: "font-size:18px;font-weight:700" }, `${c.emoji} ${top.name}`),
        h("div", { class: "muted" }, [top.city, d != null && fmtDist(d)].filter(Boolean).join(" · ")),
        top.description && h("p", {}, top.description),
        h("div", { class: "row", style: "display:flex;gap:8px;flex-wrap:wrap" },
          h("a", { class: "btn btn-primary", href: navUrl(top), target: "_blank", rel: "noopener" }, "🧭 Navigovat"),
          h("button", { class: "btn", onclick: () => focusPlace(top) }, "🗺️ Na mapě"),
          h("button", { class: "btn", onclick: () => recommend(categoryId) }, categoryId ? "🔄 Znovu" : "🎲 Jiný tip"),
        ),
      ),
      rest.length ? h("div", {}, h("div", { class: "muted" }, "Další v okolí"), h("ul", { class: "list" }, rest.slice(0, 4).map(placeItem))) : null,
      h("button", { class: "btn", onclick: openRecommend }, "← Zpět na typy"),
    ));
}

function openAdd(prefill = "", autoSubmit = false) {
  const ta = h("textarea", { placeholder: "Vlož odkaz na reelsko… nebo napiš název místa, např. „Café Savoy, Praha“" });
  ta.value = prefill;
  const out = h("div");
  const btn = h("button", { class: "btn btn-primary", type: "submit" }, "Uložit do mapy");
  const form = h("form", { class: "stack", onsubmit: async (e) => {
    e.preventDefault();
    const input = ta.value.trim();
    if (!input) return;
    btn.disabled = true;
    btn.replaceChildren(h("span", { class: "spinner" }), " Zpracovávám…");
    out.replaceChildren();
    try {
      const r = await api("/add", { method: "POST", body: JSON.stringify({ input }) });
      await loadPlaces();
      out.replaceChildren(resultView(r));
      if (r.places.length) ta.value = "";
    } catch (err) {
      out.replaceChildren(h("div", { class: "result bad" }, `⚠️ ${err.message}`));
    } finally {
      btn.disabled = false;
      btn.textContent = "Uložit do mapy";
    }
  } }, ta, btn, out,
  h("p", { class: "muted" }, "Tip: z Instagramu můžeš reelsko rovnou sdílet do Telegram bota. Na Androidu i přímo do této aplikace."));
  openSheet("add", "Přidat místo", form);
  if (autoSubmit && prefill) form.requestSubmit();
  else setTimeout(() => ta.focus(), 150);
}

function resultView(r) {
  if (r.status === "no_data") {
    return h("div", { class: "result bad" }, "😕 Z Instagramu se nepodařilo nic stáhnout. Připiš k odkazu název místa nebo město a zkus to znovu.");
  }
  if (r.status === "no_place") {
    return h("div", { class: "result bad" }, "🤔 Z reelska nejde poznat konkrétní místo. Připiš název nebo město.");
  }
  return h("div", { class: "result ok stack" },
    r.places.length ? h("b", {}, `✅ Uloženo: ${r.places.length}`) : h("b", {}, "Nic nového"),
    h("ul", { class: "list" }, [...r.places, ...r.duplicates].map((p) => {
      const li = placeItem(state.places.find((x) => x.id === p.id) ?? p);
      if (r.duplicates.includes(p)) li.querySelector(".sub").textContent = "už v mapě máš";
      return li;
    })),
  );
}

async function removePlace(p) {
  if (!confirm(`Smazat „${p.name}“ z mapy?`)) return;
  await api(`/places/${p.id}`, { method: "DELETE" });
  state.places = state.places.filter((x) => x.id !== p.id);
  map.closePopup();
  render();
  toast("Smazáno");
}

// Ruční nastavení polohy klepnutím do mapy
function startPick(id) {
  const p = state.places.find((x) => x.id === id);
  state.pickFor = id;
  map.closePopup();
  closeSheet();
  const b = $("#banner");
  b.replaceChildren(h("span", {}, `📌 Klepni do mapy, kde je „${p?.name}“`), h("button", { onclick: stopPick }, "Zrušit"));
  b.hidden = false;
  if (p?.lat != null) map.flyTo([p.lat, p.lng], 16);
}
function stopPick() {
  state.pickFor = null;
  $("#banner").hidden = true;
}
map.on("click", async (e) => {
  if (!state.pickFor) return;
  const id = state.pickFor;
  stopPick();
  await patchPlace(id, { lat: e.latlng.lat, lng: e.latlng.lng });
  toast("Poloha uložena");
});

// ---------- přístupový klíč ----------
function showGate() { $("#gate").hidden = false; }
$("#gate-form").addEventListener("submit", (e) => {
  e.preventDefault();
  localStorage.setItem(KEY_STORE, $("#gate-key").value.trim());
  $("#gate").hidden = true;
  loadPlaces();
});

// ---------- start ----------
$("#btn-locate").addEventListener("click", () => startLocate(true));
$("#btn-list").addEventListener("click", openList);
$("#btn-recommend").addEventListener("click", openRecommend);
$("#btn-add").addEventListener("click", () => openAdd());
$("#sheet-close").addEventListener("click", closeSheet);
$("#backdrop").addEventListener("click", closeSheet);

function boot() {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("k")) {
    localStorage.setItem(KEY_STORE, hash.get("k"));
    history.replaceState(null, "", location.pathname + location.search);
  }

  // Sdílení z jiné aplikace (Android: Web Share Target)
  const q = new URLSearchParams(location.search);
  const shared = [q.get("title"), q.get("text"), q.get("url")].filter(Boolean).join("\n").trim();
  if (shared) history.replaceState(null, "", location.pathname);

  const cached = localStorage.getItem(CACHE_STORE);
  if (cached) {
    const data = JSON.parse(cached);
    state.places = data.places;
    state.categories = data.categories;
    render();
  }

  if (!getKey()) return showGate();
  loadPlaces();
  if (shared) openAdd(shared, true);

  // Pokud už uživatel polohu povolil, zapni ji rovnou.
  navigator.permissions?.query({ name: "geolocation" }).then((s) => { if (s.state === "granted") startLocate(false); }).catch(() => {});
}

// Po návratu do aplikace načti novinky (např. z Telegram bota).
document.addEventListener("visibilitychange", () => { if (!document.hidden && getKey()) loadPlaces(); });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
