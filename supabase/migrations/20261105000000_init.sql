-- Uložená místa z reels
create table public.places (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      text not null default 'other',
  description   text,
  address       text,
  city          text,
  country       text,
  lat           double precision,
  lng           double precision,
  -- exact = nalezeno v mapových datech, approx = odhad (město / AI), none = bez polohy
  geo_precision text not null default 'none' check (geo_precision in ('exact', 'approx', 'none')),
  source_url    text,
  source_text   text,
  thumbnail_url text,
  visited       boolean not null default false,
  created_at    timestamptz not null default now()
);

create index places_category_idx on public.places (category);
create unique index places_source_name_uidx on public.places (source_url, lower(name)) where source_url is not null;

-- Jednoduché nastavení aplikace (např. Telegram ID majitele)
create table public.app_settings (
  key   text primary key,
  value text not null
);

-- Data čtou a zapisují jen Edge Functions se servisním klíčem.
-- RLS bez politik = veřejný (anon) klíč nemá přístup k ničemu.
alter table public.places enable row level security;
alter table public.app_settings enable row level security;
