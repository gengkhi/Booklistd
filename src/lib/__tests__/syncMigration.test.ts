/// <reference types="node" />
/**
 * No Postgres in CI, so this pins the Phase 2 migration to what the app relies on. Sean applies the SQL;
 * a change here must be mirrored in src/sync.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(join(__dirname, '../../../supabase/migrations/20260922180000_accounts_sync.sql'), 'utf8').replace(/\s+/g, ' ');
const SYNCED = ['shelves', 'user_books', 'readings', 'loans', 'profiles', 'book_edits'];

describe('accounts_sync migration', () => {
  it('lets ensure insert placeholder catalog rows', () => {
    expect(sql).toContain('alter table public.books alter column title drop not null');
  });

  it('creates book_edits keyed by (user_id, book_id) with owner RLS for every command', () => {
    expect(sql).toContain('create table public.book_edits');
    expect(sql).toContain('primary key (user_id, book_id)');
    expect(sql).toContain('alter table public.book_edits enable row level security');
    for (const cmd of ['select', 'insert', 'update', 'delete']) expect(sql).toMatch(new RegExp(`on public\\.book_edits for ${cmd} to authenticated`));
    expect(sql).toContain('with check (user_id = (select auth.uid()))');
  });

  it('stamps updated_at on insert and update for every synced table', () => {
    for (const t of SYNCED) {
      expect(sql).toContain(`create trigger trg_${t}_touch before insert or update on public.${t} for each row execute function public.touch_updated_at()`);
    }
  });

  it('guards ownership on user_books, loans, readings and book_edits', () => {
    expect(sql).toContain('security invoker set search_path = \'\'');
    for (const t of ['user_books', 'loans', 'readings', 'book_edits']) {
      expect(sql).toContain(`create trigger trg_${t}_same_owner before insert or update on public.${t} for each row execute function public.enforce_same_owner()`);
    }
  });

  it('caps lengths as the spec says', () => {
    expect(sql).toContain('check (char_length(btrim(name)) between 1 and 80)');
    expect(sql).toContain('check (char_length(btrim(borrower_name)) between 1 and 80)');
    expect(sql).toContain('check (char_length(notes) <= 2000)');
    expect(sql).toContain('check (char_length(review) <= 2000)');
    for (const c of ['title', 'subtitle', 'publisher', 'edition']) expect(sql).toContain(`check (char_length(${c}) <= 300)`);
    expect(sql).toContain('jsonb_array_length(authors) <= 20');
  });

  it('refuses to apply over rows that break a cap, then validates every cap', () => {
    expect(sql).toMatch(/do \$\$ declare .* begin .*raise exception 'accounts_sync: rows break the length caps/);
    for (const [table, where] of [
      ['shelves', 'where not (char_length(btrim(name)) between 1 and 80)'],
      ['loans', 'where not (char_length(btrim(borrower_name)) between 1 and 80)'],
      ['user_books', 'where char_length(notes) > 2000'],
      ['user_books', 'where char_length(review) > 2000'],
      ['profiles', 'where char_length(display_name) > 80'],
    ]) expect(sql).toContain(`from public.${table} ${where}`);
    for (const [table, c] of [
      ['shelves', 'shelves_name_len'], ['loans', 'loans_borrower_name_len'], ['user_books', 'user_books_notes_len'],
      ['user_books', 'user_books_review_len'], ['profiles', 'profiles_display_name_len'],
    ]) expect(sql).toContain(`alter table public.${table} validate constraint ${c};`);
  });

  it('pins cover objects to the owner folder and the book', () => {
    expect(sql).toContain("cover_object is null or cover_object ~ ('^' || user_id::text || '/' || book_id::text || '-[0-9]{13}\\.jpg$')");
  });

  it('keeps the queue and the privileged functions away from the API', () => {
    expect(sql).toContain('revoke all on table public.purge_cover_queue from anon, authenticated;');
    expect(sql).toContain('revoke execute on function public.queue_replaced_cover() from public, anon, authenticated;');
    expect(sql).toContain('revoke execute on function public.purge_soft_deleted() from public, anon, authenticated;');
  });

  it('queues a cover when its row is deleted or the photo changes', () => {
    expect(sql).toContain("if old.cover_object is not null and (tg_op = 'DELETE' or new.cover_object is distinct from old.cover_object) then");
    expect(sql).toContain('create trigger trg_book_edits_queue_cover after update or delete on public.book_edits');
  });

  it('purges by the server clock, never the device-set deleted_at', () => {
    expect(sql).toContain("cutoff constant timestamptz := now() - interval '30 days'");
    for (const t of ['loans', 'readings', 'book_edits', 'user_books', 'shelves']) {
      expect(sql).toContain(`delete from public.${t} where deleted_at is not null and updated_at < cutoff;`);
    }
    expect(sql).not.toMatch(/deleted_at < cutoff/);
  });

  it('indexes every synced table for the pull query', () => {
    for (const t of ['shelves', 'user_books', 'readings', 'loans']) expect(sql).toContain(`on public.${t} (user_id, updated_at, id)`);
    expect(sql).toContain('on public.book_edits (user_id, updated_at, book_id)');
  });

  it('keeps covers private and scoped to the owner folder', () => {
    expect(sql).toContain("values ('covers', 'covers', false");
    expect(sql.match(/\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/g)?.length).toBe(5);
  });

  it('purges soft-deleted rows after 30 days, daily, and queues their covers', () => {
    expect(sql).toContain("interval '30 days'");
    expect(sql).toContain("cron.schedule('purge-soft-deleted'");
    expect(sql).toContain("cron.schedule('purge-covers'");
    expect(sql).toContain('insert into public.purge_cover_queue');
  });
});
