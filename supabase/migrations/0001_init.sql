-- My Library — initial schema. Run in the Supabase SQL editor (or `supabase db push`).


-- Shared catalog: written only by the book-lookup edge function (service role).
create table public.books (
  id uuid primary key default gen_random_uuid(),
  isbn13 text unique,
  isbn10 text,
  title text not null,
  subtitle text,
  authors text[] not null default '{}',
  publisher text,
  published_year int,
  edition text,
  genres text[] not null default '{}',
  page_count int,
  cover_url text,
  description text,
  work_key text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_books_isbn13 on public.books (isbn13);
create index idx_books_work_key on public.books (work_key);

create table public.user_books (
  id text primary key, -- client-generated id (offline-first)
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id),
  status text not null default 'owned'
    check (status in ('owned','reading','read','wishlist','loaned','want_to_buy')),
  condition text,
  location text,
  purchase_date date,
  purchase_price numeric,
  currency text,
  rating int check (rating between 1 and 5),
  review text,
  notes text,
  reading_progress int,
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_user_books_user on public.user_books (user_id, updated_at);

create table public.shelves (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  icon text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.shelf_books (
  shelf_id text not null references public.shelves (id) on delete cascade,
  user_book_id text not null references public.user_books (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  sort_order int not null default 0,
  primary key (shelf_id, user_book_id)
);

create table public.loans (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  user_book_id text not null references public.user_books (id) on delete cascade,
  borrower_name text not null,
  loaned_at timestamptz not null default now(),
  due_reminder_at timestamptz,
  returned_at timestamptz,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- updated_at maintenance
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger trg_user_books_touch before update on public.user_books
  for each row execute function public.touch_updated_at();
create trigger trg_shelves_touch before update on public.shelves
  for each row execute function public.touch_updated_at();
create trigger trg_loans_touch before update on public.loans
  for each row execute function public.touch_updated_at();

-- Row Level Security
alter table public.books enable row level security;
alter table public.user_books enable row level security;
alter table public.shelves enable row level security;
alter table public.shelf_books enable row level security;
alter table public.loans enable row level security;
alter table public.profiles enable row level security;

-- Catalog: everyone signed-in can read; only the edge function (service role) writes.
create policy "books are readable" on public.books
  for select to authenticated using (true);

-- Per-user tables: owner-only, all operations.
create policy "own user_books" on public.user_books
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own shelves" on public.shelves
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own shelf_books" on public.shelf_books
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own loans" on public.loans
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own profile" on public.profiles
  for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
