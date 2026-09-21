-- Dewey ratings: seven reactions (1–7) replace the 1–5 star scale.
-- The original constraint was declared inline, so its name is Postgres-generated;
-- drop any CHECK on user_books that mentions rating rather than guessing the name.
do $$
declare c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.user_books'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%rating%'
  loop
    execute format('alter table public.user_books drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.user_books
  add constraint user_books_rating_check check (rating between 1 and 7);
