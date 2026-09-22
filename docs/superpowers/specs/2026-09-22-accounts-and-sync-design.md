# Accounts and Sync — Design Spec

**Date:** 2026-09-22 · **Status:** approved by Sean in brainstorming; awaiting spec review
**Builds on:** offline-first SQLite + `pending_ops` queue (every repository write enqueues a row snapshot), Supabase schema with owner-scoped RLS on every table, the hardened `book-lookup` edge function.
**Resolves OWASP review findings:** F1 (local data not bound to a user), F3 (implicit flow → PKCE), F4 (session in AsyncStorage), F5 (cross-owner foreign keys), F6 (unbounded text), F9 (`Math.random` ids), F13 (no deletion / soft-delete purge), and respects F16 (clients never insert into `books`).
**Out of scope:** Facebook sign-in, Supabase Realtime, family/shared libraries, a web app, analytics.

## 1. Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Account | **Required.** No anonymous mode. |
| Sign-in methods (v1) | **Sign in with Apple, Google, email magic link.** No passwords. |
| Sync | **Two-way, multi-device**, last edit wins per row. Store Mode stays fully offline. |
| Engine | **Our own**, built on `pending_ops` (not PowerSync / WatermelonDB). |
| Cover photos | **Sync** to a private Storage bucket. |
| Account deletion | **Immediate** and permanent, with an export offered first. |

**Workflow change:** native Google sign-in needs an **EAS development build**; Expo Go can no longer run the app once Phase 1 lands.

## 2. Phases

Each phase is built and reviewed on its own, but **the two are released to users together**. Phase 1 alone has no backup, so a sign-out wipe would destroy the only copy of a library. Until Phase 2 lands, the sign-out confirm treats every local row as not backed up ("Your library isn't backed up yet. Signing out deletes it from this phone.").

1. **Accounts:** Welcome screen, the three sign-in methods, secure session storage, owner binding, UUID ids, Profile → Account section, export, delete account.
2. **Sync:** push/pull engine, `ensure` book resolution, server `book_edits` table, cover photo sync, ownership trigger, length caps, soft-delete purge, sync status.

## 3. Sign-in and session (Phase 1)

### 3.1 Welcome screen
- `app/welcome.tsx`, shown instead of the tabs while there is no session (root layout gate).
- Content: Dewey (happy, pop), "Booklistd" display title, one line of copy ("Your shelves, backed up and on every phone."), then three buttons, in order:
  - **Continue with Apple** (iOS: native `AppleAuthenticationButton`, as Apple's guidelines require; Android: hidden unless Apple web sign-in is configured later);
  - **Continue with Google**;
  - **Email me a sign-in link** → an email field and "Send link", then "Check your inbox" with "Resend" (after 60s).
- A link to the privacy policy under the buttons.
- Errors are plain librarian copy that names the problem and the fix (for example "That link has expired. Send a new one."). Dewey stays silent on this screen's errors.
- **Session expiry:** once signed in, the session refreshes silently. An expired session never blocks Store Mode or local browsing. It only pauses sync, and Profile shows "Sign in again to back up".

### 3.2 Methods
- **Apple:**
  - Uses `expo-apple-authentication`.
  - Generate a random 32-byte nonce (`expo-crypto`), pass its SHA-256 to Apple, then call `supabase.auth.signInWithIdToken({ provider: 'apple', token: identityToken, nonce: rawNonce })`.
  - Request `FULL_NAME` and `EMAIL` scopes.
  - Apple returns the name only on the first authorisation, so save it to `profiles.display_name` right away.
- **Google:**
  - Uses `@react-native-google-signin/google-signin` (config plugin) with the iOS and web client IDs, and scopes `openid email profile` only.
  - Pass its `idToken` to `signInWithIdToken({ provider: 'google', token })`.
- **Email link:**
  - `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: 'booklistd://auth/callback' } })` with the client created with `flowType: 'pkce'`.
  - `app/auth/callback.tsx` reads `code` from the URL and calls `exchangeCodeForSession(code)`, then replaces the route with `/`.
  - Links expire after 1 hour and work once (Supabase settings).

### 3.3 Secure session storage
- **LargeSecureStore** (`src/auth/secureStorage.ts`) implements the supabase-js storage interface:
  - a random 256-bit key lives in `expo-secure-store` (Keychain/Keystore, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`);
  - the session JSON is AES-256 encrypted with that key and kept in AsyncStorage;
  - `removeItem` deletes both.
- `src/api/supabase.ts`: `storage: LargeSecureStore`, `flowType: 'pkce'`, `autoRefreshToken: true`, `persistSession: true`, `detectSessionInUrl: false`.
- Pause and resume token refresh with `AppState` (`startAutoRefresh` / `stopAutoRefresh`), as Supabase recommends for React Native.

### 3.4 Supabase auth configuration
- **Providers:** only Apple, Google and email (magic link) are enabled. Password sign-up is off, and so is anonymous sign-in.
- **Redirect allow-list:** only `booklistd://auth/callback`.
- **Identity linking:** automatic linking on verified email is on, so Apple and Google sign-ins with the same email become one user.
- **Rate limits:** the built-in auth rate limits stay on.
- **Custom SMTP:** configured (for example Resend), because the built-in mailer sends only a few emails per hour.
- **`supabase/config.toml`:** mirrors these for local dev: set `site_url` and the redirect list, and replace the 6-character password minimum with 8 even though passwords are off (F15).

## 4. Owner binding (Phase 1, fixes F1)

- **Where the owner lives:** `sync_meta` key `owner_user_id`. `src/auth/ownership.ts` exposes a pure `ownershipAction(ownerId | null, signedInId) → 'claim' | 'continue' | 'wipe'`, which is tested.
- **What each action does on sign-in:**
  - **claim** (no owner, which covers pre-accounts installs): set the owner. If the local library has rows, enqueue a full snapshot of every live row once, so everything uploads when sync ships.
  - **continue:** nothing.
  - **wipe:** delete all local rows (every table, `pending_ops`, `sync_meta` except schema) and the local covers directory, then set the new owner. Nothing from the previous owner is ever pushed under the new session.
- **Sign out:**
  1. Try a push (Phase 2).
  2. If ops remain, confirm: "⟨N⟩ changes haven't backed up yet. Sign out anyway?" (destructive style).
  3. Wipe as above, then call `supabase.auth.signOut()`, which clears the secure storage.
  4. Go to Welcome.
- **Ids (F9):** `newId()` in `src/db/ids.ts` returns `Crypto.randomUUID()` (`expo-crypto`). Existing ids are unchanged, since server id columns for user-owned tables are `text`.

## 5. Profile → Account (Phase 1)

A new section at the top of Profile, as a PocketCard with LeaderRows:
- **Signed in as:** the email and the method ("with Apple" / "with Google" / "by email").
- **Backup:** the sync status line (§6.6). Before Phase 2 it reads "Backups coming soon".
- **Actions:**
  - **Export my library (CSV)** (§7.2);
  - **Sign out**;
  - **Delete account** (red; §7.1).

## 6. Sync engine (Phase 2)

### 6.1 Shape
- `src/sync/` holds these modules:
  - `engine.ts`: single-flight orchestrator;
  - `push.ts`;
  - `pull.ts`;
  - `resolveBooks.ts`;
  - `covers.ts`;
  - `status.ts`: a zustand store.
- **Tested pure helpers:**
  - `coalesce(ops)`;
  - `pushOrder(tables)`;
  - `applyPulled(localRow, pulledRow, hasPending)`;
  - `nextCursor(rows)`.
- **Triggers:**
  - 2s debounce after any repository write (the repository calls `requestSync()`);
  - `AppState` → active;
  - right after sign-in.
- No background tasks and no polling. Only one run at a time, and a request during a run schedules exactly one follow-up.
- Synced tables: `shelves`, `user_books`, `readings`, `book_edits`, `loans`, `profiles`. `books` is pull-only, fetched by id as referenced. `shelf_books` is retired and not synced.

### 6.2 Push
1. **Coalesce:** read `pending_ops` oldest-first and keep only the latest snapshot per (table, row_id). Remember the max op id included.
2. **Resolve books (§6.4):** for every pushed `user_books`, `readings` or `book_edits` row whose `book_id` is not a known server book.
3. **Upsert by table** in `pushOrder`: shelves → user_books → readings → book_edits → loans → profiles, in chunks of 200.
   - `readings` use `onConflict: 'user_id,book_id'`;
   - `book_edits` use `onConflict: 'user_id,book_id'`;
   - deletes are upserts carrying `deleted_at`.
   - Payloads never carry `user_id`; the server default `auth.uid()` plus RLS `WITH CHECK` sets it.
4. **On first claim, shelves match by name:** a local shelf whose `lower(trim(name))` matches an existing server shelf adopts the server id. Local `user_books.shelf_id` references are rewritten in one transaction before upserting.
5. **Outcomes per chunk:**
   - **success:** delete the included ops, up to the remembered id per row (ops written during the push stay queued);
   - **network or 5xx:** stop and retry with backoff 5s → 10s → … capped at 5 min;
   - **4xx on a row** (validation, RLS, check constraint): move that row's ops to a new local `sync_rejects` table (op, error code, time), then continue. A rejection never blocks the queue.

### 6.3 Pull
- **Cursor:** per table in `sync_meta` (`pull:<table>`), `(updated_at, id)` of the last applied row.
- **Query:** `select * where (updated_at, id) > cursor order by updated_at, id limit 500`, repeated until a short page. `updated_at` is set by the server trigger (`touch_updated_at`), so device clocks never matter.
- **Apply** each row with `applyPulled`:
  - if the row has a pending local op, keep local (it will push and win);
  - otherwise upsert locally, including `deleted_at`.
- Then fetch any referenced `books` rows missing locally, by id.
- **Stale device:** if a table's cursor is older than 30 days (the purge window, §6.5), then after pushing, clear that table's local rows and cursor and pull it in full.

### 6.4 Book resolution (`ensure`)
- **Server:** the `book-lookup` function gains `POST { ensure: { isbn13 } }`.
  - It requires an authenticated user JWT (not just the anon key) and counts against that user's rate limit.
  - It returns the existing catalog `books.id` for that ISBN. Otherwise it runs a normal lookup and inserts the result, or inserts a bare `{ isbn13, title: null, source: 'placeholder' }` row with the service role.
  - The ISBN is checksum-validated with the shared `bookCore` code.
- **Client:** for each local book id unknown to the server, call `ensure`. Then, in one transaction, rewrite `books.id` and every local reference (`user_books.book_id`, `readings.book_id`, `book_edits.book_id`, and any queued `pending_ops` payloads) from the local id to the server id, and move the cover file if its name uses the id.
- User-typed details stay in `book_edits`, never in `books` (F16).
- **Books without an ISBN** can't currently be created (the edit form always carries one). If that changes, it needs its own design.

### 6.5 Server schema changes (one migration, Phase 2)
- **`book_edits` table:**
  - Columns: `user_id uuid default auth.uid()`, `book_id uuid references books`, `title`, `subtitle`, `authors jsonb`, `publisher`, `published_year`, `edition`, `cover_object text` (Storage path), `updated_at`, `deleted_at`.
  - `primary key (user_id, book_id)`, with owner-scoped RLS for select/insert/update/delete with `WITH CHECK`.
- **Ownership trigger (F5):** a `BEFORE INSERT OR UPDATE` trigger on `user_books`, `loans`, `readings` and `book_edits` rejects a row whose referenced `shelf_id` or `user_book_id` belongs to a different `user_id`. It is `security invoker` with `search_path = ''`.
- **Length caps (F6):**
  - shelf and borrower names: 1–80 chars;
  - notes and review: ≤ 2,000;
  - edit text fields: ≤ 300;
  - `authors`: ≤ 20 entries.
- **Indexes:** `(user_id, updated_at, id)` on every synced table, for the pull query.
- **Soft-delete purge (F13):** `pg_cron` runs daily, hard-deleting rows with `deleted_at < now() - interval '30 days'` in the user-owned tables, plus their Storage objects (done by a small `purge-covers` function scheduled the same way).
- **Storage:** a private bucket `covers`. Policies allow select/insert/update/delete only where `(storage.foldername(name))[1] = auth.uid()::text`.

### 6.6 Status and UI
The `status` store holds `{ state: 'idle'|'syncing'|'offline'|'error'|'signedOut', lastSyncedAt, pending, rejected }`, and Profile renders it as one line:
- "Backed up · 2 min ago"
- "Backing up…"
- "⟨N⟩ changes waiting"
- "Offline, will back up later"
- "⟨N⟩ change(s) couldn't sync". Tapping it lists them with "Try again" / "Discard".

Nothing else in the app shows sync UI.

### 6.7 Cover photos
- **Upload:** after its `book_edits` row pushes, a photo with no `cover_object` uploads to `covers/<uid>/<book_id>.jpg` (the existing ~600px JPEG, `upsert: true`), then pushes `cover_object`.
- **Remove:** "Remove photo" deletes the object and nulls `cover_object`.
- **Other devices:** download a missing photo when it's first displayed (`CoverArt` asks `covers.ensureLocal`), via a signed URL valid for 60s, cached in the documents directory. Until then the painted fallback cover shows.

## 7. Deletion, export and privacy (Phase 1)

### 7.1 Delete account
1. **What's deleted:** Profile → Delete account opens a screen that lists it: "your shelves, books, readings, loans and cover photos, on every device. This can't be undone." It carries an **Export my library** button.
2. **Confirm:** you type `DELETE` to enable the red button.
3. **Apple accounts:** the app first asks Apple for a fresh authorisation (`signInAsync`) to get an `authorizationCode`.
4. **The `delete-account` function:**
   - it verifies the JWT, and the caller can only ever delete themselves;
   - for Apple, it exchanges the code and calls Apple's token revocation endpoint;
   - it deletes every object under `covers/<uid>/`;
   - it calls `auth.admin.deleteUser(uid)`, and `on delete cascade` removes all rows.
   - Errors are generic, and nothing is logged beyond the outcome.
5. **On success:** a local wipe (§4), then Welcome. On failure: "Couldn't delete your account. Check your connection and try again." Nothing is wiped locally.

### 7.2 Export
- `src/features/export/libraryCsv.ts` is a pure function, and tested.
- **Output:** one row per copy (wishlist included), plus rows for books that have only a reading.
- **Columns:** title, authors, isbn13, status, shelf, reading state, started, finished, rating label, on loan to, loaned since.
- **Format:** RFC 4180 quoting. Cells starting with `=`, `+`, `-` or `@` are prefixed with `'` to prevent spreadsheet formula injection.
- Shared as `booklistd-library-YYYY-MM-DD.csv` via `expo-sharing`, and works offline.

### 7.3 Privacy
- **Data collected:** email, display name, the library, borrower names (typed by the owner, private to them) and cover photos. No tracking, ads or analytics SDKs.
- **Logging:** never log tokens, emails or borrower names, in the app (no `console.*` of auth objects) or in functions.
- **Privacy policy:** a draft is committed as `docs/privacy-policy.md`. Sean hosts it publicly and sets its URL in `src/lib/links.ts`.
- **Store disclosures:** the App Store Privacy labels and Play Data safety entries match the collected-data list above. None of it is linked to tracking.

## 8. Setup Sean does (documented in `docs/setup-accounts.md`)

1. **Apple:**
   - enable Sign in with Apple on the App ID;
   - create a Services ID and a Sign in with Apple key (Key ID, Team ID, `.p8`);
   - add them to Supabase → Auth → Apple.
2. **Google Cloud:**
   - create OAuth client IDs for iOS (bundle `com.sean.booklistd`), Android (package plus SHA-1 of the EAS keystore) and web;
   - add the web client ID and secret to Supabase → Auth → Google, and allow the iOS client ID as well.
3. **Supabase:**
   - set the redirect allow-list to `booklistd://auth/callback`;
   - turn on custom SMTP (Resend);
   - make sure password sign-up is off;
   - enable `pg_cron` (Phase 2).
4. **Secrets:** `APPLE_*` for token revocation, as function secrets. Never in the app or the repo.
5. **EAS:**
   - add `eas.json` with `development`, `preview` and `production` profiles;
   - run `eas build --profile development` for iOS and Android.
   - Expo Go is no longer used.

## 9. Testing

- **Unit (Jest):**
  - `ownershipAction`;
  - LargeSecureStore round-trip (mocked secure-store);
  - `coalesce`;
  - `pushOrder`;
  - `applyPulled` (pending wins; delete applies; newer server row replaces);
  - `nextCursor`;
  - book-id rewrite (all references plus queued payloads);
  - shelf name adoption on claim;
  - reject routing (a 4xx goes to `sync_rejects`, a 5xx retries);
  - `libraryCsv` (quoting, formula-injection prefix);
  - `ensure` input validation (shared `bookCore`).
- **Integration (Jest, fake Supabase client):**
  - claim → push everything → pull on a second "device" DB → edit on both → last edit wins;
  - sign in as a different user wipes before any push.
- **Manual (EAS dev build, iPhone and Android):**
  1. Sign in with Apple, Google and an email link, and sign out of each.
  2. Existing install: sign in claims the library, and it appears on a second device.
  3. Sign out with pending changes while offline (the warning shows), then sign in as someone else (nothing leaks).
  4. Edit the same book on two devices.
  5. Add a book by hand, then check it syncs with its cover.
  6. Delete a copy, and confirm it disappears on the other device.
  7. Export CSV.
  8. Delete account (Apple and Google users). Signing in again creates an empty account.
  9. Store Mode in airplane mode.

## 10. Risks

- **Offline too long:** a device offline for more than 30 days misses purged deletes. It is handled by the full re-pull in §6.3.
- **Account linking:** automatic linking relies on verified emails. An Apple private-relay email won't link to a Google account, so those become two accounts. That's acceptable; it's documented in the privacy policy FAQ.
- **Custom SMTP:** magic links fail silently without it. The setup doc flags this as a launch blocker.
