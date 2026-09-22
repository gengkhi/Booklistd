-- Accounts and sync, Phase 2 (spec §6.5). Sean applies this; nobody runs `supabase db push` for him.
--  1. ensure placeholders: catalog rows may have no title yet
--  2. book_edits: the user's per-field overrides of a catalog book, plus the synced cover photo path
--  3. updated_at is always the server clock, on insert as well as update, so device clocks never matter
--  4. ownership trigger (F5): no row may point at another user's shelf or copy, or change owner
--  5. length caps (F6), validated: the migration stops, with counts, if any existing row breaks one
--  6. (user_id, updated_at, id) indexes for the pull query
--  7. private covers bucket, owner-folder policies
--  8. replaced/removed cover objects are queued; soft-deleted rows are purged 30 days after their last
--     server-stamped updated_at (F13; deleted_at comes from device clocks)

-- 1 ---------------------------------------------------------------------------------------------
alter table public.books alter column title drop not null;

-- 2 ---------------------------------------------------------------------------------------------
create table public.book_edits (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id),
  title text,
  subtitle text,
  authors jsonb,
  publisher text,
  published_year int,
  edition text,
  cover_object text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, book_id),
  constraint book_edits_title_len check (char_length(title) <= 300),
  constraint book_edits_subtitle_len check (char_length(subtitle) <= 300),
  constraint book_edits_publisher_len check (char_length(publisher) <= 300),
  constraint book_edits_edition_len check (char_length(edition) <= 300),
  constraint book_edits_authors_shape check (
    authors is null
    or case when jsonb_typeof(authors) = 'array'
            then jsonb_array_length(authors) <= 20 and char_length(authors::text) <= 6300
            else false end
  ),
  constraint book_edits_cover_object_path check (
    cover_object is null or cover_object ~ ('^' || user_id::text || '/' || book_id::text || '-[0-9]{13}\.jpg$')
  )
);

alter table public.book_edits enable row level security;
create policy "own book_edits (select)" on public.book_edits for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own book_edits (insert)" on public.book_edits for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own book_edits (update)" on public.book_edits for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own book_edits (delete)" on public.book_edits for delete to authenticated
  using (user_id = (select auth.uid()));

-- 3 ---------------------------------------------------------------------------------------------
drop trigger if exists trg_user_books_touch on public.user_books;
drop trigger if exists trg_shelves_touch on public.shelves;
drop trigger if exists trg_loans_touch on public.loans;
drop trigger if exists trg_readings_touch on public.readings;
create trigger trg_shelves_touch before insert or update on public.shelves for each row execute function public.touch_updated_at();
create trigger trg_user_books_touch before insert or update on public.user_books for each row execute function public.touch_updated_at();
create trigger trg_readings_touch before insert or update on public.readings for each row execute function public.touch_updated_at();
create trigger trg_loans_touch before insert or update on public.loans for each row execute function public.touch_updated_at();
create trigger trg_profiles_touch before insert or update on public.profiles for each row execute function public.touch_updated_at();
create trigger trg_book_edits_touch before insert or update on public.book_edits for each row execute function public.touch_updated_at();

-- 4 ---------------------------------------------------------------------------------------------
-- security invoker: under RLS the caller only sees their own shelves/copies, so "not found" means
-- "someone else's" (the foreign key already guarantees the row exists).
create or replace function public.enforce_same_owner()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'rows cannot change owner' using errcode = '42501';
  end if;
  -- Nested IFs: PL/pgSQL resolves new.<column> when an expression first runs, so a column only one
  -- table has (shelf_id, user_book_id) must sit inside that table's branch.
  if tg_table_name = 'user_books' then
    if new.shelf_id is not null
       and not exists (select 1 from public.shelves s where s.id = new.shelf_id and s.user_id = new.user_id) then
      raise exception 'shelf belongs to another user' using errcode = '42501';
    end if;
  elsif tg_table_name = 'loans' then
    if not exists (select 1 from public.user_books ub where ub.id = new.user_book_id and ub.user_id = new.user_id) then
      raise exception 'copy belongs to another user' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger trg_user_books_same_owner before insert or update on public.user_books for each row execute function public.enforce_same_owner();
create trigger trg_loans_same_owner before insert or update on public.loans for each row execute function public.enforce_same_owner();
create trigger trg_readings_same_owner before insert or update on public.readings for each row execute function public.enforce_same_owner();
create trigger trg_book_edits_same_owner before insert or update on public.book_edits for each row execute function public.enforce_same_owner();

-- 5 ---------------------------------------------------------------------------------------------
alter table public.shelves
  add constraint shelves_name_len check (char_length(btrim(name)) between 1 and 80) not valid;
alter table public.loans
  add constraint loans_borrower_name_len check (char_length(btrim(borrower_name)) between 1 and 80) not valid;
alter table public.user_books
  add constraint user_books_notes_len check (char_length(notes) <= 2000) not valid,
  add constraint user_books_review_len check (char_length(review) <= 2000) not valid;
alter table public.profiles
  add constraint profiles_display_name_len check (char_length(display_name) <= 80) not valid;

-- NOT VALID caps are still checked on every UPDATE, so one legacy row would fail the nightly purge and
-- every sync of that row. No synced data has reached these tables yet: refuse to go on if any row breaks
-- a cap (fix those rows first), then validate them all.
do $$
declare
  v_shelves int; v_borrowers int; v_notes int; v_reviews int; v_names int;
begin
  select count(*) into v_shelves from public.shelves where not (char_length(btrim(name)) between 1 and 80);
  select count(*) into v_borrowers from public.loans where not (char_length(btrim(borrower_name)) between 1 and 80);
  select count(*) into v_notes from public.user_books where char_length(notes) > 2000;
  select count(*) into v_reviews from public.user_books where char_length(review) > 2000;
  select count(*) into v_names from public.profiles where char_length(display_name) > 80;
  if v_shelves + v_borrowers + v_notes + v_reviews + v_names > 0 then
    raise exception 'accounts_sync: rows break the length caps (shelf names %, borrower names %, notes %, reviews %, display names %)',
      v_shelves, v_borrowers, v_notes, v_reviews, v_names
      using errcode = '23514';
  end if;
end $$;

alter table public.shelves validate constraint shelves_name_len;
alter table public.loans validate constraint loans_borrower_name_len;
alter table public.user_books validate constraint user_books_notes_len;
alter table public.user_books validate constraint user_books_review_len;
alter table public.profiles validate constraint profiles_display_name_len;

-- 6 ---------------------------------------------------------------------------------------------
drop index if exists public.idx_user_books_user;
create index idx_shelves_sync on public.shelves (user_id, updated_at, id);
create index idx_user_books_sync on public.user_books (user_id, updated_at, id);
create index idx_readings_sync on public.readings (user_id, updated_at, id);
create index idx_loans_sync on public.loans (user_id, updated_at, id);
create index idx_book_edits_sync on public.book_edits (user_id, updated_at, book_id);
create index idx_profiles_sync on public.profiles (id, updated_at);
create index idx_book_edits_cover on public.book_edits (cover_object) where cover_object is not null;

-- 7 ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

create policy "covers: owner reads" on storage.objects for select to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "covers: owner uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "covers: owner replaces" on storage.objects for update to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "covers: owner deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 8 ---------------------------------------------------------------------------------------------
create table public.purge_cover_queue (
  object_path text primary key check (char_length(object_path) <= 200),
  queued_at timestamptz not null default now()
);
alter table public.purge_cover_queue enable row level security;
revoke all on table public.purge_cover_queue from anon, authenticated;
grant select, insert, delete on table public.purge_cover_queue to service_role;

-- A replaced, removed or deleted photo leaves its object behind; queue it. purge-covers deletes only
-- paths no book_edits row references (soft-deleted ones included), so re-adding a photo before the
-- purge runs is safe.
create or replace function public.queue_replaced_cover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.cover_object is not null and (tg_op = 'DELETE' or new.cover_object is distinct from old.cover_object) then
    insert into public.purge_cover_queue (object_path) values (old.cover_object) on conflict do nothing;
  end if;
  return coalesce(new, old);
end $$;

create trigger trg_book_edits_queue_cover after update or delete on public.book_edits
  for each row execute function public.queue_replaced_cover();

-- Trigger-only; never callable through the API.
revoke execute on function public.queue_replaced_cover() from public, anon, authenticated;

create or replace function public.purge_soft_deleted()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff constant timestamptz := now() - interval '30 days';
begin
  -- updated_at is the server clock (touch_updated_at); deleted_at is whatever the device said.
  delete from public.loans where deleted_at is not null and updated_at < cutoff;
  delete from public.readings where deleted_at is not null and updated_at < cutoff;
  delete from public.book_edits where deleted_at is not null and updated_at < cutoff; -- the queue trigger records their covers
  delete from public.user_books where deleted_at is not null and updated_at < cutoff; -- their loans cascade
  update public.user_books set shelf_id = null
   where shelf_id in (select id from public.shelves where deleted_at is not null and updated_at < cutoff);
  delete from public.shelves where deleted_at is not null and updated_at < cutoff;
end $$;

revoke execute on function public.purge_soft_deleted() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule('purge-soft-deleted', '17 3 * * *', 'select public.purge_soft_deleted()');

-- Needs Vault secrets project_url and purge_covers_secret (docs/setup-accounts.md §4).
select cron.schedule('purge-covers', '47 3 * * *', $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/purge-covers',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'purge_covers_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$cron$);
