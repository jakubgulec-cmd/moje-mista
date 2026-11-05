// Veřejné informace o reelsku bez přihlášení.
// Instagram nepřihlášeným požadavkům popisky ani video nevydá, proto používáme
// InstaFix (open-source proxy pro náhledy odkazů): vrací popisek, autora a video/obrázek.

export interface ReelInfo {
  shortcode: string;
  url: string;
  caption: string | null;
  author: string | null;
  mediaUrl: string | null;
  mediaKind: "video" | "image" | null;
}

export interface Media {
  bytes: Uint8Array;
  mimeType: string;
}

const URL_RE = /https?:\/\/(?:www\.|m\.)?instagram\.com\/(?:[\w.]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{5,})/i;
// Zdroj jde vyměnit bez úpravy kódu (secret INSTAFIX_HOST), kdyby služba přestala fungovat.
const INSTAFIX = Deno.env.get("INSTAFIX_HOST") ?? "https://uuinstagram.com";
// Video/obrázek stahujeme jen z těchto domén (ochrana proti podvrženým adresám).
const MEDIA_HOSTS = [new URL(INSTAFIX).hostname, "cdninstagram.com", "fbcdn.net", "instagram.com"];
const allowedMedia = (u: string) => {
  try {
    const { protocol, hostname } = new URL(u);
    return protocol === "https:" && MEDIA_HOSTS.some((h) => hostname === h || hostname.endsWith("." + h));
  } catch {
    return false;
  }
};
const BOT_UA = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)";
const MAX_MEDIA_BYTES = 40_000_000; // delší videa už nemá smysl kontrolovat

export function parseInstagramUrl(text: string): { shortcode: string; url: string } | null {
  const m = text.match(URL_RE);
  return m ? { shortcode: m[1], url: `https://www.instagram.com/reel/${m[1]}/` } : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function meta(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, "i");
  const m = html.match(re);
  return m ? decodeEntities(m[1]) : null;
}

export async function fetchReel(shortcode: string, url: string): Promise<ReelInfo> {
  const info: ReelInfo = { shortcode, url, caption: null, author: null, mediaUrl: null, mediaKind: null };
  try {
    const res = await fetch(`${INSTAFIX}/p/${shortcode}/`, {
      headers: { "User-Agent": BOT_UA },
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return info;
    const html = await res.text();
    info.caption = meta(html, "og:description")?.trim() || null;
    info.author = meta(html, "twitter:title")?.replace(/^@/, "").trim() || null;
    const video = meta(html, "og:video") ?? meta(html, "twitter:player:stream");
    const image = meta(html, "og:image");
    if (video) {
      info.mediaUrl = new URL(video, INSTAFIX).toString();
      info.mediaKind = "video";
    } else if (image) {
      info.mediaUrl = new URL(image, INSTAFIX).toString();
      info.mediaKind = "image";
    }
  } catch {
    // vrátíme, co máme
  }
  return info;
}

/** Stáhne video nebo obrázek pro AI kontrolu. */
export async function fetchMedia(url: string): Promise<Media | null> {
  if (!allowedMedia(url)) return null;
  try {
    const res = await fetch(url, { headers: { "User-Agent": BOT_UA }, signal: AbortSignal.timeout(40000) });
    if (!res.ok || !allowedMedia(res.url)) return null;
    const mimeType = res.headers.get("content-type")?.split(";")[0] ?? "";
    if (!mimeType.startsWith("video/") && !mimeType.startsWith("image/")) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_MEDIA_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > MAX_MEDIA_BYTES) return null;
    return { bytes, mimeType };
  } catch {
    return null;
  }
}
