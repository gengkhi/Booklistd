// Supabase Edge Function: book-lookup
// POST { isbn: "9780441172719" } -> normalized book metadata.
// Waterfall: shared catalog cache -> Google Books -> Open Library.
// Every hit is cached into public.books so repeated scans never re-hit sources.
// Deploy: supabase functions deploy book-lookup
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  try {
    const { isbn } = await req.json();
    if (!/^97[89]\d{10}$/.test(isbn ?? '')) {
      return json({ error: 'invalid isbn' }, 400);
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 1) cache
    const { data: cached } = await admin.from('books').select('*').eq('isbn13', isbn).maybeSingle();
    if (cached) return json(shape(cached));

    // 2) Google Books
    const g = await fromGoogle(isbn);
    if (g) return json(await cache(admin, g));

    // 3) Open Library
    const o = await fromOpenLibrary(isbn);
    if (o) return json(await cache(admin, o));

    return json({ error: 'not found' }, 404);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function shape(row: Record<string, unknown>) {
  return {
    isbn13: row.isbn13, isbn10: row.isbn10, title: row.title, subtitle: row.subtitle,
    authors: row.authors ?? [], publisher: row.publisher, publishedYear: row.published_year,
    edition: row.edition, genres: row.genres ?? [], pageCount: row.page_count,
    coverUrl: row.cover_url, description: row.description, workKey: row.work_key, source: row.source,
  };
}

async function cache(admin: ReturnType<typeof createClient>, meta: Record<string, unknown>) {
  const { data } = await admin
    .from('books')
    .upsert(
      {
        isbn13: meta.isbn13, isbn10: meta.isbn10 ?? null,
        title: meta.title, subtitle: meta.subtitle, authors: meta.authors,
        publisher: meta.publisher, published_year: meta.publishedYear, edition: meta.edition,
        genres: meta.genres, page_count: meta.pageCount, cover_url: meta.coverUrl,
        description: meta.description, work_key: meta.workKey, source: meta.source,
      },
      { onConflict: 'isbn13' },
    )
    .select()
    .single();
  return data ? shape(data) : meta;
}

async function fromGoogle(isbn: string) {
  const key = Deno.env.get('GOOGLE_BOOKS_KEY');
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}${key ? `&key=${key}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const v = (await res.json()).items?.[0]?.volumeInfo;
  if (!v?.title) return null;
  return {
    isbn13: isbn, title: v.title, subtitle: v.subtitle ?? null, authors: v.authors ?? [],
    publisher: v.publisher ?? null,
    publishedYear: v.publishedDate ? Number(String(v.publishedDate).slice(0, 4)) || null : null,
    edition: null, genres: v.categories ?? [], pageCount: v.pageCount ?? null,
    coverUrl: v.imageLinks?.thumbnail?.replace('http://', 'https://') ?? null,
    description: v.description ?? null,
    workKey: `local:${String(v.title).toLowerCase()}|${String(v.authors?.[0] ?? '').toLowerCase()}`,
    source: 'google',
  };
}

async function fromOpenLibrary(isbn: string) {
  const res = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
  if (!res.ok) return null;
  const ed = await res.json();
  if (!ed?.title) return null;
  return {
    isbn13: isbn, isbn10: ed.isbn_10?.[0] ?? null,
    title: ed.title, subtitle: ed.subtitle ?? null,
    authors: await resolveAuthors(ed),
    publisher: ed.publishers?.[0] ?? null,
    publishedYear: ed.publish_date ? Number(String(ed.publish_date).match(/\d{4}/)?.[0]) || null : null,
    edition: ed.edition_name ?? null, genres: [], pageCount: ed.number_of_pages ?? null,
    coverUrl: ed.covers?.[0] ? `https://covers.openlibrary.org/b/id/${ed.covers[0]}-L.jpg` : null,
    description: typeof ed.description === 'string' ? ed.description : ed.description?.value ?? null,
    workKey: ed.works?.[0]?.key ?? `local:${String(ed.title).toLowerCase()}|`,
    source: 'openlibrary',
  };
}

/**
 * Open Library edition records carry authors as key refs ({ key: "/authors/OL79034A" }),
 * not names, so each needs a second fetch. Resolves all of them in parallel and falls
 * back to by_statement ("Frank Herbert.") when the refs are missing or unresolvable —
 * an authorless row would otherwise be cached into the shared catalog permanently.
 */
async function resolveAuthors(ed: Record<string, any>): Promise<string[]> {
  let keys: string[] = Array.isArray(ed.authors)
    ? ed.authors.map((a: { key?: string }) => a?.key).filter(Boolean)
    : [];

  // Mass-market editions often carry no edition-level authors; the work record
  // holds them instead, nested one level deeper as authors[].author.key.
  if (!keys.length && ed.works?.[0]?.key) {
    try {
      const r = await fetch(`https://openlibrary.org${ed.works[0].key}.json`);
      if (r.ok) {
        const work = await r.json();
        keys = Array.isArray(work?.authors)
          ? work.authors.map((a: { author?: { key?: string } }) => a?.author?.key).filter(Boolean)
          : [];
      }
    } catch {
      // fall through to by_statement
    }
  }

  if (keys.length) {
    const names = await Promise.all(
      keys.map(async (key) => {
        try {
          const r = await fetch(`https://openlibrary.org${key}.json`);
          if (!r.ok) return null;
          const a = await r.json();
          return typeof a?.name === 'string' ? a.name : null;
        } catch {
          return null;
        }
      }),
    );
    const resolved = names.filter((n): n is string => !!n);
    if (resolved.length) return resolved;
  }

  if (typeof ed.by_statement === 'string') {
    const cleaned = ed.by_statement.replace(/\.$/, '').trim();
    if (cleaned) return [cleaned];
  }
  return [];
}
