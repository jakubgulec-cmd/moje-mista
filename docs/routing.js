// Přesné trasy pro úseky cesty (zdarma, bez klíče):
//  - auto / motorka / kolo / chůze: OSRM servery FOSSGIS nad OpenStreetMap (routing.openstreetmap.de)
//  - MHD: Transitous (otevřené vyhledávání spojů z jízdních řádů, MOTIS)
// Výsledek: úseky s geometrií (pro mapu), skutečná vzdálenost a čas, u MHD linky a odjezd.

const OSRM = {
  walking: "https://routing.openstreetmap.de/routed-foot/route/v1/foot",
  bicycling: "https://routing.openstreetmap.de/routed-bike/route/v1/bike",
  driving: "https://routing.openstreetmap.de/routed-car/route/v1/driving",
  "two-wheeler": "https://routing.openstreetmap.de/routed-car/route/v1/driving",
};
const TRANSIT = "https://api.transitous.org/api/v5/plan";
const CACHE_PREFIX = "mm.route.";
const TTL = { transit: 30 * 60 * 1000, other: 7 * 24 * 3600 * 1000 };

export function decodePolyline(str, precision = 5) {
  const factor = 10 ** precision;
  const coords = [];
  let lat = 0, lng = 0, i = 0;
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let result = 0, shift = 0, b;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta; else lng += delta;
    }
    coords.push([lat / factor, lng / factor]);
  }
  return coords;
}

const key = (mode, a, b) => `${CACHE_PREFIX}${mode}:${a.lat.toFixed(5)},${a.lng.toFixed(5)}>${b.lat.toFixed(5)},${b.lng.toFixed(5)}`;

function fromCache(k, mode) {
  try {
    const v = JSON.parse(localStorage.getItem(k));
    if (v && Date.now() - v.t < (mode === "transit" ? TTL.transit : TTL.other)) return v.r;
  } catch { /* ignoruj */ }
  return null;
}
function toCache(k, r) {
  try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), r })); } catch { /* plné úložiště – nevadí */ }
}

async function osrm(mode, a, b) {
  const url = `${OSRM[mode]}/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=polyline6&steps=false`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`routing ${res.status}`);
  const d = await res.json();
  const r = d.routes?.[0];
  if (!r) throw new Error("trasa nenalezena");
  return {
    km: r.distance / 1000,
    min: Math.round(r.duration / 60),
    segments: [{ coords: decodePolyline(r.geometry, 6), kind: mode }],
    exact: true,
  };
}

const TRANSIT_EMOJI = { BUS: "🚌", COACH: "🚌", TRAM: "🚋", SUBWAY: "🚇", METRO: "🚇", RAIL: "🚆", REGIONAL_RAIL: "🚆", REGIONAL_FAST_RAIL: "🚆", LONG_DISTANCE: "🚄", HIGHSPEED_RAIL: "🚄", NIGHT_RAIL: "🚆", SUBURBAN: "🚆", FERRY: "⛴️", FUNICULAR: "🚞", AERIAL_LIFT: "🚡", CABLE_CAR: "🚡" };

async function transit(a, b) {
  const url = `${TRANSIT}?fromPlace=${a.lat},${a.lng}&toPlace=${b.lat},${b.lng}&time=${new Date().toISOString()}&numItineraries=3`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`transit ${res.status}`);
  const d = await res.json();
  const it = (d.itineraries ?? []).slice().sort((x, y) => new Date(x.endTime) - new Date(y.endTime))[0];
  if (!it) throw new Error("spojení nenalezeno");
  let km = 0;
  const segments = [];
  const lines = [];
  for (const l of it.legs) {
    const coords = l.legGeometry?.points ? decodePolyline(l.legGeometry.points, l.legGeometry.precision ?? 6) : [[l.from.lat, l.from.lon], [l.to.lat, l.to.lon]];
    km += (l.distance ?? 0) / 1000;
    if (l.mode === "WALK") {
      segments.push({ coords, kind: "walking" });
    } else {
      const name = l.routeShortName || l.displayName || "";
      segments.push({ coords, kind: "transit", color: l.routeColor ? `#${l.routeColor}` : "#2563eb", label: name });
      lines.push(`${TRANSIT_EMOJI[l.mode] ?? "🚍"} ${name}`.trim());
    }
  }
  if (!km) km = segments.reduce((s, seg) => s + pathKm(seg.coords), 0);
  const dep = new Date(it.startTime);
  return {
    km,
    min: Math.round(it.duration / 60),
    segments,
    exact: true,
    transit: {
      lines,
      transfers: it.transfers ?? Math.max(0, lines.length - 1),
      departure: dep.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" }),
      walkOnly: !lines.length,
    },
  };
}

function pathKm(coords) {
  let km = 0;
  for (let i = 1; i < coords.length; i++) {
    const [la1, lo1] = coords[i - 1], [la2, lo2] = coords[i];
    const r = Math.PI / 180, dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
    const x = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
    km += 2 * 6371 * Math.asin(Math.sqrt(x));
  }
  return km;
}

/** Přesná trasa úseku. Při chybě vrátí null (volající ukáže odhad a rovnou čáru). */
export async function routeLeg(a, b, mode) {
  const k = key(mode, a, b);
  const cached = fromCache(k, mode);
  if (cached) return cached;
  try {
    const r = mode === "transit" ? await transit(a, b) : await osrm(mode, a, b);
    toCache(k, r);
    return r;
  } catch (e) {
    console.warn("trasa", mode, e?.message ?? e);
    return null;
  }
}
