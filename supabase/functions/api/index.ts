// REST API pro mobilní aplikaci. Koncept bez přihlášení: kdo zná adresu, může mapu číst i upravovat.
import { CATEGORIES, CATEGORY_IDS } from "../_shared/categories.ts";
import { db, processInput } from "../_shared/pipeline.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-app-key",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // Cesta za názvem funkce: /api/places/<id> -> ["places", "<id>"]
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const route = parts.slice(parts.indexOf("api") + 1);

  try {
    if (req.method === "GET" && route[0] === "places") {
      const { data, error } = await db.from("places").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return json({ places: data, categories: CATEGORIES });
    }

    if (req.method === "POST" && route[0] === "add") {
      const { input } = await req.json();
      if (typeof input !== "string" || !input.trim() || input.length > 5000) return json({ error: "Chybí odkaz nebo text" }, 400);
      return json(await processInput(input));
    }

    if (req.method === "PATCH" && route[0] === "places" && route[1]) {
      const body = await req.json();
      const patch: Record<string, unknown> = {};
      if (typeof body.visited === "boolean") patch.visited = body.visited;
      if (typeof body.category === "string" && CATEGORY_IDS.includes(body.category)) patch.category = body.category;
      if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 200);
      if (Number.isFinite(body.lat) && Number.isFinite(body.lng)) {
        patch.lat = body.lat;
        patch.lng = body.lng;
        patch.geo_precision = "exact";
      }
      if (!Object.keys(patch).length) return json({ error: "Nic ke změně" }, 400);
      const { data, error } = await db.from("places").update(patch).eq("id", route[1]).select().single();
      if (error) throw error;
      return json({ place: data });
    }

    if (req.method === "DELETE" && route[0] === "places" && route[1]) {
      const { error } = await db.from("places").delete().eq("id", route[1]);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "not found" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
