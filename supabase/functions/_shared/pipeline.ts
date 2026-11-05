// Celý tok: text (odkaz na reelsko nebo ruční popis) -> místa uložená v databázi.
import { createClient } from "npm:@supabase/supabase-js@2";
import { extractPlaces } from "./ai.ts";
import { geocode } from "./geo.ts";
import { fetchImageBase64, fetchReel, findInstagramUrl, type ReelInfo } from "./instagram.ts";

export const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

export interface Place {
  id: string;
  name: string;
  category: string;
  description: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  geo_precision: "exact" | "approx" | "none";
  source_url: string | null;
  source_text: string | null;
  thumbnail_url: string | null;
  visited: boolean;
  created_at: string;
}

export interface ProcessResult {
  // saved = něco uloženo; no_place = podklady máme, ale místo nejde určit;
  // no_data = z Instagramu se nepodařilo nic stáhnout
  status: "saved" | "no_place" | "no_data";
  places: Place[];
  duplicates: Place[];
  reel: Pick<ReelInfo, "url" | "method" | "author" | "location"> & { hasCaption: boolean } | null;
}

export async function processInput(raw: string): Promise<ProcessResult> {
  const text = raw.trim();
  const ig = findInstagramUrl(text);
  let reel: ReelInfo | null = null;
  let userText: string | null = text;
  let image = null;

  if (ig) {
    reel = await fetchReel(ig.url, ig.shortcode);
    userText = text.replace(ig.url, "").trim() || null;
    if (reel.thumbnailUrl) image = await fetchImageBase64(reel.thumbnailUrl);
  }

  const reelSummary = reel
    ? { url: reel.url, method: reel.method, author: reel.author, location: reel.location, hasCaption: !!reel.caption }
    : null;

  const hasData = !!(userText || reel?.caption || reel?.location || image);
  if (!hasData) return { status: "no_data", places: [], duplicates: [], reel: reelSummary };

  const found = await extractPlaces({
    caption: reel?.caption ?? null,
    location: reel?.location ?? null,
    author: reel?.author ?? null,
    userText,
    image,
  });
  if (found.length === 0) return { status: reel && !reel.caption && !userText ? "no_data" : "no_place", places: [], duplicates: [], reel: reelSummary };

  const sourceUrl = reel ? `https://www.instagram.com/reel/${reel.shortcode}/` : null;
  const saved: Place[] = [];
  const duplicates: Place[] = [];

  for (const p of found) {
    const existing = await findExisting(p.name, p.city, sourceUrl);
    if (existing) {
      duplicates.push(existing);
      continue;
    }
    const geo = await geocode(p);
    const { data, error } = await db.from("places").insert({
      name: p.name.trim(),
      category: p.category,
      description: p.description || null,
      address: p.address || geo.address,
      city: p.city || null,
      country: p.country || null,
      lat: geo.lat,
      lng: geo.lng,
      geo_precision: geo.precision,
      source_url: sourceUrl,
      source_text: reel?.caption?.slice(0, 2000) ?? userText,
      thumbnail_url: reel?.thumbnailUrl ?? null,
    }).select().single();
    if (error) throw error;
    saved.push(data as Place);
  }

  return { status: saved.length || duplicates.length ? "saved" : "no_place", places: saved, duplicates, reel: reelSummary };
}

async function findExisting(name: string, city: string, sourceUrl: string | null): Promise<Place | null> {
  let q = db.from("places").select("*").ilike("name", name.trim()).limit(1);
  q = sourceUrl ? q.eq("source_url", sourceUrl) : q.ilike("city", city || "%");
  const { data } = await q;
  return (data?.[0] as Place) ?? null;
}

export async function getSetting(key: string): Promise<string | null> {
  const { data } = await db.from("app_settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const { error } = await db.from("app_settings").upsert({ key, value });
  if (error) throw error;
}
