import type { QueryClient } from '@tanstack/react-query';

/** Every query that reads user_books. Prefix keys, so ['book', id] and ['search', term] are covered. */
export function invalidateLibrary(qc: QueryClient): void {
  for (const key of ['library', 'stats', 'search', 'book']) qc.invalidateQueries({ queryKey: [key] });
}
