// Přidání reelska do sdílené mapy (jen pro přihlášené).
import { db, handle, log } from "../_shared/submitCore.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = token ? await db.auth.getUser(token) : { data: { user: null } };
  if (!auth?.user) return json({ status: "unauthorized", message: "Pro přidání reelska se přihlas." }, 401);

  let input = "";
  try {
    input = String((await req.json()).url ?? "").slice(0, 2000);
  } catch {
    return json({ status: "invalid", message: "Chybí odkaz." }, 400);
  }

  try {
    const { result, shortcode } = await handle(auth.user.id, input);
    await log(auth.user.id, shortcode, result);
    return json(result);
  } catch (e) {
    console.error(e);
    const message = e instanceof Error ? e.message : String(e);
    await log(auth.user.id, input.match(/[A-Za-z0-9_-]{5,}/)?.[0] ?? null, { status: "error", message }).catch(() => {});
    return json({ status: "error", message }, 500);
  }
});
