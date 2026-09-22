/** Spec §9 integration: two phones against one fake server. */
jest.mock('@/api/supabase', () => ({ supabase: {} }));

import type { SQLiteDatabase } from 'expo-sqlite';
import { bindOwner } from '@/auth/ownership';
import { __setDbForTest } from '@/db/database';
import { addUserBook, createShelf, listLibrary, listShelves, renameShelf, saveBookEdit, setReadingState, upsertBook } from '@/db/repository';
import { asClient, FakeSupabase } from '@/test/fakeSupabase';
import { bookMeta } from '@/test/fixtures';
import { freshDb } from '@/test/testDb';
import { stopTimers, syncNow } from '../engine';

afterEach(() => stopTimers());
const on = (d: SQLiteDatabase) => __setDbForTest(d);

it('claim → push everything → pull on a second phone → edit on both → last edit wins', async () => {
  const server = new FakeSupabase();
  server.userId = 'u1';
  const deps = { client: asClient(server), getUserId: async () => server.userId };

  // Phone A has a library from before accounts existed.
  const phoneA = await freshDb();
  const shelf = createShelf('Study');
  const book = upsertBook(bookMeta());
  addUserBook(book.id, 'owned', shelf.id);
  setReadingState(book.id, 'reading', '2026-09-01');
  saveBookEdit(book.id, { title: 'Dune (mine)', subtitle: null, authors: null, publisher: null, publishedYear: null, edition: null });
  expect(bindOwner('u1')).toBe('claim');
  await syncNow(deps);

  const catalogId = server.tables.books[0].id;
  expect(server.rows('shelves')).toHaveLength(1);
  expect(server.rows('user_books')[0]).toMatchObject({ book_id: catalogId, shelf_id: shelf.id });
  expect(server.rows('readings')).toHaveLength(1);
  expect(server.rows('book_edits')[0]).toMatchObject({ book_id: catalogId, title: 'Dune (mine)' });

  // Phone B signs in to the same account and gets everything.
  const phoneB = await freshDb();
  expect(bindOwner('u1')).toBe('claim');
  await syncNow(deps);
  const onB = listLibrary();
  expect(onB).toHaveLength(1);
  expect(onB[0]).toMatchObject({ shelfName: 'Study', book: expect.objectContaining({ id: catalogId, title: 'Dune (mine)' }) });

  // Both rename the shelf; B's edit reaches the server last and wins everywhere.
  on(phoneA);
  renameShelf(shelf.id, 'Office');
  await syncNow(deps);
  on(phoneB);
  renameShelf(shelf.id, 'Den');
  await syncNow(deps);
  on(phoneA);
  await syncNow(deps);
  expect(listShelves().map((s) => s.name)).toEqual(['Den']);
  on(phoneB);
  expect(listShelves().map((s) => s.name)).toEqual(['Den']);
});

it('signing in as someone else wipes before anything can push', async () => {
  const server = new FakeSupabase();
  server.userId = 'u2';
  await freshDb();
  bindOwner('u1');
  createShelf('Study'); // u1's library, with a change waiting
  expect(bindOwner('u2')).toBe('wipe');
  await syncNow({ client: asClient(server), getUserId: async () => 'u2' });
  expect(server.upserts).toEqual([]);
  expect(listShelves()).toEqual([]);
});
