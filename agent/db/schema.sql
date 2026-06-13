-- LOOP — Supabase schema
-- Human-in-the-loop incident-resolution copilot.
--
-- Run this in the Supabase SQL editor (or `psql`) against your project.
-- RLS is permissive here on purpose: this is a hackathon demo with no auth.
-- Do NOT ship these policies to production.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists vector;        -- pgvector for incident-signature memory

-- ---------------------------------------------------------------------------
-- incidents — one row per incident the loop is working / has resolved.
-- `stage` mirrors the loop state machine and drives the closing-ring UI.
-- ---------------------------------------------------------------------------
create table if not exists public.incidents (
  id                  uuid primary key default gen_random_uuid(),
  title               text        not null,
  service             text        not null,
  symptom             text        not null,
  stage               text        not null default 'detect'
    check (stage in (
      'detect','diagnose','remediate','awaiting_approval',
      'verify','learn','resolved','rejected'
    )),
  root_cause          text,
  remediation         text,          -- plain-language proposed remediation
  remediation_diff    text,          -- the concrete code-level fix (unified diff)
  confidence          numeric,       -- 0..1 model confidence in the diagnosis
  mttr_seconds        integer,       -- measured time-to-resolution
  matched_incident_id uuid references public.incidents(id) on delete set null,
  approved_by         text,
  approved_at         timestamptz,
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz
);

-- ---------------------------------------------------------------------------
-- agent_steps — the live reasoning trace. Every loop transition appends here
-- and the UI subscribes via realtime to animate the trace + ring.
-- ---------------------------------------------------------------------------
create table if not exists public.agent_steps (
  id          uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  stage       text not null,
  kind        text not null
    check (kind in ('think','spl','mcp_result','action','verify')),
  content     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists agent_steps_incident_idx
  on public.agent_steps (incident_id, created_at);

-- ---------------------------------------------------------------------------
-- incident_memory — resolved-incident signatures for cross-incident LEARN.
-- 384-dim embeddings (all-MiniLM-L6-v2 / equivalent) for similarity recall.
-- ---------------------------------------------------------------------------
create table if not exists public.incident_memory (
  id                uuid primary key default gen_random_uuid(),
  signature_text    text        not null,
  embedding         vector(384),
  service           text        not null,
  anti_pattern      text        not null,   -- e.g. "N+1 on cart_items after deploy"
  fix               text        not null,
  source_incident_id uuid references public.incidents(id) on delete set null,
  created_at        timestamptz not null default now()
);

-- Cosine-distance ANN index for signature recall.
create index if not exists incident_memory_embedding_idx
  on public.incident_memory
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ---------------------------------------------------------------------------
-- match_incident_memory — RPC the agent calls during DIAGNOSE to find the
-- nearest known signature. Returns cosine similarity (1 - distance).
-- ---------------------------------------------------------------------------
create or replace function public.match_incident_memory(
  query_embedding vector(384),
  match_threshold float default 0.75,
  match_count     int   default 1
)
returns table (
  id                uuid,
  signature_text    text,
  service           text,
  anti_pattern      text,
  fix               text,
  source_incident_id uuid,
  similarity        float
)
language sql stable
as $$
  select
    m.id,
    m.signature_text,
    m.service,
    m.anti_pattern,
    m.fix,
    m.source_incident_id,
    1 - (m.embedding <=> query_embedding) as similarity
  from public.incident_memory m
  where m.embedding is not null
    and 1 - (m.embedding <=> query_embedding) >= match_threshold
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

-- ---------------------------------------------------------------------------
-- Realtime — UI subscribes to these two tables.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.incidents;
alter publication supabase_realtime add table public.agent_steps;

-- ---------------------------------------------------------------------------
-- RLS — permissive, DEMO ONLY. Anon + service role can do everything.
-- ---------------------------------------------------------------------------
alter table public.incidents       enable row level security;
alter table public.agent_steps     enable row level security;
alter table public.incident_memory enable row level security;

drop policy if exists "demo_all_incidents"       on public.incidents;
drop policy if exists "demo_all_agent_steps"      on public.agent_steps;
drop policy if exists "demo_all_incident_memory"  on public.incident_memory;

create policy "demo_all_incidents"
  on public.incidents       for all using (true) with check (true);
create policy "demo_all_agent_steps"
  on public.agent_steps     for all using (true) with check (true);
create policy "demo_all_incident_memory"
  on public.incident_memory for all using (true) with check (true);
