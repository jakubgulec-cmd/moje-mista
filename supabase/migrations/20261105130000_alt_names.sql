-- Alternativní názvy místa (původní, anglický…) pro rozpoznání duplicit napříč jazyky.
alter table public.places add column alt_names text[] not null default '{}';
update public.places set alt_names = array[name] where alt_names = '{}';
-- Oprava starých přibližných poloh podle přesného dohledání.
update public.places set lat = -46.63370, lng = -72.64076, geo_precision = 'exact',
  alt_names = array['Marble Caves', 'Capillas de Mármol', 'Cuevas de Mármol'] where name = 'Marble Caves';
update public.places set lat = 41.96684, lng = 44.20767, geo_precision = 'exact' where name = 'Uplistsikhe';
