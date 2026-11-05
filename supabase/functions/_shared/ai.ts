// Rozpoznání míst z popisku / textu / náhledu pomocí Gemini.
import { CATEGORIES, CATEGORY_IDS } from "./categories.ts";

export interface ExtractedPlace {
  name: string;
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

export interface ExtractInput {
  caption: string | null;
  location: string | null;
  author: string | null;
  userText: string | null;
  image: { data: string; mimeType: string } | null;
}

const SCHEMA = {
  type: "object",
  properties: {
    places: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Přesný název podniku nebo místa v původním jazyce" },
          category: { type: "string", enum: CATEGORY_IDS },
          description: { type: "string", description: "1–2 věty česky: co tam je a proč stojí za návštěvu" },
          address: { type: "string", description: "Ulice a číslo, pokud jsou známé, jinak prázdné" },
          neighborhood: { type: "string", description: "Čtvrť nebo část města (důležité u řetězců s více pobočkami), jinak prázdné" },
          city: { type: "string" },
          country: { type: "string" },
          search_query: { type: "string", description: "Dotaz pro vyhledání v mapě, např. 'Café Lusitano, Lisboa, Portugal'" },
          approx_lat: { type: "number", nullable: true },
          approx_lng: { type: "number", nullable: true },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["name", "category", "description", "address", "neighborhood", "city", "country", "search_query", "confidence"],
      },
    },
  },
  required: ["places"],
};

const PROMPT = `Jsi asistent, který z Instagram reelska zjistí konkrétní místa k navštívění (podniky, přírodní místa, vyhlídky, památky…).

Pravidla:
- Vrať jen místa, která jsou v podkladech skutečně uvedená nebo jasně identifikovatelná (štítek polohy, popisek, text v náhledu, hashtagy).
- Nic si nevymýšlej. Když místo nejde určit, vrať prázdné pole "places".
- Reelsko může obsahovat víc míst (např. "top 5 kaváren") – vrať všechna.
- Kategorie vyber z: ${CATEGORIES.map((c) => `${c.id} (${c.label})`).join(", ")}.
- approx_lat/approx_lng vyplň, kdykoli polohu znáš s rozumnou jistotou (aspoň na úrovni čtvrti) – u známých míst vždy. Jinak null.
- search_query napiš tak, aby místo našla mapa OpenStreetMap: "název, čtvrť, město" (bez slov jako "best", "kavárna" navíc).
- confidence: high = název i město jsou jisté, medium = drobná nejistota, low = spíš odhad.`;

export let usedModel = "";
export const failures: string[] = [];
// Pořadí podle měření na free tieru: lite modely odpovídají do ~2 s, velké bývají přetížené (503).
const FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-lite-latest", "gemini-3.5-flash"];

export async function extractPlaces(input: ExtractInput): Promise<ExtractedPlace[]> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("Chybí GEMINI_API_KEY");
  const model = Deno.env.get("GEMINI_MODEL") ?? FALLBACK_MODELS[0];

  const facts = [
    input.location && `Štítek polohy: ${input.location}`,
    input.author && `Autor: @${input.author}`,
    input.caption && `Popisek:\n${input.caption}`,
    input.userText && `Text od uživatele:\n${input.userText}`,
    input.image && "Přiložen je náhled videa.",
  ].filter(Boolean).join("\n\n");

  const parts: unknown[] = [{ text: `${PROMPT}\n\n--- PODKLADY ---\n${facts || "(žádné)"}` }];
  if (input.image) parts.push({ inline_data: { mime_type: input.image.mimeType, data: input.image.data } });

  const body = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.2 },
  });

  // Free tier bývá přetížený (503/429) – zkusíme postupně další modely.
  const models = [...new Set([model, ...FALLBACK_MODELS])];
  let res: Response | null = null;
  let lastError = "";
  failures.length = 0;
  for (const m of models) {
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body,
        signal: AbortSignal.timeout(25000),
      });
    } catch (e) {
      lastError = `Gemini ${m}: ${e instanceof Error ? e.message : e}`;
      failures.push(`${m} timeout`);
      res = null;
      continue;
    }
    if (res.ok) {
      usedModel = m;
      break;
    }
    lastError = `Gemini ${m} ${res.status}: ${(await res.text()).slice(0, 200)}`;
    console.warn(lastError);
    failures.push(`${m} ${res.status}`);
    if (![404, 429, 500, 503].includes(res.status)) break;
    res = null;
  }
  if (!res?.ok) throw new Error(lastError || "Gemini nedostupné");

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  const parsed = JSON.parse(text || '{"places":[]}');
  return (parsed.places ?? []).filter((p: ExtractedPlace) => p?.name?.trim());
}
