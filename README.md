# Moje místa (mapinstabot)

Mapa míst z Instagram reels. Sdílíš reelsko do Telegram bota, AI najde místo a uloží ho na mapu.

- `docs/` – mobilní webová aplikace (PWA) pro GitHub Pages: mapa, filtry podle typu, poloha, doporučení
- `supabase/functions/api` – API pro aplikaci (bez přihlášení – koncept)
- `supabase/functions/telegram` – webhook Telegram bota
- `supabase/functions/_shared` – stažení popisku z Instagramu, rozpoznání místa (Gemini), souřadnice (OpenStreetMap)
- `supabase/migrations` – databáze

Tajné hodnoty (tokeny, klíče) jsou jen v Supabase secrets, ne v repozitáři.
