-- Migration 002: multi-tenant admin accounts, retrieval relevance threshold,
-- and rate limiting.
--
-- Run this ONCE in Supabase (SQL Editor → New query → paste → Run) on a
-- project that already has supabase/schema.sql applied. Fresh installs don't
-- need it — schema.sql already includes everything below.

-- ---------------------------------------------------------------------------
-- Admin accounts. Replaces the single shared ADMIN_PASSWORD: each business
-- owner logs in with their own email/password and can only see their own
-- business. A 'superadmin' (you) can see and switch between every business.
-- Passwords are stored as PBKDF2 hashes (see api/_lib/admin-auth.js); create
-- accounts with scripts/create_admin.py.
-- ---------------------------------------------------------------------------
create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text,
  password_hash text not null,
  role text not null default 'owner' check (role in ('owner', 'superadmin')),
  business_id uuid references businesses(id) on delete cascade,
  created_at timestamptz default now(),
  -- Owners must belong to a business; superadmins aren't tied to one.
  constraint owner_has_business check (role = 'superadmin' or business_id is not null)
);

alter table admin_users enable row level security;

-- ---------------------------------------------------------------------------
-- Retrieval relevance threshold. The old match_chunks always returned the top
-- N chunks even when none were related to the question, which nudged the
-- model into confident-sounding wrong answers. The signature changes, so the
-- old function is dropped first (otherwise Postgres keeps both overloads).
-- ---------------------------------------------------------------------------
drop function if exists match_chunks(vector, uuid, int);

create or replace function match_chunks(
  query_embedding vector(768),
  match_business_id uuid,
  match_count int default 4,
  min_similarity float default 0
)
returns table (
  id uuid,
  content text,
  document_id uuid,
  similarity float
)
language sql stable
as $$
  select
    chunks.id,
    chunks.content,
    chunks.document_id,
    1 - (chunks.embedding <=> query_embedding) as similarity
  from chunks
  where chunks.business_id = match_business_id
    and 1 - (chunks.embedding <=> query_embedding) >= min_similarity
  order by chunks.embedding <=> query_embedding
  limit match_count;
$$;

-- ---------------------------------------------------------------------------
-- Rate limiting (fixed-window counters). Protects the free Gemini quota and
-- the admin login from abuse. Keys look like 'chat:ip:<hash>' or
-- 'chat:biz:<uuid>'; IPs are hashed before they get here.
-- ---------------------------------------------------------------------------
create table if not exists rate_limits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);

create index if not exists rate_limits_window_idx on rate_limits (window_start);

alter table rate_limits enable row level security;

-- Records one hit for `p_key` in the current window and returns true if the
-- caller is still within `p_max` hits for that window.
create or replace function hit_rate_limit(p_key text, p_window_seconds int, p_max int)
returns boolean
language plpgsql
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count int;
begin
  insert into rate_limits (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = rate_limits.count + 1
  returning count into v_count;

  -- Opportunistic cleanup so the table doesn't grow forever.
  if random() < 0.01 then
    delete from rate_limits where window_start < now() - interval '2 days';
  end if;

  return v_count <= p_max;
end;
$$;
