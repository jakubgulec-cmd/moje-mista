-- Zpevnění po bezpečnostní kontrole.

-- 1) Nahlášení: počítají se jen účty starší než 24 hodin (rychle založené účty reelsko neskryjí).
create or replace function public.handle_report() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pid uuid;
  trusted int;
begin
  select count(*) into trusted
  from public.reports r join auth.users u on u.id = r.user_id
  where r.reel_id = new.reel_id and u.created_at < now() - interval '24 hours';
  if trusted >= 3 then
    update public.reels set hidden = true where id = new.reel_id returning place_id into pid;
    update public.places set hidden = true
      where id = pid and not exists (select 1 from public.reels where place_id = pid and not hidden);
  end if;
  return new;
end $$;

-- 2) Obrana do hloubky: veřejné role nesmí do sdílených tabulek zapisovat ani na úrovni práv
--    (pravidla řádků to už blokují, tohle chrání i při budoucí chybě v pravidlech).
revoke insert, update, delete, truncate on public.places, public.reels, public.categories, public.profiles, public.submissions from anon, authenticated;
revoke insert, update, delete, truncate on public.visits, public.saved_places, public.trips, public.trip_stops, public.reports from anon;
revoke update, truncate on public.reports from authenticated;
revoke update, truncate on public.visits from authenticated;
revoke truncate on public.saved_places, public.trips, public.trip_stops from authenticated;

-- 3) Přezdívka bez řídicích znaků a HTML.
alter table public.profiles add constraint nickname_clean check (nickname !~ '[<>\x00-\x1f]');

-- Přezdívka při registraci: odstranit nepovolené znaky (jinak by registrace spadla na kontrole výše).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  base text := coalesce(nullif(trim(regexp_replace(coalesce(new.raw_user_meta_data ->> 'nickname', ''), '[<>\x00-\x1f]', '', 'g')), ''), 'cestovatel');
  nick text;
begin
  if char_length(base) < 2 then base := 'cestovatel'; end if;
  nick := left(base, 24);
  if exists (select 1 from public.profiles where nickname = nick) then
    nick := left(base, 19) || '-' || substr(md5(new.id::text), 1, 4);
  end if;
  insert into public.profiles (id, nickname) values (new.id, nick);
  return new;
end $$;

-- Přehledový pohled je jen ke čtení.
revoke insert, update, delete, truncate on public.places_feed from anon, authenticated;
