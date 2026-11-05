# Moje místa

Aplikace: https://jakubgulec-cmd.github.io/moje-mista/

Společná mapa míst z cestovatelských Instagram reels. Kdokoli s účtem pošle odkaz na reelsko,
AI přísně ověří, že jde o cestovatelský tip s konkrétním místem, a místo se objeví na mapě všem.

- `docs/` – webová aplikace (PWA) pro GitHub Pages: mapa, filtry, místa v okolí, účty, navštívená místa
- `supabase/functions/submit` – přidání reelska: duplicita → stažení → AI kontrola videa → poloha → zámek 7 dní na místo
- `supabase/functions/_shared` – Instagram (přes InstaFix), AI moderace (Gemini), hledání polohy (Photon/OSM)
- `supabase/migrations` – databáze: místa, reelska, profily, návštěvy, nahlášení, historie

Pravidla: jedno reelsko na místo na 7 dní, max. 20 odeslání za den na uživatele, 3 nahlášení reelsko skryjí.
Tajné hodnoty jsou jen v Supabase secrets; v aplikaci je jen veřejný (publishable) klíč.
