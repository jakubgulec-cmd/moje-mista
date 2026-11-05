/* global L, APP_CONFIG */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm";
import { routeLeg } from "./routing.js?v=202611051539";
import { initGlass } from "./glass.js?v=202611051539";

const sb = createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
const SUBMIT_URL = `${APP_CONFIG.supabaseUrl}/functions/v1/submit`;
const CACHE = "mm.feed.v2";
const RADII = [1, 5, 25, 100, 500];

const state = {
  places: [],
  categories: [],
  user: null,
  nickname: null,
  visits: new Set(),
  saved: new Set(),        // Moje mapa: uložená místa
  trips: [],               // cesty uživatele se zastávkami
  mine: false,             // zobrazit jen Moji mapu
  activeTrip: null,        // id cesty zobrazené na mapě
  filter: new Set(),       // prázdné = všechny kategorie
  hideVisited: false,      // skrýt navštívená místa
  radiusKm: null,          // null = všude
  me: null,
  loaded: false,
};

// ---------- pomocné ----------
const $ = (s) => document.querySelector(s);
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") el.style.cssText = v;
    else if (k === "html") el.innerHTML = v; // jen pro statické ikony
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
const ICON = {
  nav: '<svg viewBox="0 0 24 24"><path d="M3 11 21 3l-8 18-2-8-8-2Z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5 10 17 19 7"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5-12-7.5Z"/></svg>',
  ig: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r=".8" fill="currentColor"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9.5" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3l1.8 4.9L19 9.7l-5.2 1.8L12 16.5l-1.8-5L5 9.7l5.2-1.8L12 3Z"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  paste: '<svg viewBox="0 0 24 24"><rect x="6" y="4.5" width="12" height="16" rx="2.5"/><path d="M9.5 4.5V3.5h5v1"/></svg>',
  map: '<svg viewBox="0 0 24 24"><path d="m9 4-6 2.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4Z"/><path d="M9 4v13.5M15 6.5V20"/></svg>',
  dice: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="15" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/><circle cx="9" cy="15" r="1" fill="currentColor"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 6 9 12l6 6"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5Z"/></svg>',
  starFill: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9L12 3.5Z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
  route: '<svg viewBox="0 0 24 24"><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/></svg>',
  sort: '<svg viewBox="0 0 24 24"><path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/></svg>',
};
const icon = (n) => h("span", { html: ICON[n], style: "display:inline-flex" });

const cat = (id) => state.categories.find((c) => c.id === id) ?? { id: "other", label: "Jiné", emoji: "📍", color: "#64748b" };
const distanceKm = (a, b) => {
  const R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const fmtDist = (km) => km < 1 ? `${Math.round(km * 100) * 10} m` : km < 10 ? `${km.toFixed(1).replace(".", ",")} km` : `${Math.round(km).toLocaleString("cs-CZ")} km`;
const distTo = (p) => (state.me ? distanceKm(state.me, p) : null);
const navUrl = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
const plural = (n, a, b, c) => `${n} ${n === 1 ? a : n >= 2 && n <= 4 ? b : c}`;
const fmtDate = (iso) => new Date(iso).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" });
const visited = (p) => state.visits.has(p.id);
const isSaved = (p) => state.saved.has(p.id);

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2800);
}

// ---------- liquid glass: odlesk sleduje prst / kurzor ----------
function moveLight(e) {
  const el = e.target.closest?.(".lg");
  if (!el) return;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--lx", `${((e.clientX - r.left) / r.width) * 100}%`);
  el.style.setProperty("--ly", `${((e.clientY - r.top) / r.height) * 100}%`);
}
document.addEventListener("pointermove", moveLight, { passive: true });
document.addEventListener("pointerdown", moveLight, { passive: true });

// ---------- data ----------
async function loadPlaces() {
  const [cats, feed] = await Promise.all([
    sb.from("categories").select("*").order("sort"),
    sb.from("places_feed").select("*").order("reel_created_at", { ascending: false }),
  ]);
  if (feed.error || cats.error) {
    if (!state.places.length) toast("Nepodařilo se načíst mapu. Zkus to za chvíli.");
  } else {
    state.categories = cats.data;
    state.places = feed.data;
    localStorage.setItem(CACHE, JSON.stringify({ categories: cats.data, places: feed.data }));
  }
  state.loaded = true;
  render();
}

async function loadMine() {
  state.visits = new Set();
  state.saved = new Set();
  state.trips = [];
  state.nickname = null;
  if (state.user) {
    const [v, p, sv] = await Promise.all([
      sb.from("visits").select("place_id"),
      sb.from("profiles").select("nickname").eq("id", state.user.id).maybeSingle(),
      sb.from("saved_places").select("place_id"),
      loadTrips(),
    ]);
    state.visits = new Set((v.data ?? []).map((x) => x.place_id));
    state.saved = new Set((sv.data ?? []).map((x) => x.place_id));
    state.nickname = p.data?.nickname ?? null;
  } else {
    if (state.mine) setView(false);
    state.mine = false;
    state.activeTrip = null;
  }
  renderAccountButton();
  render();
}

// ---------- mapa ----------
// Mapa nejde vytáhnout mimo svět: svisle pevné okraje, vodorovně se svět opakuje.
const map = L.map("map", {
  zoomControl: false,
  worldCopyJump: true,
  minZoom: 2,
  maxZoom: 19,
  maxBounds: L.latLngBounds([-85.05, -100000], [85.05, 100000]),
  maxBoundsViscosity: 1.0,
  bounceAtZoomLimits: false,
}).setView([48.5, 14], 4);
// Nejmenší zoom takový, aby svět vždy vyplnil celou výšku obrazovky (žádná šedá místa).
function fitMinZoom() {
  const h = map.getSize().y;
  map.setMinZoom(Math.max(2, Math.ceil(Math.log2(Math.max(h, 256) / 256))));
}
fitMinZoom();
map.on("resize", fitMinZoom);
const STYLE = { community: "https://tiles.openfreemap.org/styles/liberty", mine: "https://tiles.openfreemap.org/styles/positron" };
const glLayer = L.maplibreGL({
  style: STYLE.community,
  attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
}).addTo(map);
const cluster = L.markerClusterGroup({
  showCoverageOnHover: false,
  maxClusterRadius: 52,
  spiderfyDistanceMultiplier: 1.6,
  iconCreateFunction: (c) => L.divIcon({ className: "", html: `<div class="cluster lg"><b>${c.getChildCount()}</b></div>`, iconSize: [48, 48] }),
}).addTo(map);
let meMarker = null, meCircle = null, radiusCircle = null, fitted = false;

function pinIcon(p) {
  const c = cat(p.category);
  const v = visited(p);
  return L.divIcon({
    className: "",
    html: `<div class="pin-wrap">${v ? `<div class="pin-check">${ICON.check}</div>` : ""}${isSaved(p) ? `<div class="pin-star">${ICON.starFill}</div>` : ""}<div class="pin ${v ? "visited" : ""}" style="--c:${c.color}"><span>${c.emoji}</span></div></div>`,
    iconSize: [44, 50],
    iconAnchor: [22, 47],
  });
}

function visiblePlaces() {
  const trip = activeTrip();
  if (trip) {
    const ids = new Set(trip.stops.map((s) => s.place_id));
    return state.places.filter((p) => ids.has(p.id));
  }
  return state.places.filter((p) => {
    if (state.mine && !isSaved(p)) return false;
    if (state.filter.size && !state.filter.has(p.category)) return false;
    if (state.hideVisited && visited(p)) return false;
    if (state.radiusKm && state.me && distanceKm(state.me, p) > state.radiusKm) return false;
    return true;
  });
}

function renderMarkers() {
  cluster.clearLayers();
  const ps = visiblePlaces();
  cluster.addLayers(ps.map((p) => L.marker([p.lat, p.lng], { icon: pinIcon(p), title: p.name }).on("click", () => openPlace(p))));
  if (!fitted && ps.length) {
    fitted = true;
    map.fitBounds(ps.map((p) => [p.lat, p.lng]), { paddingTopLeft: [30, 150], paddingBottomRight: [30, 120], maxZoom: 13 });
  }
}

function renderHeader() {
  const total = state.places.length;
  const mine = state.mine;
  document.body.classList.toggle("mine", mine);
  const vs = $("#viewswitch");
  vs.classList.toggle("is-mine", mine);
  $("#view-community").classList.toggle("on", !mine);
  $("#view-mine").classList.toggle("on", mine);
  $("#view-community").setAttribute("aria-selected", String(!mine));
  $("#view-mine").setAttribute("aria-selected", String(mine));
  $("#cnt-community").textContent = !state.loaded && !total ? "Načítám…" : plural(total, "místo", "místa", "míst");
  $("#cnt-mine").textContent = !state.user ? "přihlas se"
    : `${plural(state.saved.size, "místo", "místa", "míst")}${state.trips.length ? ` · ${plural(state.trips.length, "cesta", "cesty", "cest")}` : ""}`;
  const rb = $("#btn-radius");
  rb.classList.toggle("tint", !!state.radiusKm);
  rb.classList.toggle("lens", !state.radiusKm);
  rb.classList.toggle("on", !!state.radiusKm);
  $("#radius-label").textContent = state.radiusKm ? `Do ${state.radiusKm} km` : "Okolí";
}

let styleShown = "community";
function setView(mine) {
  state.filter.clear();
  if (mine && !requireLogin("Přihlas se a měj vlastní mapu s uloženými místy a cestami.")) return;
  state.mine = mine;
  if (!mine) state.activeTrip = null;
  const want = mine ? "mine" : "community";
  if (styleShown !== want) {
    styleShown = want;
    try { glLayer.getMaplibreMap().setStyle(STYLE[want]); } catch { /* mapa se ještě načítá */ }
  }
  fitted = false;
  closeSheet();
  render();
  if (mine && !state.saved.size && !state.trips.length) {
    openSheet("mine-empty", "Moje mapa",
      h("div", { class: "empty-note" }, h("div", { class: "orb" }, "⭐"),
        "Tvoje vlastní mapa je zatím prázdná. V Komunitní mapě otevři místo a dej Uložit do mé mapy – objeví se tady a můžeš z nich plánovat cesty.",
        h("div", { style: "margin-top:14px" }, h("button", { class: "btn lg tint", onclick: () => setView(false) }, "Do Komunitní mapy"))));
  }
}

function renderChips() {
  const box = $("#chips");
  box.replaceChildren();
  if (!state.places.length) return;
  const trip = activeTrip();
  if (trip) {
    box.append(h("button", { class: "chip lg on", style: "--c:#d97706", onclick: () => openTrip(trip.id) },
      icon("route"), trip.name, h("span", { class: "count" }, trip.stops.length)),
    h("button", { class: "chip lg lens", onclick: () => { state.activeTrip = null; fitted = false; render(); } }, icon("x"), "Zavřít cestu"));
    return;
  }
  const pool = state.mine ? state.places.filter(isSaved) : state.places;
  const counts = {};
  for (const p of pool) counts[p.category] = (counts[p.category] ?? 0) + 1;
  if (state.mine) {
    // Moje mapa: cesty jako první, pak typy uložených míst
    for (const t of state.trips) {
      box.append(h("button", { class: "chip lg lens", onclick: () => showTripOnMap(t) }, icon("route"), t.name, h("span", { class: "count" }, t.stops.length)));
    }
    box.append(h("button", { class: "chip lg lens", onclick: () => createTrip() }, icon("plus"), "Nová cesta"));
  }
  if (!pool.length) return;
  box.append(h("button", { class: `chip lg all ${state.filter.size ? "lens" : "on"}`, onclick: () => { state.filter.clear(); render(); } },
    state.mine ? "Vše uložené" : "Vše", h("span", { class: "count" }, pool.length)));
  for (const c of state.categories) {
    if (!counts[c.id]) continue;
    box.append(h("button", {
      class: `chip lg ${state.filter.has(c.id) ? "on" : "lens"}`, style: `--c:${c.color}`,
      onclick: () => { state.filter.has(c.id) ? state.filter.delete(c.id) : state.filter.add(c.id); render(); },
    }, `${c.emoji} ${c.label}`, h("span", { class: "count" }, counts[c.id])));
  }
  if (state.user && state.visits.size) {
    box.append(h("button", {
      class: `chip lg ${state.hideVisited ? "on" : "lens"}`, style: "--c:#16a34a",
      onclick: () => { state.hideVisited = !state.hideVisited; render(); },
    }, icon("check"), state.hideVisited ? "Navštívená skrytá" : "Skrýt navštívená"));
  }
}

function renderAccountButton() {
  const a = $("#avatar");
  if (state.user) {
    a.className = "avatar me";
    a.textContent = (state.nickname ?? state.user.email ?? "?").slice(0, 1).toUpperCase();
    $("#account-label").textContent = "Já";
  } else {
    a.className = "avatar";
    a.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.4-3.6 4.2-5.4 7.5-5.4s6.1 1.8 7.5 5.4"/></svg>';
    $("#account-label").textContent = "Účet";
  }
}

function renderRadius() {
  radiusCircle?.remove();
  radiusCircle = null;
  if (state.radiusKm && state.me) {
    radiusCircle = L.circle([state.me.lat, state.me.lng], { radius: state.radiusKm * 1000, color: "#6f5cff", weight: 1.5, dashArray: "6 6", fillOpacity: 0.05, interactive: false }).addTo(map);
  }
}

function render() {
  renderHeader();
  renderChips();
  renderMarkers();
  renderRadius();
  renderTripLayer();
  if (!$("#sheet").hidden && currentSheet === "list") openList();
}

// ---------- poloha ----------
let watchId = null;
let onFirstFix = null;
function startLocate(center = true) {
  if (!("geolocation" in navigator)) return toast("Prohlížeč neumí zjistit polohu");
  if (watchId != null) {
    if (state.me && center) map.flyTo([state.me.lat, state.me.lng], Math.max(map.getZoom(), 14));
    return;
  }
  let first = center;
  $("#btn-locate").classList.add("active", "lens");
  watchId = navigator.geolocation.watchPosition((pos) => {
    const firstFix = !state.me;
    state.me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    const ll = [state.me.lat, state.me.lng];
    if (!meMarker) {
      meMarker = L.marker(ll, { icon: L.divIcon({ className: "", html: '<div class="me-dot"></div>', iconSize: [20, 20] }), zIndexOffset: 1000, interactive: false }).addTo(map);
      meCircle = L.circle(ll, { radius: pos.coords.accuracy, color: "#1f7aff", weight: 1, fillOpacity: 0.07, interactive: false }).addTo(map);
    } else {
      meMarker.setLatLng(ll);
      meCircle.setLatLng(ll).setRadius(pos.coords.accuracy);
    }
    if (first) { first = false; map.flyTo(ll, Math.max(map.getZoom(), 14)); }
    if (firstFix) {
      render();
      onFirstFix?.();
      onFirstFix = null;
    }
  }, (err) => {
    $("#btn-locate").classList.remove("active", "lens");
    $("#btn-locate").style.backdropFilter = "";
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    toast(err.code === 1 ? "Přístup k poloze je zakázaný – povol ho v nastavení prohlížeče" : "Polohu se nepodařilo zjistit");
  }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
}

// ---------- spodní panel ----------
let currentSheet = null;
// Šipka Zpět: nextBack nastaví volající těsně před otevřením panelu (např. detail místa ze seznamu).
let sheetBack = null;
let nextBack = null;
function openSheet(name, title, ...content) {
  currentSheet = name;
  sheetBack = nextBack;
  nextBack = null;
  $("#sheet-back").hidden = !sheetBack;
  $("#sheet-title").textContent = title;
  $("#sheet-body").replaceChildren(...content.flat().filter((c) => c != null && c !== false));
  $("#sheet-body").scrollTop = 0;
  $("#sheet").style.transform = "";
  $("#sheet").hidden = false;
  $("#backdrop").hidden = false;
  document.body.classList.add("sheet-open");
}

// Zavření panelu stažením dolů (za horní lištu panelu).
(() => {
  const sheet = $("#sheet");
  let startY = 0, lastY = 0, lastT = 0, speed = 0, dragging = false;
  const grab = (e) => e.target.closest(".sheet-handle, .sheet-head") && !e.target.closest("button");
  sheet.addEventListener("pointerdown", (e) => {
    if (!grab(e)) return;
    dragging = true;
    startY = lastY = e.clientY;
    lastT = performance.now();
    speed = 0;
    sheet.style.transition = "none";
    sheet.setPointerCapture(e.pointerId);
  });
  sheet.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const now = performance.now();
    speed = (e.clientY - lastY) / Math.max(1, now - lastT);
    lastY = e.clientY;
    lastT = now;
    const dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
    $("#backdrop").style.opacity = String(Math.max(0, 1 - dy / 400));
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    const dy = Math.max(0, lastY - startY);
    sheet.style.transition = "transform .3s cubic-bezier(.22,1,.36,1)";
    $("#backdrop").style.opacity = "";
    if (dy > 110 || speed > 0.6) {
      sheet.style.transform = "translateY(110%)";
      setTimeout(() => { closeSheet(); sheet.style.transition = ""; sheet.style.transform = ""; }, 220);
    } else {
      sheet.style.transform = "";
      setTimeout(() => { sheet.style.transition = ""; }, 300);
    }
  };
  sheet.addEventListener("pointerup", end);
  sheet.addEventListener("pointercancel", end);
})();

/** Posune mapu tak, aby místo bylo vidět nad otevřeným panelem. */
function keepVisible(p) {
  requestAnimationFrame(() => {
    const top = 140; // hlavička + filtry
    const sheetTop = $("#sheet").getBoundingClientRect().top;
    if (sheetTop - top < 70) return; // panel přes skoro celou obrazovku
    const pt = map.latLngToContainerPoint([p.lat, p.lng]);
    const target = L.point(map.getSize().x / 2, top + (sheetTop - top) / 2 + 24);
    map.panBy(pt.subtract(target), { animate: true, duration: 0.35 });
  });
}
// Nativní aplikace: tlačítko Zpět nejdřív zavře otevřený panel.
window.mmBack = () => {
  if ($("#sheet").hidden) return false;
  if (sheetBack) { const b = sheetBack; b(); } else closeSheet();
  return true;
};
function closeSheet() {
  currentSheet = null;
  sheetBack = null;
  $("#sheet-body").querySelectorAll("video").forEach((v) => v.pause());
  $("#sheet").hidden = true;
  $("#backdrop").hidden = true;
  document.body.classList.remove("sheet-open");
}

function requireLogin(reason) {
  if (state.user) return true;
  openAccount(reason);
  return false;
}

// ---------- vlastní dialogy (místo systémových okének) ----------
function askText({ title, label, value = "", ok = "Uložit", back }) {
  return new Promise((resolve) => {
    const input = h("input", { type: "text", value, maxlength: 80, "aria-label": label });
    const done = (v) => { resolve(v); };
    nextBack = () => { done(null); back?.(); };
    openSheet("dialog", title,
      h("form", { class: "stack", onsubmit: (e) => { e.preventDefault(); const v = input.value.trim(); if (v) done(v); } },
        label ? h("p", { class: "muted" }, label) : null, input,
        h("div", { class: "btn-grid" },
          h("button", { class: "btn lg", type: "button", onclick: () => { done(null); back ? back() : closeSheet(); } }, "Zrušit"),
          h("button", { class: "btn lg tint", type: "submit" }, ok))));
    setTimeout(() => { input.focus(); input.select(); }, 250);
  });
}

function askConfirm({ title, text, ok = "Ano", danger = false, back }) {
  return new Promise((resolve) => {
    nextBack = () => { resolve(false); back?.(); };
    openSheet("dialog", title,
      h("p", { class: "muted", style: "font-size:15px" }, text),
      h("div", { class: "btn-grid" },
        h("button", { class: "btn lg", onclick: () => { resolve(false); back ? back() : closeSheet(); } }, "Zrušit"),
        h("button", { class: `btn ${danger ? "danger-solid" : "lg tint"}`, onclick: () => resolve(true) }, ok)));
  });
}

// ---------- detail místa ----------
function reelView(p) {
  const box = h("div", { class: "reel" });
  const video = h("video", {
    src: `https://uuinstagram.com/videos/${p.shortcode}/1#t=0.5`,
    playsinline: true, muted: true, loop: true, preload: "metadata",
  });
  video.muted = true;
  const play = h("button", { class: "play lg lens", "aria-label": "Přehrát", html: ICON.play });
  const toggle = () => {
    if (video.paused) { video.play().catch(() => window.open(p.reel_url, "_blank")); play.hidden = true; }
    else { video.pause(); play.hidden = false; }
  };
  video.addEventListener("click", toggle);
  play.addEventListener("click", toggle);
  video.addEventListener("error", () => { video.remove(); play.remove(); box.style.background = "var(--grad)"; }, { once: true });
  box.append(video, play);
  return box;
}

function openPlace(p) {
  const c = cat(p.category);
  const d = distTo(p);
  const locked = new Date(p.next_slot_at) > new Date();
  const visitBtn = h("button", { class: `btn ${visited(p) ? "on" : "lg"}` }, icon("check"), visited(p) ? "Navštíveno" : "Označit navštívené");
  visitBtn.addEventListener("click", async () => {
    if (!requireLogin("Přihlas se a odškrtávej navštívená místa.")) return;
    visitBtn.disabled = true;
    const was = visited(p);
    const { error } = was
      ? await sb.from("visits").delete().eq("place_id", p.id).eq("user_id", state.user.id)
      : await sb.from("visits").insert({ place_id: p.id });
    visitBtn.disabled = false;
    if (error) return toast("Nepodařilo se uložit");
    was ? state.visits.delete(p.id) : state.visits.add(p.id);
    render();
    openPlace(p);
    toast(was ? "Odebráno z navštívených" : "Navštíveno ✓");
  });

  openSheet("place", c.label,
    h("div", { class: "place-head" },
      h("div", { class: "gloss lgx", style: `--c:${c.color}` }, c.emoji),
      h("div", {},
        h("h3", {}, p.name),
        h("div", { class: "meta" }, [p.city, p.country, d != null && fmtDist(d)].filter(Boolean).join(" · ")))),
    h("div", { class: "place-grid" },
      reelView(p),
      h("div", { class: "place-side" },
        h("a", { class: "ig-link", href: p.reel_url, target: "_blank", rel: "noopener" },
          h("span", { class: "ig", html: ICON.ig }),
          h("span", {}, h("b", {}, p.ig_author ? `@${p.ig_author}` : "Instagram"), h("small", {}, "Otevřít reelsko"))),
        p.description && h("p", { class: "place-desc" }, p.description),
        h("div", { class: `slot ${locked ? "" : "free"}` },
          icon(locked ? "lock" : "spark"),
          h("span", {},
            `${p.contributor ? `Přidal(a) ${p.contributor}` : "Přidáno komunitou"} · ${fmtDate(p.reel_created_at)}`,
            h("br"),
            locked ? `Další reelsko od ${fmtDate(p.next_slot_at)}` : "Místo je volné – přidej své reelsko")))),
    h("div", { class: "btn-grid" },
      h("a", { class: "btn lg tint", href: navUrl(p), target: "_blank", rel: "noopener" }, icon("nav"), "Navigovat"),
      h("button", { class: `btn ${isSaved(p) ? "on-star" : "lg"}`, onclick: () => toggleSaved(p) }, icon(isSaved(p) ? "starFill" : "star"), isSaved(p) ? "V mé mapě" : "Uložit do mé mapy"),
      visitBtn,
      h("button", { class: "btn lg", onclick: () => addToTripPicker(p) }, icon("route"), "Přidat do cesty")),
    h("div", { style: "text-align:center;margin-top:6px" },
      h("button", { class: "btn btn-text", onclick: () => report(p) }, icon("flag"), "Nahlásit nevhodné reelsko")),
  );
  keepVisible(p);
}

async function report(p) {
  if (!requireLogin("Pro nahlášení se přihlas.")) return;
  const yes = await askConfirm({ title: "Nahlásit reelsko", text: `Je reelsko u místa „${p.name}“ nevhodné? Po třech nahlášeních od různých lidí z mapy zmizí.`, ok: "Nahlásit", danger: true, back: () => openPlace(p) });
  if (!yes) return;
  const { error } = await sb.from("reports").insert({ reel_id: p.reel_id, reason: "nevhodné" });
  openPlace(p);
  toast(error?.code === "23505" ? "Tohle už máš nahlášené" : error ? "Nahlášení se nepovedlo" : "Díky, nahlášení jsme přijali.");
}

function focusPlace(p, back = null) {
  closeSheet();
  if (state.filter.size && !state.filter.has(p.category)) state.filter.clear();
  if (state.hideVisited && visited(p)) state.hideVisited = false;
  render();
  map.flyTo([p.lat, p.lng], 15, { duration: 0.8 });
  let opened = false;
  const go = () => { if (opened) return; opened = true; nextBack = back; openPlace(p); };
  map.once("moveend", go);
  setTimeout(go, 1100); // pojistka, kdyby animace mapy neskončila
}

// ---------- seznam ----------
function placeItem(p, sub, back = null) {
  const c = cat(p.category);
  const d = distTo(p);
  return h("li", { class: `item ${visited(p) ? "visited" : ""}` },
    h("div", { class: "gloss sm", style: `--c:${c.color}` }, c.emoji),
    h("button", { class: "txt", onclick: () => focusPlace(p, back) },
      h("div", { class: "name" }, p.name),
      h("div", { class: "sub" }, sub ?? [c.label, p.city, p.country].filter(Boolean).join(" · "))),
    d != null ? h("span", { class: "pill" }, fmtDist(d)) : null,
    h("a", { class: "nav-btn", href: navUrl(p), target: "_blank", rel: "noopener", "aria-label": "Navigovat", html: ICON.nav }));
}

let listSort = "near";
let listTab = "places"; // places | saved | trips
function openList(tab = listTab) {
  listTab = tab;
  const tabs = h("div", { class: "seg seg-wide" },
    h("button", { class: tab === "places" ? "on" : "", onclick: () => openList("places") }, "Místa"),
    h("button", { class: tab === "saved" ? "on" : "", onclick: () => openList("saved") }, icon("star"), "Moje mapa"),
    h("button", { class: tab === "trips" ? "on" : "", onclick: () => openList("trips") }, icon("route"), "Cesty"));
  if (tab === "trips") return openTripsList(tabs);

  const pool = tab === "saved" ? state.places.filter(isSaved) : visiblePlaces();
  const items = pool.slice();
  const near = listSort === "near" && state.me;
  items.sort((a, b) => near ? distTo(a) - distTo(b) : new Date(b.reel_created_at) - new Date(a.reel_created_at));
  const empty = tab === "saved"
    ? (state.user ? "Zatím nemáš uložená žádná místa. Otevři místo na mapě a dej Uložit do mé mapy." : "Přihlas se a ukládej si místa do vlastní mapy.")
    : "Tady zatím nic není. Zkus zvětšit vzdálenost nebo zrušit filtr.";
  openSheet("list", tab === "saved" ? "Moje mapa" : "Místa", tabs,
    h("div", { class: "seg" },
      h("button", { class: listSort === "near" ? "on" : "", onclick: () => { listSort = "near"; if (!state.me) startLocate(false); openList(); } }, "Nejblíž"),
      h("button", { class: listSort === "new" ? "on" : "", onclick: () => { listSort = "new"; openList(); } }, "Nejnovější")),
    listSort === "near" && !state.me ? h("p", { class: "muted" }, "Zjišťuji polohu… Zatím řadím od nejnovějších.") : null,
    tab === "saved" && items.length ? h("button", { class: "btn lg btn-block", style: "margin-bottom:10px", onclick: () => setView(true) }, icon("map"), "Otevřít Moji mapu") : null,
    items.length ? h("ul", { class: "list" }, items.map((p) => placeItem(p, undefined, () => openList(tab))))
      : h("div", { class: "empty-note" }, h("div", { class: "orb" }, tab === "saved" ? "⭐" : "🗺️"), empty,
        !state.user && tab === "saved" ? h("div", { style: "margin-top:12px" }, h("button", { class: "btn lg tint", onclick: () => openAccount() }, "Přihlásit se")) : null));
}

// ---------- moje mapa ----------
async function toggleSaved(p) {
  if (!requireLogin("Přihlas se a ukládej si místa do vlastní mapy.")) return;
  const was = isSaved(p);
  const { error } = was
    ? await sb.from("saved_places").delete().eq("place_id", p.id).eq("user_id", state.user.id)
    : await sb.from("saved_places").insert({ place_id: p.id });
  if (error) return toast("Nepodařilo se uložit");
  was ? state.saved.delete(p.id) : state.saved.add(p.id);
  if (!state.saved.size) state.mine = false;
  render();
  if (currentSheet === "place") openPlace(p);
  toast(was ? "Odebráno z mé mapy" : "Uloženo do mé mapy ⭐");
}

// ---------- cesty ----------
// Způsoby dopravy podle Google Maps (parametr travelmode). MHD neumí zastávky po cestě.
const MODES = [
  { id: "walking", emoji: "🚶", label: "Pěšky", kmh: 4.5, color: "#16a34a", dash: "2 8" },
  { id: "transit", emoji: "🚇", label: "MHD", kmh: 22, color: "#2563eb", dash: null },
  { id: "driving", emoji: "🚗", label: "Autem", kmh: 45, color: "#e4572e", dash: null },
  { id: "bicycling", emoji: "🚲", label: "Na kole", kmh: 15, color: "#0d9488", dash: "10 6" },
  { id: "two-wheeler", emoji: "🛵", label: "Motorka", kmh: 35, color: "#9333ea", dash: "14 6" },
];
const modeOf = (id) => MODES.find((m) => m.id === id) ?? MODES[0];
const placeById = (id) => state.places.find((p) => p.id === id);
const activeTrip = () => state.trips.find((t) => t.id === state.activeTrip) ?? null;

async function loadTrips() {
  const { data } = await sb.from("trips").select("id, name, created_at, trip_stops(id, place_id, position, mode)").order("created_at", { ascending: false });
  state.trips = (data ?? []).map((t) => ({
    id: t.id, name: t.name, created_at: t.created_at,
    stops: (t.trip_stops ?? []).sort((a, b) => a.position - b.position),
  }));
  if (state.activeTrip && !activeTrip()) state.activeTrip = null;
  return state.trips;
}

/** Odhad úseku: vzdušná vzdálenost × 1,3 (cesty nejsou rovné) a průměrná rychlost. */
function legEstimate(a, b, mode) {
  const km = distanceKm(a, b) * 1.3;
  // Na delší vzdálenosti jede auto/motorka po dálnici a MHD je spíš vlak/autobus.
  const long = { driving: 85, "two-wheeler": 75, transit: 65 };
  const kmh = km > 40 && long[mode] ? long[mode] : modeOf(mode).kmh;
  const min = Math.round((km / kmh) * 60) + (mode === "transit" ? 8 : 0);
  return { km, min };
}
const fmtMin = (min) => min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
const legUrl = (a, b, mode) => `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&travelmode=${mode}`;
const legModes = (trip) => new Set(trip.stops.slice(1).map((s) => s.mode));

/** Celá cesta jedním odkazem – jen když mají všechny úseky stejnou dopravu (ne MHD) a nejvýš 9 zastávek po cestě. */
function wholeTripUrl(trip) {
  const ps = trip.stops.map((s) => placeById(s.place_id)).filter(Boolean);
  if (ps.length < 2) return null;
  const modes = legModes(trip);
  if (modes.size !== 1) return null;
  const mode = [...modes][0];
  if (mode === "transit" || ps.length - 2 > 9) return null;
  const wp = ps.slice(1, -1).map((p) => `${p.lat},${p.lng}`).join("|");
  return `https://www.google.com/maps/dir/?api=1&origin=${ps[0].lat},${ps[0].lng}&destination=${ps.at(-1).lat},${ps.at(-1).lng}&travelmode=${mode}${wp ? `&waypoints=${encodeURIComponent(wp)}` : ""}`;
}

function tripTotals(trip) {
  let km = 0, min = 0;
  for (let i = 1; i < trip.stops.length; i++) {
    const a = placeById(trip.stops[i - 1].place_id), b = placeById(trip.stops[i].place_id);
    if (!a || !b) continue;
    const e = legEstimate(a, b, trip.stops[i].mode);
    km += e.km; min += e.min;
  }
  return { km, min };
}

function openTripsList(tabs) {
  if (!state.user) {
    return openSheet("list", "Cesty", tabs,
      h("div", { class: "empty-note" }, h("div", { class: "orb" }, "🧭"), "Přihlas se a plánuj si cesty z uložených míst.",
        h("div", { style: "margin-top:12px" }, h("button", { class: "btn lg tint", onclick: () => openAccount() }, "Přihlásit se"))));
  }
  openSheet("list", "Cesty", tabs,
    h("button", { class: "btn lg tint btn-block", style: "margin-bottom:12px", onclick: () => createTrip() }, icon("plus"), "Nová cesta"),
    state.trips.length
      ? h("ul", { class: "list" }, state.trips.map((t) => {
        const tot = tripTotals(t);
        return h("li", { class: "item" },
          h("div", { class: "gloss sm", style: "--c:#6f5cff" }, "🧭"),
          h("button", { class: "txt", onclick: () => openTrip(t.id) },
            h("div", { class: "name" }, t.name),
            h("div", { class: "sub" }, `${plural(t.stops.length, "zastávka", "zastávky", "zastávek")}${t.stops.length > 1 ? ` · ~${fmtDist(tot.km)} · ~${fmtMin(tot.min)}` : ""}`)));
      }))
      : h("p", { class: "muted" }, "Zatím žádná cesta. Vytvoř cestu a přidávej do ní místa z mapy – u každého úseku si vybereš, jestli půjdeš pěšky, MHD, autem nebo na kole."));
}

async function createTrip(firstPlace) {
  if (!requireLogin("Přihlas se a plánuj si cesty.")) return null;
  // Cesta se pojmenuje sama, přejmenovat jde kdykoli tužkou v detailu cesty.
  const name = firstPlace?.city ? `Výlet – ${firstPlace.city}` : `Cesta ${new Date().toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" })}`;
  const { data, error } = await sb.from("trips").insert({ name }).select("id").single();
  if (error) { toast("Cestu se nepodařilo vytvořit"); return null; }
  if (firstPlace) await sb.from("trip_stops").insert({ trip_id: data.id, place_id: firstPlace.id, position: 0 });
  await loadTrips();
  render();
  openTrip(data.id);
  toast("Cesta vytvořená – přidej do ní další místa");
  return data.id;
}

function addToTripPicker(p) {
  if (!requireLogin("Přihlas se a plánuj si cesty.")) return;
  nextBack = () => openPlace(p);
  openSheet("trip-pick", "Přidat do cesty",
    h("p", { class: "muted" }, `Kam přidat „${p.name}“?`),
    h("button", { class: "btn lg tint btn-block", style: "margin-bottom:12px", onclick: () => createTrip(p) }, icon("plus"), "Nová cesta s tímto místem"),
    state.trips.length ? h("ul", { class: "list" }, state.trips.map((t) => {
      const has = t.stops.some((s) => s.place_id === p.id);
      return h("li", { class: "item" },
        h("div", { class: "gloss sm", style: "--c:#6f5cff" }, "🧭"),
        h("button", { class: "txt", disabled: has, onclick: () => addStop(t, p) },
          h("div", { class: "name" }, t.name),
          h("div", { class: "sub" }, has ? "už v cestě je" : plural(t.stops.length, "zastávka", "zastávky", "zastávek"))));
    })) : null);
}

/** Výchozí doprava podle vzdálenosti: do 2 km pěšky, do 15 km MHD, dál autem. */
function suggestMode(a, b) {
  if (!a || !b) return "walking";
  const km = distanceKm(a, b);
  return km < 2 ? "walking" : km < 15 ? "transit" : "driving";
}

async function addStop(trip, p) {
  const last = trip.stops.at(-1);
  const { error } = await sb.from("trip_stops").insert({
    trip_id: trip.id, place_id: p.id,
    position: last ? last.position + 1 : 0,
    mode: last ? suggestMode(placeById(last.place_id), p) : "walking",
  });
  if (error) return toast("Nepodařilo se přidat");
  await loadTrips();
  render();
  toast(`Přidáno do cesty ${trip.name}`);
  openTrip(trip.id);
}

async function saveOrder(trip, stops) {
  await Promise.all(stops.map((s, i) => sb.from("trip_stops").update({ position: i }).eq("id", s.id)));
  await loadTrips();
  render();
  openTrip(trip.id);
}

function moveStop(trip, i, dir) {
  const stops = trip.stops.slice();
  const j = i + dir;
  if (j < 0 || j >= stops.length) return;
  [stops[i], stops[j]] = [stops[j], stops[i]];
  saveOrder(trip, stops);
}

/** Seřadí zastávky nejkratší trasou (od první zastávky vždy k nejbližší další). */
function optimizeTrip(trip) {
  const known = trip.stops.filter((s) => placeById(s.place_id));
  if (known.length < 3) return;
  const rest = known.slice(1);
  const order = [known[0]];
  while (rest.length) {
    const cur = placeById(order.at(-1).place_id);
    rest.sort((a, b) => distanceKm(cur, placeById(a.place_id)) - distanceKm(cur, placeById(b.place_id)));
    order.push(rest.shift());
  }
  toast("Seřazeno nejkratší trasou");
  saveOrder(trip, order);
}

async function setMode(trip, stop, mode) {
  stop.mode = mode;
  render();
  openTrip(trip.id);
  const { error } = await sb.from("trip_stops").update({ mode }).eq("id", stop.id);
  if (error) toast("Nepodařilo se uložit dopravu");
}

async function removeStop(trip, stop) {
  await sb.from("trip_stops").delete().eq("id", stop.id);
  await loadTrips();
  render();
  openTrip(trip.id);
}

async function renameTrip(trip) {
  const name = await askText({ title: "Přejmenovat cestu", value: trip.name, back: () => openTrip(trip.id) });
  if (!name) return;
  await sb.from("trips").update({ name: name.slice(0, 80) }).eq("id", trip.id);
  await loadTrips();
  render();
  openTrip(trip.id);
}

async function deleteTrip(trip) {
  const yes = await askConfirm({ title: "Smazat cestu", text: `Opravdu smazat cestu „${trip.name}“? Místa v Mé mapě zůstanou.`, ok: "Smazat", danger: true, back: () => openTrip(trip.id) });
  if (!yes) return;
  await sb.from("trips").delete().eq("id", trip.id);
  if (state.activeTrip === trip.id) state.activeTrip = null;
  await loadTrips();
  render();
  openList("trips");
}

function showTripOnMap(trip) {
  if (!state.mine) setView(true);
  state.activeTrip = trip.id;
  closeSheet();
  render();
  const ps = trip.stops.map((s) => placeById(s.place_id)).filter(Boolean);
  if (ps.length) map.flyToBounds(ps.map((p) => [p.lat, p.lng]), { paddingTopLeft: [40, 150], paddingBottomRight: [40, 130], maxZoom: 15, duration: 0.8 });
}

function openTrip(id) {
  const trip = state.trips.find((t) => t.id === id);
  if (!trip) return openList("trips");
  const ps = trip.stops.map((s) => placeById(s.place_id));
  const rows = [];
  trip.stops.forEach((stop, i) => {
    const p = ps[i];
    if (i > 0 && p && ps[i - 1]) {
      const e = legEstimate(ps[i - 1], p, stop.mode);
      const info = h("span", { class: "leg-text" }, h("span", { class: "spin-sm" }), `${modeOf(stop.mode).label} · hledám trasu…`);
      const detail = h("div", { class: "leg-detail" });
      const from = ps[i - 1];
      routeLeg(from, p, stop.mode).then((r) => {
        if (!info.isConnected) return;
        const m = modeOf(stop.mode);
        if (!r) {
          info.replaceChildren(`${m.label} · ~${fmtDist(e.km)} · ~${fmtMin(e.min)} (odhad)`);
          return;
        }
        info.replaceChildren(`${m.label} · ${fmtDist(r.km)} · ${fmtMin(r.min)}`);
        if (r.transit) {
          detail.replaceChildren(r.transit.walkOnly
            ? h("span", {}, "MHD tu nejede – nejrychlejší je pěšky")
            : h("span", { class: "lines" }, r.transit.lines.map((l) => h("span", { class: "line-pill" }, l)),
              h("span", {}, ` · odjezd ${r.transit.departure}${r.transit.transfers ? ` · ${plural(r.transit.transfers, "přestup", "přestupy", "přestupů")}` : " · bez přestupu"}`)));
        }
        legResults.set(stop.id, r);
        updateTripTotal();
      });
      rows.push(h("li", { class: "leg" },
        h("div", { class: "leg-modes", role: "radiogroup", "aria-label": "Doprava" },
          MODES.map((m) => h("button", { class: `mode ${stop.mode === m.id ? "on" : ""}`, title: m.label, "aria-label": m.label, style: `--m:${m.color}`, onclick: () => setMode(trip, stop, m.id) }, m.emoji))),
        h("div", { class: "leg-info" }, info,
          h("a", { class: "leg-link", href: legUrl(ps[i - 1], p, stop.mode), target: "_blank", rel: "noopener" }, "Otevřít v Google Maps ↗")),
        detail));
    }
    const c = p ? cat(p.category) : cat("other");
    rows.push(h("li", { class: "item stop" },
      h("div", { class: "stop-num" }, i + 1),
      h("div", { class: "gloss sm", style: `--c:${c.color}` }, c.emoji),
      h("button", { class: "txt", onclick: () => p && focusPlace(p, () => openTrip(trip.id)) },
        h("div", { class: "name" }, p?.name ?? "Místo už není v mapě"),
        h("div", { class: "sub" }, [p?.city, p?.country].filter(Boolean).join(" · "))),
      h("div", { class: "stop-tools" },
        h("button", { class: "icon-btn", "aria-label": "Nahoru", disabled: i === 0, onclick: () => moveStop(trip, i, -1), html: ICON.up }),
        h("button", { class: "icon-btn", "aria-label": "Dolů", disabled: i === trip.stops.length - 1, onclick: () => moveStop(trip, i, 1), html: ICON.down }),
        h("button", { class: "icon-btn danger", "aria-label": "Odebrat", onclick: () => removeStop(trip, stop), html: ICON.x }))));
  });

  const tot = tripTotals(trip);
  const whole = wholeTripUrl(trip);
  const modes = legModes(trip);
  const legResults = new Map();
  const totalEl = h("span", {}, trip.stops.length > 1 ? ` · ~${fmtDist(tot.km)} · ~${fmtMin(tot.min)}` : "");
  const noteEl = h("small", {}, trip.stops.length > 1 ? "Počítám přesné trasy…" : "Přidej aspoň dvě místa.");
  function updateTripTotal() {
    const legs = trip.stops.length - 1;
    if (legResults.size !== legs) return;
    let km = 0, min = 0;
    for (const r of legResults.values()) { km += r.km; min += r.min; }
    totalEl.textContent = ` · ${fmtDist(km)} · ${fmtMin(min)}`;
    noteEl.textContent = modes.has("transit") ? "Přesné trasy; MHD podle nejbližšího spojení." : "Přesné trasy po silnicích a cestách.";
  }
  const savedNotIn = state.places.filter((p) => isSaved(p) && !trip.stops.some((s) => s.place_id === p.id));
  openSheet("trip", trip.name,
    h("div", { class: "trip-summary card" },
      h("div", { style: "flex:1;min-width:0" },
        h("b", {}, plural(trip.stops.length, "zastávka", "zastávky", "zastávek")),
        totalEl, noteEl),
      h("button", { class: "icon-btn", "aria-label": "Přejmenovat", onclick: () => renameTrip(trip), html: ICON.edit }),
      h("button", { class: "icon-btn danger", "aria-label": "Smazat cestu", onclick: () => deleteTrip(trip), html: ICON.x })),
    h("div", { class: "btn-grid", style: "margin:12px 0 8px" },
      h("button", { class: "btn lg tint", disabled: !trip.stops.length, onclick: () => showTripOnMap(trip) }, icon("map"), "Na mapě"),
      whole ? h("a", { class: "btn lg", href: whole, target: "_blank", rel: "noopener" }, icon("nav"), "Celá v Google Maps")
        : h("button", { class: "btn lg", disabled: trip.stops.length < 3, onclick: () => optimizeTrip(trip) }, icon("sort"), "Nejkratší pořadí")),
    whole && trip.stops.length > 2 ? h("div", { style: "text-align:center" }, h("button", { class: "btn btn-text", onclick: () => optimizeTrip(trip) }, icon("sort"), "Seřadit nejkratší trasou")) : null,
    !whole && trip.stops.length > 1 ? h("p", { class: "muted" }, modes.has("transit") || modes.size > 1
      ? "Google Maps neumí v jedné trase kombinovat různou dopravu ani MHD se zastávkami po cestě – otevři jednotlivé úseky."
      : "Na celou trasu je moc zastávek (Google Maps zvládne 9 po cestě) – otevři jednotlivé úseky.") : null,
    trip.stops.length ? h("ul", { class: "list trip-list" }, rows) : null,
    h("div", { class: "section-label" }, "Přidat zastávku z Mé mapy"),
    savedNotIn.length
      ? h("ul", { class: "list" }, savedNotIn.slice(0, 12).map((p) => {
        const c = cat(p.category);
        return h("li", { class: "item" },
          h("div", { class: "gloss sm", style: `--c:${c.color}` }, c.emoji),
          h("button", { class: "txt", onclick: () => addStop(trip, p) },
            h("div", { class: "name" }, p.name),
            h("div", { class: "sub" }, [c.label, p.city].filter(Boolean).join(" · "))),
          h("button", { class: "icon-btn", "aria-label": "Přidat", onclick: () => addStop(trip, p), html: ICON.plus }));
      }))
      : h("p", { class: "muted" }, "Místa přidáš tlačítkem „Přidat do cesty“ v detailu místa, nebo si je ulož do Mé mapy a objeví se tady."));
}

// Vykreslení aktivní cesty: přesná trasa po silnicích / linkách MHD, barevně podle dopravy.
const tripLayer = L.layerGroup().addTo(map);
let tripRenderToken = 0;
function drawSegment(seg, fallbackColor, layer) {
  const m = modeOf(seg.kind === "transit" ? "transit" : seg.kind);
  const color = seg.kind === "walking" ? modeOf("walking").color : (seg.color ?? fallbackColor ?? m.color);
  const dash = seg.kind === "walking" ? "1 9" : seg.kind === "bicycling" ? "10 6" : null;
  L.polyline(seg.coords, { color: "#fff", weight: 9, opacity: 0.95, lineCap: "round", lineJoin: "round", interactive: false }).addTo(layer);
  L.polyline(seg.coords, { color, weight: seg.kind === "walking" ? 5 : 5.5, dashArray: dash, lineCap: "round", lineJoin: "round", interactive: false }).addTo(layer);
}
function renderTripLayer() {
  const token = ++tripRenderToken;
  tripLayer.clearLayers();
  const trip = activeTrip();
  if (!trip) return;
  const ps = trip.stops.map((s) => placeById(s.place_id));
  const legsLayer = L.layerGroup().addTo(tripLayer);
  const bounds = [];
  trip.stops.forEach((stop, i) => {
    const p = ps[i];
    if (!p) return;
    bounds.push([p.lat, p.lng]);
    L.marker([p.lat, p.lng], { icon: L.divIcon({ className: "", html: `<div class="stop-badge">${i + 1}</div>`, iconSize: [24, 24], iconAnchor: [-6, 52] }), interactive: false, zIndexOffset: 2000 }).addTo(tripLayer);
    if (i === 0 || !ps[i - 1]) return;
    const a = ps[i - 1], m = modeOf(stop.mode);
    // Dočasně rovná tenká čára, než dorazí přesná trasa.
    const temp = L.polyline([[a.lat, a.lng], [p.lat, p.lng]], { color: m.color, weight: 2, opacity: 0.5, dashArray: "4 8", interactive: false }).addTo(legsLayer);
    routeLeg(a, p, stop.mode).then((r) => {
      if (token !== tripRenderToken) return;
      if (!r) { temp.setStyle({ opacity: 0.9, weight: 4 }); return; }
      temp.remove();
      for (const seg of r.segments) drawSegment(seg, m.color, legsLayer);
      const mid = r.segments.flatMap((sg) => sg.coords);
      const c = mid[Math.floor(mid.length / 2)];
      if (c) L.marker(c, { icon: L.divIcon({ className: "", html: `<div class="leg-badge" style="--m:${m.color}">${m.emoji}<small>${fmtMin(r.min)}</small></div>`, iconSize: [66, 30] }), interactive: false }).addTo(tripLayer);
    });
  });
}

// ---------- vzdálenost ----------
function openRadius() {
  const pick = (km) => {
    state.radiusKm = km;
    closeSheet();
    const apply = () => {
      render();
      if (km && state.me) map.flyToBounds(L.latLng(state.me.lat, state.me.lng).toBounds(km * 2000), { paddingTopLeft: [20, 140], paddingBottomRight: [20, 110] });
    };
    if (km && !state.me) { onFirstFix = apply; startLocate(false); toast("Zjišťuji polohu…"); }
    apply();
  };
  openSheet("radius", "Místa v okolí",
    h("p", { class: "muted" }, "Ukážu jen místa do zvolené vzdálenosti od tebe."),
    h("div", { class: "radius-grid" },
      RADII.map((km) => h("button", { class: state.radiusKm === km ? "on" : "", onclick: () => pick(km) }, `${km} km`,
        h("small", {}, state.me ? plural(state.places.filter((p) => distanceKm(state.me, p) <= km).length, "místo", "místa", "míst") : "v okolí"))),
      h("button", { class: state.radiusKm ? "" : "on", onclick: () => pick(null) }, "Všude", h("small", {}, plural(state.places.length, "místo", "místa", "míst")))));
}

// ---------- tipy ----------
function openRecommend() {
  if (!state.me && watchId == null) { onFirstFix = () => currentSheet === "tips" && openRecommend(); startLocate(false); }
  const pool = state.places.filter((p) => !visited(p) && (!state.mine || isSaved(p)));
  const counts = {};
  for (const p of pool) counts[p.category] = (counts[p.category] ?? 0) + 1;
  openSheet("tips", state.mine ? "Kam z mé mapy?" : "Kam dnes?",
    h("p", { class: "muted" }, state.me ? "Vyber typ a doporučím nejbližší místo, které ještě nemáš navštívené." : "Zjišťuji polohu… Bez ní doporučím nejnovější místa."),
    h("div", { class: "grid" },
      h("button", { class: "tile any", disabled: !pool.length, onclick: () => recommend(null) },
        h("span", { class: "e" }, "🎲"), "Překvap mě", h("span", { class: "count" }, pool.length)),
      state.categories.filter((c) => counts[c.id]).map((c) =>
        h("button", { class: "tile", style: `--c:${c.color}`, onclick: () => recommend(c.id) },
          h("span", { class: "e" }, c.emoji), c.label, h("span", { class: "count" }, counts[c.id])))));
}

function recommend(categoryId) {
  let pool = state.places.filter((p) => !visited(p) && (!state.mine || isSaved(p)) && (!categoryId || p.category === categoryId));
  pool.sort((a, b) => state.me ? distTo(a) - distTo(b) : new Date(b.reel_created_at) - new Date(a.reel_created_at));
  if (!categoryId && pool.length > 1) {
    const near = pool.slice(0, 8);
    const pick = near[Math.floor(Math.random() * near.length)];
    pool = [pick, ...pool.filter((p) => p !== pick)];
  }
  const [top, ...rest] = pool;
  if (!top) return toast("Tady už máš všechno navštívené 🎉");
  openPlace(top);
  const body = $("#sheet-body");
  body.prepend(h("div", { class: "row", style: "margin-bottom:12px" },
    h("button", { class: "btn lg btn-sm", onclick: openRecommend }, icon("back"), "Typy"),
    h("button", { class: "btn lg btn-sm", onclick: () => recommend(categoryId) }, icon("dice"), "Jiný tip")));
  if (rest.length) body.append(h("div", { class: "section-label" }, "Další v okolí"), h("ul", { class: "list" }, rest.slice(0, 4).map((p) => placeItem(p, undefined, () => recommend(categoryId)))));
  $("#sheet-title").textContent = categoryId ? `Tip: ${cat(categoryId).label}` : "Tip pro tebe";
  currentSheet = "tip";
}

// ---------- přidání reelska ----------
const REEL_RE = /https?:\/\/(?:www\.|m\.)?instagram\.com\/(?:[\w.]+\/)?(?:reel|reels|p|tv)\/[A-Za-z0-9_-]{5,}[^\s]*/i;
const extractReel = (text) => (text ?? "").match(REEL_RE)?.[0] ?? null;

const STEPS = ["Kontroluji, jestli už reelsko v mapě není", "Stahuji reelsko", "AI ověřuje, že jde o cestovatelský tip", "Hledám místo na mapě", "Ukládám"];

function openAdd(prefill = "", autoSubmit = false) {
  if (!requireLogin("Přihlas se a přidávej reelska do společné mapy.")) {
    if (prefill) sessionStorage.setItem(SHARE_KEY, prefill);
    return;
  }
  const input = h("input", { type: "text", inputmode: "url", placeholder: "https://www.instagram.com/reel/…", value: extractReel(prefill) ?? prefill, autocomplete: "off" });
  const pasteBtn = h("button", { class: "btn lg", type: "button", "aria-label": "Vložit ze schránky", onclick: async () => {
    try {
      const t = window.MojeMistaApp?.readClipboard ? window.MojeMistaApp.readClipboard() : await navigator.clipboard.readText();
      if (t) { input.value = extractReel(t) ?? t.trim(); form.requestSubmit(); }
    } catch { toast("Schránka není dostupná – vlož odkaz ručně"); input.focus(); }
  } }, icon("paste"), "Vložit");
  const out = h("div");
  const submit = h("button", { class: "btn lg tint btn-block", type: "submit" }, "Přidat do mapy");
  const form = h("form", { class: "stack", onsubmit: async (e) => {
    e.preventDefault();
    const url = extractReel(input.value) ?? input.value.trim();
    if (!url) return input.focus();
    submit.disabled = true;
    const steps = h("ul", { class: "steps card" }, STEPS.map((s) => h("li", {}, h("span", { class: "dot" }), s)));
    out.replaceChildren(steps);
    let i = 0;
    const lis = [...steps.children];
    const tick = () => { lis.forEach((li, k) => { li.className = k < i ? "done" : k === i ? "active" : ""; if (k < i) li.firstChild.innerHTML = ICON.check; }); };
    tick();
    const timer = setInterval(() => { if (i < lis.length - 1) { i++; tick(); } }, 2600);
    let r;
    try {
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(SUBMIT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}`, apikey: APP_CONFIG.supabaseKey },
        body: JSON.stringify({ url }),
      });
      const text = await res.text();
      try { r = JSON.parse(text); } catch { r = { status: "error", message: `Server neodpověděl správně (HTTP ${res.status}). Zkus to za chvíli znovu.` }; }
    } catch (err) {
      r = { status: "error", message: `Spojení selhalo (${err?.message ?? "neznámá chyba"}). Zkus to znovu.` };
    }
    clearInterval(timer);
    submit.disabled = false;
    out.replaceChildren(resultView(r));
    if (r.status === "saved_new" || r.status === "saved_existing") {
      input.value = "";
      await loadPlaces();
      out.replaceChildren(resultView(r));
    }
  } },
  h("div", { class: "field-row" }, input, pasteBtn),
  submit, out,
  h("div", { class: "section-label" }, "Pravidla mapy"),
  h("ul", { class: "rules card" },
    h("li", {}, h("span", { class: "ico" }, "✈️"), h("span", {}, h("b", {}, "Jen cestovatelská reelska "), "s jedním konkrétním místem, které je ve videu vidět.")),
    h("li", {}, h("span", { class: "ico" }, "🛡️"), h("span", {}, h("b", {}, "AI kontroluje každé video. "), "Nevhodný obsah, reklamy a reelska bez místa neprojdou.")),
    h("li", {}, h("span", { class: "ico" }, "🔒"), h("span", {}, h("b", {}, "Jedno reelsko na místo na 7 dní. "), "Kdo je první, toho reelsko u místa svítí.")),
    h("li", {}, h("span", { class: "ico" }, "📲"), h("span", {}, h("b", {}, "Jak sdílet: "), "v Instagramu dej Sdílet → Kopírovat odkaz a tady Vložit. Na Androidu můžeš sdílet rovnou do aplikace."))));
  openSheet("add", "Přidat reelsko", form);
  form.noValidate = true;
  if (autoSubmit && prefill) setTimeout(() => form.requestSubmit(), 50);
}

function resultView(r) {
  const kinds = {
    saved_new: ["ok", "🎉", "Hotovo, místo je na mapě"],
    saved_existing: ["ok", "✨", "Tvoje reelsko je u místa"],
    duplicate_reel: ["info", "🔁", "Tohle reelsko už v mapě je"],
    place_locked: ["info", "🔒", "Místo je zatím obsazené"],
    rejected: ["bad", "🛡️", "Reelsko neprošlo kontrolou"],
    no_data: ["bad", "📭", "Reelsko se nepodařilo stáhnout"],
    invalid: ["bad", "🔗", "Neplatný odkaz"],
    limit: ["bad", "⏳", "Dnešní limit vyčerpán"],
    unauthorized: ["bad", "👤", "Přihlas se"],
  };
  const [kind, emoji, title] = kinds[r.status] ?? ["bad", "⚠️", "Něco se pokazilo"];
  const place = r.place_id && state.places.find((p) => p.id === r.place_id);
  return h("div", { class: `result ${kind}` },
    h("span", { class: "ico" }, emoji),
    h("div", { style: "flex:1;min-width:0" },
      h("b", {}, title),
      h("span", {}, r.message ?? ""),
      place ? h("div", { style: "margin-top:10px" }, h("button", { class: "btn lg btn-sm", onclick: () => focusPlace(place) }, icon("map"), "Ukázat na mapě")) : null));
}

// ---------- účet ----------
function openAccount(reason) {
  if (state.user) return openProfile();
  let mode = "login";
  const email = h("input", { type: "email", placeholder: "E-mail", autocomplete: "email", required: true });
  const pass = h("input", { type: "password", placeholder: "Heslo (aspoň 6 znaků)", autocomplete: "current-password", minlength: 6, required: true });
  const nick = h("input", { type: "text", placeholder: "Přezdívka (uvidí ji ostatní)", maxlength: 24, autocomplete: "nickname" });
  const err = h("p", { class: "error" });
  const submit = h("button", { class: "btn lg tint btn-block", type: "submit" }, "Přihlásit se");
  const seg = h("div", { class: "seg" });
  const setMode = (m) => {
    mode = m;
    seg.replaceChildren(
      h("button", { type: "button", class: m === "login" ? "on" : "", onclick: () => setMode("login") }, "Přihlášení"),
      h("button", { type: "button", class: m === "signup" ? "on" : "", onclick: () => setMode("signup") }, "Nový účet"));
    nick.hidden = m !== "signup";
    nick.required = m === "signup";
    pass.autocomplete = m === "signup" ? "new-password" : "current-password";
    submit.textContent = m === "signup" ? "Vytvořit účet" : "Přihlásit se";
    err.textContent = "";
  };
  setMode("login");
  const form = h("form", { class: "stack", onsubmit: async (e) => {
    e.preventDefault();
    submit.disabled = true;
    err.textContent = "";
    const { error } = mode === "signup"
      ? await sb.auth.signUp({ email: email.value.trim(), password: pass.value, options: { data: { nickname: nick.value.trim() } } })
      : await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
    submit.disabled = false;
    if (error) {
      err.textContent = /invalid login/i.test(error.message) ? "Špatný e-mail nebo heslo."
        : /already registered/i.test(error.message) ? "Účet s tímto e-mailem už existuje – přihlas se."
        : /password/i.test(error.message) ? "Heslo musí mít aspoň 6 znaků."
        : error.message;
      return;
    }
    if (currentSheet === "account") closeSheet(); // panel se sdíleným reelskem nezavírat
    toast(mode === "signup" ? "Vítej v komunitě! 🎉" : "Přihlášení proběhlo ✓");
  } }, seg, reason ? h("p", { class: "muted" }, reason) : null, email, pass, nick, err, submit);
  openSheet("account", "Účet", form,
    h("p", { class: "muted", style: "margin-top:14px;text-align:center" }, "Mapu si můžeš prohlížet i bez účtu. Účet potřebuješ na přidávání reelsek a odškrtávání míst."));
}

async function openProfile() {
  const mine = await sb.from("submissions").select("status, reason, created_at, place_id, shortcode").order("created_at", { ascending: false }).limit(20);
  const added = (mine.data ?? []).filter((s) => s.status.startsWith("saved")).length;
  const ok = (s) => s.status.startsWith("saved");
  const name = state.nickname ?? state.user.email;
  openSheet("profile", "Můj účet",
    h("div", { class: "card profile" },
      h("div", { class: "big-avatar" }, name.slice(0, 1).toUpperCase()),
      h("div", {}, h("h3", {}, name), h("p", { class: "muted" }, state.user.email))),
    h("div", { class: "stats", style: "margin-top:10px" },
      h("div", { class: "card stat" }, h("b", {}, state.visits.size), h("span", {}, "navštívených míst")),
      h("div", { class: "card stat" }, h("b", {}, added), h("span", {}, "přidaných reelsek"))),
    h("div", { class: "section-label" }, "Moje poslední reelska"),
    (mine.data ?? []).length
      ? h("ul", { class: "list history" }, mine.data.map((s) => {
        const p = s.place_id && state.places.find((x) => x.id === s.place_id);
        return h("li", { class: "item" },
          h("div", { class: "gloss sm", style: `--c:${p ? cat(p.category).color : "#94a3b8"}` }, p ? cat(p.category).emoji : ok(s) ? "📍" : "🛡️"),
          h("button", { class: "txt", onclick: () => p && focusPlace(p) },
            h("div", { class: "name" }, p?.name ?? `Reelsko ${s.shortcode ?? ""}`),
            h("div", { class: `sub ${ok(s) ? "ok" : "bad"}` }, `${fmtDate(s.created_at)} · ${s.reason}`)));
      }))
      : h("p", { class: "muted" }, "Zatím tu nic není. Tlačítkem ＋ přidáš první reelsko."),
    h("div", { style: "margin-top:16px" }, h("button", { class: "btn lg btn-block", onclick: async () => { await sb.auth.signOut(); closeSheet(); toast("Odhlášeno"); } }, "Odhlásit se")));
}

// ---------- start ----------
$("#btn-locate").addEventListener("click", () => startLocate(true));
$("#btn-list").addEventListener("click", () => openList(state.mine ? (listTab === "trips" ? "trips" : "saved") : "places"));
$("#btn-recommend").addEventListener("click", openRecommend);
$("#btn-add").addEventListener("click", () => openAdd());
$("#btn-account").addEventListener("click", () => openAccount());
$("#btn-radius").addEventListener("click", openRadius);
$("#view-community").addEventListener("click", () => state.mine && setView(false));
$("#view-mine").addEventListener("click", () => !state.mine && setView(true));
$("#sheet-close").addEventListener("click", closeSheet);
$("#sheet-back").addEventListener("click", () => window.mmBack());
$("#backdrop").addEventListener("click", closeSheet);

sb.auth.onAuthStateChange((_event, session) => {
  const was = state.user?.id;
  state.user = session?.user ?? null;
  authReady = true;
  if (was !== state.user?.id || !state.nickname) loadMine();
  handleShare();
});

// ---------- sdílení z Instagramu ----------
// Odkaz se uloží do sessionStorage, aby přežil i případné znovunačtení stránky.
const SHARE_KEY = "mm.share";
let authReady = false;
let shareBusy = false;
function handleShare() {
  const shared = sessionStorage.getItem(SHARE_KEY);
  if (!shared || shareBusy || !authReady) return;
  if (!state.user) {
    // Po přihlášení se sdílení dokončí samo (handleShare zavolá onAuthStateChange).
    if (currentSheet !== "account") openAccount("Přihlas se a reelsko se hned přidá do mapy.");
    return;
  }
  shareBusy = true;
  sessionStorage.removeItem(SHARE_KEY);
  openAdd(shared, true);
  shareBusy = false;
}

// ---------- úvodní seznámení (jen poprvé) ----------
function openOnboarding() {
  const done = () => localStorage.setItem("mm.onboarded", "1");
  const step = (emoji, title, text) => h("li", { class: "onb-step" },
    h("span", { class: "onb-ico" }, emoji),
    h("span", {}, h("b", {}, title), h("small", {}, text)));
  openSheet("onboarding", "Vítej v Mých místech",
    h("p", { class: "muted" }, "Společná mapa míst, která lidé objevili v cestovatelských reelsech na Instagramu."),
    h("ul", { class: "onb-steps" },
      step("📲", "Sdílej reelsko", "V Instagramu dej u reelska Sdílet → Moje místa, nebo zkopíruj odkaz a vlož ho tlačítkem ＋."),
      step("🛡️", "AI ho zkontroluje", "Projdou jen cestovatelská reelska s konkrétním místem. Místo se objeví na mapě všem."),
      step("⭐", "Ulož si, co tě láká", "Místa si ukládej do Mé mapy a odškrtávej ta navštívená."),
      step("🧭", "Naplánuj cestu", "Z uložených míst poskládej výlet – pěšky, MHD, autem nebo na kole, s přesnou trasou.")),
    h("div", { class: "btn-grid" },
      h("button", { class: "btn lg", onclick: () => { done(); closeSheet(); } }, "Prohlédnout mapu"),
      h("button", { class: "btn lg tint", onclick: () => { done(); openAdd(); } }, icon("plus"), "Přidat reelsko")));
  $("#sheet-close").addEventListener("click", done, { once: true });
}

function boot() {
  // Sdílení z jiné aplikace (Android: Web Share Target)
  const q = new URLSearchParams(location.search);
  const raw = [q.get("url"), q.get("text"), q.get("title")].filter(Boolean).join(" ").trim();
  const shared = extractReel(raw) ?? raw;
  if (location.search || location.hash) history.replaceState(null, "", location.pathname);
  ["mm.places", "mm.appKey"].forEach((k) => localStorage.removeItem(k));

  const cached = localStorage.getItem(CACHE);
  if (cached) { try { Object.assign(state, JSON.parse(cached)); render(); } catch { /* ignoruj */ } }
  loadPlaces();
  if (shared) {
    sessionStorage.setItem(SHARE_KEY, shared);
    toast("Reelsko přijato ✓");
  }
  handleShare();
  if (!shared && !localStorage.getItem("mm.onboarded")) setTimeout(() => { if ($("#sheet").hidden) openOnboarding(); }, 900);
  navigator.permissions?.query({ name: "geolocation" }).then((s) => { if (s.state === "granted") startLocate(false); }).catch(() => {});
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadPlaces(); });
initGlass();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => r.update()).catch(() => {});
boot();
