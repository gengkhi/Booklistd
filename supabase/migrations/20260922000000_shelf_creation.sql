-- Shelves become places: a saved plank colour per shelf, one shelf per At home copy (shelf_id),
-- and the free-text user_books.location retired. Same rules as the device's migrateLocations.

alter table public.shelves
  add column plank text not null default 'bus' check (plank in ('bus','tomato','pool','grass','plum'));

alter table public.user_books add column shelf_id text references public.shelves (id);
create index idx_user_books_shelf on public.user_books (shelf_id);

-- One shelf per distinct trimmed name (case-insensitive) per user, spelled the way most copies spell it
-- (ties: earliest copy), ordered by book count then name; planks cycle bus → plum by order.
with spellings as (
  select user_id, btrim(location) as name, lower(btrim(location)) as key,
         count(*) as n, min(created_at) as first_at
    from public.user_books
   where deleted_at is null and status = 'owned' and location is not null and btrim(location) <> ''
   group by user_id, btrim(location), lower(btrim(location))
), picked as (
  select distinct on (user_id, key) user_id, key, name
    from spellings
   order by user_id, key, n desc, first_at asc
), totals as (
  select user_id, key, sum(n) as total from spellings group by user_id, key
), ordered as (
  select p.user_id, p.name,
         (row_number() over (partition by p.user_id order by t.total desc, p.name asc) - 1)::int as sort_order
    from picked p join totals t using (user_id, key)
)
insert into public.shelves (id, user_id, name, sort_order, plank)
select gen_random_uuid()::text, user_id, name, sort_order,
       (array['bus','tomato','pool','grass','plum'])[(sort_order % 5) + 1]
  from ordered;

update public.user_books ub
   set shelf_id = s.id
  from public.shelves s
 where s.user_id = ub.user_id
   and s.deleted_at is null
   and lower(s.name) = lower(btrim(ub.location))
   and ub.deleted_at is null
   and ub.status = 'owned';

update public.user_books set location = null where location is not null;
