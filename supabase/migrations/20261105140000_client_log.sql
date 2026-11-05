-- Diagnostický log z aplikace (spuštění, sdílení, odeslání).
create table if not exists public.client_log (
  id         bigserial primary key,
  user_id    uuid default auth.uid(),
  kind       text not null,
  detail     text,
  created_at timestamptz not null default now()
);
alter table public.client_log enable row level security;
create policy "log zapíše kdokoli" on public.client_log for insert to anon, authenticated with check (true);
