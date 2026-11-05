// Převod názvu místa na souřadnice z dat OpenStreetMap (zdarma, bez klíče).
// Primárně Photon (komoot) – Nominatim blokuje IP adresy cloudových serverů.
// Pravidla: max. 1 dotaz za sekundu, vlastní User-Agent.
import type { ExtractedPlace } from "./moderate.ts";

export interface GeoResult {
  lat: number | null;
  lng: number | null;
  precision: "exact" | "approx" | "none";
  address: string | null;
}

const UA = "mapinstabot/1.0 (personal place map)";
let lastCall = 0;
let nominatimBlocked = false;

interface Hit { lat: number; lng: number; display: string; type: string; name: string }

// Obecná slova, která v názvu nic nerozlišují ("Café Savoy" vs. "Café V Parku").
const GENERIC = new Set([
  "cafe", "caffe", "coffee", "kavarna", "restaurace", "restaurant", "restaurante", "ristorante", "bistro", "bar",
  "pub", "hospoda", "the", "la", "le", "el", "il", "da", "de", "do", "di", "a", "and", "u", "v", "na", "hotel",
  "pizzeria", "bakery", "pekarna", "cukrarna", "shop", "store", "museum", "muzeum",
]);
const tokens = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !GENERIC.has(t));

/** Shoduje se nalezené místo s hledaným názvem? Stačí jedno společné rozlišující slovo. */
export function nameMatches(wanted: string, found: string): boolean {
  const w = tokens(wanted);
  if (!w.length) return true;
  const f = new Set(tokens(found));
  return w.some((t) => f.has(t));
}

async function throttle() {
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

const PHOTON_AREA = new Set(["city", "district", "county", "state", "country", "locality"]);

async function photon(q: string, wanted: string, near?: { lat: number; lng: number }): Promise<Hit | null> {
  await throttle();
  try {
    const bias = near ? `&lat=${near.lat}&lon=${near.lng}` : "";
    const url = `https://photon.komoot.io/api/?limit=5${bias}&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      geoLog.push(`photon ${res.status} pro "${q}"`);
      return null;
    }
    const data = await res.json();
    const hits: Hit[] = (data.features ?? []).map((f: { geometry: { coordinates: number[] }; properties: Record<string, string> }) => {
      const p = f.properties;
      const street = [p.street, p.housenumber].filter(Boolean).join(" ");
      return {
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        display: [p.name, street, p.city ?? p.town ?? p.village, p.country].filter(Boolean).join(", "),
        // Sjednocení s Nominatim: oblasti označíme jako "city", ostatní jako bod.
        type: PHOTON_AREA.has(p.type) ? "city" : (p.osm_value ?? "poi"),
        name: p.name ?? "",
      };
    }).filter((h: Hit) => nameMatches(wanted, h.name));
    geoLog.push(`photon "${q}" -> ${hits.length} shod`);
    if (!hits.length) return null;
    if (near) hits.sort((a, b) => dist2(a, near) - dist2(b, near));
    return hits[0];
  } catch (e) {
    geoLog.push(`photon chyba: ${e}`);
    return null;
  }
}

async function lookup(q: string, wanted: string, near?: { lat: number; lng: number }): Promise<Hit | null> {
  return (await photon(q, wanted, near)) ?? (nominatimBlocked ? null : await nominatim(q, wanted, near));
}

async function nominatim(q: string, wanted: string, near?: { lat: number; lng: number }): Promise<Hit | null> {
  await throttle();
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=0&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "cs,en" }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      if (res.status === 403) nominatimBlocked = true;
      geoLog.push(`nominatim ${res.status} pro "${q}"`);
      return null;
    }
    const hits: Hit[] = (await res.json()).map((h: Record<string, string>) => ({
      lat: Number(h.lat), lng: Number(h.lon), display: h.display_name, type: h.addresstype ?? h.type, name: h.name ?? h.display_name,
    })).filter((h: Hit) => nameMatches(wanted, h.name));
    geoLog.push(`"${q}" -> ${hits.length} výsledků`);
    if (!hits.length) return null;
    // Víc poboček stejného jména -> vezmi tu nejbližší odhadu od AI.
    if (near) hits.sort((a, b) => dist2(a, near) - dist2(b, near));
    return hits[0];
  } catch (e) {
    geoLog.push(`nominatim chyba: ${e}`);
    return null;
  }
}

export const geoLog: string[] = [];

const dist2 = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  (a.lat - b.lat) ** 2 + ((a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180)) ** 2;

const AREA_TYPES = new Set(["city", "town", "village", "municipality", "county", "state", "country", "suburb", "region"]);

export async function geocode(p: ExtractedPlace): Promise<GeoResult> {
  const near = p.approx_lat != null && p.approx_lng != null ? { lat: p.approx_lat, lng: p.approx_lng } : undefined;
  const queries = [
    p.search_query,
    [p.name, p.address, p.city].filter(Boolean).join(", "),
    [p.name, p.neighborhood, p.city].filter(Boolean).join(", "),
    [p.name, p.city].filter(Boolean).join(", "),
  ].filter((q, i, all) => q && all.indexOf(q) === i);

  for (const q of queries) {
    const hit = await lookup(q, p.name, near);
    // Výsledek daleko od odhadu AI (> ~30 km) je nejspíš jiné místo stejného jména.
    if (hit && near && dist2(hit, near) > 0.08) continue;
    // Když hledání názvu vrátí jen celé město, není to přesná poloha podniku.
    if (hit && !AREA_TYPES.has(hit.type)) return { lat: hit.lat, lng: hit.lng, precision: "exact", address: hit.display };
  }

  // Odhad AI bereme jen při vysoké jistotě. Střed města jako náhradní poloha nestačí.
  if (p.approx_lat != null && p.approx_lng != null && p.confidence === "high") {
    return { lat: p.approx_lat, lng: p.approx_lng, precision: "approx", address: null };
  }
  return { lat: null, lng: null, precision: "none", address: null };
}
