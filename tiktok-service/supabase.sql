-- Run once in your own Supabase project's SQL Editor.
create table if not exists public.studio_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 60),
  handle text not null default '' check (length(handle) <= 60),
  notes text not null default '' check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  saved_at timestamptz,
  profile_key text
);
alter table public.studio_accounts enable row level security;
revoke all on public.studio_accounts from anon, authenticated;
grant all on public.studio_accounts to service_role;
-- Private bucket. The backend alone handles encrypted profile uploads.
insert into storage.buckets (id, name, public, file_size_limit)
values ('tiktok-profiles', 'tiktok-profiles', false, 52428800)
on conflict (id) do nothing;
