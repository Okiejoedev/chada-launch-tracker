-- Chada Tech Launch Tracker: database setup
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run.
-- BEFORE you run it: change the passcode on the last line to your own.
-- Anyone with the passcode can change statuses; everyone with the link can view.

create extension if not exists pgcrypto with schema extensions;

-- 1. One row per task status
create table if not exists public.statuses (
  id          text primary key check (id ~ '^t[0-9]{3}$'),
  s           text not null default 'todo' check (s in ('todo','done','blocked')),
  note        text not null default '' check (char_length(note) <= 300),
  by_name     text not null default '' check (char_length(by_name) <= 40),
  updated_at  timestamptz not null default now()
);

alter table public.statuses enable row level security;

-- Everyone can read statuses. Nobody writes directly: only through set_status() below.
drop policy if exists "anyone can read statuses" on public.statuses;
create policy "anyone can read statuses" on public.statuses for select using (true);

grant select on public.statuses to anon, authenticated;
revoke insert, update, delete on public.statuses from anon, authenticated;

-- 2. The editor passcode (stored as a hash, never readable from the website)
create table if not exists public.tracker_settings (
  id         int primary key default 1 check (id = 1),
  pin_hash   text not null
);
alter table public.tracker_settings enable row level security;
revoke all on public.tracker_settings from anon, authenticated;

-- 3. Check a passcode (used when Ope unlocks editing)
create or replace function public.check_pin(p_pin text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.tracker_settings
    where pin_hash = extensions.crypt(p_pin, pin_hash)
  );
$$;

-- 4. Change a status (needs the passcode)
create or replace function public.set_status(p_id text, p_s text, p_note text, p_by text, p_pin text)
returns public.statuses
language plpgsql
security definer
set search_path = public, extensions
as $$
declare r public.statuses;
begin
  if not public.check_pin(p_pin) then
    raise exception 'wrong passcode' using errcode = '28P01';
  end if;
  insert into public.statuses as st (id, s, note, by_name, updated_at)
  values (p_id, p_s, case when p_s = 'blocked' then left(coalesce(p_note,''),300) else '' end,
          left(coalesce(p_by,''),40), now())
  on conflict (id) do update
    set s = excluded.s, note = excluded.note, by_name = excluded.by_name, updated_at = now()
  returning * into r;
  return r;
end;
$$;

revoke all on function public.check_pin(text) from public;
revoke all on function public.set_status(text,text,text,text,text) from public;
grant execute on function public.check_pin(text) to anon, authenticated;
grant execute on function public.set_status(text,text,text,text,text) to anon, authenticated;

-- 5. Live updates: send changes to everyone who has the page open
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'statuses') then
    alter publication supabase_realtime add table public.statuses;
  end if;
end $$;

-- 6. YOUR PASSCODE: change CHANGE-ME-chada-2026 to your own before running.
--    To change it later, edit this line and run just this statement again.
insert into public.tracker_settings (id, pin_hash)
values (1, extensions.crypt('CHANGE-ME-chada-2026', extensions.gen_salt('bf')))
on conflict (id) do update set pin_hash = excluded.pin_hash;
