import { addUserBook, createShelf, listExportRows, saveBookEdit, setReadingState, upsertBook } from '@/db/repository';
import { bookMeta } from '@/test/fixtures';
import { freshDb } from '@/test/testDb';

it('lists every live copy (wishlist included), then books that only have a reading', async () => {
  const db = await freshDb();
  const shelf = createShelf('Study');
  const dune = upsertBook(bookMeta());
  const emma = upsertBook(bookMeta({ isbn13: '9780141439587', title: 'Emma' }));
  const pride = upsertBook(bookMeta({ isbn13: '9780141439518', title: 'Pride and Prejudice' }));
  const copy = addUserBook(dune.id, 'owned', shelf.id);
  addUserBook(emma.id, 'wishlist');
  setReadingState(pride.id, 'reading', '2026-09-01');
  saveBookEdit(dune.id, { title: 'Dune (my copy)', subtitle: null, authors: null, publisher: null, publishedYear: null, edition: null });
  db.runSync(`INSERT INTO loans (id, user_book_id, borrower_name, loaned_at) VALUES ('l1', ?, 'Ana', '2026-09-10 08:00:00')`, [copy.id]);

  const rows = listExportRows();
  expect(rows.map((r) => [r.title, r.status, r.shelf, r.readingState, r.loanedTo])).toEqual([
    ['Dune (my copy)', 'owned', 'Study', null, 'Ana'],
    ['Emma', 'wishlist', null, null, null],
    ['Pride and Prejudice', null, null, 'reading', null],
  ]);
  expect(rows[0].authors).toEqual(['Frank Herbert']);
});
