-- Run once in Supabase > SQL Editor. Replace YOUR_EMAIL below first.

create table if not exists docs (
  collection text not null,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
create table if not exists editors (email text primary key);

alter table docs    enable row level security;
alter table editors enable row level security;

-- Anyone can read the scouting data.
drop policy if exists "read docs" on docs;
create policy "read docs" on docs for select using (true);

-- Only signed-in users listed in `editors` can write.
drop policy if exists "editors write docs" on docs;
create policy "editors write docs" on docs for all to authenticated
  using      (exists (select 1 from editors e where e.email = auth.jwt() ->> 'email'))
  with check (exists (select 1 from editors e where e.email = auth.jwt() ->> 'email'));

drop policy if exists "see own editor row" on editors;
create policy "see own editor row" on editors for select to authenticated
  using (email = auth.jwt() ->> 'email');

insert into editors (email) values ('YOUR_EMAIL') on conflict do nothing;

-- Live updates
alter publication supabase_realtime add table docs;

-- Robot photos (public to read, editors only to upload)
insert into storage.buckets (id, name, public) values ('photos', 'photos', true) on conflict do nothing;
drop policy if exists "editors upload photos" on storage.objects;
create policy "editors upload photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and exists (select 1 from editors e where e.email = auth.jwt() ->> 'email'));

-- Table privileges (newer Supabase projects do not grant these automatically).
-- Row-level security above still decides who may do what.
grant usage on schema public to anon, authenticated;
grant select on docs to anon, authenticated;
grant insert, update, delete on docs to authenticated;
grant select on editors to authenticated;
