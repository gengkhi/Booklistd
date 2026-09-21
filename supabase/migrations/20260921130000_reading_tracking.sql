-- Reading tracking: ownership stays on user_books ('owned' | 'wishlist'); reading state, dates and the
-- Dewey rating (1–7) move to readings, one row per user per book.

create table public.readings (
  id text primary key, -- client-generated id (offline-first)
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id),
  state text not null check (state in ('want','reading','read','dnf')),
  started_at date,
  finished_at date,
  rating int check (rating between 1 and 7),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, book_id)
);

create trigger trg_readings_touch before update on public.readings
  for each row execute function public.touch_updated_at();

alter table public.readings enable row level security;
create policy "own readings" on public.readings
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Backfill from the old mixed statuses (mirrors readingFromLegacy on the device). A rated copy was read,
-- whatever its status; read beats reading; the latest copy that decides the state dates it; the best
-- rating across all live copies of the book carries over.
with legacy as (
  select user_id, book_id, status, rating, updated_at,
         bool_or(status = 'read' or rating is not null) over (partition by user_id, book_id) as any_read,
         max(rating) over (partition by user_id, book_id) as best_rating
    from public.user_books
   where deleted_at is null
), chosen as (
  select distinct on (user_id, book_id) user_id, book_id, any_read, best_rating, updated_at
    from legacy
   where case when any_read then status = 'read' or rating is not null else status = 'reading' end
   order by user_id, book_id, updated_at desc
)
insert into public.readings (id, user_id, book_id, state, started_at, finished_at, rating)
select gen_random_uuid()::text, user_id, book_id,
       case when any_read then 'read' else 'reading' end,
       case when any_read then null else updated_at::date end,
       case when any_read then updated_at::date else null end,
       best_rating
  from chosen
on conflict (user_id, book_id) do nothing;

update public.user_books set status = 'owned' where status in ('reading', 'read', 'loaned');
update public.user_books set status = 'wishlist' where status = 'want_to_buy';
update public.user_books set rating = null where rating is not null;

-- Narrow the status check. Its name is Postgres-generated, so find it by definition.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.user_books'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.user_books drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.user_books
  add constraint user_books_status_check check (status in ('owned', 'wishlist'));
