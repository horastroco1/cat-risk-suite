-- CAT Risk Suite — initial schema (Postgres / Supabase)
-- Run in Supabase SQL editor or via supabase db push

create extension if not exists "uuid-ossp";

create table if not exists settings (
  id text primary key default 'default',
  timezone text default 'America/Chicago',
  data_mode text default 'synthetic' check (data_mode in ('synthetic', 'anonymized', 'real')),
  radius_default_mi numeric default 50,
  radius_by_peril_json jsonb default '{}',
  email_digest_enabled boolean default false,
  llm_enabled boolean default true,
  llm_daily_cap_usd numeric default 1.67,
  numbers_only_mode boolean default false,
  last_run_at_utc timestamptz,
  updated_at timestamptz default now()
);

insert into settings (id) values ('default') on conflict do nothing;

create table if not exists policies (
  policy_id text primary key,
  name text,
  lat double precision not null,
  lon double precision not null,
  state text not null,
  insured_value numeric not null default 0,
  currency text default 'USD',
  perils text[] default '{}',
  metadata_json jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists runs (
  run_id uuid primary key default uuid_generate_v4(),
  started_at_utc timestamptz not null default now(),
  ended_at_utc timestamptz,
  trigger text default 'manual',
  data_mode text,
  feed_status_json jsonb not null default '{}',
  summary_counts_json jsonb default '{}',
  latency_ms integer,
  portfolio_hash text,
  schema_version text default '1',
  error text
);

create index if not exists runs_started_idx on runs (started_at_utc desc);

create table if not exists events (
  id bigserial primary key,
  event_id text not null,
  run_id uuid references runs (run_id) on delete cascade,
  feed text not null,
  schema_version text default '1',
  ingested_at_utc timestamptz default now(),
  occurred_at_utc timestamptz,
  updated_at_utc timestamptz,
  name text,
  peril text,
  severity text,
  tier integer default 2,
  geometry jsonb,
  source_url text,
  raw_properties_json jsonb,
  content_hash text
);

create index if not exists events_run_idx on events (run_id);
create index if not exists events_event_id_idx on events (event_id);

create table if not exists hits (
  hit_id uuid primary key default uuid_generate_v4(),
  run_id uuid references runs (run_id) on delete cascade,
  event_id text not null,
  policy_id text references policies (policy_id) on delete cascade,
  distance_mi double precision,
  inside_polygon boolean default false,
  peril_alignment text,
  tier integer,
  score numeric,
  notes text
);

create index if not exists hits_run_idx on hits (run_id);

create table if not exists feed_cache (
  feed text not null,
  cache_key text not null default 'default',
  etag text,
  last_modified text,
  fetched_at_utc timestamptz,
  payload_json jsonb,
  primary key (feed, cache_key)
);

-- Briefing archive (optional Phase 4)
create table if not exists briefing_archive (
  id bigserial primary key,
  run_id uuid references runs (run_id) on delete set null,
  created_at_utc timestamptz default now(),
  title text,
  body_html text,
  body_markdown text
);

alter table settings enable row level security;
-- Single-user: use service role in functions only; or create policy for anon if needed
