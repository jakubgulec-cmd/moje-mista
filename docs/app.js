/* global L, APP_CONFIG */
const API = APP_CONFIG.apiBase;
const CACHE_STORE = "mm.places";
const BOT_URL = "https://t.me/mapinstabot";

const state = {
  places: [],
  categories: [],
  filter: new Set(),      // prázdné = všechny kategorie
  hideVisited: false,
  me: null,               // { lat, lng, acc }
  markers: new Map(),     // id -> L.Marker
  pickFor: null,          // id místa, kterému se klepnutím do mapy nastavuje poloha
  loaded: false,
};

// ---------- pomocné funkce ----------
const $ = (sel) => document.querySelector(sel);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") el.style.cssText = v;
    else if (k === "html") el.innerHTML = v; // jen pro statické SVG ikony
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}

const ICON = {
  nav: '<svg viewBox="0 0 24 24"><path d="M3 11 21 3l-8 18-2-8-8-2Z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5-12-7.5Z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5 10 17 19 7"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 22s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  map: '<svg viewBox="0 0 24 24"><path d="m9 4-6 2.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4Z"/><path d="M9 4v13.5M15 6.5V20"/></svg>',
  dice: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="15" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/><circle cx="9" cy="15" r="1" fill="currentColor"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 6 9 12l6 6"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M21.5 4.5 2.8 11.7c-.9.4-.9 1.6.1 1.9l4.6 1.4 1.8 5.6c.3.8 1.3 1 1.9.4l2.6-2.5 4.7 3.4c.7.5 1.7.1 1.9-.7L23 5.9c.2-1-.6-1.8-1.5-1.4Z"/></svg>',
};
const icon = (name) => h("span", { html: ICON[name], style: "display:inline-flex" });

const cat = (id) => state.categories.find((c) => c.id === id) ?? { id: "other", label: "Jiné", emoji: "📍", color: "#64748b" };

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
const plural = (n, one, few, many) => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Chyba ${res.status}`);
  return data;
}

function applyData(data) {
  state.places = data.places;
  state.categories = data.categories;
}

async function loadPlaces() {
  try {
    const data = await api("/places");
    applyData(data);
    localStorage.setItem(CACHE_STORE, JSON.stringify(data));
  } catch (e) {
    if (!state.places.length) toast(`Nepodařilo se načíst místa: ${e.message}`);
    else toast("Offline – zobrazuji uložená data");
  }
  state.loaded = true;
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
const dark = window.matchMedia("(prefers-color-scheme: dark)");
let tiles = null;
function setTiles() {
  tiles?.remove();
  // OpenFreeMap: vektorové mapy z OpenStreetMap, zdarma a bez API klíče.
  const style = dark.matches ? "dark" : "positron";
  tiles = L.maplibreGL({
    style: `https://tiles.openfreemap.org/styles/${style}`,
    attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
  }).addTo(map);
}
setTiles();
dark.addEventListener?.("change", setTiles);
let meMarker = null, meCircle = null, fittedOnce = false;

function pinIcon(p) {
  const c = cat(p.category);
  const cls = ["pin", p.geo_precision === "approx" && "approx", p.visited && "visited"].filter(Boolean).join(" ");
  return L.divIcon({
    className: "",
    html: `<div class="pin-wrap"><div class="${cls}" style="--c:${c.color}"><span>${c.emoji}</span></div></div>`,
    iconSize: [44, 50],
    iconAnchor: [22, 47],
    popupAnchor: [0, -44],
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
    h("div", { class: "pop-head" },
      h("div", { class: "gloss", style: `--c:${c.color}` }, c.emoji),
      h("div", {},
        h("h3", {}, p.name),
        h("div", { class: "meta" }, [c.label, p.city, d != null && fmtDist(d)].filter(Boolean).join(" · ")),
      ),
    ),
    p.description && h("p", {}, p.description),
    p.geo_precision === "approx" && h("div", { class: "warn" }, "Poloha je jen přibližná – můžeš ji upravit."),
    h("div", { class: "row" },
      h("a", { class: "btn btn-primary btn-sm", href: navUrl(p), target: "_blank", rel: "noopener" }, icon("nav"), "Navigovat"),
      p.source_url && h("a", { class: "btn btn-sm", href: p.source_url, target: "_blank", rel: "noopener" }, icon("play"), "Reelsko"),
      h("button", {
        class: "btn btn-sm",
        onclick: async () => { await patchPlace(p.id, { visited: !p.visited }); toast(p.visited ? "Vráceno mezi nenavštívené" : "Navštíveno ✓"); },
      }, icon(p.visited ? "undo" : "check"), p.visited ? "Zpět" : "Byl jsem"),
    ),
    h("div", { class: "row tools" },
      select,
      h("button", { class: "btn btn-sm", "aria-label": "Upravit polohu", onclick: () => startPick(p.id) }, icon("pin")),
      h("button", { class: "btn btn-sm btn-danger", "aria-label": "Smazat", onclick: () => removePlace(p) }, icon("trash")),
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
    m.unbindPopup().bindPopup(() => popupContent(p), { maxWidth: 300, minWidth: 270, autoPanPaddingTopLeft: [16, 165], autoPanPaddingBottomRight: [16, 120] });
    if (wasOpen) m.openPopup();
  }
  if (!fittedOnce && visible.size) {
    fittedOnce = true;
    const pts = state.places.filter((p) => visible.has(p.id)).map((p) => [p.lat, p.lng]);
    map.fitBounds(pts, { paddingTopLeft: [40, 140], paddingBottomRight: [40, 130], maxZoom: 14 });
  }
}

function renderHeader() {
  const total = state.places.length;
  const visited = state.places.filter((p) => p.visited).length;
  $("#brand-sub").textContent = !state.loaded && !total
    ? "Načítám…"
    : total ? `${plural(total, "místo", "místa", "míst")}${visited ? ` · ${visited} navštíveno` : ""}` : "Zatím žádná místa";
  $("#empty").hidden = !(state.loaded && total === 0) || !$("#sheet").hidden;
}

function renderChips() {
  const box = $("#chips");
  box.replaceChildren();
  if (!state.places.length) return;
  const counts = {};
  for (const p of state.places) counts[p.category] = (counts[p.category] ?? 0) + 1;

  box.append(h("button", {
    class: `chip all ${state.filter.size === 0 ? "on" : ""}`,
    onclick: () => { state.filter.clear(); render(); },
  }, "Vše", h("span", { class: "count" }, state.places.length)));

  for (const c of state.categories) {
    if (!counts[c.id]) continue;
    box.append(h("button", {
      class: `chip ${state.filter.has(c.id) ? "on" : ""}`,
      style: `--c:${c.color}`,
      onclick: () => { state.filter.has(c.id) ? state.filter.delete(c.id) : state.filter.add(c.id); render(); },
    }, h("span", { class: "dot" }), `${c.emoji} ${c.label}`, h("span", { class: "count" }, counts[c.id])));
  }

  if (state.places.some((p) => p.visited)) {
    box.append(h("button", {
      class: `chip ${state.hideVisited ? "on" : ""}`,
      style: "--c:#64748b",
      onclick: () => { state.hideVisited = !state.hideVisited; render(); },
    }, state.hideVisited ? "Skryté navštívené" : "Skrýt navštívené"));
  }
}

function render() {
  renderHeader();
  renderChips();
  renderMarkers();
  if (!$("#sheet").hidden && currentSheet === "list") openList();
}

// ---------- poloha ----------
let watchId = null;
function startLocate(center = true) {
  if (!("geolocation" in navigator)) return toast("Prohlížeč neumí zjistit polohu");
  if (watchId != null) {
    if (state.me) map.flyTo([state.me.lat, state.me.lng], Math.max(map.getZoom(), 15));
    return;
  }
  let first = center;
  $("#btn-locate").classList.add("active");
  watchId = navigator.geolocation.watchPosition((pos) => {
    const firstFix = !state.me;
    state.me = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
    const ll = [state.me.lat, state.me.lng];
    if (!meMarker) {
      meMarker = L.marker(ll, { icon: L.divIcon({ className: "", html: '<div class="me-dot"></div>', iconSize: [20, 20] }), zIndexOffset: 1000 }).addTo(map);
      meCircle = L.circle(ll, { radius: state.me.acc, color: "#1f7aff", weight: 1, fillOpacity: 0.07 }).addTo(map);
    } else {
      meMarker.setLatLng(ll);
      meCircle.setLatLng(ll).setRadius(state.me.acc);
    }
    if (first) { first = false; map.flyTo(ll, Math.max(map.getZoom(), 15)); }
    if (firstFix && currentSheet === "recommend-home") openRecommend();
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
  $("#empty").hidden = true;
}
function closeSheet() {
  currentSheet = null;
  $("#sheet").hidden = true;
  $("#backdrop").hidden = true;
  renderHeader();
}

function focusPlace(p) {
  closeSheet();
  if (!hasPos(p)) return startPick(p.id);
  if (state.filter.size && !state.filter.has(p.category)) state.filter.clear();
  if (state.hideVisited && p.visited) state.hideVisited = false;
  render();
  const open = () => state.markers.get(p.id)?.openPopup();
  if (map.getZoom() === 16 && map.getCenter().distanceTo([p.lat, p.lng]) < 5) return open();
  map.once("moveend", open);
  map.flyTo([p.lat, p.lng], 16, { duration: 0.8 });
}

function placeItem(p, subOverride) {
  const c = cat(p.category);
  const d = distTo(p);
  return h("li", { class: `item ${p.visited ? "visited" : ""}` },
    h("div", { class: "gloss sm", style: `--c:${c.color}` }, c.emoji),
    h("button", { class: "txt", onclick: () => focusPlace(p) },
      h("div", { class: "name" }, p.name),
      h("div", { class: "sub" }, subOverride ?? [c.label, p.city, !hasPos(p) && "bez polohy"].filter(Boolean).join(" · ")),
    ),
    d != null ? h("span", { class: "pill" }, fmtDist(d)) : null,
    h("a", { class: "nav-btn", href: navUrl(p), target: "_blank", rel: "noopener", "aria-label": "Navigovat", html: ICON.nav }),
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
    h("button", { class: listSort === "near" ? "on" : "", onclick: () => { listSort = "near"; if (!state.me) startLocate(false); openList(); } }, "Nejblíž"),
    h("button", { class: listSort === "new" ? "on" : "", onclick: () => { listSort = "new"; openList(); } }, "Nejnovější"),
  );
  openSheet("list", "Moje místa", seg,
    items.length
      ? h("ul", { class: "list" }, items.map((p) => placeItem(p)))
      : h("p", { class: "muted" }, "Zatím tu nic není. Přidej první místo tlačítkem Přidat nebo přes Telegram bota."));
}

function openRecommend() {
  if (!state.me && watchId == null) startLocate(false);
  const candidates = state.places.filter((p) => !p.visited && hasPos(p));
  const counts = {};
  for (const p of candidates) counts[p.category] = (counts[p.category] ?? 0) + 1;

  const grid = h("div", { class: "grid" },
    h("button", { class: "tile any", disabled: !candidates.length, onclick: () => recommend(null) },
      h("span", { class: "e" }, "🎲"), "Překvap mě", h("span", { class: "count" }, candidates.length)),
    state.categories.filter((c) => counts[c.id]).map((c) =>
      h("button", { class: "tile", style: `--c:${c.color}`, onclick: () => recommend(c.id) },
        h("span", { class: "e" }, c.emoji), c.label, h("span", { class: "count" }, counts[c.id]))),
  );
  openSheet("recommend-home", "Na co máš chuť?",
    h("p", { class: "muted" }, !candidates.length
      ? "Nemáš žádná nenavštívená místa s polohou."
      : state.me ? "Vyber typ a doporučím ti nejbližší místo, kde jsi ještě nebyl." : "Zjišťuji polohu… Bez ní doporučím nejnovější uložená místa."),
    grid);
}

function recommend(categoryId) {
  let pool = state.places.filter((p) => !p.visited && hasPos(p) && (!categoryId || p.category === categoryId));
  if (state.me) pool.sort((a, b) => distTo(a) - distTo(b));
  else pool.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  // U "Překvap mě" vyber náhodně z nejbližších, ať to není pořád totéž.
  if (!categoryId && pool.length > 1) {
    const near = pool.slice(0, 8);
    const pick = near[Math.floor(Math.random() * near.length)];
    pool = [pick, ...pool.filter((p) => p !== pick)];
  }
  const [top, ...rest] = pool;
  if (!top) return toast("Tady nic nenavštíveného nemáš");
  const c = cat(top.category);
  const d = distTo(top);
  openSheet("recommend", categoryId ? c.label : "Tip pro tebe",
    h("div", { class: "stack" },
      h("div", { class: "hero", style: `--c:${c.color}` },
        h("div", { class: "hero-emoji" }, c.emoji),
        h("h3", {}, top.name),
        h("div", { class: "hero-meta" },
          d != null && h("span", { class: "tag" }, fmtDist(d)),
          top.city && h("span", { class: "tag" }, top.city),
          h("span", { class: "tag" }, c.label)),
        top.description && h("p", {}, top.description),
        h("div", { class: "actions" },
          h("a", { class: "btn btn-white", href: navUrl(top), target: "_blank", rel: "noopener" }, icon("nav"), "Navigovat"),
          h("button", { class: "btn btn-ghost-light", onclick: () => focusPlace(top) }, icon("map"), "Na mapě"),
          h("button", { class: "btn btn-ghost-light", onclick: () => recommend(categoryId) }, icon("dice"), "Jiný tip"),
        ),
      ),
      rest.length ? h("div", {}, h("div", { class: "section-label" }, "Další v okolí"), h("ul", { class: "list" }, rest.slice(0, 4).map((p) => placeItem(p)))) : null,
      h("button", { class: "btn btn-glass", onclick: openRecommend }, icon("back"), "Zpět na typy"),
    ));
}

function openAdd(prefill = "", autoSubmit = false) {
  const ta = h("textarea", { placeholder: "Vlož odkaz na reelsko… nebo napiš název místa, třeba „Café Savoy, Praha“" });
  ta.value = prefill;
  const out = h("div");
  const label = "Uložit do mapy";
  const btn = h("button", { class: "btn btn-primary btn-block", type: "submit" }, label);
  const form = h("form", { class: "stack", onsubmit: async (e) => {
    e.preventDefault();
    const input = ta.value.trim();
    if (!input) return ta.focus();
    btn.disabled = true;
    btn.replaceChildren(h("span", { class: "spinner" }), "AI hledá místo…");
    out.replaceChildren();
    try {
      const r = await api("/add", { method: "POST", body: JSON.stringify({ input }) });
      await loadPlaces();
      out.replaceChildren(resultView(r));
      if (r.places.length) ta.value = "";
    } catch (err) {
      out.replaceChildren(h("div", { class: "result bad" }, `Něco se pokazilo: ${err.message}`));
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  } }, ta, btn, out,
  h("a", { class: "tip", href: BOT_URL, target: "_blank", rel: "noopener" },
    h("span", { class: "nav-btn", html: ICON.send }),
    h("span", {}, h("strong", {}, "Rychlejší: "), "v Instagramu dej Sdílet → Telegram → Map-helper. Na Androidu můžeš sdílet i přímo sem.")));
  openSheet("add", "Přidat místo", form);
  if (autoSubmit && prefill) form.requestSubmit();
  else setTimeout(() => ta.focus(), 200);
}

function resultView(r) {
  if (r.status === "no_data") {
    return h("div", { class: "result bad" }, "Z Instagramu se nepodařilo nic stáhnout. Připiš k odkazu název místa nebo město a zkus to znovu.");
  }
  if (r.status === "no_place") {
    return h("div", { class: "result bad" }, "Z reelska nejde poznat konkrétní místo. Připiš název nebo město.");
  }
  const dupIds = new Set(r.duplicates.map((p) => p.id));
  return h("div", { class: "result ok" },
    h("b", {}, r.places.length ? `Uloženo ${plural(r.places.length, "místo", "místa", "míst")}` : "Nic nového"),
    h("ul", { class: "list" }, [...r.places, ...r.duplicates].map((p) =>
      placeItem(state.places.find((x) => x.id === p.id) ?? p, dupIds.has(p.id) ? "už v mapě máš" : undefined))),
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
  b.replaceChildren(h("span", {}, `Klepni do mapy, kde je „${p?.name}“`), h("button", { class: "btn btn-sm", onclick: stopPick }, "Zrušit"));
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

// ---------- start ----------
$("#btn-locate").addEventListener("click", () => startLocate(true));
$("#btn-list").addEventListener("click", openList);
$("#btn-recommend").addEventListener("click", openRecommend);
$("#btn-add").addEventListener("click", () => openAdd());
$("#empty-add").addEventListener("click", () => openAdd());
$("#sheet-close").addEventListener("click", closeSheet);
$("#backdrop").addEventListener("click", closeSheet);

function boot() {
  // Staré odkazy s klíčem (#k=…) už nejsou potřeba.
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  localStorage.removeItem("mm.appKey");

  // Sdílení z jiné aplikace (Android: Web Share Target)
  const q = new URLSearchParams(location.search);
  const shared = [q.get("title"), q.get("text"), q.get("url")].filter(Boolean).join("\n").trim();
  if (shared) history.replaceState(null, "", location.pathname);

  const cached = localStorage.getItem(CACHE_STORE);
  if (cached) {
    try { applyData(JSON.parse(cached)); render(); } catch { /* poškozená cache */ }
  }

  loadPlaces();
  if (shared) openAdd(shared, true);

  // Pokud už uživatel polohu povolil, zapni ji rovnou.
  navigator.permissions?.query({ name: "geolocation" }).then((s) => { if (s.state === "granted") startLocate(false); }).catch(() => {});
}

// Po návratu do aplikace načti novinky (např. z Telegram bota).
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadPlaces(); });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
