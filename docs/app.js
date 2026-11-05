/* global L, APP_CONFIG */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm";
import { initGlass } from "./glass.js?v=202611051352";

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
  filter: new Set(),       // prázdné = všechny kategorie
  visitFilter: "all",      // all | todo | done
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

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2800);
}

// ---------- diagnostika (dočasně): co aplikace dostala ----------
function clog(kind, detail) {
  try { sb.from("client_log").insert({ kind, detail: typeof detail === "string" ? detail.slice(0, 2000) : JSON.stringify(detail).slice(0, 2000) }).then(() => {}); } catch { /* ignoruj */ }
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
  state.nickname = null;
  if (state.user) {
    const [v, p] = await Promise.all([
      sb.from("visits").select("place_id"),
      sb.from("profiles").select("nickname").eq("id", state.user.id).maybeSingle(),
    ]);
    state.visits = new Set((v.data ?? []).map((x) => x.place_id));
    state.nickname = p.data?.nickname ?? null;
  }
  renderAccountButton();
  render();
}

// ---------- mapa ----------
const map = L.map("map", { zoomControl: false, worldCopyJump: true, minZoom: 2, maxZoom: 19 }).setView([48.5, 14], 4);
L.maplibreGL({
  style: "https://tiles.openfreemap.org/styles/liberty",
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
    html: `<div class="pin-wrap">${v ? `<div class="pin-check">${ICON.check}</div>` : ""}<div class="pin ${v ? "visited" : ""}" style="--c:${c.color}"><span>${c.emoji}</span></div></div>`,
    iconSize: [44, 50],
    iconAnchor: [22, 47],
  });
}

function visiblePlaces() {
  return state.places.filter((p) => {
    if (state.filter.size && !state.filter.has(p.category)) return false;
    if (state.visitFilter === "todo" && visited(p)) return false;
    if (state.visitFilter === "done" && !visited(p)) return false;
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
  const shown = visiblePlaces().length;
  $("#brand-sub").textContent = !state.loaded && !total ? "Načítám…"
    : shown !== total ? `${plural(shown, "místo", "místa", "míst")} z ${total}`
    : `${plural(total, "místo", "místa", "míst")} od komunity`;
  const rb = $("#btn-radius");
  rb.classList.toggle("tint", !!state.radiusKm);
  rb.classList.toggle("lens", !state.radiusKm);
  rb.classList.toggle("on", !!state.radiusKm);
  $("#radius-label").textContent = state.radiusKm ? `Do ${state.radiusKm} km` : "Všude";
}

function renderChips() {
  const box = $("#chips");
  box.replaceChildren();
  if (!state.places.length) return;
  const counts = {};
  for (const p of state.places) counts[p.category] = (counts[p.category] ?? 0) + 1;
  box.append(h("button", { class: `chip lg all ${state.filter.size ? "lens" : "on"}`, onclick: () => { state.filter.clear(); render(); } },
    "Vše", h("span", { class: "count" }, state.places.length)));
  for (const c of state.categories) {
    if (!counts[c.id]) continue;
    box.append(h("button", {
      class: `chip lg ${state.filter.has(c.id) ? "on" : "lens"}`, style: `--c:${c.color}`,
      onclick: () => { state.filter.has(c.id) ? state.filter.delete(c.id) : state.filter.add(c.id); render(); },
    }, `${c.emoji} ${c.label}`, h("span", { class: "count" }, counts[c.id])));
  }
  if (state.user) {
    const next = { all: "todo", todo: "done", done: "all" };
    const label = { all: "Navštívené i nenavštívené", todo: "Kde jsem nebyl", done: "Kde jsem byl" };
    box.append(h("button", {
      class: `chip lg ${state.visitFilter !== "all" ? "on" : "lens"}`, style: "--c:#16a34a",
      onclick: () => { state.visitFilter = next[state.visitFilter]; render(); },
    }, state.visitFilter === "done" ? "✓ " : "", label[state.visitFilter]));
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
function openSheet(name, title, ...content) {
  currentSheet = name;
  $("#sheet-title").textContent = title;
  $("#sheet-body").replaceChildren(...content);
  $("#sheet-body").scrollTop = 0;
  $("#sheet").hidden = false;
  $("#backdrop").hidden = false;
}
// Nativní aplikace: tlačítko Zpět nejdřív zavře otevřený panel.
window.mmBack = () => {
  if (!$("#sheet").hidden) { closeSheet(); return true; }
  return false;
};
function closeSheet() {
  currentSheet = null;
  $("#sheet-body").querySelectorAll("video").forEach((v) => v.pause());
  $("#sheet").hidden = true;
  $("#backdrop").hidden = true;
}

function requireLogin(reason) {
  if (state.user) return true;
  openAccount(reason);
  return false;
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
  box.append(video, play,
    h("a", { class: "author lg lens", href: p.reel_url, target: "_blank", rel: "noopener" },
      h("span", { class: "ig", html: ICON.ig }),
      h("span", {}, p.ig_author ? `@${p.ig_author}` : "Instagram", h("small", {}, "Otevřít reelsko na Instagramu"))));
  return box;
}

function openPlace(p) {
  const c = cat(p.category);
  const d = distTo(p);
  const locked = new Date(p.next_slot_at) > new Date();
  const visitBtn = h("button", { class: `btn ${visited(p) ? "on" : "lg"}` }, icon("check"), visited(p) ? "Byl jsem tu" : "Označit jako navštívené");
  visitBtn.addEventListener("click", async () => {
    if (!requireLogin("Přihlas se a odškrtávej místa, kde jsi byl.")) return;
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
    toast(was ? "Odebráno z navštívených" : "Super, máš o místo víc ✓");
  });

  openSheet("place", c.label,
    h("div", { class: "place-head" },
      h("div", { class: "gloss lgx", style: `--c:${c.color}` }, c.emoji),
      h("div", {},
        h("h3", {}, p.name),
        h("div", { class: "meta" }, [p.city, p.country, d != null && fmtDist(d)].filter(Boolean).join(" · ")))),
    reelView(p),
    p.description && h("p", { class: "place-desc" }, p.description),
    h("div", { class: `slot ${locked ? "" : "free"}` },
      icon(locked ? "lock" : "spark"),
      h("span", {},
        `${p.contributor ? `Přidáno uživatelem ${p.contributor}` : "Přidáno komunitou"} ${fmtDate(p.reel_created_at)}. `,
        locked ? `Nové reelsko k tomuto místu jde přidat od ${fmtDate(p.next_slot_at)}.` : "Místo je volné – přidej sem své reelsko a zviditelni se.")),
    h("div", { class: "row grow", style: "margin-top:14px" },
      h("a", { class: "btn lg tint", href: navUrl(p), target: "_blank", rel: "noopener" }, icon("nav"), "Navigovat"),
      visitBtn),
    h("div", { style: "text-align:center;margin-top:6px" },
      h("button", { class: "btn btn-text", onclick: () => report(p) }, icon("flag"), "Nahlásit nevhodné reelsko")),
  );
}

async function report(p) {
  if (!requireLogin("Pro nahlášení se přihlas.")) return;
  if (!confirm(`Nahlásit reelsko u místa „${p.name}“ jako nevhodné?`)) return;
  const { error } = await sb.from("reports").insert({ reel_id: p.reel_id, reason: "nevhodné" });
  toast(error?.code === "23505" ? "Tohle už jsi nahlásil" : error ? "Nahlášení se nepovedlo" : "Díky, podíváme se na to. Po 3 nahlášeních reelsko zmizí.");
}

function focusPlace(p) {
  closeSheet();
  if (state.filter.size && !state.filter.has(p.category)) state.filter.clear();
  state.visitFilter = "all";
  render();
  map.flyTo([p.lat, p.lng], 15, { duration: 0.8 });
  map.once("moveend", () => openPlace(p));
}

// ---------- seznam ----------
function placeItem(p, sub) {
  const c = cat(p.category);
  const d = distTo(p);
  return h("li", { class: `item ${visited(p) ? "visited" : ""}` },
    h("div", { class: "gloss sm", style: `--c:${c.color}` }, c.emoji),
    h("button", { class: "txt", onclick: () => focusPlace(p) },
      h("div", { class: "name" }, p.name),
      h("div", { class: "sub" }, sub ?? [c.label, p.city, p.country].filter(Boolean).join(" · "))),
    d != null ? h("span", { class: "pill" }, fmtDist(d)) : null,
    h("a", { class: "nav-btn", href: navUrl(p), target: "_blank", rel: "noopener", "aria-label": "Navigovat", html: ICON.nav }));
}

let listSort = "near";
function openList() {
  const items = visiblePlaces().slice();
  const near = listSort === "near" && state.me;
  items.sort((a, b) => near ? distTo(a) - distTo(b) : new Date(b.reel_created_at) - new Date(a.reel_created_at));
  openSheet("list", "Místa",
    h("div", { class: "seg" },
      h("button", { class: listSort === "near" ? "on" : "", onclick: () => { listSort = "near"; if (!state.me) startLocate(false); openList(); } }, "Nejblíž"),
      h("button", { class: listSort === "new" ? "on" : "", onclick: () => { listSort = "new"; openList(); } }, "Nejnovější")),
    listSort === "near" && !state.me ? h("p", { class: "muted" }, "Zjišťuji polohu… Zatím řadím od nejnovějších.") : null,
    items.length ? h("ul", { class: "list" }, items.map((p) => placeItem(p)))
      : h("div", { class: "empty-note" }, h("div", { class: "orb" }, "🗺️"), "Tady zatím nic není. Zkus zvětšit vzdálenost nebo zrušit filtr."));
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
  const pool = state.places.filter((p) => !visited(p));
  const counts = {};
  for (const p of pool) counts[p.category] = (counts[p.category] ?? 0) + 1;
  openSheet("tips", "Kam dnes?",
    h("p", { class: "muted" }, state.me ? "Vyber typ a doporučím nejbližší místo, kde jsi ještě nebyl." : "Zjišťuji polohu… Bez ní doporučím nejnovější místa."),
    h("div", { class: "grid" },
      h("button", { class: "tile any", disabled: !pool.length, onclick: () => recommend(null) },
        h("span", { class: "e" }, "🎲"), "Překvap mě", h("span", { class: "count" }, pool.length)),
      state.categories.filter((c) => counts[c.id]).map((c) =>
        h("button", { class: "tile", style: `--c:${c.color}`, onclick: () => recommend(c.id) },
          h("span", { class: "e" }, c.emoji), c.label, h("span", { class: "count" }, counts[c.id])))));
}

function recommend(categoryId) {
  let pool = state.places.filter((p) => !visited(p) && (!categoryId || p.category === categoryId));
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
  if (rest.length) body.append(h("div", { class: "section-label" }, "Další v okolí"), h("ul", { class: "list" }, rest.slice(0, 4).map((p) => placeItem(p))));
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
    clog("submit", { url, status: r.status, message: r.message });
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
    toast(mode === "signup" ? "Vítej v komunitě! 🎉" : "Jsi přihlášený");
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
      : h("p", { class: "muted" }, "Zatím jsi nic nepřidal. Tlačítkem ＋ přidáš první reelsko."),
    h("div", { style: "margin-top:16px" }, h("button", { class: "btn lg btn-block", onclick: async () => { await sb.auth.signOut(); closeSheet(); toast("Odhlášeno"); } }, "Odhlásit se")));
}

// ---------- start ----------
$("#btn-locate").addEventListener("click", () => startLocate(true));
$("#btn-list").addEventListener("click", openList);
$("#btn-recommend").addEventListener("click", openRecommend);
$("#btn-add").addEventListener("click", () => openAdd());
$("#btn-account").addEventListener("click", () => openAccount());
$("#btn-radius").addEventListener("click", openRadius);
$("#sheet-close").addEventListener("click", closeSheet);
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
  clog("share", { shared, user: !!state.user, sheet: currentSheet });
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

function boot() {
  // Sdílení z jiné aplikace (Android: Web Share Target)
  const q = new URLSearchParams(location.search);
  const raw = [q.get("url"), q.get("text"), q.get("title")].filter(Boolean).join(" ").trim();
  const shared = extractReel(raw) ?? raw;
  clog("launch", { href: location.href, referrer: document.referrer, standalone: matchMedia("(display-mode: standalone)").matches, ua: navigator.userAgent, raw, shared });
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
  navigator.permissions?.query({ name: "geolocation" }).then((s) => { if (s.state === "granted") startLocate(false); }).catch(() => {});
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadPlaces(); });
initGlass();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => r.update()).catch(() => {});
boot();
