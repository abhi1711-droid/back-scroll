-- Run once in the Supabase SQL Editor before setting the Vercel environment variables.
create table if not exists public.members (
  public_id text primary key,
  display_name text not null default '' check (char_length(display_name) <= 40),
  token_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.memories (
  id uuid primary key,
  moment_id text null,
  member_public_id text null references public.members(public_id) on delete set null,
  member_display_name text not null default '',
  text text not null check (char_length(text) between 12 and 500),
  era text not null default '',
  region text not null default '',
  language text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz null
);

alter table public.memories add column if not exists member_public_id text null references public.members(public_id) on delete set null;
alter table public.memories add column if not exists member_display_name text not null default '';

create index if not exists memories_status_created_at_idx
  on public.memories (status, created_at asc);

create index if not exists memories_moment_status_idx
  on public.memories (moment_id, status);

create index if not exists memories_member_public_id_idx
  on public.memories (member_public_id);

alter table public.memories enable row level security;
alter table public.members enable row level security;
-- No client policies are created. All access goes through the server using the
-- service role key, which must only exist in server-side environment variables.
