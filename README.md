# My Library

Personal book cataloging for iOS + Android, with a Store Mode scanner that tells you
**instantly and offline** whether you already own the book in your hand.

Stack: Expo (SDK 54) &middot; TypeScript &middot; Expo Router &middot; expo-sqlite (offline-first source of truth)
&middot; Supabase (Postgres, Auth, Storage, RLS, Edge Functions) &middot; TanStack Query &middot; Zustand &middot; expo-camera.

## Quick start

```bash
npm install
npx expo install --fix   # reconcile native package versions with the SDK
cp .env.example .env      # fill in Supabase keys (optional for first run)
npx expo start            # scan the QR with Expo Go
```

The app runs without Supabase: the library lives in on-device SQLite and metadata
lookups fall back to Google Books / Open Library directly. Supabase adds the shared
catalog cache, auth, and sync.

## Supabase setup (when ready)
1. Create a project at supabase.com.
2. Run `supabase/migrations/0001_init.sql` in the SQL editor.
3. `supabase functions deploy book-lookup` (optionally set `GOOGLE_BOOKS_KEY`).
4. Put the project URL + anon key in `.env`.

## Architecture map
```
app/                  Expo Router — (tabs)/ library, search, scan, wishlist, profile; book/[id]
src/theme/tokens.ts   The "reading nook" design tokens (see DESIGN.md)
src/lib/isbn.ts       Normalize/validate scans (EAN-13 978/979, ISBN-10 upgrade)
src/db/               SQLite: schema (versioned), database bootstrap, repository
src/features/scanner/ useScanPipeline — cooldown, offline verdict, async metadata
src/api/              Supabase client + book lookup waterfall
src/sync/             Push queue implemented; pull is Phase 3 (see TODO)
supabase/             Postgres migration (RLS) + book-lookup edge function
```

Design context for AI tooling: `PRODUCT.md` + `DESIGN.md` (Impeccable-ready — run
`npx impeccable install`, then `/impeccable init` in Claude Code).

## The rule that keeps Store Mode fast
`checkOwnership()` in `src/db/repository.ts` is the hot path: pure local SQLite,
indexed on `isbn13` and `work_key`, target <150ms scan-to-verdict. Network only
runs *after* the verdict, in the background, for unknown books.
