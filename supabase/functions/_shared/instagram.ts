// Získání veřejných informací o reelsku bez přihlášení.
// Instagram nemá veřejné API pro cizí příspěvky, takže zkoušíme veřejné stránky
// (embed a meta tagy). Když selžou, pipeline pracuje jen s tím, co máme.

export interface ReelInfo {
  url: string;
  shortcode: string;
  caption: string | null;
  author: string | null;
  location: string | null;
  thumbnailUrl: string | null;
  method: string[]; // které zdroje vrátily data (pro ladění)
}

const URL_RE = /https?:\/\/(?:www\.|m\.)?instagram\.com\/(?:[\w.]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)[^\s]*/i;

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  "Accept-Language": "cs,en;q=0.8",
  Accept: "text/html,application/xhtml+xml",
};

export function findInstagramUrl(text: string): { url: string; shortcode: string } | null {
  const m = text.match(URL_RE);
  return m ? { url: m[0], shortcode: m[1] } : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function htmlToText(s: string): string {
  return decodeEntities(s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).trim();
}

function meta(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, "i");
  const m = html.match(re);
  return m ? decodeEntities(m[1]) : null;
}

/** Název místa z JSONu ve stránce (štítek polohy u příspěvku). */
function locationFromJson(html: string): string | null {
  const unescaped = html.replace(/\\"/g, '"');
  const m = unescaped.match(/"location":\{[^{}]*?"name":"([^"]+)"/);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return m[1];
  }
}

async function get(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const html = await res.text();
    // Přesměrování na přihlášení = nic užitečného.
    if (res.url.includes("/accounts/login")) return null;
    return html;
  } catch {
    return null;
  }
}

export async function fetchReel(url: string, shortcode: string): Promise<ReelInfo> {
  const info: ReelInfo = { url, shortcode, caption: null, author: null, location: null, thumbnailUrl: null, method: [] };

  // 1) Embed stránka s popiskem – obvykle funguje bez přihlášení.
  const embed = await get(`https://www.instagram.com/p/${shortcode}/embed/captioned/`);
  if (embed) {
    const cap = embed.match(/class="Caption"[^>]*>([\s\S]*?)<div class="CaptionComments"/);
    if (cap) {
      const user = cap[1].match(/class="CaptionUsername"[^>]*>([^<]+)</);
      if (user) info.author = decodeEntities(user[1]).trim();
      const body = cap[1].replace(/<a[^>]*class="CaptionUsername"[^>]*>[^<]*<\/a>/, "");
      const text = htmlToText(body);
      if (text) info.caption = text;
    }
    const img = embed.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/) ?? embed.match(/<img[^>]+src="([^"]+)"[^>]*class="EmbeddedMediaImage"/);
    if (img) info.thumbnailUrl = decodeEntities(img[1]);
    info.location = locationFromJson(embed);
    if (info.caption || info.thumbnailUrl) info.method.push("embed");
  }

  // 2) Hlavní stránka – meta tagy (popisek bývá v og:description / og:title).
  if (!info.caption || !info.thumbnailUrl) {
    const page = await get(`https://www.instagram.com/reel/${shortcode}/`);
    if (page) {
      const desc = meta(page, "og:description") ?? meta(page, "description");
      const title = meta(page, "og:title");
      // Formát: '123 likes, 4 comments - user on 1. 3. 2025: "popisek"'
      const quoted = (desc ?? title ?? "").match(/:\s*"([\s\S]+)"\s*\.?$/);
      if (!info.caption && (quoted || desc)) info.caption = (quoted ? quoted[1] : desc)!.trim();
      if (!info.author) {
        const a = (desc ?? "").match(/-\s*([\w.]+)\s+on\s/);
        if (a) info.author = a[1];
      }
      if (!info.thumbnailUrl) info.thumbnailUrl = meta(page, "og:image");
      if (!info.location) info.location = locationFromJson(page);
      if (info.caption || info.thumbnailUrl) info.method.push("page");
    }
  }

  return info;
}

/** Stáhne náhled jako base64 pro vision model. */
export async function fetchImageBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const mimeType = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
    if (!mimeType.startsWith("image/")) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > 4_000_000) return null;
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { data: btoa(binary), mimeType };
  } catch {
    return null;
  }
}
