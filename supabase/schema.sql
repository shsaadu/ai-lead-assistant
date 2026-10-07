-- AI Lead Assistant — database schema
-- Run this in Supabase: Project → SQL Editor → New query → paste this whole file → Run

-- Enables vector similarity search (pgvector), used for real RAG retrieval
-- instead of doing cosine similarity in JavaScript.
create extension if not exists vector;

-- One row per business using this assistant. Ships with one demo row
-- (Northstar Plumbing) but the schema supports multiple businesses/clients.
create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  tagline text,
  brand_color text default '#1d4ed8',
  notify_email text,
  system_prompt text not null,
  services text[] default '{}',
  -- Websites allowed to embed this business's chat widget (widget.js), e.g.
  -- {'https://www.example.co.uk'}. Empty = any website (fine for demos).
  allowed_origins text[] default '{}',
  -- Extra lead-form questions, e.g. [{"key":"course","label":"Which course?",
  -- "type":"select","options":["General English"]}]. `label` may be an object
  -- of translations keyed by language code. See migrations/005.
  lead_fields jsonb default '[]'::jsonb,
  -- Optional name for the assistant (e.g. "Lumi"), shown in the chat header
  -- and greeting. See migrations/006.
  assistant_name text,
  -- "lamp" (built-in street lamp), an https:// image URL, or null for none.
  assistant_avatar text,
  -- "light" or "dark" chat window.
  widget_theme text default 'light',
  created_at timestamptz default now()
);

-- Source documents (FAQs, service pages, policies) a business uploads via the
-- admin dashboard. Each gets chunked + embedded into `chunks` below.
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null,
  content text not null,
  created_at timestamptz default now()
);

-- Chunked + embedded document text. `embedding` uses gemini-embedding-001's
-- 768-dimension output (matching the dimensionality set in api/_lib/gemini.js).
create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  business_id uuid references businesses(id) on delete cascade,
  content text not null,
  embedding vector(768),
  created_at timestamptz default now()
);

create index if not exists chunks_embedding_idx
  on chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- One row per website visitor chat session.
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  handoff_requested boolean default false,
  -- Filled in by the assistant on each reply (see api/_lib/reply-format.js):
  -- the visitor's language (ISO 639-1), how ready they are to act, and a
  -- short English summary for staff.
  language text,
  intent text check (intent in ('ready', 'researching', 'other')),
  summary text,
  created_at timestamptz default now(),
  last_message_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz default now()
);

-- Captured leads: name, email, service needed, budget — the actual
-- commercial output of the assistant.
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  name text not null,
  email text,
  phone text,
  service_needed text,
  budget text,
  message text,
  -- Answers to the business's lead_fields questions, keyed by question key.
  details jsonb default '{}'::jsonb,
  status text default 'new' check (status in ('new', 'contacted', 'won', 'lost')),
  created_at timestamptz default now(),
  constraint leads_contact_required check (email is not null or phone is not null)
);

-- Vector search function: given a query embedding, return the top N most
-- similar chunks for a specific business, ignoring chunks below
-- `min_similarity` so unrelated text never gets passed to the model as
-- "relevant". Called via Supabase RPC from api/chat.js.
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

-- Row-level security: lock every table down. The backend (api/_lib/supabase.js)
-- connects with the service_role key, which bypasses RLS entirely, so all the
-- API routes keep working. Enabling RLS with NO policies means the anon/public
-- key — if it is ever used from the browser — can read and write nothing.
alter table businesses    enable row level security;
alter table documents     enable row level security;
alter table chunks        enable row level security;
alter table conversations enable row level security;
alter table messages      enable row level security;
alter table leads         enable row level security;
alter table admin_users   enable row level security;
alter table rate_limits   enable row level security;

-- Seed the demo business (Northstar Plumbing) so the site works immediately.
insert into businesses (slug, name, tagline, brand_color, notify_email, system_prompt, services)
values (
  'northstar-plumbing',
  'Northstar Plumbing',
  'Plumbing that shows up.',
  '#1d4ed8',
  null, -- set this to your own email after creating your Resend account
  'You are Northstar Plumbing''s concise, helpful website assistant, serving South East England. You handle emergency leaks, burst pipes, blockages, no-hot-water issues, bathroom and kitchen plumbing, and maintenance. Never invent prices, availability, or diagnostic certainty. If you are not confident an answer is correct, say so plainly and offer to connect the customer with the team instead of guessing. Keep responses under 70 words and end with a helpful next step.',
  array['Emergency repairs', 'Bathroom & kitchen installs', 'Maintenance & servicing']
)
on conflict (slug) do nothing;
