-- Sdílená mapa: místa jsou společná pro všechny, každé místo má reelsko autora,
-- uživatelé mají účty, vlastní "navštíveno" a mohou nahlásit nevhodné reelsko.

-- ---------- Kategorie (jediný zdroj pravdy pro web i AI) ----------
create table public.categories (
  id    text primary key,
  label text not null,
  emoji text not null,
  color text not null,
  sort  int  not null
);
insert into public.categories (id, label, emoji, color, sort) values
  ('cafe',       'Kavárna',            '☕',  '#8d5524', 1),
  ('restaurant', 'Restaurace',         '🍽️', '#e4572e', 2),
  ('bar',        'Bar',                '🍸', '#9b5de5', 3),
  ('bakery',     'Cukrárna a pekárna', '🧁', '#d63384', 4),
  ('nature',     'Příroda',            '🌲', '#2a9d8f', 5),
  ('viewpoint',  'Vyhlídka',           '🌄', '#e76f51', 6),
  ('sight',      'Památka',            '🏛️', '#577590', 7),
  ('museum',     'Muzeum a galerie',   '🖼️', '#4361ee', 8),
  ('beach',      'Pláž a koupání',     '🏖️', '#0096c7', 9),
  ('activity',   'Zážitek',            '🎢', '#c9184a', 10),
  ('shop',       'Obchod',             '🛍️', '#118a7e', 11),
  ('stay',       'Ubytování',          '🛏️', '#6c757d', 12),
  ('other',      'Jiné',               '📍', '#343a40', 13);

-- ---------- Profily (přezdívka autora příspěvku) ----------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  nickname   text not null unique check (char_length(nickname) between 2 and 24),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  base text := coalesce(nullif(trim(new.raw_user_meta_data ->> 'nickname'), ''), 'cestovatel');
  nick text := left(base, 24);
begin
  if exists (select 1 from public.profiles where nickname = nick) then
    nick := left(base, 19) || '-' || substr(md5(new.id::text), 1, 4);
  end if;
  insert into public.profiles (id, nickname) values (new.id, nick);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Reelska ----------
create table public.reels (
  id            uuid primary key default gen_random_uuid(),
  place_id      uuid not null references public.places (id) on delete cascade,
  shortcode     text not null unique,
  url           text not null,
  ig_author     text,
  caption       text,
  thumbnail_url text,
  submitted_by  uuid references public.profiles (id) on delete set null,
  hidden        boolean not null default false,
  created_at    timestamptz not null default now()
);
create index reels_place_idx on public.reels (place_id, created_at desc);

-- Stará testovací data: zdvojené místo ze stejného reelska (překlep v názvu).
delete from public.places where name = 'Uoplistsiche';

insert into public.reels (place_id, shortcode, url, created_at)
select id, substring(source_url from '/(?:reel|p)/([A-Za-z0-9_-]+)'), source_url, created_at
from public.places where source_url is not null
on conflict (shortcode) do nothing;
delete from public.places p where not exists (select 1 from public.reels r where r.place_id = p.id);

alter table public.places
  drop column visited,
  drop column source_url,
  drop column source_text,
  drop column thumbnail_url,
  add column hidden boolean not null default false;
drop index if exists places_source_name_uidx;
drop table public.app_settings;

-- ---------- Navštívená místa (každý uživatel zvlášť) ----------
create table public.visits (
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  place_id   uuid not null references public.places (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);

-- ---------- Nahlášení (3 nahlášení = reelsko zmizí) ----------
create table public.reports (
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  reel_id    uuid not null references public.reels (id) on delete cascade,
  reason     text,
  created_at timestamptz not null default now(),
  primary key (user_id, reel_id)
);

create or replace function public.handle_report() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if (select count(*) from public.reports where reel_id = new.reel_id) >= 3 then
    update public.reels set hidden = true where id = new.reel_id returning place_id into pid;
    update public.places set hidden = true
      where id = pid and not exists (select 1 from public.reels where place_id = pid and not hidden);
  end if;
  return new;
end $$;

create trigger on_report after insert on public.reports
  for each row execute function public.handle_report();

-- ---------- Log odeslaných reelsek (limit na uživatele + historie) ----------
create table public.submissions (
  id         bigserial primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  shortcode  text,
  status     text not null,
  reason     text,
  place_id   uuid references public.places (id) on delete set null,
  created_at timestamptz not null default now()
);
create index submissions_user_idx on public.submissions (user_id, created_at desc);

-- ---------- Veřejný přehled míst s aktuálním reelskem ----------
create view public.places_feed with (security_invoker = true) as
select
  p.id, p.name, p.category, p.description, p.address, p.city, p.country,
  p.lat, p.lng, p.geo_precision, p.created_at,
  r.id as reel_id, r.shortcode, r.url as reel_url, r.ig_author, r.thumbnail_url,
  r.created_at as reel_created_at,
  r.created_at + interval '7 days' as next_slot_at,
  pr.nickname as contributor,
  (select count(*) from public.reels r2 where r2.place_id = p.id and not r2.hidden) as reel_count
from public.places p
join lateral (
  select * from public.reels r where r.place_id = p.id and not r.hidden order by r.created_at desc limit 1
) r on true
left join public.profiles pr on pr.id = r.submitted_by
where not p.hidden;

-- ---------- Oprávnění ----------
alter table public.categories enable row level security;
alter table public.profiles enable row level security;
alter table public.reels enable row level security;
alter table public.visits enable row level security;
alter table public.reports enable row level security;
alter table public.submissions enable row level security;

create policy "kategorie čte každý" on public.categories for select using (true);
create policy "místa čte každý" on public.places for select using (not hidden);
create policy "reelska čte každý" on public.reels for select using (not hidden);
create policy "přezdívky čte každý" on public.profiles for select using (true);

create policy "své návštěvy čtu" on public.visits for select to authenticated using (auth.uid() = user_id);
create policy "své návštěvy přidám" on public.visits for insert to authenticated with check (auth.uid() = user_id);
create policy "své návštěvy smažu" on public.visits for delete to authenticated using (auth.uid() = user_id);

create policy "nahlásit může přihlášený" on public.reports for insert to authenticated with check (auth.uid() = user_id);
create policy "svá nahlášení čtu" on public.reports for select to authenticated using (auth.uid() = user_id);

create policy "svou historii čtu" on public.submissions for select to authenticated using (auth.uid() = user_id);

grant select on public.places_feed to anon, authenticated;
