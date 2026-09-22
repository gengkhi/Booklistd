/**
 * The shared lookup core (supabase/functions/_shared/bookCore.ts) runs in both the app
 * and the book-lookup edge function, so these tests cover the server's validation, URL
 * allow-list and work-key rules too.
 */
import {
  ENSURE_LIMITS,
  ensureBucket,
  fallbackWorkKey,
  isAllowedFetchUrl,
  lookupGoogleBooks,
  lookupOpenLibrary,
  openLibraryRefUrl,
  parseEnsureRequest,
  parseIsbnStrict,
  placeholderBook,
  safeCoverUrl,
  type FetchJson,
} from '../../../supabase/functions/_shared/bookCore';
import * as appIsbn from '../isbn';

const DUNE_13 = '9780441172719';
const DUNE_10 = '0441172717';

describe('ISBN normalisation', () => {
  it('accepts valid ISBN-13s with hyphens or spaces', () => {
    expect(appIsbn.normalizeToIsbn13('978-0-441-17271-9')).toBe(DUNE_13);
    expect(parseIsbnStrict('978 0 441 17271 9')).toBe(DUNE_13);
  });

  it('upgrades ISBN-10 (including an X check digit) to ISBN-13', () => {
    expect(parseIsbnStrict(DUNE_10)).toBe(DUNE_13);
    expect(parseIsbnStrict('0-8044-2957-X')).toBe('9780804429573');
  });

  it('rejects bad checksums, non-Bookland EANs and UPC-as-EAN', () => {
    expect(parseIsbnStrict('9780441172718')).toBeNull();
    expect(parseIsbnStrict('0441172718')).toBeNull();
    expect(parseIsbnStrict('4006381333931')).toBeNull(); // valid EAN-13, not a book
    expect(parseIsbnStrict('0012345678905')).toBeNull();
  });

  it('strict parsing refuses anything that is not a plain ISBN string', () => {
    expect(parseIsbnStrict([DUNE_13])).toBeNull();
    expect(parseIsbnStrict(9780441172719)).toBeNull();
    expect(parseIsbnStrict(null)).toBeNull();
    expect(parseIsbnStrict(`isbn:${DUNE_13}`)).toBeNull();
    expect(parseIsbnStrict(`${DUNE_13}\n`)).toBeNull();
    expect(parseIsbnStrict(`${'-'.repeat(20)}${DUNE_13}`)).toBeNull();
    // The forgiving scanner path still strips junk, as before.
    expect(appIsbn.normalizeToIsbn13(`isbn:${DUNE_13}`)).toBe(DUNE_13);
  });
});

describe('work keys', () => {
  it('the app re-exports the shared implementation', () => {
    expect(appIsbn.fallbackWorkKey).toBe(fallbackWorkKey);
  });

  it('normalises case, accents and punctuation', () => {
    expect(fallbackWorkKey('Cien años de soledad', 'Gabriel García Márquez')).toBe('local:cien anos de soledad|gabriel garcia marquez');
    expect(fallbackWorkKey("  Harry Potter & the Philosopher's Stone ", 'J.K. Rowling')).toBe('local:harry potter the philosophers stone|jk rowling');
    expect(fallbackWorkKey('Dune')).toBe('local:dune|');
  });
});

describe('upstream URL allow-list', () => {
  it('keeps https covers on expected hosts and upgrades http', () => {
    expect(safeCoverUrl('http://books.google.com/books/content?id=abc&img=1')).toBe('https://books.google.com/books/content?id=abc&img=1');
    expect(safeCoverUrl('https://lh3.googleusercontent.com/x.jpg')).toBe('https://lh3.googleusercontent.com/x.jpg');
    expect(safeCoverUrl('https://covers.openlibrary.org/b/id/1-L.jpg')).toBe('https://covers.openlibrary.org/b/id/1-L.jpg');
  });

  it('drops other hosts, credentials, ports and schemes', () => {
    for (const bad of [
      'https://evil.example/x.jpg',
      'https://books.google.com@evil.example/x.jpg',
      'https://user:pw@books.google.com/x.jpg',
      'https://books.google.com:8443/x.jpg',
      'https://googleusercontent.com.evil.example/x.jpg',
      'https://.googleusercontent.com/x.jpg',
      'javascript:alert(1)',
      'ftp://books.google.com/x.jpg',
      42,
      null,
    ]) {
      expect(safeCoverUrl(bad)).toBeNull();
    }
  });

  it('only builds Open Library URLs from well-formed refs', () => {
    expect(openLibraryRefUrl('/works/OL45883W', 'works')).toBe('https://openlibrary.org/works/OL45883W.json');
    expect(openLibraryRefUrl('/authors/OL79034A', 'authors')).toBe('https://openlibrary.org/authors/OL79034A.json');
    expect(openLibraryRefUrl('@evil.example/x', 'works')).toBeNull();
    expect(openLibraryRefUrl('/works/OL1W/../../x', 'works')).toBeNull();
    expect(openLibraryRefUrl('/authors/OL1A', 'works')).toBeNull();
  });

  it('only fetches from the lookup hosts', () => {
    expect(isAllowedFetchUrl('https://openlibrary.org/isbn/1.json')).toBe(true);
    expect(isAllowedFetchUrl('https://www.googleapis.com/books/v1/volumes?q=isbn:1')).toBe(true);
    expect(isAllowedFetchUrl('https://openlibrary.org@evil.example/x.json')).toBe(false);
    expect(isAllowedFetchUrl('http://169.254.169.254/latest')).toBe(false);
  });
});

function fakeFetch(docs: Record<string, unknown>): FetchJson & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    return url in docs ? docs[url] : null;
  }) as FetchJson & { calls: string[] };
  f.calls = calls;
  return f;
}

describe('Google Books parsing', () => {
  it('derives the same fallback work key as the app would', async () => {
    const f = fakeFetch({
      [`https://www.googleapis.com/books/v1/volumes?q=isbn:${DUNE_13}`]: {
        items: [{ volumeInfo: { title: 'Dune!', authors: ['Frank Herbért'], imageLinks: { thumbnail: 'https://evil.example/c.jpg' }, publishedDate: '1965-08-01' } }],
      },
    });
    const b = await lookupGoogleBooks(DUNE_13, f);
    expect(b?.workKey).toBe(fallbackWorkKey('Dune!', 'Frank Herbért'));
    expect(b?.workKey).toBe('local:dune|frank herbert');
    expect(b?.coverUrl).toBeNull();
    expect(b?.publishedYear).toBe(1965);
  });

  it('returns null when Google has no volume', async () => {
    const f = fakeFetch({ [`https://www.googleapis.com/books/v1/volumes?q=isbn:${DUNE_13}`]: { totalItems: 0 } });
    expect(await lookupGoogleBooks(DUNE_13, f)).toBeNull();
  });
});

describe('Open Library parsing', () => {
  const edUrl = `https://openlibrary.org/isbn/${DUNE_13}.json`;

  it('uses a valid work ref as the work key and resolves authors', async () => {
    const f = fakeFetch({
      [edUrl]: { title: 'Dune', works: [{ key: '/works/OL893415W' }], authors: [{ key: '/authors/OL79034A' }], covers: [8231856] },
      'https://openlibrary.org/authors/OL79034A.json': { name: 'Frank Herbert' },
    });
    const b = await lookupOpenLibrary(DUNE_13, f);
    expect(b?.workKey).toBe('/works/OL893415W');
    expect(b?.authors).toEqual(['Frank Herbert']);
    expect(b?.coverUrl).toBe('https://covers.openlibrary.org/b/id/8231856-L.jpg');
  });

  it('never fetches or stores malformed refs, and falls back to the shared work key', async () => {
    const f = fakeFetch({
      [edUrl]: {
        title: 'Dune',
        works: [{ key: '@evil.example/x' }],
        authors: [{ key: '@evil.example/a' }],
        by_statement: 'Frank Herbert.',
        covers: [-1],
      },
    });
    const b = await lookupOpenLibrary(DUNE_13, f);
    expect(f.calls).toEqual([edUrl]);
    expect(b?.authors).toEqual(['Frank Herbert']);
    expect(b?.workKey).toBe(fallbackWorkKey('Dune', 'Frank Herbert'));
    expect(b?.coverUrl).toBeNull();
  });

  it('caps author fetches', async () => {
    const authors = Array.from({ length: 30 }, (_, i) => ({ key: `/authors/OL${i + 1}A` }));
    const f = fakeFetch({ [edUrl]: { title: 'Anthology', authors } });
    await lookupOpenLibrary(DUNE_13, f);
    expect(f.calls.length).toBe(1 + 5);
  });

  it('returns null when Open Library does not know the ISBN', async () => {
    expect(await lookupOpenLibrary(DUNE_13, fakeFetch({}))).toBeNull();
  });
});

describe('ensure requests (sync book resolution)', () => {
  it('accepts exactly { ensure: { isbn13 } } with a valid checksum', () => {
    expect(parseEnsureRequest({ ensure: { isbn13: '9780441172719' } })).toBe('9780441172719');
  });
  it.each([
    [{ ensure: { isbn13: '9780441172718' } }], // bad checksum
    [{ ensure: { isbn13: '0441172717' } }], // ISBN-10: the app always sends the stored 13-digit form
    [{ ensure: { isbn13: '978-0441172719' } }],
    [{ ensure: { isbn13: 9780441172719 } }],
    [{ ensure: { isbn13: '9780441172719', title: 'x' } }],
    [{ ensure: { isbn13: '9780441172719' }, isbn: '9780441172719' }],
    [{ isbn: '9780441172719' }],
    [{ ensure: null }],
    [null],
  ])('rejects %p', (body) => expect(parseEnsureRequest(body)).toBeNull());
  it('builds the bare placeholder row', () => {
    expect(placeholderBook('9780441172719')).toEqual({ isbn13: '9780441172719', title: null, source: 'placeholder' });
  });
});

describe('ensure limits (I4)', () => {
  it('ensure counts in its own per-user bucket, apart from lookups', () => {
    expect(ensureBucket('user:6f1c1b8e-3b0a-4c55-9d7e-2a1f0c9b8d7e')).toBe('ensure:user:6f1c1b8e-3b0a-4c55-9d7e-2a1f0c9b8d7e');
    // lookup_rate_limits.bucket is capped at 128 characters.
    expect(ensureBucket('user:6f1c1b8e-3b0a-4c55-9d7e-2a1f0c9b8d7e').length).toBeLessThanOrEqual(128);
  });
  it('allows 120 a minute and 2000 a day', () => {
    expect(ENSURE_LIMITS.minute).toEqual({ windowSeconds: 60, max: 120 });
    expect(ENSURE_LIMITS.day).toEqual({ windowSeconds: 86_400, max: 2000 });
  });
});
