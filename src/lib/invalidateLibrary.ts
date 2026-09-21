import type { QueryClient } from '@tanstack/react-query';

/** Every query that reads user_books, readings or shelves. Prefix keys, so ['book', id] and ['search', term] are covered. */
export function invalidateLibrary(qc: QueryClient): void {
  for (const key of ['library', 'stats', 'search', 'book', 'reading', 'shelves']) qc.invalidateQueries({ queryKey: [key] });
}
