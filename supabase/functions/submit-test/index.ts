// DOČASNÉ: test celého průběhu bez ukládání (chráněno TEST_KEY).
import { handle } from "../_shared/submitCore.ts";
Deno.serve(async (req) => {
  if (!Deno.env.get("TEST_KEY") || req.headers.get("x-test-key") !== Deno.env.get("TEST_KEY")) return new Response("forbidden", { status: 403 });
  const { url } = await req.json();
  const t = Date.now();
  try {
    const r = await handle(null, url, { dryRun: true });
    return new Response(JSON.stringify({ ...r, ms: Date.now() - t }), { headers: { "Content-Type": "application/json; charset=utf-8" } });
  } catch (e) {
    return new Response(JSON.stringify({ result: { status: "error", message: String(e) }, debug: [], ms: Date.now() - t }), { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
});
