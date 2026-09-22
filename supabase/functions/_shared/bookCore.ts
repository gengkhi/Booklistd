/**
 * Book lookup core shared by the app and the book-lookup edge function.
 *
 * This file is the single source of truth for ISBN validation, work keys, upstream URL
 * safety and Google Books / Open Library parsing. The app imports it through
 * src/lib/isbn.ts and src/api/bookLookup.ts; the edge function imports it as
 * ../_shared/bookCore.ts. Keep it plain TypeScript: no imports, no Deno or React Native
 * APIs, so it runs unchanged in Deno, Hermes and Jest.
 */

// ---------------------------------------------------------------------------
// ISBN
// ---------------------------------------------------------------------------

function clean(raw: string): string {
  return raw.replace(/[^0-9Xx]/g, '').toUpperCase();
}

/**
 * Normalize a scanner payload to ISBN-13 or null.
 * - Books are EAN-13 starting 978/979 (Bookland); anything else is not a book barcode.
 * - iOS reports UPC-A as EAN-13 with a leading 0 — correctly rejected by the prefix check.
 * - ISBN-10 input (manual entry) is upgraded to ISBN-13.
 */
export function normalizeToIsbn13(raw: string): string | null {
  const s = clean(raw);
  if (s.length === 13 && (s.startsWith('978') || s.startsWith('979')) && isValidIsbn13(s)) return s;
  if (s.length === 10 && isValidIsbn10(s)) return isbn10To13(s);
  return null;
}

/**
 * Strict variant for untrusted input (the edge function's request body): only digits,
 * hyphens, spaces and a check-digit X are allowed, then the same checksum rules apply.
 * normalizeToIsbn13 is deliberately forgiving for scanner payloads; this one is not.
 */
export function parseIsbnStrict(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 24) return null;
  if (!/^[0-9Xx\- ]+$/.test(raw)) return null;
  return normalizeToIsbn13(raw);
}

export function isValidIsbn13(isbn: string): boolean {
  if (!/^\d{13}$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(isbn[12]);
}

export function isValidIsbn10(isbn: string): boolean {
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(isbn[i]) * (10 - i);
  sum += isbn[9] === 'X' ? 10 : Number(isbn[9]);
  return sum % 11 === 0;
}

/**
 * The sync engine's `ensure` request: exactly { ensure: { isbn13 } } with a checksum-valid ISBN-13.
 * Stricter than parseIsbnStrict on purpose, because the app always sends the stored 13-digit form.
 */
export function parseEnsureRequest(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const outer = body as Record<string, unknown>;
  const inner = outer.ensure;
  if (Object.keys(outer).length !== 1 || typeof inner !== 'object' || inner === null || Array.isArray(inner)) return null;
  const fields = inner as Record<string, unknown>;
  if (Object.keys(fields).length !== 1) return null;
  const isbn = fields.isbn13;
  return typeof isbn === 'string' && /^97[89]\d{10}$/.test(isbn) && isValidIsbn13(isbn) ? isbn : null;
}

/**
 * Ensure's own limits (I4), apart from the lookup bucket so a first backup can't starve Store Mode scans:
 * a per-minute rate, and a daily cap on the ensures that can create a catalog row (placeholders, upstream calls).
 * Both use the same bucket name; lookup_rate_hit keys windows on (bucket, window_seconds).
 */
export const ENSURE_LIMITS = {
  minute: { windowSeconds: 60, max: 120 },
  day: { windowSeconds: 86_400, max: 2000 },
} as const;

/** The ensure bucket for a verified caller bucket ("user:<uuid>"). */
export function ensureBucket(callerBucket: string): string {
  return `ensure:${callerBucket}`;
}

/** The catalog row ensure inserts when no source knows the ISBN. User-typed details stay in book_edits (F16). */
export function placeholderBook(isbn13: string): { isbn13: string; title: null; source: 'placeholder' } {
  return { isbn13, title: null, source: 'placeholder' };
}

export function isbn10To13(isbn10: string): string {
  const core = '978' + isbn10.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  return core + String((10 - (sum % 10)) % 10);
}

// ---------------------------------------------------------------------------
// Work keys
// ---------------------------------------------------------------------------

/** Fallback work key when the metadata source has none: normalized title + first author. */
export function fallbackWorkKey(title: string, author?: string | null): string {
  const norm = (t: string) =>
    t.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  return `local:${norm(title)}|${norm(author ?? '')}`;
}

// ---------------------------------------------------------------------------
// Upstream URL safety (security review F7)
// ---------------------------------------------------------------------------

const OL_REF = { works: /^\/works\/OL\d{1,12}W$/, authors: /^\/authors\/OL\d{1,12}A$/ } as const;

/** True for a well-formed Open Library reference such as "/works/OL45883W". */
export function isOpenLibraryRef(key: unknown, kind: keyof typeof OL_REF): key is string {
  return typeof key === 'string' && OL_REF[kind].test(key);
}

/** Builds the JSON URL for a validated Open Library ref, or null when the ref is not one. */
export function openLibraryRefUrl(key: unknown, kind: keyof typeof OL_REF): string | null {
  if (!isOpenLibraryRef(key, kind)) return null;
  const url = new URL(`${key}.json`, 'https://openlibrary.org');
  return url.protocol === 'https:' && url.host === 'openlibrary.org' ? url.toString() : null;
}

function hostAllowed(host: string, exact: readonly string[], suffixes: readonly string[]): boolean {
  return exact.includes(host) || suffixes.some((s) => host.endsWith(s) && host.length > s.length);
}

/**
 * Parses a URL copied from upstream data and keeps it only when it is https (http is
 * upgraded) on an expected host, with no credentials and no explicit port. Anything
 * else is dropped.
 */
function safeUrl(raw: unknown, exact: readonly string[], suffixes: readonly string[] = []): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw.startsWith('http://') ? `https://${raw.slice('http://'.length)}` : raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (!hostAllowed(url.hostname.toLowerCase(), exact, suffixes)) return null;
  return url.toString();
}

/** Hosts a cover URL may point at: Open Library covers, Google Books thumbnails. */
export const COVER_HOSTS = ['covers.openlibrary.org', 'books.google.com'] as const;
export const COVER_HOST_SUFFIXES = ['.googleusercontent.com'] as const;

export function safeCoverUrl(raw: unknown): string | null {
  return safeUrl(raw, COVER_HOSTS, COVER_HOST_SUFFIXES);
}

/** Hosts the lookup itself fetches from (checked again after redirects). */
export const FETCH_HOSTS = ['www.googleapis.com', 'openlibrary.org'] as const;

export function isAllowedFetchUrl(raw: string): boolean {
  return safeUrl(raw, FETCH_HOSTS) !== null;
}

// ---------------------------------------------------------------------------
// Parsing upstream records
// ---------------------------------------------------------------------------

export interface SourceBook {
  isbn13: string;
  isbn10: string | null;
  title: string;
  subtitle: string | null;
  authors: string[];
  publisher: string | null;
  publishedYear: number | null;
  edition: string | null;
  genres: string[];
  pageCount: number | null;
  coverUrl: string | null;
  description: string | null;
  workKey: string;
  source: 'google' | 'openlibrary';
}

/**
 * Fetches a JSON document. Resolves null when the resource does not exist (404) and
 * throws on anything else that went wrong (timeouts, 5xx, quota errors), so callers can
 * tell "not found" apart from "could not ask".
 */
export type FetchJson = (url: string) => Promise<unknown>;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Size caps keep one upstream record from bloating the shared catalog. */
export const LIMITS = { text: 500, description: 10_000, listItems: 20, authors: 5 } as const;

function text(v: unknown, max: number = LIMITS.text): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function textList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => text(x)).filter((x): x is string => !!x).slice(0, LIMITS.listItems);
}

function year(v: unknown): number | null {
  const m = typeof v === 'string' || typeof v === 'number' ? String(v).match(/\d{4}/) : null;
  const y = m ? Number(m[0]) : NaN;
  return y >= 1000 && y <= 2999 ? y : null;
}

function count(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 100_000 ? v : null;
}

export function googleBooksUrl(isbn13: string): string {
  return `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn13)}`;
}

export function parseGoogleVolume(isbn13: string, json: unknown): SourceBook | null {
  const items = isObj(json) && Array.isArray(json.items) ? json.items : [];
  const v = isObj(items[0]) && isObj(items[0].volumeInfo) ? items[0].volumeInfo : null;
  const title = v ? text(v.title) : null;
  if (!v || !title) return null;
  const authors = textList(v.authors);
  const links = isObj(v.imageLinks) ? v.imageLinks : {};
  return {
    isbn13,
    isbn10: null,
    title,
    subtitle: text(v.subtitle),
    authors,
    publisher: text(v.publisher),
    publishedYear: typeof v.publishedDate === 'string' ? year(v.publishedDate.slice(0, 4)) : null,
    edition: null,
    genres: textList(v.categories),
    pageCount: count(v.pageCount),
    coverUrl: safeCoverUrl(links.thumbnail),
    description: text(v.description, LIMITS.description),
    workKey: fallbackWorkKey(title, authors[0]),
    source: 'google',
  };
}

export async function lookupGoogleBooks(isbn13: string, getJson: FetchJson): Promise<SourceBook | null> {
  return parseGoogleVolume(isbn13, await getJson(googleBooksUrl(isbn13)));
}

export async function lookupOpenLibrary(isbn13: string, getJson: FetchJson): Promise<SourceBook | null> {
  const ed = await getJson(`https://openlibrary.org/isbn/${encodeURIComponent(isbn13)}.json`);
  if (!isObj(ed)) return null;
  const title = text(ed.title);
  if (!title) return null;
  const works = Array.isArray(ed.works) ? ed.works : [];
  const workRef = isObj(works[0]) && isOpenLibraryRef(works[0].key, 'works') ? works[0].key : null;
  const authors = await resolveAuthors(ed, workRef, getJson);
  const covers = Array.isArray(ed.covers) ? ed.covers : [];
  const coverId = typeof covers[0] === 'number' && Number.isInteger(covers[0]) && covers[0] > 0 ? covers[0] : null;
  const isbn10s = Array.isArray(ed.isbn_10) ? ed.isbn_10 : [];
  const isbn10 = typeof isbn10s[0] === 'string' && isValidIsbn10(clean(isbn10s[0])) ? clean(isbn10s[0]) : null;
  const desc = isObj(ed.description) ? ed.description.value : ed.description;
  return {
    isbn13,
    isbn10,
    title,
    subtitle: text(ed.subtitle),
    authors,
    publisher: textList(ed.publishers)[0] ?? null,
    publishedYear: year(ed.publish_date),
    edition: text(ed.edition_name),
    genres: [],
    pageCount: count(ed.number_of_pages),
    coverUrl: coverId ? safeCoverUrl(`https://covers.openlibrary.org/b/id/${coverId}-L.jpg`) : null,
    description: text(desc, LIMITS.description),
    workKey: workRef ?? fallbackWorkKey(title, authors[0]),
    source: 'openlibrary',
  };
}

async function getJsonQuietly(getJson: FetchJson, url: string | null): Promise<unknown> {
  if (!url) return null;
  try {
    return await getJson(url);
  } catch {
    return null;
  }
}

/**
 * Open Library edition records carry authors as key refs ({ key: "/authors/OL79034A" }),
 * not names, so each needs a second fetch. Resolves them in parallel (capped) and falls
 * back to by_statement ("Frank Herbert.") when the refs are missing or unresolvable —
 * an authorless row would otherwise be cached into the shared catalog permanently.
 * Refs that are not well-formed Open Library keys are never fetched.
 */
async function resolveAuthors(ed: Obj, workRef: string | null, getJson: FetchJson): Promise<string[]> {
  const refsOf = (list: unknown, pick: (a: Obj) => unknown): string[] =>
    (Array.isArray(list) ? list : [])
      .map((a) => (isObj(a) ? pick(a) : null))
      .filter((k): k is string => isOpenLibraryRef(k, 'authors'))
      .slice(0, LIMITS.authors);

  let keys = refsOf(ed.authors, (a) => a.key);

  // Mass-market editions often carry no edition-level authors; the work record
  // holds them instead, nested one level deeper as authors[].author.key.
  if (!keys.length && workRef) {
    const work = await getJsonQuietly(getJson, openLibraryRefUrl(workRef, 'works'));
    if (isObj(work)) keys = refsOf(work.authors, (a) => (isObj(a.author) ? a.author.key : null));
  }

  if (keys.length) {
    const names = await Promise.all(
      keys.map(async (key) => {
        const a = await getJsonQuietly(getJson, openLibraryRefUrl(key, 'authors'));
        return isObj(a) ? text(a.name) : null;
      }),
    );
    const resolved = names.filter((n): n is string => !!n);
    if (resolved.length) return resolved;
  }

  const by = text(ed.by_statement);
  const cleaned = by ? by.replace(/\.$/, '').trim() : '';
  return cleaned ? [cleaned] : [];
}
