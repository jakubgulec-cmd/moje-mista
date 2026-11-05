// Webhook Telegram bota: sdílené reelsko -> místo na mapě.
import { categoryOf } from "../_shared/categories.ts";
import { getSetting, type ProcessResult, processInput, setSetting } from "../_shared/pipeline.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const TOKEN = Deno.env.get("TELEGRAM_TOKEN")!;
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!;
const APP_URL = Deno.env.get("APP_URL") ?? "";
const APP_KEY = Deno.env.get("APP_KEY") ?? "";

async function tg(method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) console.error(method, data);
  return data.result;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const appLink = () => `${APP_URL}#k=${encodeURIComponent(APP_KEY)}`;

function formatResult(r: ProcessResult): string {
  if (r.status === "no_data") {
    return "😕 Z Instagramu se k tomuhle reelsku nepodařilo nic stáhnout (Instagram blokuje přístup).\n\n" +
      "Pošli mi odkaz znovu a připiš k němu název místa nebo město, např.:\n<i>odkaz + Café Savoy, Praha</i>";
  }
  if (r.status === "no_place") {
    return "🤔 Z reelska nejde poznat konkrétní místo.\n\nPošli odkaz znovu a připiš název nebo město, pomůže mi to.";
  }
  const lines: string[] = [];
  for (const p of r.places) {
    const c = categoryOf(p.category);
    const where = [p.city, p.country].filter(Boolean).join(", ");
    const pin = p.geo_precision === "exact" ? "" : p.geo_precision === "approx" ? " <i>(poloha přibližná)</i>" : " <i>(bez polohy, doplň v aplikaci)</i>";
    lines.push(`${c.emoji} <b>${esc(p.name)}</b>${where ? ` · ${esc(where)}` : ""}${pin}`);
    if (p.description) lines.push(`   ${esc(p.description)}`);
  }
  for (const p of r.duplicates) lines.push(`↩️ <b>${esc(p.name)}</b> už v mapě máš`);
  const head = r.places.length ? `✅ Uloženo ${r.places.length === 1 ? "1 místo" : `${r.places.length} míst`}:` : "Nic nového:";
  return `${head}\n\n${lines.join("\n")}`;
}

async function handleMessage(chatId: number, text: string) {
  const owner = await getSetting("telegram_owner");

  if (text.startsWith("/start")) {
    if (!owner) await setSetting("telegram_owner", String(chatId));
    else if (owner !== String(chatId)) return tg("sendMessage", { chat_id: chatId, text: "Tohle je soukromý bot." });
    return tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text: "👋 Ahoj! Sdílej mi reelsko z Instagramu (Sdílet → Telegram → tento bot) a já místo uložím do tvé mapy.\n\n" +
        "Můžeš poslat i jen text, např. <i>Lokál Dlouhá, Praha</i>.\n\n" +
        `🗺️ <a href="${appLink()}">Otevřít mapu</a> – na mobilu ji pak přidej na plochu.`,
      disable_web_page_preview: true,
    });
  }

  if (owner !== String(chatId)) return tg("sendMessage", { chat_id: chatId, text: "Tohle je soukromý bot." });

  if (text.startsWith("/klic")) {
    return tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", text: `🔑 Přístupový klíč do aplikace (pro iPhone po přidání na plochu):

<code>${esc(APP_KEY)}</code>` });
  }

  if (text.startsWith("/mapa")) {
    return tg("sendMessage", { chat_id: chatId, parse_mode: "HTML", text: `🗺️ <a href="${appLink()}">Otevřít mapu</a>` });
  }

  const status = await tg("sendMessage", { chat_id: chatId, text: "⏳ Koukám na to…" });
  let reply: string;
  try {
    reply = formatResult(await processInput(text));
  } catch (e) {
    console.error(e);
    reply = "⚠️ Něco se pokazilo při zpracování. Zkus to prosím znovu za chvíli.";
  }
  await tg("editMessageText", {
    chat_id: chatId,
    message_id: status.message_id,
    parse_mode: "HTML",
    text: reply,
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[{ text: "🗺️ Otevřít mapu", url: appLink() }]] },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST" || req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const update = await req.json();
  const msg = update.message ?? update.edited_message ?? update.channel_post;
  const text: string | undefined = msg?.text ?? msg?.caption;
  // Odkazy můžou být i jen v entitách (text_link).
  const links: string[] = [...(msg?.entities ?? []), ...(msg?.caption_entities ?? [])]
    .filter((e: { type: string; url?: string }) => e.type === "text_link" && e.url)
    .map((e: { url: string }) => e.url);
  const full = [text, ...links].filter(Boolean).join("\n");

  if (msg?.chat?.id && full) {
    // Telegramu odpovíme hned, zpracování doběhne na pozadí.
    EdgeRuntime.waitUntil(handleMessage(msg.chat.id, full).catch(console.error));
  }
  return new Response("ok");
});
