// Převod názvu místa na souřadnice přes OpenStreetMap Nominatim (zdarma, bez klíče).
// Pravidla Nominatim: max. 1 dotaz za sekundu, vlastní User-Agent.
import type { ExtractedPlace } from "./ai.ts";

export interface GeoResult {
  lat: number | null;
  lng: number | null;
  precision: "exact" | "approx" | "none";
  address: string | null;
}

const UA = "mapinstabot/1.0 (personal place map)";
let lastCall = 0;

interface Hit { lat: number; lng: number; display: string; type: string }

async function nominatim(q: string, near?: { lat: number; lng: number }): Promise<Hit | null> {
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&addressdetails=0&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "cs,en" }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const hits: Hit[] = (await res.json()).map((h: Record<string, string>) => ({
      lat: Number(h.lat), lng: Number(h.lon), display: h.display_name, type: h.addresstype ?? h.type,
    }));
    if (!hits.length) return null;
    // Víc poboček stejného jména -> vezmi tu nejbližší odhadu od AI.
    if (near) hits.sort((a, b) => dist2(a, near) - dist2(b, near));
    return hits[0];
  } catch {
    return null;
  }
}

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
    const hit = await nominatim(q, near);
    // Výsledek daleko od odhadu AI (> ~30 km) je nejspíš jiné místo stejného jména.
    if (hit && near && dist2(hit, near) > 0.08) continue;
    // Když hledání názvu vrátí jen celé město, není to přesná poloha podniku.
    if (hit && !AREA_TYPES.has(hit.type)) return { lat: hit.lat, lng: hit.lng, precision: "exact", address: hit.display };
  }

  if (p.approx_lat != null && p.approx_lng != null && p.confidence !== "low") {
    return { lat: p.approx_lat, lng: p.approx_lng, precision: "approx", address: null };
  }

  const area = [p.city, p.country].filter(Boolean).join(", ");
  if (area) {
    const hit = await nominatim(area);
    if (hit) return { lat: hit.lat, lng: hit.lng, precision: "approx", address: null };
  }
  return { lat: null, lng: null, precision: "none", address: null };
}
