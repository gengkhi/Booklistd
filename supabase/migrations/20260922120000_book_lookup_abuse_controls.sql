-- Abuse controls for the book-lookup edge function (security review F2).
--
-- 1. lookup_misses: a negative cache, so an ISBN that neither Google Books nor Open
--    Library knows stops hitting them on every request (re-checked after 7 days).
-- 2. lookup_rate_limits + lookup_rate_hit(): a Postgres-backed fixed-window rate
--    limiter. Buckets are "user:<uuid>" or "ip:<sha-256 hex>"; raw IPs are never stored.
--
-- Only the edge function's service role touches any of this: RLS is enabled with no
-- policies, table privileges are revoked from anon/authenticated, and the RPC is
-- executable by service_role alone.

create table public.lookup_misses (
  isbn13     text primary key check (isbn13 ~ '^97[89][0-9]{10}$'),
  checked_at timestamptz not null default now()
);

alter table public.lookup_misses enable row level security;
revoke all on table public.lookup_misses from anon, authenticated;
grant select, insert, update, delete on table public.lookup_misses to service_role;

create table public.lookup_rate_limits (
  bucket         text not null check (char_length(bucket) between 1 and 128),
  window_seconds integer not null check (window_seconds between 1 and 86400),
  window_start   timestamptz not null,
  hits           integer not null default 0,
  expires_at     timestamptz not null,
  primary key (bucket, window_seconds, window_start)
);
create index idx_lookup_rate_limits_expires on public.lookup_rate_limits (expires_at);

alter table public.lookup_rate_limits enable row level security;
revoke all on table public.lookup_rate_limits from anon, authenticated;

-- Counts one hit against a bucket's current fixed window and reports whether it is
-- within p_limit. The increment is a single atomic upsert, so concurrent requests can't
-- both slip under the limit. Expired windows are swept on roughly 1 call in 50, which
-- keeps the table tiny without pg_cron. All built-ins resolve from pg_catalog, so an
-- empty search_path is safe.
create or replace function public.lookup_rate_hit(p_bucket text, p_window_seconds integer, p_limit integer)
returns table (allowed boolean, used integer, retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end   timestamptz;
  v_hits  integer;
begin
  if p_bucket is null or char_length(p_bucket) not between 1 and 128
     or p_window_seconds is null or p_window_seconds not between 1 and 86400
     or p_limit is null or p_limit < 1 then
    raise exception 'invalid rate limit arguments' using errcode = '22023';
  end if;

  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_end := v_start + make_interval(secs => p_window_seconds);

  insert into public.lookup_rate_limits as r (bucket, window_seconds, window_start, hits, expires_at)
  values (p_bucket, p_window_seconds, v_start, 1, v_end)
  on conflict (bucket, window_seconds, window_start)
  do update set hits = r.hits + 1
  returning r.hits into v_hits;

  if random() < 0.02 then
    delete from public.lookup_rate_limits where expires_at < now();
  end if;

  allowed := v_hits <= p_limit;
  used := v_hits;
  retry_after := case
    when v_hits <= p_limit then 0
    else greatest(1, ceil(extract(epoch from (v_end - now())))::integer)
  end;
  return next;
end $$;

revoke all on function public.lookup_rate_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.lookup_rate_hit(text, integer, integer) to service_role;
