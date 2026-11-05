// Přísná AI kontrola reelska + určení místa (Gemini se vstupem: video/obrázek + popisek).
// Přijmeme jen cestovatelský obsah s jedním konkrétním, ve videu viditelným místem.
// Konečné rozhodnutí dělá server z jednotlivých kontrol, ne jen z verdiktu modelu.
import type { Media } from "./instagram.ts";

export interface Category { id: string; label: string }

export interface ExtractedPlace {
  name: string;
  name_en: string;
  category: string;
  description: string;
  address: string;
  neighborhood: string;
  city: string;
  country: string;
  search_query: string;
  approx_lat: number | null;
  approx_lng: number | null;
  confidence: "high" | "medium" | "low";
}

export interface Verdict {
  accepted: boolean;
  reason: string;          // pro uživatele, česky
  place: ExtractedPlace | null;
  model: string;
  failedChecks: string[];
}

const CHECKS = {
  is_travel_content: "Reelsko je cestovatelské: ukazuje a doporučuje konkrétní místo k návštěvě (příroda, památka, vyhlídka, podnik, zážitek).",
  specific_place_identified: "Jde jednoznačně určit jedno konkrétní pojmenované místo (název + město/oblast), ne jen 'pláž v Asii'.",
  place_shown_in_media: "Místo je ve videu/obrázku skutečně vidět (nejen text nebo člověk před zdí).",
  sexual_or_suggestive: "Jakákoli nahota, sexuální či svůdné pózy, důraz na tělo, spodní prádlo, erotika – i jen náznak.",
  violence_or_shock: "Násilí, krev, nehody, šokující nebo nechutný obsah.",
  hate_or_politics: "Nenávist, extremismus, politická agitace, urážky skupin.",
  spam_or_ad: "Hlavním účelem je reklama na produkt/službu, soutěž, MLM, odkaz na prodej, clickbait bez místa.",
  drugs_weapons_illegal: "Drogy, zbraně, nelegální činnost, nebezpečné výzvy.",
  minors_risk: "Obsah, kde jsou děti v nevhodném nebo nebezpečném kontextu.",
  meme_or_unrelated: "Meme, vtip, tanec, vlog o sobě, móda, jídlo bez konkrétního podniku – nic, co by bylo tipem na místo.",
} as const;

const GOOD = ["is_travel_content", "specific_place_identified", "place_shown_in_media"] as const;
const BAD = ["sexual_or_suggestive", "violence_or_shock", "hate_or_politics", "spam_or_ad", "drugs_weapons_illegal", "minors_risk", "meme_or_unrelated"] as const;

const REASONS: Record<string, string> = {
  is_travel_content: "Tohle není cestovatelské reelsko s tipem na místo.",
  specific_place_identified: "Z reelska nejde jednoznačně určit konkrétní místo.",
  place_shown_in_media: "Místo není ve videu pořádně vidět.",
  sexual_or_suggestive: "Reelsko obsahuje nevhodný (sexuální nebo svůdný) obsah.",
  violence_or_shock: "Reelsko obsahuje násilný nebo šokující obsah.",
  hate_or_politics: "Reelsko obsahuje nenávistný nebo politický obsah.",
  spam_or_ad: "Reelsko je hlavně reklama nebo spam.",
  drugs_weapons_illegal: "Reelsko ukazuje drogy, zbraně nebo nelegální činnost.",
  minors_risk: "Reelsko ukazuje děti v nevhodném kontextu.",
  meme_or_unrelated: "Reelsko nesouvisí s tipem na místo (meme, vlog, móda…).",
};

// Lite modely odpovídají rychle; velké bývají na free tieru přetížené.
const MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-lite-latest", "gemini-3.5-flash"];

function schema(categories: Category[]) {
  return {
    type: "object",
    properties: {
      checks: {
        type: "object",
        properties: Object.fromEntries(Object.keys(CHECKS).map((k) => [k, { type: "boolean" }])),
        required: Object.keys(CHECKS),
      },
      verdict: { type: "string", enum: ["accept", "reject"] },
      reject_reason_cs: { type: "string", description: "Krátké vysvětlení česky, proč odmítnuto (prázdné při accept)" },
      place: {
        type: "object",
        nullable: true,
        properties: {
          name: { type: "string", description: "Přesný oficiální název místa v původním jazyce" },
          name_en: { type: "string", description: "Běžný anglický název místa (nebo stejný jako name)" },
          category: { type: "string", enum: categories.map((c) => c.id) },
          description: { type: "string", description: "1–2 věty česky: co tam je a proč stojí za návštěvu" },
          address: { type: "string" },
          neighborhood: { type: "string" },
          city: { type: "string" },
          country: { type: "string", description: "Země česky" },
          search_query: { type: "string", description: "Dotaz pro OpenStreetMap: 'název, město, země'" },
          approx_lat: { type: "number", nullable: true },
          approx_lng: { type: "number", nullable: true },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["name", "name_en", "category", "description", "address", "neighborhood", "city", "country", "search_query", "confidence"],
      },
    },
    required: ["checks", "verdict", "reject_reason_cs"],
  };
}

function prompt(categories: Category[], caption: string | null, author: string | null, kind: string) {
  return `Jsi EXTRÉMNĚ PŘÍSNÝ moderátor veřejné cestovatelské mapy. Lidé posílají Instagram reelska a ty rozhoduješ,
jestli reelsko smí na mapu jako tip na místo. Na mapu ho uvidí kdokoli včetně dětí.

Vyhodnoť každou kontrolu (true/false):
${Object.entries(CHECKS).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

Pravidla:
- Při jakékoli pochybnosti odmítni. Raději odmítnout dobré reelsko než pustit špatné.
- Krásné místo v pozadí nezachrání nevhodný obsah v popředí (např. svůdné pózování na náměstí = reject).
- Lidé v plavkách na pláži jsou v pořádku jen tehdy, když video ukazuje hlavně místo, ne těla.
- Místo musí být jedno konkrétní a reálné. U videí s více místy vyber to hlavní, a pokud žádné nedominuje, odmítni.
- Název, město a zemi ber z popisku, štítku, textu ve videu nebo hlasu. Nic si nevymýšlej.
- approx_lat/approx_lng vyplň, pokud polohu znáš (u známých míst vždy), jinak null.
- confidence = high jen tehdy, když jsi si názvem i městem jistý.
- Kategorie: ${categories.map((c) => `${c.id} (${c.label})`).join(", ")}.
- Při reject nastav place na null.

--- REELSKO ---
Autor: ${author ? "@" + author : "neznámý"}
Přiložené médium: ${kind}
Popisek:
${caption ?? "(bez popisku)"}`;
}

const INLINE_LIMIT = 3_000_000; // menší soubory posíláme vložené, větší přes Files API

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Nahraje soubor do Gemini Files API a počká, až je zpracovaný. Vrátí URI souboru. */
async function uploadToGemini(media: Media, apiKey: string): Promise<string> {
  const start = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(media.bytes.length),
      "X-Goog-Upload-Header-Content-Type": media.mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: "reel" } }),
    signal: AbortSignal.timeout(20000),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!start.ok || !uploadUrl) throw new Error(`Gemini upload start ${start.status}`);
  const up = await fetch(uploadUrl, {
    method: "POST",
    headers: { "X-Goog-Upload-Command": "upload, finalize", "X-Goog-Upload-Offset": "0", "Content-Type": media.mimeType },
    body: media.bytes,
    signal: AbortSignal.timeout(90000),
  });
  if (!up.ok) throw new Error(`Gemini upload ${up.status}`);
  let file = (await up.json()).file;
  // Video se chvíli zpracovává.
  for (let i = 0; i < 30 && file.state === "PROCESSING"; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const st = await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, { headers: { "x-goog-api-key": apiKey } });
    file = await st.json();
  }
  if (file.state !== "ACTIVE") throw new Error(`Gemini soubor ve stavu ${file.state}`);
  return file.uri;
}

export async function moderate(media: Media, caption: string | null, author: string | null, categories: Category[]): Promise<Verdict> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("Chybí GEMINI_API_KEY");

  const mediaPart = media.bytes.length > INLINE_LIMIT
    ? { file_data: { mime_type: media.mimeType, file_uri: await uploadToGemini(media, apiKey) } }
    : { inline_data: { mime_type: media.mimeType, data: toBase64(media.bytes) } };

  const body = JSON.stringify({
    contents: [{
      role: "user",
      parts: [
        mediaPart,
        { text: prompt(categories, caption, author, media.mimeType.startsWith("video/") ? "celé video reelska" : "obrázek z příspěvku") },
      ],
    }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema(categories), temperature: 0 },
  });

  let lastError = "";
  for (const model of MODELS) {
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body,
        signal: AbortSignal.timeout(45000),
      });
    } catch (e) {
      lastError = `${model}: ${e instanceof Error ? e.message : e}`;
      continue;
    }
    if (!res.ok) {
      lastError = `${model} ${res.status}: ${(await res.text()).slice(0, 200)}`;
      if ([404, 429, 500, 503].includes(res.status)) continue;
      break;
    }

    const data = await res.json();
    // Bezpečnostní filtr Googlu zablokoval vstup nebo odpověď -> rovnou odmítnout.
    const blocked = data?.promptFeedback?.blockReason ?? (["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"].includes(data?.candidates?.[0]?.finishReason) ? data.candidates[0].finishReason : null);
    if (blocked) {
      return { accepted: false, reason: "Reelsko neprošlo bezpečnostní kontrolou obsahu.", place: null, model, failedChecks: [`blocked:${blocked}`] };
    }
    const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    let out;
    try {
      out = JSON.parse(text);
    } catch {
      lastError = `${model}: neplatný JSON`;
      continue;
    }

    const checks = out.checks ?? {};
    const failed = [
      ...GOOD.filter((k) => checks[k] !== true),
      ...BAD.filter((k) => checks[k] !== false),
    ];
    const p: ExtractedPlace | null = out.place ?? null;
    if (out.verdict !== "accept") failed.push("verdict");
    if (!p?.name?.trim() || !p.city?.trim()) failed.push("place_missing");
    else if (p.confidence !== "high") failed.push("low_confidence");
    if (p && !categories.some((c) => c.id === p.category)) p.category = "other";

    if (failed.length) {
      const first = failed.find((k) => REASONS[k]);
      const reason = first ? REASONS[first]
        : failed.includes("low_confidence") || failed.includes("place_missing") ? "AI si není jistá, o jaké místo jde." : (out.reject_reason_cs || "Reelsko nesplňuje pravidla mapy.");
      return { accepted: false, reason, place: null, model, failedChecks: failed };
    }
    return { accepted: true, reason: "", place: p, model, failedChecks: [] };
  }
  throw new Error(`AI kontrola je teď nedostupná (${lastError})`);
}
