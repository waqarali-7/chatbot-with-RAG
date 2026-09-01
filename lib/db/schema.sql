-- Supabase / Postgres schema.
--
-- Apply it by pasting this whole file into the Supabase SQL editor and running
-- it, or with psql if you have the direct connection string:
--   psql "$SUPABASE_DB_URL" -f lib/db/schema.sql
--
-- Safe to re-run: every statement is idempotent.
--
-- Everything here is synthetic demo data. No real client data, ever.

-- Supabase installs extensions into the `extensions` schema rather than public,
-- so the `vector` type will not resolve from a bare search_path and every table
-- using it fails with "type vector does not exist". Putting both on the path
-- makes this work whether the extension lives in extensions or in public.
create schema if not exists extensions;
set search_path = public, extensions;

create extension if not exists vector with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- RAG store
create table if not exists doc_chunks (
  id            text primary key,
  doc           text not null,
  heading_path  text not null,
  content       text not null,
  token_count   int  not null,
  embedding     vector(1536) not null,
  embed_model   text not null,
  created_at    timestamptz not null default now()
);

-- No ANN index here, deliberately.
--
-- An ivfflat index partitions the vectors into `lists` clusters and probes only
-- one of them by default. With a corpus this size most clusters are empty, so a
-- query lands in an empty list and returns nothing: an earlier version of this
-- file created ivfflat with lists = 32 over 27 chunks and recall@5 measured
-- 0.23, because the index was silently returning 8 candidates out of 27 and
-- often none at all.
--
-- Below a few thousand rows an exact sequential scan is both correct and fast.
-- Add an index when the corpus justifies it, sized to the data:
--   ivfflat  lists ≈ rows / 1000   (needs rows in the tens of thousands)
--   hnsw     no list sizing, better recall, slower to build
-- and re-measure recall@5 after adding it, because an ANN index trades recall
-- for speed by design.
drop index if exists doc_chunks_embedding_idx;

-- Cosine similarity, with the floor applied in SQL so an under-floor match is
-- never returned at all. Abstention depends on getting nothing back rather
-- than on the caller remembering to filter.
create or replace function match_chunks(
  query_embedding vector(1536),
  match_count int default 5,
  similarity_floor float default 0.35
)
returns table (id text, doc text, heading_path text, content text, similarity float)
language sql stable
as $$
  select c.id, c.doc, c.heading_path, c.content,
         1 - (c.embedding <=> query_embedding) as similarity
  from doc_chunks c
  where 1 - (c.embedding <=> query_embedding) >= similarity_floor
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- ------------------------------------------------------------- Slot / booking
do $$ begin
  create type slot_status as enum ('open', 'held', 'booked');
exception when duplicate_object then null; end $$;

create table if not exists slots (
  id           uuid primary key default gen_random_uuid(),
  starts_at    timestamptz not null,
  location     text not null,
  practitioner text not null,
  service      text not null,
  status       slot_status not null default 'open',
  held_until   timestamptz,
  held_by      text,
  unique (starts_at, practitioner)
);

create index if not exists slots_open_idx on slots (starts_at) where status <> 'booked';

create table if not exists bookings (
  id              uuid primary key default gen_random_uuid(),
  slot_id         uuid not null references slots(id),
  session_id      text not null,
  name            text not null,
  reason          text not null,
  disclosure_mode text not null,
  created_at      timestamptz not null default now()
);

create unique index if not exists bookings_slot_unique on bookings (slot_id);

-- Sweep expired holds back to open. Called before every availability read so a
-- timed-out hold never silently removes a slot from circulation.
create or replace function release_expired_holds()
returns int language plpgsql as $$
declare n int;
begin
  update slots set status = 'open', held_until = null, held_by = null
  where status = 'held' and held_until < now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Row-level lock on the hold. Two concurrent testers cannot hold the same slot.
create or replace function hold_slot(p_slot_id uuid, p_session text, p_minutes int default 10)
returns table (ok boolean, reason text, held_until timestamptz)
language plpgsql as $$
declare s slots%rowtype;
begin
  perform release_expired_holds();
  select * into s from slots where id = p_slot_id for update;
  if not found then
    return query select false, 'not_found'::text, null::timestamptz; return;
  end if;
  if s.status = 'booked' then
    return query select false, 'already_booked'::text, null::timestamptz; return;
  end if;
  if s.status = 'held' and s.held_by is distinct from p_session and s.held_until > now() then
    return query select false, 'held_by_other'::text, null::timestamptz; return;
  end if;
  update slots
     set status = 'held', held_by = p_session, held_until = now() + make_interval(mins => p_minutes)
   where id = p_slot_id;
  return query select true, 'ok'::text, (now() + make_interval(mins => p_minutes));
end $$;

-- Row-level lock on confirm. This is the function that makes double-booking
-- impossible rather than unlikely.
create or replace function confirm_slot(
  p_slot_id uuid, p_session text, p_name text, p_reason text, p_mode text
)
returns table (ok boolean, reason text, booking_id uuid)
language plpgsql as $$
declare s slots%rowtype; b uuid;
begin
  perform release_expired_holds();
  select * into s from slots where id = p_slot_id for update;
  if not found then
    return query select false, 'not_found'::text, null::uuid; return;
  end if;
  if s.status = 'booked' then
    return query select false, 'already_booked'::text, null::uuid; return;
  end if;
  if s.status = 'held' and s.held_by is distinct from p_session and s.held_until > now() then
    return query select false, 'held_by_other'::text, null::uuid; return;
  end if;
  insert into bookings (slot_id, session_id, name, reason, disclosure_mode)
  values (p_slot_id, p_session, p_name, p_reason, p_mode)
  returning id into b;
  update slots set status = 'booked', held_until = null, held_by = null where id = p_slot_id;
  return query select true, 'ok'::text, b;
end $$;

-- ------------------------------------------------------------------- Traces
create table if not exists traces (
  id              uuid primary key default gen_random_uuid(),
  session_id      text not null,
  turn_index      int not null,
  created_at      timestamptz not null default now(),
  disclosure_mode text not null,
  payload         jsonb not null
);

create index if not exists traces_session_idx on traces (session_id, turn_index);
