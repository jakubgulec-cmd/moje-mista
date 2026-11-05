// Společná logika přidání reelska (používá ji funkce submit i dočasný test).
// Pořadí kroků: limit -> je reelsko už v mapě? -> stažení -> přísná AI kontrola
// -> poloha -> existuje místo? (zámek 7 dní na nové reelsko) -> uložení.
import { createClient } from "npm:@supabase/supabase-js@2";
import { geocode, nameMatches } from "./geo.ts";
import { fetchMedia, fetchReel, parseInstagramUrl } from "./instagram.ts";
import { type Category, type ExtractedPlace, moderate } from "./moderate.ts";

export const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const LOCK_DAYS = 7;
const DAILY_LIMIT = 20;

type Status = "saved_new" | "saved_existing" | "duplicate_reel" | "place_locked" | "rejected" | "no_data" | "invalid" | "limit";

export interface Result {
  status: Status;
  message: string;
  place_id?: string;
  place_name?: string;
  until?: string;
}

export async function log(userId: string, shortcode: string | null, r: Result) {
  await db.from("submissions").insert({ user_id: userId, shortcode, status: r.status, reason: r.message, place_id: r.place_id ?? null });
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" });

// Řídce rozmístěná místa (příroda, památky…): stačí blízkost, i když se název liší jazykem.
const SPARSE = new Set(["nature", "viewpoint", "sight", "beach", "museum"]);

/** Najde už existující místo: shodný název do 15 km, řídké místo stejného typu do 800 m, cokoli stejného typu do 60 m. */
async function findSamePlace(p: ExtractedPlace, lat: number, lng: number) {
  const dLat = 0.15, dLng = 0.15 / Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
  const { data } = await db.from("places").select("id, name, alt_names, category, lat, lng")
    .gte("lat", lat - dLat).lte("lat", lat + dLat).gte("lng", lng - dLng).lte("lng", lng + dLng);
  const meters = (a: { lat: number; lng: number }) => {
    const x = (a.lng - lng) * Math.cos((lat * Math.PI) / 180), y = a.lat - lat;
    return Math.sqrt(x * x + y * y) * 111_320;
  };
  const wanted = [p.name, p.name_en].filter(Boolean);
  const named = (c: { name: string; alt_names: string[] }) =>
    [c.name, ...(c.alt_names ?? [])].some((n) => wanted.some((w) => nameMatches(w, n) || nameMatches(n, w)));
  const scored = (data ?? []).map((c) => ({ ...c, m: meters(c) })).sort((a, b) => a.m - b.m);
  return scored.find((c) => named(c) && c.m < 15_000)
    ?? scored.find((c) => c.category === p.category && SPARSE.has(p.category) && c.m < 800)
    ?? scored.find((c) => c.category === p.category && c.m < 60)
    ?? null;
}

export async function handle(userId: string | null, input: string, opts: { dryRun?: boolean } = {}): Promise<{ result: Result; shortcode: string | null; debug: string[] }> {
  const debug: string[] = [];
  const r = await run(userId, input, !!opts.dryRun, debug);
  return { ...r, debug };
}

async function run(userId: string | null, input: string, dryRun: boolean, debug: string[]): Promise<{ result: Result; shortcode: string | null }> {
  const ig = parseInstagramUrl(input);
  if (!ig) return { shortcode: null, result: { status: "invalid", message: "Tohle není odkaz na Instagram reelsko." } };

  // 1) Limit na uživatele
  if (userId) {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await db.from("submissions").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) {
    return { shortcode: ig.shortcode, result: { status: "limit", message: `Za den můžeš poslat nejvýš ${DAILY_LIMIT} reelsek. Zkus to zítra.` } };
  }
  }

  // 2) Je reelsko už v mapě? (dřív než cokoli drahého)
  const { data: dup } = await db.from("reels").select("place_id, places(name)").eq("shortcode", ig.shortcode).maybeSingle();
  if (dup && dryRun) debug.push("reelsko už v mapě je (v testu pokračuji dál)");
  if (dup && !dryRun) {
    const name = (dup.places as unknown as { name: string } | null)?.name ?? "";
    return { shortcode: ig.shortcode, result: { status: "duplicate_reel", message: `Tohle reelsko už v mapě je${name ? ` (${name})` : ""}.`, place_id: dup.place_id, place_name: name } };
  }

  // 3) Stažení popisku a videa
  const reel = await fetchReel(ig.shortcode, ig.url);
  if (reel.mediaUrl && reel.mediaKind !== "video") {
    return { shortcode: ig.shortcode, result: { status: "invalid", message: "Tohle není reelsko. Do mapy jdou jen videa (reels), ne fotky." } };
  }
  if (!reel.mediaUrl) {
    return { shortcode: ig.shortcode, result: { status: "no_data", message: "Reelsko se nepodařilo stáhnout. Je účet veřejný a odkaz správný?" } };
  }
  debug.push(`instafix: autor=${reel.author} médium=${reel.mediaKind} popisek=${reel.caption ? reel.caption.length + " znaků" : "ne"}`);
  const t0 = Date.now();
  const media = await fetchMedia(reel.mediaUrl);
  debug.push(`stažení: ${media ? Math.round(media.bytes / 1024) + " kB" : "selhalo"} za ${Date.now() - t0} ms`);
  if (!media) {
    return { shortcode: ig.shortcode, result: { status: "no_data", message: "Video reelska se nepodařilo stáhnout (možná je moc dlouhé). Zkus jiné." } };
  }

  // 4) Přísná AI kontrola
  const { data: cats } = await db.from("categories").select("id, label").order("sort");
  const verdict = await moderate(media, reel.caption, reel.author, (cats ?? []) as Category[]);
  console.log("verdict", ig.shortcode, verdict.model, verdict.accepted, verdict.failedChecks.join(","));
  debug.push(`ai: ${verdict.model} ${verdict.accepted ? "přijato" : "odmítnuto"} [${verdict.failedChecks.join(", ")}] za ${Date.now() - t0} ms`);
  if (verdict.place) debug.push(`místo: ${verdict.place.name}, ${verdict.place.city}, ${verdict.place.country} (${verdict.place.category}, ${verdict.place.confidence})`);
  if (!verdict.accepted || !verdict.place) {
    return { shortcode: ig.shortcode, result: { status: "rejected", message: verdict.reason } };
  }
  const p = verdict.place;

  // 5) Poloha – bez jisté polohy na mapu nepouštíme
  const geo = await geocode(p);
  if (geo.lat == null || geo.lng == null) {
    return { shortcode: ig.shortcode, result: { status: "rejected", message: `Místo „${p.name}“ se nepodařilo najít na mapě.` } };
  }

  // 6) Existuje místo? Nové reelsko jen jednou za 7 dní.
  debug.push(`poloha: ${geo.precision} ${geo.lat?.toFixed(5)}, ${geo.lng?.toFixed(5)}`);
  const same = await findSamePlace(p, geo.lat, geo.lng);
  debug.push(`shoda s existujícím místem: ${same ? same.name : "ne"}`);
  let placeId: string;
  let status: Status = "saved_new";
  if (same) {
    const { data: last } = await db.from("reels").select("created_at").eq("place_id", same.id).eq("hidden", false)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last) {
      const until = new Date(new Date(last.created_at).getTime() + LOCK_DAYS * 86_400_000);
      if (until > new Date()) {
        return {
          shortcode: ig.shortcode,
          result: { status: "place_locked", message: `${same.name} už v mapě má reelsko. Nové sem jde přidat od ${fmtDate(until.toISOString())}.`, place_id: same.id, place_name: same.name, until: until.toISOString() },
        };
      }
    }
    placeId = same.id;
    status = "saved_existing";
    const names = [...new Set([...(same.alt_names ?? []), p.name, p.name_en].filter(Boolean))];
    if (!dryRun) await db.from("places").update({ alt_names: names }).eq("id", same.id);
  } else if (dryRun) {
    placeId = "dry-run";
  } else {
    const { data: created, error } = await db.from("places").insert({
      name: p.name.trim(),
      alt_names: [...new Set([p.name.trim(), p.name_en?.trim()].filter(Boolean))],
      category: p.category,
      description: p.description || null,
      address: p.address || geo.address,
      city: p.city || null,
      country: p.country || null,
      lat: geo.lat,
      lng: geo.lng,
      geo_precision: geo.precision,
    }).select("id").single();
    if (error) throw error;
    placeId = created.id;
  }

  if (dryRun) {
    return { shortcode: ig.shortcode, result: { status, message: `[test] ${status}: ${p.name}`, place_id: placeId, place_name: p.name } };
  }

  // 7) Uložení reelska (unikátní shortcode chrání i před souběžným odesláním)
  const { error: reelError } = await db.from("reels").insert({
    place_id: placeId,
    shortcode: ig.shortcode,
    url: ig.url,
    ig_author: reel.author,
    caption: reel.caption?.slice(0, 2000) ?? null,
    thumbnail_url: reel.mediaKind === "image" ? reel.mediaUrl : null,
    submitted_by: userId,
  });
  if (reelError) {
    if (status === "saved_new") await db.from("places").delete().eq("id", placeId);
    if (reelError.code === "23505") return { shortcode: ig.shortcode, result: { status: "duplicate_reel", message: "Tohle reelsko už v mapě je." } };
    throw reelError;
  }

  return {
    shortcode: ig.shortcode,
    result: {
      status,
      message: status === "saved_new" ? `${p.name} je nově na mapě. Díky!` : `${p.name} má teď tvoje reelsko. Díky!`,
      place_id: placeId,
      place_name: p.name,
    },
  };
}

