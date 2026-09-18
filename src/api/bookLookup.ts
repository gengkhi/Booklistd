/**
 * Metadata pipeline. Production path: Supabase Edge Function (book-lookup),
 * which runs the Google Books -> Open Library waterfall server-side and caches
 * into the shared public.books catalog. Dev fallback: hit the sources directly
 * so the app works before Supabase is configured.
 */
import { fallbackWorkKey } from '@/lib/isbn';
import type { Book } from '@/lib/types';
import { supabase, supabaseConfigured } from './supabase';

export type BookMeta = Omit<Book, 'id'>;

export async function lookupIsbn(isbn13: string): Promise<BookMeta | null> {
  if (supabaseConfigured) {
    try {
      const { data, error } = await supabase.functions.invoke<BookMeta>('book-lookup', {
        body: { isbn: isbn13 },
      });
      if (!error && data?.title) return data;
    } catch {
      // fall through to direct sources
    }
  }
  return (await fromGoogleBooks(isbn13)) ?? (await fromOpenLibrary(isbn13));
}

async function fromGoogleBooks(isbn13: string): Promise<BookMeta | null> {
  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn13}`);
    if (!res.ok) return null;
    const json = await res.json();
    const v = json.items?.[0]?.volumeInfo;
    if (!v?.title) return null;
    return {
      isbn13,
      isbn10: null,
      title: v.title,
      subtitle: v.subtitle ?? null,
      authors: v.authors ?? [],
      publisher: v.publisher ?? null,
      publishedYear: v.publishedDate ? Number(String(v.publishedDate).slice(0, 4)) || null : null,
      edition: null,
      genres: v.categories ?? [],
      pageCount: v.pageCount ?? null,
      coverUrl: v.imageLinks?.thumbnail?.replace('http://', 'https://') ?? null,
      description: v.description ?? null,
      workKey: fallbackWorkKey(v.title, v.authors?.[0]),
      source: 'google',
    };
  } catch {
    return null;
  }
}

async function fromOpenLibrary(isbn13: string): Promise<BookMeta | null> {
  try {
    const res = await fetch(`https://openlibrary.org/isbn/${isbn13}.json`);
    if (!res.ok) return null;
    const ed = await res.json();
    if (!ed?.title) return null;
    const workKey: string | null = ed.works?.[0]?.key ?? null;
    let authors: string[] = [];
    if (Array.isArray(ed.authors) && ed.authors[0]?.key) {
      try {
        const a = await fetch(`https://openlibrary.org${ed.authors[0].key}.json`).then((r) => r.json());
        if (a?.name) authors = [a.name];
      } catch {}
    }
    return {
      isbn13,
      isbn10: null,
      title: ed.title,
      subtitle: ed.subtitle ?? null,
      authors,
      publisher: ed.publishers?.[0] ?? null,
      publishedYear: ed.publish_date ? Number(String(ed.publish_date).match(/\d{4}/)?.[0]) || null : null,
      edition: ed.edition_name ?? null,
      genres: [],
      pageCount: ed.number_of_pages ?? null,
      coverUrl: ed.covers?.[0] ? `https://covers.openlibrary.org/b/id/${ed.covers[0]}-L.jpg` : null,
      description: typeof ed.description === 'string' ? ed.description : ed.description?.value ?? null,
      workKey: workKey ?? fallbackWorkKey(ed.title, authors[0]),
      source: 'openlibrary',
    };
  } catch {
    return null;
  }
}
