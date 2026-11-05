-- Moje mapa (uložená místa) a plánované cesty uživatele.
create table public.saved_places (
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  place_id   uuid not null references public.places (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, place_id)
);

create table public.trips (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name       text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);
create index trips_user_idx on public.trips (user_id, created_at desc);

-- Zastávky cesty v pořadí; mode = způsob dopravy NA tuto zastávku z předchozí (podle Google Maps).
create table public.trip_stops (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips (id) on delete cascade,
  place_id   uuid not null references public.places (id) on delete cascade,
  position   int not null,
  mode       text not null default 'walking' check (mode in ('walking', 'transit', 'driving', 'bicycling', 'two-wheeler')),
  created_at timestamptz not null default now()
);
create index trip_stops_trip_idx on public.trip_stops (trip_id, position);

alter table public.saved_places enable row level security;
alter table public.trips enable row level security;
alter table public.trip_stops enable row level security;

create policy "svá uložená místa" on public.saved_places for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "své cesty" on public.trips for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "zastávky mých cest" on public.trip_stops for all to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()))
  with check (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()));
