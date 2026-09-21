-- Pin search_path on the updated_at trigger function.
-- A trigger function with a mutable search_path can be hijacked by an object
-- planted in an earlier schema. pg_catalog is always searched implicitly, so
-- now() still resolves with search_path set to ''.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end $$;
