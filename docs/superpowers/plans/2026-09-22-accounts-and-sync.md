# Accounts and Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every library belongs to a signed-in account (Apple, Google or email link), and it backs up and syncs two ways across the owner's phones, covers included, while Store Mode stays fully offline.

**Architecture:**
- **Phase 1 (accounts):** a PKCE Supabase client with its session in an encrypted `LargeSecureStore`, a session store that gates the root layout between a Welcome screen and the app, and owner binding in `sync_meta`: claim on first sign-in, wipe when a different user signs in. It also adds UUID ids, the Profile → Account section, CSV export, and a `delete-account` edge function.
- **Phase 2 (sync):** our own engine on top of `pending_ops`.
  - **Push:** coalesce the queue, resolve local book ids to catalog ids through a new `ensure` call on `book-lookup`, upsert per table in a fixed order, and route 4xx rows to `sync_rejects`.
  - **Pull:** keyset pages on `(updated_at, id)`, where a pending local op always wins.
  - **Covers:** upload to a private `covers` bucket, and download lazily when a cover is first shown.
  - **Server:** one migration adds `book_edits`, the ownership trigger, length caps, sync indexes, the bucket, and a daily `pg_cron` purge.
- Pure decisions live in small tested modules: `ownership`, `sync/logic`, `libraryCsv`, and the `_shared` edge cores. I/O modules take their Supabase client as a parameter, so Jest can drive them against a fake server and an in-memory SQLite (sql.js).

**Tech Stack:**
- Expo SDK 57, RN 0.86, React 19.2, TypeScript 6, expo-router, expo-sqlite (sync API), zustand, TanStack Query, Jest (jest-expo).
- New app packages: expo-secure-store, expo-crypto, expo-apple-authentication, @react-native-google-signin/google-signin, expo-sharing, expo-dev-client and aes-js. New dev packages: @types/aes-js, sql.js and @types/sql.js.
- Server: Supabase (Postgres 17, RLS, Storage, pg_cron, pg_net, Vault) and Deno edge functions.

**Spec:** `docs/superpowers/specs/2026-09-22-accounts-and-sync-design.md` (binding; read it before any task).

## Global Constraints

- **Git:** subagents never run git state-changing commands (`add`, `commit`, `push`, `rm`, `mv`, `checkout`, `reset`, `stash`, `rebase`, `merge`, `tag`). Read-only `git status`/`git diff` is fine. Sean commits manually. Each task ends with a checkpoint that lists its files.
- **Supabase CLI:** never deploy functions, never run `supabase db push`, never run `supabase migration repair` or `supabase db pull`, never `supabase link`. Migrations and functions are written as files only. Sean applies them.
- **Secrets:**
  - Secrets never go in the app or the repo.
  - The app may only read `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME`. These are all public identifiers.
  - `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_CLIENT_ID` and `PURGE_COVERS_SECRET` are edge-function secrets. `project_url` and `purge_covers_secret` are Vault secrets. Sean sets all of them.
- **Logging:** never log tokens, emails or borrower names. No `console.*` of sessions, users, auth errors, payloads or rows in the app. Edge functions log only a request id and an outcome word.
- **Dependencies:**
  - Native: install with `npx expo install` only: `expo-secure-store expo-crypto expo-apple-authentication @react-native-google-signin/google-signin expo-sharing` (Task 1) and `expo-dev-client` (Task 8).
  - JS: `aes-js`.
  - Dev: `@types/aes-js sql.js @types/sql.js`.
  - Nothing else.
- **Why aes-js:** it is pure JavaScript, so it needs no native module and runs unchanged in Hermes and in Jest, and the secure-storage test exercises real encryption. It is the library Supabase's own React Native `LargeSecureStore` recipe uses. Hermes has no WebCrypto `subtle`, and expo-secure-store alone can't hold a full session on Android (about 2 KB limit).
- **Expo Go:** from Task 3 on the app needs an EAS development build (native Google sign-in). Jest tests mock every native module (`expo-secure-store`, `expo-crypto`, `expo-apple-authentication`, `@react-native-google-signin/google-signin`, `expo-sqlite`, `expo-file-system`, `expo-sharing`) and Supabase (a fake client for sync).
- **Node types in tests:** `tsconfig.json` limits global types to `jest`. Any test or test helper that uses Node APIs (`crypto`, `fs`, `path`, `Buffer`, `__dirname`, `require.resolve`) starts with `/// <reference types="node" />`.
- **Transactions never nest:** expo-sqlite's `withTransactionSync` can't be nested, and the test adapter throws if you try. A function that opens a transaction must never be called from inside another one.
- **Deno is not installed:** edge-function logic that can be pure lives in `supabase/functions/_shared/*.ts`. Those files are plain TypeScript with no imports, so they run in Deno, Hermes and Jest. They are tested by Jest from `src/lib/__tests__/`. `index.ts` files only wire I/O.
- **Synced tables:** `shelves`, `user_books`, `readings`, `book_edits`, `loans` and `profiles`. `books` is pull-only. `shelf_books` is never synced.
- **Push order, verbatim:** shelves → user_books → readings → book_edits → loans → profiles, in chunks of 200.
- **Payloads:** push payloads never carry `user_id` or `updated_at`. The server sets both: `auth.uid()` default plus RLS `WITH CHECK`, and the `touch_updated_at` trigger.
- **Copy (voice: warm librarian, plain verbs, sentence case; errors name the problem and the fix; Dewey stays silent on Welcome errors). Verbatim:**
  - "Your shelves, backed up and on every phone."
  - "Continue with Google"
  - "Email me a sign-in link"
  - "Send link"
  - "Check your inbox"
  - "Resend"
  - "That link has expired. Send a new one."
  - "Sign in again to back up"
  - "Backups coming soon"
  - "Your library isn't backed up yet. Signing out deletes it from this phone."
  - "⟨N⟩ changes haven't backed up yet. Sign out anyway?"
  - "Export my library (CSV)"
  - "Sign out"
  - "Delete account"
  - "your shelves, books, readings, loans and cover photos, on every device. This can't be undone."
  - "Export my library"
  - "Couldn't delete your account. Check your connection and try again."
  - "Backed up · 2 min ago"
  - "Backing up…"
  - "⟨N⟩ changes waiting"
  - "Offline, will back up later"
  - "⟨N⟩ change(s) couldn't sync"
  - "Try again"
  - "Discard"
- **Styling:**
  - Use existing tokens only: `@/theme/palette` (`ink`, `font`, `radius`) and `useTheme()`, plus the `PocketCard`, `LeaderRow` and `Button` components.
  - Yellow (`ink.bus`) is for the primary action only.
  - Figtree for all UI. Gochi Hand never on a control.
  - Hard offset shadows only (`Raised`).
- **Checks at the end of every task (the checkpoint):**
  - `npx tsc --noEmit` exits 0;
  - `npx jest` passes (132 tests at the start);
  - `npx expo-doctor` reports no failed checks.
- **Working directory:** `C:\Users\seanj\Documents\personal\Booklistd\Booklistd`. Paths below are relative to it.

---

## File map

| File | Status | Responsibility | Task |
|---|---|---|---|
| `package.json` | modify | deps, `jest.setupFiles`, expo-doctor directory exclude | 1, 2, 8 |
| `src/test/jestSetup.ts` | create | global mocks: expo-crypto (1); expo-sqlite, expo-file-system, expo-image-manipulator stubs (2) | 1, 2 |
| `src/auth/secureStorage.ts` (+test) | create | `LargeSecureStore`, `AUTH_STORAGE_KEY`, `forgetLocalSession` | 1 |
| `src/api/supabase.ts` (+test) | modify | PKCE client on `LargeSecureStore`; AppState refresh | 1 |
| `src/db/ids.ts` | modify | `newId()` = `Crypto.randomUUID()` | 2 |
| `src/db/database.ts` | modify | export `migrate`, `__setDbForTest` | 2 |
| `src/db/schema.ts` | modify | v5 (profiles), v6 (sync columns, `sync_rejects`, view) | 2, 11 |
| `src/db/pendingOps.ts` | create | `enqueueOp`, `pendingCount`, `setOnEnqueue` | 2, 15 |
| `src/db/localData.ts` (+test) | create | owner meta, `claimLibrary`, `wipeLocalData`, `saveProfileName`, meta helpers | 2 |
| `src/auth/ownership.ts` (+test) | create | pure `ownershipAction`, `bindOwner` | 2 |
| `src/test/memoryDb.ts`, `src/test/testDb.ts` | create | sql.js adapter with the expo-sqlite sync API; `freshDb()` | 2 |
| `src/test/fixtures.ts` | modify | `bookMeta()` | 2 |
| `src/features/bookEdits/coverFiles.ts` | modify | `deleteAllCoverFiles` (2), `renameCoverFile` (12) | 2, 12 |
| `src/db/repository.ts` | modify | uses `enqueueOp` (2); `listExportRows` (6); book_edits ops + `cover_object` (11); `coverPending` (16) | 2, 6, 11, 16 |
| `src/auth/session.ts` (+test) | create | `useSession`, `sessionStatus`, `routeGuards`, `methodOf`, `applySession`, `startSessionListener` | 3 |
| `src/auth/signIn.ts` (+test) | create | Apple, Google, email link, `completeEmailLink`, `SignInCancelled` | 3 |
| `src/auth/authErrors.ts` (+test) | create | `authErrorMessage`, `callbackResult` | 3 |
| `app/auth/callback.tsx` | create | email-link landing route | 3 |
| `src/auth/emailLink.ts` (+test) | create | `isPlausibleEmail`, `RESEND_AFTER_MS`, `resendLabel` | 4 |
| `src/lib/links.ts` | create | `PRIVACY_POLICY_URL` | 4 |
| `app/welcome.tsx` | create | Welcome screen | 4 |
| `app/_layout.tsx` | modify | session listener, `Stack.Protected` gate (4); sync start (15) | 4, 7, 15, 17 |
| `src/features/account/accountLines.ts` (+test) | create | `methodLabel`, `signOutWarning`, copy constants | 5 |
| `src/features/account/signOut.ts` (+test) | create | `signOut`, `endSession` | 5 |
| `src/components/account/AccountCard.tsx` | create | Profile → Account pocket card | 5, 6, 7 |
| `app/(tabs)/profile.tsx` | modify | Account section (5–7); sync status (15, 17) | 5, 6, 7, 15, 17 |
| `src/features/export/libraryCsv.ts` (+test) | create | pure CSV | 6 |
| `src/features/export/shareCsv.ts` | create | write + share file | 6 |
| `supabase/functions/_shared/accountCore.ts` (+test in `src/lib/__tests__`) | create | delete-account pure helpers | 7 |
| `supabase/functions/delete-account/index.ts` | create | delete-account function | 7 |
| `src/features/account/deleteAccount.ts` (+test) | create | client flow | 7 |
| `app/account/delete.tsx` | create | Delete account screen | 7 |
| `src/components/ui/Button.tsx` | modify | `danger` variant | 7 |
| `supabase/config.toml` | modify | auth + functions config | 8, 9 |
| `app.json`, `app.config.ts`, `eas.json` | modify/create | plugins, Apple capability, EAS profiles | 8 |
| `docs/setup-accounts.md`, `docs/privacy-policy.md` | create | Sean's setup; privacy draft | 8, 9 |
| `supabase/migrations/20260922180000_accounts_sync.sql` (+contract test) | create | Phase 2 server schema | 9 |
| `supabase/functions/_shared/purgeCore.ts` (+test), `supabase/functions/purge-covers/index.ts` | create | orphaned cover purge | 9 |
| `supabase/functions/_shared/bookCore.ts` (+test) | modify | `parseEnsureRequest` | 10 |
| `supabase/functions/book-lookup/index.ts` | modify | `POST { ensure }`; placeholders never served as hits | 10 |
| `src/lib/types.ts` | modify | `Book.source` gains `'placeholder'`; `Book.coverPending` | 11, 16 |
| `src/sync/logic.ts` (+test) | create | pure sync helpers | 11 |
| `src/sync/client.ts` | create | `SyncClient`, `SyncRetryable`, `statusOf` | 12 |
| `src/test/fakeSupabase.ts` | create | in-memory fake server | 12 |
| `src/sync/resolveBooks.ts` (+test) | create | `rewriteBookId`, `resolveBooks` | 12 |
| `src/sync/adoptShelves.ts` (+test) | create | `adoptionPlan`, `rewriteShelfId`, `adoptShelvesOnClaim` | 12 |
| `src/sync/push.ts` (+test) | create | push | 13 |
| `src/sync/pull.ts` (+test) | create | pull, stale reset | 14 |
| `src/sync/status.ts` (+test) | create | `useSyncStatus`, `statusLine` | 15 |
| `src/sync/engine.ts` (+tests incl. integration) | create | single-flight engine, triggers | 15, 16 |
| `src/providers/QueryProvider.tsx` | modify | export `queryClient` | 15 |
| `src/sync/covers.ts` (+test) | create | upload, `ensureLocal` | 16 |
| `src/components/shelf/CoverArt.tsx` + 4 call sites | modify | lazy synced-cover download | 16 |
| `src/sync/rejects.ts` (+test) | create | list/retry/discard, `describeReject` | 17 |
| `app/account/rejects.tsx` | create | rejects list | 17 |

---

# Phase 1 — Accounts

### Task 1: Dependencies, secure session storage and the PKCE client

**Files:**
- Modify: `package.json`, `src/api/supabase.ts`
- Create: `src/auth/secureStorage.ts`, `src/test/jestSetup.ts`
- Test: `src/auth/__tests__/secureStorage.test.ts`, `src/api/__tests__/supabase.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  // src/auth/secureStorage.ts
  export const AUTH_STORAGE_KEY = 'booklistd-auth';
  export const LargeSecureStore: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  };
  export function forgetLocalSession(): Promise<void>;
  // src/api/supabase.ts (unchanged exports)
  export const supabaseConfigured: boolean;
  export const supabase: SupabaseClient;
  ```

- [ ] **Step 1: Install dependencies**

Run:
```bash
npx expo install expo-secure-store expo-crypto expo-apple-authentication @react-native-google-signin/google-signin expo-sharing
npm install aes-js
npm install --save-dev @types/aes-js sql.js @types/sql.js
```
Expected: all five native packages land in `dependencies` with SDK 57 versions, `aes-js` in `dependencies`, and the three dev packages in `devDependencies`.

- [ ] **Step 2: Wire the Jest setup file and the expo-doctor exclude**

In `package.json`:
- replace the `"jest"` block with the one below;
- add the `"expo"` block after it, so expo-doctor doesn't fail on `aes-js`, a pure-JS package with no React Native Directory entry.

```json
  "jest": {
    "preset": "jest-expo",
    "setupFiles": ["<rootDir>/src/test/jestSetup.ts"],
    "moduleNameMapper": {
      "^@/(.*)$": "<rootDir>/src/$1"
    }
  },
  "expo": {
    "doctor": {
      "reactNativeDirectoryCheck": {
        "exclude": ["aes-js"],
        "listUnknownPackages": false
      }
    }
  }
```

Create `src/test/jestSetup.ts`:

```ts
/**
 * Global Jest mocks for native modules that many files import transitively.
 * A test that needs different behaviour calls jest.mock() for the same module itself; that wins.
 */
jest.mock('expo-crypto', () => {
  const nodeCrypto = jest.requireActual('crypto');
  return {
    randomUUID: () => nodeCrypto.randomUUID(),
    getRandomBytes: (n: number) => new Uint8Array(nodeCrypto.randomBytes(n)),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digestStringAsync: async (_algorithm: string, data: string) => nodeCrypto.createHash('sha256').update(data).digest('hex'),
  };
});
```

- [ ] **Step 3: Write the failing secure-storage test**

Create `src/auth/__tests__/secureStorage.test.ts`:

```ts
const mockSecure = new Map<string, string>();
const mockAsync = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  setItemAsync: jest.fn(async (k: string, v: string) => { mockSecure.set(k, v); }),
  getItemAsync: jest.fn(async (k: string) => mockSecure.get(k) ?? null),
  deleteItemAsync: jest.fn(async (k: string) => { mockSecure.delete(k); }),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    setItem: jest.fn(async (k: string, v: string) => { mockAsync.set(k, v); }),
    getItem: jest.fn(async (k: string) => mockAsync.get(k) ?? null),
    removeItem: jest.fn(async (k: string) => { mockAsync.delete(k); }),
  },
}));

import * as SecureStore from 'expo-secure-store';
import { AUTH_STORAGE_KEY, forgetLocalSession, LargeSecureStore } from '../secureStorage';

const SESSION = JSON.stringify({ access_token: 'aaa.bbb.ccc', refresh_token: 'refresh-123', user: { id: 'u1' } });

beforeEach(() => {
  mockSecure.clear();
  mockAsync.clear();
  jest.clearAllMocks();
});

describe('LargeSecureStore', () => {
  it('round-trips a session', async () => {
    await LargeSecureStore.setItem(AUTH_STORAGE_KEY, SESSION);
    expect(await LargeSecureStore.getItem(AUTH_STORAGE_KEY)).toBe(SESSION);
  });

  it('keeps only ciphertext in AsyncStorage', async () => {
    await LargeSecureStore.setItem(AUTH_STORAGE_KEY, SESSION);
    const stored = mockAsync.get(AUTH_STORAGE_KEY)!;
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]+$/);
    expect(stored).not.toContain('refresh-123');
  });

  it('keeps a 256-bit key in secure storage, this device only', async () => {
    await LargeSecureStore.setItem(AUTH_STORAGE_KEY, SESSION);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'booklistd-auth.key',
      expect.stringMatching(/^[0-9a-f]{64}$/),
      { keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' }
    );
  });

  it('uses a fresh key and IV on every write', async () => {
    await LargeSecureStore.setItem(AUTH_STORAGE_KEY, SESSION);
    const first = [mockSecure.get('booklistd-auth.key'), mockAsync.get(AUTH_STORAGE_KEY)];
    await LargeSecureStore.setItem(AUTH_STORAGE_KEY, SESSION);
    expect(mockSecure.get('booklistd-auth.key')).not.toBe(first[0]);
    expect(mockAsync.get(AUTH_STORAGE_KEY)).not.toBe(first[1]);
  });

  it('returns null when nothing is stored', async () => {
    expect(await LargeSecureStore.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });

  it('returns null when the key is gone (e.g. restored backup on a new phone)', async () => {
    await LargeSecureStore.setItem(AUTH_STORAGE_KEY, SESSION);
    mockSecure.clear();
    expect(await LargeSecureStore.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });

  it('removeItem deletes both halves', async () => {
    await LargeSecureStore.setItem(AUTH_STORAGE_KEY, SESSION);
    await LargeSecureStore.removeItem(AUTH_STORAGE_KEY);
    expect(mockAsync.has(AUTH_STORAGE_KEY)).toBe(false);
    expect(mockSecure.has('booklistd-auth.key')).toBe(false);
  });

  it('forgetLocalSession clears the session and the PKCE verifier', async () => {
    await LargeSecureStore.setItem(AUTH_STORAGE_KEY, SESSION);
    await LargeSecureStore.setItem(`${AUTH_STORAGE_KEY}-code-verifier`, 'verifier');
    await forgetLocalSession();
    expect(mockAsync.size).toBe(0);
    expect(mockSecure.size).toBe(0);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx jest src/auth/__tests__/secureStorage.test.ts`
Expected: FAIL with "Cannot find module '../secureStorage'".

- [ ] **Step 5: Implement `LargeSecureStore`**

Create `src/auth/secureStorage.ts`:

```ts
/**
 * LargeSecureStore: the supabase-js storage adapter (spec §3.3).
 * A session is too big for the Keychain/Keystore (about 2 KB on Android), so the JSON is AES-256-CTR
 * encrypted into AsyncStorage and only the 256-bit key lives in expo-secure-store. Every write uses a
 * fresh key and IV, so a counter is never reused under one key. Never log what passes through here.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import aesjs from 'aes-js';

export const AUTH_STORAGE_KEY = 'booklistd-auth';

const KEY_OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const { hex, utf8 } = aesjs.utils;
// Secure-store keys allow only [A-Za-z0-9._-]; supabase-js keys are "booklistd-auth" and "booklistd-auth-code-verifier".
const keyName = (key: string) => `${key}.key`;
const ctr = (key: Uint8Array, iv: Uint8Array) => new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(iv));

async function encrypt(key: string, value: string): Promise<string> {
  const k = Crypto.getRandomBytes(32);
  const iv = Crypto.getRandomBytes(16);
  const body = ctr(k, iv).encrypt(utf8.toBytes(value));
  await SecureStore.setItemAsync(keyName(key), hex.fromBytes(k), KEY_OPTIONS);
  return `${hex.fromBytes(iv)}:${hex.fromBytes(body)}`;
}

async function decrypt(key: string, stored: string): Promise<string | null> {
  const k = await SecureStore.getItemAsync(keyName(key), KEY_OPTIONS);
  const [ivHex, bodyHex] = stored.split(':');
  if (!k || !ivHex || !bodyHex) return null;
  try {
    return utf8.fromBytes(ctr(hex.toBytes(k), hex.toBytes(ivHex)).decrypt(hex.toBytes(bodyHex)));
  } catch {
    return null;
  }
}

export const LargeSecureStore = {
  async getItem(key: string): Promise<string | null> {
    const stored = await AsyncStorage.getItem(key);
    return stored ? decrypt(key, stored) : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(key, await encrypt(key, value));
  },
  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(keyName(key), KEY_OPTIONS);
  },
};

/** Drops this phone's session even when the sign-out request can't reach the server. */
export async function forgetLocalSession(): Promise<void> {
  for (const k of [AUTH_STORAGE_KEY, `${AUTH_STORAGE_KEY}-code-verifier`, `${AUTH_STORAGE_KEY}-user`]) {
    await LargeSecureStore.removeItem(k).catch(() => {});
  }
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npx jest src/auth/__tests__/secureStorage.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 7: Write the failing client test**

Create `src/api/__tests__/supabase.test.ts`:

```ts
const mockAuth = { startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn() };
const mockCreateClient = jest.fn((..._args: unknown[]) => ({ auth: mockAuth }));
jest.mock('@supabase/supabase-js', () => ({ createClient: (...a: unknown[]) => mockCreateClient(...a) }));
jest.mock('react-native-url-polyfill/auto', () => ({}));
jest.mock('@/auth/secureStorage', () => ({ LargeSecureStore: { name: 'LargeSecureStore' }, AUTH_STORAGE_KEY: 'booklistd-auth' }));
let mockOnAppState: ((s: string) => void) | null = null;
jest.mock('react-native', () => ({
  AppState: { addEventListener: (_: string, fn: (s: string) => void) => { mockOnAppState = fn; return { remove: jest.fn() }; } },
}));

import '../supabase';

describe('supabase client', () => {
  it('uses PKCE and the encrypted store, and never reads sessions from URLs', () => {
    const options = mockCreateClient.mock.calls[0][2] as { auth: Record<string, unknown> };
    expect(options.auth).toEqual({
      storage: { name: 'LargeSecureStore' },
      storageKey: 'booklistd-auth',
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    });
  });

  it('refreshes tokens only while the app is in the foreground', () => {
    mockOnAppState!('active');
    expect(mockAuth.startAutoRefresh).toHaveBeenCalledTimes(1);
    mockOnAppState!('background');
    expect(mockAuth.stopAutoRefresh).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `npx jest src/api/__tests__/supabase.test.ts`
Expected: FAIL. The options still use `AsyncStorage` and have no `flowType`, and `mockOnAppState` is null.

- [ ] **Step 9: Switch the client to PKCE and LargeSecureStore**

Replace `src/api/supabase.ts` with:

```ts
import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { AUTH_STORAGE_KEY, LargeSecureStore } from '@/auth/secureStorage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabaseConfigured = url.length > 0 && anonKey.length > 0;

export const supabase = createClient(url || 'http://localhost', anonKey || 'anon', {
  auth: {
    storage: LargeSecureStore,
    storageKey: AUTH_STORAGE_KEY,
    flowType: 'pkce',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Supabase's React Native guidance: refresh tokens only while the app is in the foreground.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx jest src/api src/auth`
Expected: PASS (10 new tests; `lookupErrors` still passes).

- [ ] **Step 11: Checkpoint**

Run `npx tsc --noEmit`, `npx jest`, `npx expo-doctor`.
Expected:
- tsc exits 0;
- 142 tests pass;
- expo-doctor has no failed checks.

Hand Sean the file list: `package.json`, `package-lock.json`, `src/test/jestSetup.ts`, `src/auth/secureStorage.ts`, `src/auth/__tests__/secureStorage.test.ts`, `src/api/supabase.ts`, `src/api/__tests__/supabase.test.ts`. Do not commit.

---

### Task 2: UUID ids, owner binding and the local wipe

**Files:**
- Modify: `src/db/ids.ts`, `src/db/database.ts`, `src/db/schema.ts`, `src/db/repository.ts` (enqueue only), `src/features/bookEdits/coverFiles.ts`, `src/test/jestSetup.ts`, `src/test/fixtures.ts`
- Create: `src/db/pendingOps.ts`, `src/db/localData.ts`, `src/auth/ownership.ts`, `src/test/memoryDb.ts`, `src/test/testDb.ts`
- Test: `src/auth/__tests__/ownership.test.ts`, `src/db/__tests__/localData.test.ts`

**Interfaces:**
- Consumes: the global `expo-crypto` mock (Task 1).
- Produces:
  ```ts
  // src/db/ids.ts
  export function newId(): string; // RFC 4122 v4 UUID
  // src/db/database.ts
  export function getDb(): SQLiteDatabase;
  export function migrate(d: SQLiteDatabase): void;
  export function __setDbForTest(d: SQLiteDatabase | null): void;
  // src/db/pendingOps.ts
  export type OpKind = 'upsert' | 'delete';
  export function enqueueOp(table: string, rowId: string, op: OpKind, payload: unknown): void;
  export function pendingCount(): number; // distinct (table,row) awaiting push, shelf_books excluded
  // src/db/localData.ts
  export const OWNER_KEY = 'owner_user_id';
  export const ADOPT_SHELVES_KEY = 'adopt_shelves';
  export function getMeta(key: string): string | null;
  export function setMeta(key: string, value: string): void;
  export function deleteMeta(key: string): void;
  export function getOwner(): string | null;
  export function claimLibrary(userId: string): number; // rows snapshotted
  export function wipeLocalData(): void;
  export function saveProfileName(userId: string, name: string): void;
  // src/auth/ownership.ts
  export type OwnershipAction = 'claim' | 'continue' | 'wipe';
  export function ownershipAction(ownerId: string | null, signedInId: string): OwnershipAction;
  export function bindOwner(userId: string): OwnershipAction;
  // src/features/bookEdits/coverFiles.ts
  export function deleteAllCoverFiles(): void;
  // src/test/testDb.ts
  export function freshDb(): Promise<SQLiteDatabase>;
  // src/test/fixtures.ts
  export function bookMeta(p?: { isbn13?: string; title?: string }): Omit<Book, 'id'>;
  ```

- [ ] **Step 1: UUID ids**

Replace `src/db/ids.ts` with:

```ts
import * as Crypto from 'expo-crypto';

/** RFC 4122 v4 UUID from the platform CSPRNG (F9). Server id columns for user-owned tables are text, so older ids stay valid. */
export function newId(): string {
  return Crypto.randomUUID();
}
```

- [ ] **Step 2: Test hooks on the database module**

Replace `src/db/database.ts` with:

```ts
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import { MIGRATIONS, SCHEMA_VERSION } from './schema';

export { newId } from './ids';

let db: SQLiteDatabase | null = null;

export function getDb(): SQLiteDatabase {
  if (db) return db;
  db = openDatabaseSync('mylibrary.db');
  db.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

export function migrate(d: SQLiteDatabase) {
  const row = d.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let v = current; v < SCHEMA_VERSION; v++) {
    d.withTransactionSync(() => {
      const m = MIGRATIONS[v];
      if (typeof m === 'string') d.execSync(m);
      else m(d);
      d.execSync(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/** Tests only: point getDb() at an in-memory database (see src/test/testDb.ts). */
export function __setDbForTest(d: SQLiteDatabase | null): void {
  db = d;
}
```

- [ ] **Step 3: Schema v5 (local profiles)**

In `src/db/schema.ts`, change `export const SCHEMA_VERSION = 4;` to `export const SCHEMA_VERSION = 5;`, and add this entry after `migrateV4ShelfCreation,` in `MIGRATIONS`:

```ts
  // v5 — accounts: the signed-in user's profile row (Apple gives the name only once, so it is kept here and synced).
  `
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    display_name TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
```

- [ ] **Step 4: The pending-ops module; repository uses it**

Create `src/db/pendingOps.ts`:

```ts
/** The offline queue. Every repository write lands here as a row snapshot; the sync engine drains it. */
import { getDb } from './database';

export type OpKind = 'upsert' | 'delete';

export function enqueueOp(table: string, rowId: string, op: OpKind, payload: unknown): void {
  getDb().runSync(
    'INSERT INTO pending_ops (table_name, row_id, op, payload) VALUES (?, ?, ?, ?)',
    [table, rowId, op, JSON.stringify(payload)]
  );
}

/** Rows (not ops) still waiting to back up. */
export function pendingCount(): number {
  return (
    getDb().getFirstSync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM (SELECT DISTINCT table_name, row_id FROM pending_ops WHERE table_name != 'shelf_books')`
    )?.n ?? 0
  );
}
```

In `src/db/repository.ts`:
- replace the private `enqueue` function (the `function enqueue(table: string, rowId: string, op: 'upsert' | 'delete', payload: unknown) { … }` block) with the one-line alias below;
- add `import { enqueueOp } from './pendingOps';` under the `./database` import.

```ts
const enqueue = enqueueOp;
```

Also update the header comment's first two lines to:

```ts
 * Repository — every screen talks to this, never to SQLite directly.
 * Writes also enqueue a pending_op (src/db/pendingOps.ts) that the sync engine (src/sync) pushes oldest-first.
```

and delete the three "Phase 3 notes" lines below them. `src/sync/push.ts` and `src/sync/adoptShelves.ts` implement those notes.

- [ ] **Step 5: Covers directory wipe**

Append to `src/features/bookEdits/coverFiles.ts`:

```ts
/** Best-effort: removes every local cover photo (used by the account wipe). */
export function deleteAllCoverFiles(): void {
  try {
    const dir = new Directory(Paths.document, COVERS_DIR);
    if (dir.exists) dir.delete();
  } catch {
    // A leftover folder is harmless; the rows that pointed at it are gone.
  }
}
```

- [ ] **Step 6: In-memory SQLite for tests**

Create `src/test/memoryDb.ts`:

```ts
/// <reference types="node" />
/**
 * sql.js (SQLite compiled to WebAssembly) behind the subset of expo-sqlite's sync API the app uses,
 * so repository, migrations and sync code run against real SQL in Jest.
 */
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import type { SQLiteDatabase } from 'expo-sqlite';

type Bind = (string | number | null | Uint8Array)[];
let SQL: SqlJsStatic | null = null;

const bindable = (params: unknown): Bind =>
  (Array.isArray(params) ? params : params === undefined ? [] : [params]).map((v) =>
    v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : (v as string | number | null | Uint8Array)
  );

export async function openMemoryDb(): Promise<SQLiteDatabase> {
  SQL ??= await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) });
  const raw: Database = new SQL.Database();
  let inTransaction = false;

  const all = <T>(source: string, params?: unknown): T[] => {
    const stmt = raw.prepare(source);
    try {
      stmt.bind(bindable(params));
      const out: T[] = [];
      while (stmt.step()) out.push(stmt.getAsObject() as T);
      return out;
    } finally {
      stmt.free();
    }
  };

  const db = {
    execSync: (source: string) => {
      raw.exec(source);
    },
    runSync: (source: string, params?: unknown) => {
      raw.run(source, bindable(params));
      const changes = raw.getRowsModified();
      const last = all<{ id: number }>('SELECT last_insert_rowid() AS id')[0]?.id ?? 0;
      return { changes, lastInsertRowId: Number(last) };
    },
    getFirstSync: <T>(source: string, params?: unknown): T | null => all<T>(source, params)[0] ?? null,
    getAllSync: all,
    // expo-sqlite runs BEGIN…COMMIT and can't nest ("cannot start a transaction within a transaction"),
    // so nesting fails loudly here too instead of passing in tests and crashing on a phone.
    withTransactionSync: (task: () => void) => {
      if (inTransaction) throw new Error('withTransactionSync cannot be nested (expo-sqlite would fail)');
      inTransaction = true;
      raw.exec('BEGIN');
      try {
        task();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      } finally {
        inTransaction = false;
      }
    },
    closeSync: () => raw.close(),
  };
  return db as unknown as SQLiteDatabase;
}
```

Create `src/test/testDb.ts`:

```ts
import type { SQLiteDatabase } from 'expo-sqlite';
import { __setDbForTest, migrate } from '@/db/database';
import { openMemoryDb } from './memoryDb';

/** A migrated, empty database that getDb() now returns. Call in beforeEach. */
export async function freshDb(): Promise<SQLiteDatabase> {
  const d = await openMemoryDb();
  d.execSync('PRAGMA foreign_keys = ON;');
  migrate(d);
  __setDbForTest(d);
  return d;
}
```

Append to `src/test/jestSetup.ts`:

```ts
// The real database is native; tests use freshDb() from src/test/testDb.ts instead.
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    throw new Error('Tests must call freshDb() from src/test/testDb.ts');
  },
}));

// Minimal file-system stubs: nothing exists, writes are no-ops. Tests that care mock these themselves.
jest.mock('expo-file-system', () => {
  const join = (parts: unknown[]) => parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
  class File {
    uri: string;
    exists = false;
    constructor(...parts: unknown[]) { this.uri = join(parts); }
    static downloadFileAsync = jest.fn(async (_url: string, dest: File) => dest);
    create() {}
    write() {}
    delete() {}
    copySync() {}
    moveSync() {}
    async bytes() { return new Uint8Array(); }
  }
  class Directory {
    uri: string;
    exists = false;
    constructor(...parts: unknown[]) { this.uri = join(parts); }
    create() {}
    delete() {}
  }
  return { File, Directory, Paths: { document: { uri: 'file:///docs' }, cache: { uri: 'file:///cache' } } };
});
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' } }));
```

Add to `src/test/fixtures.ts`. Change the import line to `import type { Book, LibraryRow } from '@/lib/types';` and append:

```ts
/** Catalog metadata for upsertBook(). The default ISBN is Dune's, with a valid checksum. */
export function bookMeta(p: { isbn13?: string; title?: string } = {}): Omit<Book, 'id'> {
  return {
    isbn13: p.isbn13 ?? '9780441172719', isbn10: null, title: p.title ?? 'Dune', subtitle: null, authors: ['Frank Herbert'],
    publisher: null, publishedYear: null, edition: null, genres: [], pageCount: null, coverUrl: null,
    description: null, workKey: null, source: 'manual',
  };
}
```

- [ ] **Step 7: Write the failing tests**

Create `src/auth/__tests__/ownership.test.ts`:

```ts
jest.mock('@/features/bookEdits/coverFiles', () => ({
  ...jest.requireActual('@/features/bookEdits/coverFiles'),
  deleteAllCoverFiles: jest.fn(),
}));

import { deleteAllCoverFiles } from '@/features/bookEdits/coverFiles';
import { addUserBook, createShelf, upsertBook } from '@/db/repository';
import { getOwner } from '@/db/localData';
import { newId } from '@/db/ids';
import { bookMeta } from '@/test/fixtures';
import { freshDb } from '@/test/testDb';
import { bindOwner, ownershipAction } from '../ownership';

describe('ownershipAction', () => {
  it('claims an unowned library (including pre-accounts installs)', () => {
    expect(ownershipAction(null, 'u1')).toBe('claim');
  });
  it('continues for the same user', () => {
    expect(ownershipAction('u1', 'u1')).toBe('continue');
  });
  it('wipes for a different user', () => {
    expect(ownershipAction('u1', 'u2')).toBe('wipe');
  });
});

describe('bindOwner', () => {
  let db: Awaited<ReturnType<typeof freshDb>>;
  beforeEach(async () => {
    db = await freshDb();
    jest.clearAllMocks();
  });
  const count = (table: string) => db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n;

  it('claim sets the owner', () => {
    expect(bindOwner('u1')).toBe('claim');
    expect(getOwner()).toBe('u1');
  });

  it('continue changes nothing', () => {
    bindOwner('u1');
    createShelf('Study');
    const ops = count('pending_ops');
    expect(bindOwner('u1')).toBe('continue');
    expect(count('pending_ops')).toBe(ops);
    expect(count('shelves')).toBe(1);
  });

  it('a different user wipes every local row and the covers, then takes ownership', () => {
    bindOwner('u1');
    const shelf = createShelf('Study');
    const book = upsertBook(bookMeta());
    addUserBook(book.id, 'owned', shelf.id);
    expect(bindOwner('u2')).toBe('wipe');
    for (const t of ['books', 'user_books', 'shelves', 'pending_ops']) expect(count(t)).toBe(0);
    expect(getOwner()).toBe('u2');
    expect(deleteAllCoverFiles).toHaveBeenCalledTimes(1);
    expect(db.getFirstSync<{ user_version: number }>('PRAGMA user_version')!.user_version).toBeGreaterThanOrEqual(5);
  });
});

describe('newId', () => {
  it('is a v4 UUID', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
```

Create `src/db/__tests__/localData.test.ts`:

```ts
jest.mock('@/features/bookEdits/coverFiles', () => ({
  ...jest.requireActual('@/features/bookEdits/coverFiles'),
  deleteAllCoverFiles: jest.fn(),
}));

import { addUserBook, createShelf, removeCopy, saveBookEdit, setReadingState, upsertBook } from '@/db/repository';
import { bookMeta } from '@/test/fixtures';
import { freshDb } from '@/test/testDb';
import { ADOPT_SHELVES_KEY, claimLibrary, getMeta, getOwner, saveProfileName, wipeLocalData } from '../localData';
import { pendingCount } from '../pendingOps';

let db: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => {
  db = await freshDb();
});
const ops = () => db.getAllSync<{ table_name: string; row_id: string }>('SELECT table_name, row_id FROM pending_ops ORDER BY id');

describe('claimLibrary', () => {
  it('snapshots every live row once, in push order, and flags shelf adoption', () => {
    const shelf = createShelf('Study');
    const book = upsertBook(bookMeta());
    const copy = addUserBook(book.id, 'owned', shelf.id);
    const gone = addUserBook(book.id, 'wishlist');
    removeCopy(gone.id);
    setReadingState(book.id, 'reading', '2026-09-01');
    saveBookEdit(book.id, { title: 'Dune (mine)', subtitle: null, authors: null, publisher: null, publishedYear: null, edition: null });
    db.execSync('DELETE FROM pending_ops');

    expect(claimLibrary('u1')).toBe(4);
    expect(ops().map((o) => o.table_name)).toEqual(['shelves', 'user_books', 'readings', 'book_edits']);
    expect(ops().some((o) => o.row_id === gone.id)).toBe(false);
    expect(ops().find((o) => o.table_name === 'user_books')!.row_id).toBe(copy.id);
    expect(getOwner()).toBe('u1');
    expect(getMeta(ADOPT_SHELVES_KEY)).toBe('1');
  });

  it('an empty library claims without snapshots or adoption', () => {
    expect(claimLibrary('u1')).toBe(0);
    expect(ops()).toEqual([]);
    expect(getMeta(ADOPT_SHELVES_KEY)).toBeNull();
  });
});

describe('wipeLocalData', () => {
  it('empties every table but keeps the schema version', () => {
    createShelf('Study');
    saveProfileName('u1', 'Sean');
    wipeLocalData();
    for (const t of ['shelves', 'profiles', 'pending_ops', 'sync_meta']) {
      expect(db.getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n).toBe(0);
    }
    expect(db.getFirstSync<{ user_version: number }>('PRAGMA user_version')!.user_version).toBeGreaterThanOrEqual(5);
  });
});

describe('saveProfileName', () => {
  it('keeps the name locally and queues it for backup', () => {
    saveProfileName('u1', 'Sean Merchant');
    expect(db.getFirstSync<{ display_name: string }>('SELECT display_name FROM profiles WHERE id = ?', ['u1'])!.display_name).toBe('Sean Merchant');
    expect(ops()).toEqual([{ table_name: 'profiles', row_id: 'u1' }]);
    expect(pendingCount()).toBe(1);
  });
});
```

- [ ] **Step 8: Run them to verify they fail**

Run: `npx jest src/auth/__tests__/ownership.test.ts src/db/__tests__/localData.test.ts`
Expected: FAIL with "Cannot find module '../ownership'" and "Cannot find module '../localData'".

- [ ] **Step 9: Implement local data and ownership**

Create `src/db/localData.ts`:

```ts
/**
 * Whose library this is (spec §4) and the two things that change it: claim and wipe.
 * The owner lives in sync_meta under OWNER_KEY. Nothing from a previous owner is ever pushed under a new session.
 */
import { getDb } from './database';
import { enqueueOp } from './pendingOps';
import { deleteAllCoverFiles } from '@/features/bookEdits/coverFiles';

export const OWNER_KEY = 'owner_user_id';
/** Set when a non-empty library is claimed; the first push matches local shelves to server shelves by name. */
export const ADOPT_SHELVES_KEY = 'adopt_shelves';

/** Children before parents, so foreign keys never block the wipe. Tables added later are skipped until they exist. */
const WIPE_ORDER = [
  'loans', 'readings', 'book_edits', 'shelf_books', 'user_books', 'shelves', 'books', 'profiles',
  'pending_ops', 'sync_rejects', 'sync_meta',
] as const;

/** Live rows snapshotted on claim, in push order. */
const CLAIM_SNAPSHOTS: { table: string; key: string; sql: string }[] = [
  { table: 'shelves', key: 'id', sql: 'SELECT * FROM shelves WHERE deleted_at IS NULL' },
  { table: 'user_books', key: 'id', sql: 'SELECT * FROM user_books WHERE deleted_at IS NULL' },
  { table: 'readings', key: 'id', sql: 'SELECT * FROM readings WHERE deleted_at IS NULL' },
  { table: 'book_edits', key: 'book_id', sql: 'SELECT * FROM book_edits' },
  { table: 'loans', key: 'id', sql: 'SELECT * FROM loans WHERE deleted_at IS NULL' },
];

export function getMeta(key: string): string | null {
  return getDb().getFirstSync<{ value: string | null }>('SELECT value FROM sync_meta WHERE key = ?', [key])?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  getDb().runSync('INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

export function deleteMeta(key: string): void {
  getDb().runSync('DELETE FROM sync_meta WHERE key = ?', [key]);
}

export function getOwner(): string | null {
  return getMeta(OWNER_KEY);
}

/** Takes ownership. A non-empty library is snapshotted once, so all of it uploads on the first push. */
export function claimLibrary(userId: string): number {
  const d = getDb();
  let n = 0;
  let shelves = 0;
  d.withTransactionSync(() => {
    for (const s of CLAIM_SNAPSHOTS) {
      for (const row of d.getAllSync<Record<string, unknown>>(s.sql)) {
        enqueueOp(s.table, String(row[s.key]), 'upsert', row);
        n++;
        if (s.table === 'shelves') shelves++;
      }
    }
    setMeta(OWNER_KEY, userId);
    if (shelves > 0) setMeta(ADOPT_SHELVES_KEY, '1');
  });
  return n;
}

/** Deletes every local row (the schema and PRAGMA user_version stay) and the covers folder. */
export function wipeLocalData(): void {
  const d = getDb();
  d.withTransactionSync(() => {
    for (const t of WIPE_ORDER) {
      const exists = d.getFirstSync("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [t]);
      if (exists) d.runSync(`DELETE FROM ${t}`);
    }
  });
  deleteAllCoverFiles();
}

/** Apple returns the name only on the first authorisation, so it is stored at once and queued for backup. */
export function saveProfileName(userId: string, name: string): void {
  const d = getDb();
  d.runSync(
    `INSERT INTO profiles (id, display_name, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, updated_at = datetime('now')`,
    [userId, name.slice(0, 80)]
  );
  enqueueOp('profiles', userId, 'upsert', d.getFirstSync('SELECT * FROM profiles WHERE id = ?', [userId]));
}
```

Create `src/auth/ownership.ts`:

```ts
/** Binds the local library to the signed-in user (spec §4, fixes F1). */
import { claimLibrary, getOwner, OWNER_KEY, setMeta, wipeLocalData } from '@/db/localData';

export type OwnershipAction = 'claim' | 'continue' | 'wipe';

export function ownershipAction(ownerId: string | null, signedInId: string): OwnershipAction {
  if (!ownerId) return 'claim';
  return ownerId === signedInId ? 'continue' : 'wipe';
}

/** Idempotent: safe to call on every session start. A wipe always happens before anything can push. */
export function bindOwner(userId: string): OwnershipAction {
  const action = ownershipAction(getOwner(), userId);
  if (action === 'claim') claimLibrary(userId);
  if (action === 'wipe') {
    wipeLocalData();
    setMeta(OWNER_KEY, userId);
  }
  return action;
}
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx jest src/auth src/db`
Expected: PASS (ownership 7, localData 4, plus Task 1's).

- [ ] **Step 11: Checkpoint**

Run `npx tsc --noEmit`, `npx jest`, `npx expo-doctor`.
Expected: all clean, with 153 tests passing.

Hand Sean the file list: `src/db/ids.ts`, `src/db/database.ts`, `src/db/schema.ts`, `src/db/pendingOps.ts`, `src/db/localData.ts`, `src/db/repository.ts`, `src/db/__tests__/localData.test.ts`, `src/auth/ownership.ts`, `src/auth/__tests__/ownership.test.ts`, `src/features/bookEdits/coverFiles.ts`, `src/test/memoryDb.ts`, `src/test/testDb.ts`, `src/test/jestSetup.ts`, `src/test/fixtures.ts`.

---

### Task 3: Sign-in service (Apple, Google, email link), session store and callback route

**Files:**
- Create: `src/auth/session.ts`, `src/auth/signIn.ts`, `src/auth/authErrors.ts`, `app/auth/callback.tsx`
- Test: `src/auth/__tests__/session.test.ts`, `src/auth/__tests__/signIn.test.ts`, `src/auth/__tests__/authErrors.test.ts`

**Interfaces:**
- Consumes: `supabase` (Task 1); `bindOwner` (Task 2); `getOwner`, `saveProfileName` (Task 2).
- Produces:
  ```ts
  // src/auth/session.ts
  export type AuthMethod = 'apple' | 'google' | 'email';
  export type SessionStatus = 'loading' | 'signedIn' | 'expired' | 'signedOut';
  export interface SessionState { status: SessionStatus; userId: string | null; email: string | null; method: AuthMethod | null; providers: string[] }
  export const useSession: UseBoundStore<StoreApi<SessionState>>;
  export function sessionStatus(hasSession: boolean, ownerId: string | null): Exclude<SessionStatus, 'loading'>;
  export function routeGuards(status: SessionStatus): { app: boolean; welcome: boolean };
  export function methodOf(user: { app_metadata?: { provider?: string } }): AuthMethod;
  export function applySession(user: User | null): void;
  export function startSessionListener(client?: Pick<SupabaseClient, 'auth'>): () => void;
  // src/auth/signIn.ts
  export const EMAIL_REDIRECT = 'booklistd://auth/callback';
  export class SignInCancelled extends Error {}
  export function appleDisplayName(n: { givenName?: string | null; familyName?: string | null } | null): string | null;
  export function signInWithApple(client?: Pick<SupabaseClient, 'auth'>): Promise<void>;
  export function signInWithGoogle(client?: Pick<SupabaseClient, 'auth'>): Promise<void>;
  export function sendEmailLink(email: string, client?: Pick<SupabaseClient, 'auth'>): Promise<void>;
  export function completeEmailLink(code: string, client?: Pick<SupabaseClient, 'auth'>): Promise<void>;
  // src/auth/authErrors.ts
  export const GENERIC_SIGN_IN_ERROR = "Couldn't sign you in. Try again.";
  export function authErrorMessage(e: unknown): string | null; // null = user cancelled, show nothing
  export function callbackResult(params: { code?: string; error?: string; error_code?: string }): { code: string } | { error: string };
  ```
- **Session rule (resolves spec §3.1 "an expired session never blocks"):**
  - a session → `signedIn`;
  - no session but a local owner → `expired`: the app stays open, sync pauses, and Profile says "Sign in again to back up";
  - no session and no owner → `signedOut` (Welcome).
  - Only the sign-out and delete flows clear the owner.

- [ ] **Step 1: Write the failing tests**

Create `src/auth/__tests__/authErrors.test.ts`:

```ts
import { authErrorMessage, callbackResult, GENERIC_SIGN_IN_ERROR } from '../authErrors';
import { SignInCancelled } from '../signIn';

jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/auth/ownership', () => ({ bindOwner: jest.fn() }));
jest.mock('@/db/localData', () => ({ saveProfileName: jest.fn() }));
jest.mock('expo-apple-authentication', () => ({}));
jest.mock('@react-native-google-signin/google-signin', () => ({}));

describe('authErrorMessage', () => {
  it('says nothing when the person cancelled', () => {
    expect(authErrorMessage(new SignInCancelled())).toBeNull();
  });
  it('names an expired or used link and the fix', () => {
    expect(authErrorMessage({ code: 'otp_expired', message: 'Email link is invalid or has expired' })).toBe('That link has expired. Send a new one.');
  });
  it('explains a link opened on another phone', () => {
    expect(authErrorMessage({ code: 'flow_state_not_found' })).toBe('Open the link on the phone you asked from, or send a new one.');
  });
  it('handles email throttling', () => {
    expect(authErrorMessage({ code: 'over_email_send_rate_limit', status: 429 })).toBe('Lots of links sent just now. Wait a minute, then send another.');
  });
  it('handles a bad email', () => {
    expect(authErrorMessage({ code: 'email_address_invalid' })).toBe("That email doesn't look right. Check it and try again.");
  });
  it('handles no connection', () => {
    expect(authErrorMessage(new TypeError('Network request failed'))).toBe("Couldn't reach the library. Check your connection and try again.");
  });
  it('falls back to a plain message', () => {
    expect(authErrorMessage(new Error('boom'))).toBe(GENERIC_SIGN_IN_ERROR);
  });
});

describe('callbackResult', () => {
  it('returns the PKCE code', () => {
    expect(callbackResult({ code: 'abc' })).toEqual({ code: 'abc' });
  });
  it('turns an expired-link redirect into copy', () => {
    expect(callbackResult({ error: 'access_denied', error_code: 'otp_expired' })).toEqual({ error: 'That link has expired. Send a new one.' });
  });
  it('treats anything else as a plain failure', () => {
    expect(callbackResult({})).toEqual({ error: GENERIC_SIGN_IN_ERROR });
  });
});
```

Create `src/auth/__tests__/signIn.test.ts`:

```ts
/// <reference types="node" />
// (tsconfig limits global types to jest; this file needs Node's crypto.)
import { createHash } from 'crypto';

const mockApple = { signInAsync: jest.fn() };
jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  signInAsync: (...a: unknown[]) => mockApple.signInAsync(...a),
}));
const mockGoogle = { configure: jest.fn(), hasPlayServices: jest.fn(async () => true), signIn: jest.fn() };
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: (...a: unknown[]) => mockGoogle.configure(...a),
    hasPlayServices: (...a: unknown[]) => mockGoogle.hasPlayServices(...a),
    signIn: (...a: unknown[]) => mockGoogle.signIn(...a),
  },
  isSuccessResponse: (r: { type: string }) => r.type === 'success',
  isErrorWithCode: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED', IN_PROGRESS: 'IN_PROGRESS', PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE' },
}));
jest.mock('@/api/supabase', () => ({ supabase: {} }));
const mockBindOwner = jest.fn();
jest.mock('@/auth/ownership', () => ({ bindOwner: (...a: unknown[]) => mockBindOwner(...a) }));
const mockSaveName = jest.fn();
jest.mock('@/db/localData', () => ({ saveProfileName: (...a: unknown[]) => mockSaveName(...a) }));

import { completeEmailLink, EMAIL_REDIRECT, sendEmailLink, SignInCancelled, signInWithApple, signInWithGoogle } from '../signIn';

const user = { id: 'u1' };
const fakeAuth = () => ({
  auth: {
    signInWithIdToken: jest.fn(async () => ({ data: { user, session: {} }, error: null })),
    signInWithOtp: jest.fn(async () => ({ data: {}, error: null })),
    exchangeCodeForSession: jest.fn(async () => ({ data: { user, session: {} }, error: null })),
  },
});

beforeEach(() => jest.clearAllMocks());

describe('signInWithApple', () => {
  it('sends Apple the SHA-256 of a fresh nonce and Supabase the raw nonce', async () => {
    mockApple.signInAsync.mockResolvedValue({ identityToken: 'apple.jwt', fullName: { givenName: 'Sean', familyName: 'Merchant' } });
    const client = fakeAuth();
    await signInWithApple(client as never);
    const { nonce: hashed, requestedScopes } = mockApple.signInAsync.mock.calls[0][0];
    const { provider, token, nonce: raw } = (client.auth.signInWithIdToken.mock.calls[0] as unknown as [{ provider: string; token: string; nonce: string }])[0];
    expect(requestedScopes).toEqual([0, 1]);
    expect(provider).toBe('apple');
    expect(token).toBe('apple.jwt');
    expect(raw).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed).toBe(createHash('sha256').update(raw).digest('hex'));
  });

  it('binds the owner, then saves the one-time name', async () => {
    mockApple.signInAsync.mockResolvedValue({ identityToken: 't', fullName: { givenName: 'Sean', familyName: null } });
    await signInWithApple(fakeAuth() as never);
    expect(mockBindOwner).toHaveBeenCalledWith('u1');
    expect(mockSaveName).toHaveBeenCalledWith('u1', 'Sean');
    expect(mockBindOwner.mock.invocationCallOrder[0]).toBeLessThan(mockSaveName.mock.invocationCallOrder[0]);
  });

  it('turns a cancel into SignInCancelled', async () => {
    mockApple.signInAsync.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
    await expect(signInWithApple(fakeAuth() as never)).rejects.toBeInstanceOf(SignInCancelled);
  });
});

describe('signInWithGoogle', () => {
  it('passes the Google id token to Supabase', async () => {
    mockGoogle.signIn.mockResolvedValue({ type: 'success', data: { idToken: 'google.jwt' } });
    const client = fakeAuth();
    await signInWithGoogle(client as never);
    expect(mockGoogle.configure).toHaveBeenCalledWith(expect.objectContaining({ scopes: ['openid', 'email', 'profile'] }));
    expect(client.auth.signInWithIdToken).toHaveBeenCalledWith({ provider: 'google', token: 'google.jwt' });
    expect(mockBindOwner).toHaveBeenCalledWith('u1');
  });

  it('treats a cancelled response as SignInCancelled', async () => {
    mockGoogle.signIn.mockResolvedValue({ type: 'cancelled', data: null });
    await expect(signInWithGoogle(fakeAuth() as never)).rejects.toBeInstanceOf(SignInCancelled);
  });
});

describe('email link', () => {
  it('asks for a link that returns to the app', async () => {
    const client = fakeAuth();
    await sendEmailLink('  reader@example.com ', client as never);
    expect(client.auth.signInWithOtp).toHaveBeenCalledWith({ email: 'reader@example.com', options: { emailRedirectTo: EMAIL_REDIRECT, shouldCreateUser: true } });
    expect(EMAIL_REDIRECT).toBe('booklistd://auth/callback');
  });

  it('exchanges the code and binds the owner', async () => {
    const client = fakeAuth();
    await completeEmailLink('code-1', client as never);
    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith('code-1');
    expect(mockBindOwner).toHaveBeenCalledWith('u1');
  });
});
```

Create `src/auth/__tests__/session.test.ts`:

```ts
jest.mock('@/api/supabase', () => ({ supabase: {} }));
const mockBindOwner = jest.fn();
jest.mock('@/auth/ownership', () => ({ bindOwner: (...a: unknown[]) => mockBindOwner(...a) }));
let mockOwner: string | null = null;
jest.mock('@/db/localData', () => ({ getOwner: () => mockOwner }));

import { methodOf, routeGuards, sessionStatus, startSessionListener, useSession } from '../session';

type Listener = (event: string, session: { user: object } | null) => void;
const fakeClient = () => {
  let listener: Listener | null = null;
  const client = { auth: { onAuthStateChange: (fn: Listener) => { listener = fn; return { data: { subscription: { unsubscribe: jest.fn() } } }; } } };
  return { client, emit: (e: string, s: { user: object } | null) => listener!(e, s) };
};

beforeEach(() => {
  mockOwner = null;
  jest.clearAllMocks();
  useSession.setState({ status: 'loading', userId: null, email: null, method: null, providers: [] });
});

describe('sessionStatus', () => {
  it('a session is signed in', () => expect(sessionStatus(true, null)).toBe('signedIn'));
  it('no session but an owner is expired: the app stays open', () => expect(sessionStatus(false, 'u1')).toBe('expired'));
  it('no session and no owner is signed out', () => expect(sessionStatus(false, null)).toBe('signedOut'));
});

describe('routeGuards', () => {
  it('shows only Welcome while signed out', () => expect(routeGuards('signedOut')).toEqual({ app: false, welcome: true }));
  it('shows only the app while signed in', () => expect(routeGuards('signedIn')).toEqual({ app: true, welcome: false }));
  it('keeps the app and allows Welcome for re-auth while expired', () => expect(routeGuards('expired')).toEqual({ app: true, welcome: true }));
  it('shows nothing while loading', () => expect(routeGuards('loading')).toEqual({ app: false, welcome: false }));
});

describe('methodOf', () => {
  it('maps providers to methods', () => {
    expect(methodOf({ app_metadata: { provider: 'apple' } })).toBe('apple');
    expect(methodOf({ app_metadata: { provider: 'google' } })).toBe('google');
    expect(methodOf({ app_metadata: { provider: 'email' } })).toBe('email');
    expect(methodOf({})).toBe('email');
  });
});

describe('startSessionListener', () => {
  it('binds the owner on the first session and marks the store signed in', () => {
    const { client, emit } = fakeClient();
    startSessionListener(client as never);
    mockOwner = 'u1';
    emit('INITIAL_SESSION', { user: { id: 'u1', email: 'r@example.com', app_metadata: { provider: 'google', providers: ['google'] } } });
    expect(mockBindOwner).toHaveBeenCalledWith('u1');
    expect(useSession.getState()).toMatchObject({ status: 'signedIn', userId: 'u1', email: 'r@example.com', method: 'google', providers: ['google'] });
  });

  it('does not rebind on token refresh', () => {
    const { client, emit } = fakeClient();
    startSessionListener(client as never);
    emit('TOKEN_REFRESHED', { user: { id: 'u1', app_metadata: {} } });
    expect(mockBindOwner).not.toHaveBeenCalled();
  });

  it('a lost session with a local owner is expired, not signed out', () => {
    const { client, emit } = fakeClient();
    startSessionListener(client as never);
    mockOwner = 'u1';
    emit('SIGNED_OUT', null);
    expect(useSession.getState()).toMatchObject({ status: 'expired', userId: 'u1', email: null });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest src/auth/__tests__/authErrors.test.ts src/auth/__tests__/signIn.test.ts src/auth/__tests__/session.test.ts`
Expected: FAIL with "Cannot find module '../authErrors'" / "'../signIn'" / "'../session'".

- [ ] **Step 3: Implement error copy**

Create `src/auth/authErrors.ts`:

```ts
/** Plain librarian copy for sign-in failures (spec §3.1): name the problem and the fix. Never log the error itself. */
import { SignInCancelled } from './signIn';

export const GENERIC_SIGN_IN_ERROR = "Couldn't sign you in. Try again.";
const EXPIRED = 'That link has expired. Send a new one.';

export function authErrorMessage(e: unknown): string | null {
  if (e instanceof SignInCancelled) return null;
  const err = (typeof e === 'object' && e !== null ? e : {}) as { code?: unknown; status?: unknown; message?: unknown; name?: unknown };
  const code = typeof err.code === 'string' ? err.code : '';
  const message = typeof err.message === 'string' ? err.message : '';
  if (code === 'otp_expired' || /expired/i.test(message)) return EXPIRED;
  if (code === 'flow_state_not_found' || code === 'flow_state_expired' || code === 'bad_code_verifier') {
    return 'Open the link on the phone you asked from, or send a new one.';
  }
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || err.status === 429) {
    return 'Lots of links sent just now. Wait a minute, then send another.';
  }
  if (code === 'email_address_invalid' || code === 'validation_failed') return "That email doesn't look right. Check it and try again.";
  if (code === 'PLAY_SERVICES_NOT_AVAILABLE') return 'Google sign-in needs Google Play services on this phone.';
  if (e instanceof TypeError || err.name === 'AuthRetryableFetchError' || /network/i.test(message)) {
    return "Couldn't reach the library. Check your connection and try again.";
  }
  return GENERIC_SIGN_IN_ERROR;
}

/** What the email-link redirect carried: a PKCE code, or an error to explain. */
export function callbackResult(params: { code?: string; error?: string; error_code?: string }): { code: string } | { error: string } {
  if (params.code) return { code: params.code };
  if (params.error_code === 'otp_expired') return { error: EXPIRED };
  return { error: GENERIC_SIGN_IN_ERROR };
}
```

- [ ] **Step 4: Implement the sign-in methods**

Create `src/auth/signIn.ts`:

```ts
/**
 * The three sign-in methods (spec §3.2). Each ends by binding the owner, which is idempotent with the
 * session listener's call, so a wipe for a different user always happens before anything else runs.
 */
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } from '@react-native-google-signin/google-signin';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/api/supabase';
import { bindOwner } from '@/auth/ownership';
import { saveProfileName } from '@/db/localData';

type AuthClient = Pick<SupabaseClient, 'auth'>;

export const EMAIL_REDIRECT = 'booklistd://auth/callback';

export class SignInCancelled extends Error {
  constructor() {
    super('sign-in cancelled');
    this.name = 'SignInCancelled';
  }
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export function appleDisplayName(n: { givenName?: string | null; familyName?: string | null } | null): string | null {
  const name = [n?.givenName, n?.familyName].filter((p): p is string => !!p && !!p.trim()).join(' ').trim();
  return name || null;
}

export async function signInWithApple(client: AuthClient = supabase): Promise<void> {
  const rawNonce = hex(Crypto.getRandomBytes(32));
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashedNonce,
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw new SignInCancelled();
    throw e;
  }
  if (!credential.identityToken) throw new Error('apple_no_identity_token');
  const { data, error } = await client.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken, nonce: rawNonce });
  if (error) throw error;
  if (!data.user) throw new Error('no_user');
  bindOwner(data.user.id);
  const name = appleDisplayName(credential.fullName);
  if (name) saveProfileName(data.user.id, name);
}

let googleConfigured = false;
function configureGoogle() {
  if (googleConfigured) return;
  GoogleSignin.configure({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    scopes: ['openid', 'email', 'profile'],
  });
  googleConfigured = true;
}

export async function signInWithGoogle(client: AuthClient = supabase): Promise<void> {
  configureGoogle();
  let idToken: string | null = null;
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const res = await GoogleSignin.signIn();
    if (!isSuccessResponse(res)) throw new SignInCancelled();
    idToken = res.data.idToken;
  } catch (e) {
    if (e instanceof SignInCancelled) throw e;
    if (isErrorWithCode(e) && (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS)) throw new SignInCancelled();
    throw e;
  }
  if (!idToken) throw new Error('google_no_id_token');
  const { data, error } = await client.auth.signInWithIdToken({ provider: 'google', token: idToken });
  if (error) throw error;
  if (!data.user) throw new Error('no_user');
  bindOwner(data.user.id);
}

export async function sendEmailLink(email: string, client: AuthClient = supabase): Promise<void> {
  const { error } = await client.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: EMAIL_REDIRECT, shouldCreateUser: true },
  });
  if (error) throw error;
}

export async function completeEmailLink(code: string, client: AuthClient = supabase): Promise<void> {
  const { data, error } = await client.auth.exchangeCodeForSession(code);
  if (error) throw error;
  if (!data.user) throw new Error('no_user');
  bindOwner(data.user.id);
}
```

- [ ] **Step 5: Implement the session store**

Create `src/auth/session.ts`:

```ts
/**
 * Who is signed in, as the UI sees it. The root layout gates on `status` (see routeGuards).
 * An expired session never closes the app: with a local owner it is 'expired', sync pauses and
 * Profile offers "Sign in again to back up". Only sign-out and delete-account clear the owner.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { create } from 'zustand';
import { supabase } from '@/api/supabase';
import { bindOwner } from '@/auth/ownership';
import { getOwner } from '@/db/localData';

export type AuthMethod = 'apple' | 'google' | 'email';
export type SessionStatus = 'loading' | 'signedIn' | 'expired' | 'signedOut';

export interface SessionState {
  status: SessionStatus;
  userId: string | null;
  email: string | null;
  method: AuthMethod | null;
  /** Every linked identity provider, e.g. ['apple', 'google']. Delete account needs to know about Apple. */
  providers: string[];
}

export const useSession = create<SessionState>(() => ({ status: 'loading', userId: null, email: null, method: null, providers: [] }));

export function sessionStatus(hasSession: boolean, ownerId: string | null): Exclude<SessionStatus, 'loading'> {
  if (hasSession) return 'signedIn';
  return ownerId ? 'expired' : 'signedOut';
}

export function routeGuards(status: SessionStatus): { app: boolean; welcome: boolean } {
  return { app: status === 'signedIn' || status === 'expired', welcome: status === 'signedOut' || status === 'expired' };
}

export function methodOf(user: { app_metadata?: { provider?: string } }): AuthMethod {
  const p = user.app_metadata?.provider;
  return p === 'apple' || p === 'google' ? p : 'email';
}

export function applySession(user: User | null): void {
  const owner = getOwner();
  const providers = user?.app_metadata?.providers;
  useSession.setState({
    status: sessionStatus(!!user, owner),
    userId: user?.id ?? owner,
    email: user?.email ?? null,
    method: user ? methodOf(user) : null,
    providers: Array.isArray(providers) ? providers.filter((p): p is string => typeof p === 'string') : [],
  });
}

/** Call once from the root layout. Never await Supabase calls inside this callback (supabase-js deadlocks). */
export function startSessionListener(client: Pick<SupabaseClient, 'auth'> = supabase): () => void {
  const { data } = client.auth.onAuthStateChange((event, session) => {
    const user = session?.user ?? null;
    if (user && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')) bindOwner(user.id);
    applySession(user);
  });
  return () => data.subscription.unsubscribe();
}
```

- [ ] **Step 6: The callback route**

Create `app/auth/callback.tsx`:

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { authErrorMessage, callbackResult, GENERIC_SIGN_IN_ERROR } from '@/auth/authErrors';
import { completeEmailLink } from '@/auth/signIn';
import { font, ink } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

/** booklistd://auth/callback?code=… — the email link lands here (PKCE). */
export default function AuthCallback() {
  const { c } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string; error?: string; error_code?: string }>();
  const [problem, setProblem] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const r = callbackResult(params);
    if ('error' in r) {
      setProblem(r.error);
      return;
    }
    completeEmailLink(r.code).then(
      () => router.replace('/'),
      (e) => setProblem(authErrorMessage(e) ?? GENERIC_SIGN_IN_ERROR)
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper, justifyContent: 'center', paddingHorizontal: 20 }}>
      <View style={{ gap: 16 }}>
        <Text accessibilityRole={problem ? 'alert' : undefined} style={{ fontFamily: font.black, fontSize: 17, color: problem ? ink.tomato : c.text, textAlign: 'center' }}>
          {problem ?? 'Signing you in…'}
        </Text>
        {problem ? <Button label="Back to sign in" variant="ghost" onPress={() => router.replace('/welcome')} /> : null}
      </View>
    </SafeAreaView>
  );
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx jest src/auth`
Expected: PASS (authErrors 10, signIn 7, session 11, plus earlier tasks).

- [ ] **Step 8: Checkpoint**

Run `npx tsc --noEmit`, `npx jest`, `npx expo-doctor`.
Expected: all clean, with 181 tests passing. The typed-routes error for `/welcome` is fixed in Task 4. If tsc flags `router.replace('/welcome')` before `app/welcome.tsx` exists, create `app/welcome.tsx` as `export default function Welcome() { return null; }` now; Task 4 replaces it.

Hand Sean the file list: `src/auth/session.ts`, `src/auth/signIn.ts`, `src/auth/authErrors.ts`, their three tests, `app/auth/callback.tsx` (and the `app/welcome.tsx` stub, if created).

---

### Task 4: Root-layout gate and the Welcome screen

**Files:**
- Create: `app/welcome.tsx`, `src/auth/emailLink.ts`, `src/lib/links.ts`
- Modify: `app/_layout.tsx`
- Test: `src/auth/__tests__/emailLink.test.ts`

**Interfaces:**
- Consumes: `useSession`, `routeGuards`, `startSessionListener` (Task 3); `signInWithApple`, `signInWithGoogle`, `sendEmailLink`, `authErrorMessage` (Task 3); `Button`, `Dewey`.
- Produces:
  ```ts
  // src/auth/emailLink.ts
  export const RESEND_AFTER_MS = 60_000;
  export function isPlausibleEmail(s: string): boolean;
  export function resendLabel(sentAt: number, now: number): { label: string; enabled: boolean };
  // src/lib/links.ts
  export const PRIVACY_POLICY_URL: string | null;
  ```
  The routes are `/welcome` (signed out or expired) and the app (signed in or expired). `auth/callback` is always reachable.

- [ ] **Step 1: Write the failing test**

Create `src/auth/__tests__/emailLink.test.ts`:

```ts
import { isPlausibleEmail, RESEND_AFTER_MS, resendLabel } from '../emailLink';

describe('isPlausibleEmail', () => {
  it.each(['reader@example.com', ' a.b+c@sub.example.co.uk '])('accepts %p', (s) => expect(isPlausibleEmail(s)).toBe(true));
  it.each(['', 'reader', 'reader@', '@example.com', 'a b@example.com', 'reader@example'])('rejects %p', (s) => expect(isPlausibleEmail(s)).toBe(false));
});

describe('resendLabel', () => {
  it('counts down for 60 seconds', () => {
    expect(resendLabel(0, 18_200)).toEqual({ label: 'Resend in 42s', enabled: false });
  });
  it('enables Resend after 60 seconds', () => {
    expect(resendLabel(0, RESEND_AFTER_MS)).toEqual({ label: 'Resend', enabled: true });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/auth/__tests__/emailLink.test.ts`
Expected: FAIL with "Cannot find module '../emailLink'".

- [ ] **Step 3: Implement the helpers and the links file**

Create `src/auth/emailLink.ts`:

```ts
export const RESEND_AFTER_MS = 60_000;

/** A light check so "Send link" enables at the right time; Supabase does the real validation. */
export function isPlausibleEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

export function resendLabel(sentAt: number, now: number): { label: string; enabled: boolean } {
  const left = Math.ceil((sentAt + RESEND_AFTER_MS - now) / 1000);
  return left > 0 ? { label: `Resend in ${left}s`, enabled: false } : { label: 'Resend', enabled: true };
}
```

Create `src/lib/links.ts`:

```ts
/**
 * Public URLs the app links to. Sean hosts docs/privacy-policy.md and sets the URL here before
 * release (see docs/setup-accounts.md). While null, Welcome hides the link.
 */
export const PRIVACY_POLICY_URL: string | null = null;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest src/auth/__tests__/emailLink.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: The Welcome screen**

Create (or replace the stub) `app/welcome.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Dewey } from '@/components/dewey/Dewey';
import { Button } from '@/components/ui/Button';
import { authErrorMessage } from '@/auth/authErrors';
import { isPlausibleEmail, resendLabel } from '@/auth/emailLink';
import { sendEmailLink, signInWithApple, signInWithGoogle } from '@/auth/signIn';
import { PRIVACY_POLICY_URL } from '@/lib/links';
import { font, ink, radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

type Mode = 'buttons' | 'email' | 'sent';

export default function Welcome() {
  const { c, scheme } = useTheme();
  const [mode, setMode] = useState<Mode>('buttons');
  const [email, setEmail] = useState('');
  const [sentAt, setSentAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [appleReady, setAppleReady] = useState(false);

  // Apple's guidelines require the native button on iOS; Android hides Apple until web sign-in is configured.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync().then(setAppleReady, () => setAppleReady(false));
  }, []);
  useEffect(() => {
    if (mode !== 'sent') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [mode]);

  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await task();
    } catch (e) {
      setProblem(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const send = () =>
    run(async () => {
      await sendEmailLink(email);
      const t = Date.now();
      setSentAt(t);
      setNow(t);
      setMode('sent');
    });
  const resend = resendLabel(sentAt, now);
  const link = (label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={10} style={{ alignSelf: 'center', paddingVertical: 6 }}>
      <Text style={{ fontFamily: font.heavy, fontSize: 14, color: c.text, textDecorationLine: 'underline' }}>{label}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 32 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center' }}>
            <Dewey mood="happy" size={96} pop />
            <Text accessibilityRole="header" style={{ fontFamily: font.display, fontSize: 40, lineHeight: 44, color: c.text, marginTop: 12 }}>Booklistd</Text>
            <Text style={{ fontFamily: font.bold, fontSize: 15, color: c.soft, marginTop: 6, textAlign: 'center' }}>
              Your shelves, backed up and on every phone.
            </Text>
          </View>

          <View style={{ marginTop: 32, gap: 12 }}>
            {mode === 'buttons' ? (
              <>
                {appleReady ? (
                  <AppleAuthentication.AppleAuthenticationButton
                    buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                    buttonStyle={scheme === 'lamp' ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                    cornerRadius={radius.button}
                    style={{ height: 52 }}
                    onPress={() => run(() => signInWithApple())}
                  />
                ) : null}
                <Button label="Continue with Google" variant="ghost" disabled={busy} onPress={() => run(() => signInWithGoogle())} />
                <Button label="Email me a sign-in link" variant="ghost" disabled={busy} onPress={() => { setProblem(null); setMode('email'); }} />
              </>
            ) : null}

            {mode === 'email' ? (
              <>
                <Text style={{ fontFamily: font.heavy, fontSize: 14, color: c.text }}>Your email</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  returnKeyType="send"
                  onSubmitEditing={() => { if (isPlausibleEmail(email)) send(); }}
                  accessibilityLabel="Your email"
                  style={{
                    minHeight: 46, paddingHorizontal: 12, borderWidth: 2, borderColor: c.line, borderRadius: radius.pill / 2,
                    backgroundColor: ink.white, fontFamily: font.bold, fontSize: 16, color: ink.brown,
                  }}
                />
                <Button label={busy ? 'Sending…' : 'Send link'} disabled={busy || !isPlausibleEmail(email)} onPress={send} />
                {link('Back', () => { setProblem(null); setMode('buttons'); })}
              </>
            ) : null}

            {mode === 'sent' ? (
              <>
                <Text accessibilityRole="header" style={{ fontFamily: font.black, fontSize: 17, color: c.text, textAlign: 'center' }}>Check your inbox</Text>
                <Text style={{ fontFamily: font.bold, fontSize: 14, color: c.soft, textAlign: 'center' }}>
                  {`We sent a sign-in link to ${email.trim()}. It works once, within an hour.`}
                </Text>
                <Button label={resend.label} variant="ghost" disabled={busy || !resend.enabled} onPress={send} />
                {link('Use a different email', () => { setProblem(null); setMode('email'); })}
              </>
            ) : null}

            {problem ? (
              <Text accessibilityRole="alert" style={{ fontFamily: font.bold, fontSize: 13, color: ink.tomato, textAlign: 'center' }}>{problem}</Text>
            ) : null}
          </View>

          {PRIVACY_POLICY_URL ? <View style={{ marginTop: 28 }}>{link('Privacy policy', () => Linking.openURL(PRIVACY_POLICY_URL!))}</View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
```

- [ ] **Step 6: Gate the root layout**

In `app/_layout.tsx`:

1. Add these imports after `import { getDb } from '@/db/database';`:

```tsx
import { routeGuards, startSessionListener, useSession } from '@/auth/session';
```

2. Replace the block

```tsx
  useEffect(() => {
    getDb(); // open + migrate on launch
  }, []);

  const ready = fontsLoaded && hydrated;
```

with

```tsx
  useEffect(() => {
    getDb(); // open + migrate on launch
    return startSessionListener();
  }, []);

  // The splash stays up until Supabase has read the stored session, so signed-out people never glimpse the tabs.
  const status = useSession((s) => s.status);
  const guards = routeGuards(status);
  const ready = fontsLoaded && hydrated && status !== 'loading';
```

3. Replace the `<Stack …>…</Stack>` element with:

```tsx
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.paper } }}>
          <Stack.Protected guard={guards.app}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="book/[id]" />
            <Stack.Screen name="book/edit" options={{ presentation: 'modal' }} />
            <Stack.Screen name="reading" />
            <Stack.Screen name="shelves" />
          </Stack.Protected>
          <Stack.Protected guard={guards.welcome}>
            <Stack.Screen name="welcome" />
          </Stack.Protected>
          <Stack.Screen name="auth/callback" />
        </Stack>
```

- [ ] **Step 7: Checkpoint**

Run `npx tsc --noEmit`, `npx jest`, `npx expo-doctor`.
Expected: all clean, with 191 tests passing.

Manual check (dev build, once Task 8 is in): a fresh install opens on Welcome, not the tabs.

Hand Sean the file list: `app/welcome.tsx`, `app/_layout.tsx`, `src/auth/emailLink.ts`, `src/auth/__tests__/emailLink.test.ts`, `src/lib/links.ts`.

---

### Task 5: Profile → Account section and sign-out

**Files:**
- Create: `src/features/account/accountLines.ts`, `src/features/account/signOut.ts`, `src/components/account/AccountCard.tsx`
- Modify: `app/(tabs)/profile.tsx`
- Test: `src/features/account/__tests__/accountLines.test.ts`, `src/features/account/__tests__/signOut.test.ts`

**Interfaces:**
- Consumes: `useSession`, `applySession`, `AuthMethod` (Task 3); `forgetLocalSession` (Task 1); `pendingCount` (Task 2); `wipeLocalData` (Task 2).
- Produces:
  ```ts
  // src/features/account/accountLines.ts
  export const BACKUP_COMING_SOON = 'Backups coming soon';
  export const SIGN_IN_AGAIN = 'Sign in again to back up';
  export function methodLabel(m: AuthMethod | null): string; // 'with Apple' | 'with Google' | 'by email' | ''
  export function signOutWarning(p: { syncEnabled: boolean; pending: number }): string | null;
  // src/features/account/signOut.ts
  export interface SignOutDeps { push: () => Promise<void>; syncEnabled: boolean; confirm: (message: string) => Promise<boolean>; client?: Pick<SupabaseClient, 'auth'> }
  export function signOut(deps: SignOutDeps): Promise<boolean>; // false = cancelled
  export function endSession(client?: Pick<SupabaseClient, 'auth'>): Promise<void>;
  // src/components/account/AccountCard.tsx
  export function AccountCard(p: {
    email: string | null; method: AuthMethod | null; backupLine: string; onBackupPress?: () => void;
    onExport?: () => void; onSignOut: () => void; onDelete?: () => void; busy?: boolean;
  }): React.JSX.Element;
  ```
- **Sign-out scope:** `signOut({ scope: 'local' })`, not the default global scope. A global sign-out would also end the owner's other phones, and the spec means "this phone". If the request fails offline, `forgetLocalSession()` clears the stored session anyway.

- [ ] **Step 1: Write the failing tests**

Create `src/features/account/__tests__/accountLines.test.ts`:

```ts
import { methodLabel, signOutWarning } from '../accountLines';

describe('methodLabel', () => {
  it('names each method', () => {
    expect(methodLabel('apple')).toBe('with Apple');
    expect(methodLabel('google')).toBe('with Google');
    expect(methodLabel('email')).toBe('by email');
    expect(methodLabel(null)).toBe('');
  });
});

describe('signOutWarning', () => {
  it('before sync ships, every library counts as not backed up', () => {
    expect(signOutWarning({ syncEnabled: false, pending: 0 })).toBe("Your library isn't backed up yet. Signing out deletes it from this phone.");
  });
  it('with sync and nothing waiting, no warning', () => {
    expect(signOutWarning({ syncEnabled: true, pending: 0 })).toBeNull();
  });
  it('names the waiting changes', () => {
    expect(signOutWarning({ syncEnabled: true, pending: 3 })).toBe("3 changes haven't backed up yet. Sign out anyway?");
    expect(signOutWarning({ syncEnabled: true, pending: 1 })).toBe("1 change hasn't backed up yet. Sign out anyway?");
  });
});
```

Create `src/features/account/__tests__/signOut.test.ts`:

```ts
jest.mock('@/api/supabase', () => ({ supabase: {} }));
const mockForget = jest.fn(async () => {});
jest.mock('@/auth/secureStorage', () => ({ forgetLocalSession: () => mockForget() }));
const mockApply = jest.fn();
jest.mock('@/auth/session', () => ({ applySession: (...a: unknown[]) => mockApply(...a) }));
let mockPending = 0;
jest.mock('@/db/pendingOps', () => ({ pendingCount: () => mockPending }));
const mockWipe = jest.fn();
jest.mock('@/db/localData', () => ({ wipeLocalData: () => mockWipe() }));

import { signOut } from '../signOut';

const client = (result: unknown = { error: null }) => ({ auth: { signOut: jest.fn(async (_o?: unknown) => result) } });

beforeEach(() => {
  mockPending = 0;
  jest.clearAllMocks();
  mockWipe.mockReset();
});

it('before sync ships it always warns, and cancelling keeps everything', async () => {
  const confirm = jest.fn(async () => false);
  const c = client();
  expect(await signOut({ push: async () => {}, syncEnabled: false, confirm, client: c as never })).toBe(false);
  expect(confirm).toHaveBeenCalledWith("Your library isn't backed up yet. Signing out deletes it from this phone.");
  expect(mockWipe).not.toHaveBeenCalled();
  expect(c.auth.signOut).not.toHaveBeenCalled();
});

it("confirmed: tries a push, wipes, then ends only this phone's session", async () => {
  const order: string[] = [];
  const push = jest.fn(async () => { order.push('push'); });
  mockWipe.mockImplementation(() => order.push('wipe'));
  const c = client();
  c.auth.signOut.mockImplementation(async () => { order.push('signOut'); return { error: null }; });
  expect(await signOut({ push, syncEnabled: false, confirm: async () => true, client: c as never })).toBe(true);
  expect(order).toEqual(['push', 'wipe', 'signOut']);
  expect(c.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(mockApply).toHaveBeenCalledWith(null);
  expect(mockForget).not.toHaveBeenCalled();
});

it('with sync on and nothing waiting, signs out without asking', async () => {
  const confirm = jest.fn(async () => true);
  await signOut({ push: async () => {}, syncEnabled: true, confirm, client: client() as never });
  expect(confirm).not.toHaveBeenCalled();
  expect(mockWipe).toHaveBeenCalled();
});

it('names the changes still waiting after the push', async () => {
  mockPending = 2;
  const confirm = jest.fn(async () => false);
  await signOut({ push: async () => {}, syncEnabled: true, confirm, client: client() as never });
  expect(confirm).toHaveBeenCalledWith("2 changes haven't backed up yet. Sign out anyway?");
});

it('a failed push still lets you sign out', async () => {
  await signOut({ push: async () => { throw new Error('offline'); }, syncEnabled: true, confirm: async () => true, client: client() as never });
  expect(mockWipe).toHaveBeenCalled();
});

it('offline, the stored session is still forgotten', async () => {
  await signOut({ push: async () => {}, syncEnabled: false, confirm: async () => true, client: client({ error: new Error('Network request failed') }) as never });
  expect(mockForget).toHaveBeenCalled();
  expect(mockApply).toHaveBeenCalledWith(null);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest src/features/account`
Expected: FAIL with "Cannot find module '../accountLines'" and "'../signOut'".

- [ ] **Step 3: Implement the copy and the flow**

Create `src/features/account/accountLines.ts`:

```ts
import type { AuthMethod } from '@/auth/session';

export const BACKUP_COMING_SOON = 'Backups coming soon';
export const SIGN_IN_AGAIN = 'Sign in again to back up';

export function methodLabel(m: AuthMethod | null): string {
  if (m === 'apple') return 'with Apple';
  if (m === 'google') return 'with Google';
  if (m === 'email') return 'by email';
  return '';
}

/** Spec §2 and §4: until sync ships nothing is backed up; after, only rows still in the queue are at risk. */
export function signOutWarning({ syncEnabled, pending }: { syncEnabled: boolean; pending: number }): string | null {
  if (!syncEnabled) return "Your library isn't backed up yet. Signing out deletes it from this phone.";
  if (pending <= 0) return null;
  return pending === 1 ? "1 change hasn't backed up yet. Sign out anyway?" : `${pending} changes haven't backed up yet. Sign out anyway?`;
}
```

Create `src/features/account/signOut.ts`:

```ts
/** Spec §4 sign-out: try a push, confirm if anything is left, wipe, end the session (the gate then shows Welcome). */
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/api/supabase';
import { forgetLocalSession } from '@/auth/secureStorage';
import { applySession } from '@/auth/session';
import { wipeLocalData } from '@/db/localData';
import { pendingCount } from '@/db/pendingOps';
import { signOutWarning } from './accountLines';

type AuthClient = Pick<SupabaseClient, 'auth'>;

export interface SignOutDeps {
  /** One sync run (Phase 2). Before sync ships: async () => {}. */
  push: () => Promise<void>;
  syncEnabled: boolean;
  confirm: (message: string) => Promise<boolean>;
  client?: AuthClient;
}

export async function signOut({ push, syncEnabled, confirm, client = supabase }: SignOutDeps): Promise<boolean> {
  try {
    await push();
  } catch {
    // Offline or failing: whatever didn't go up is counted below.
  }
  const warning = signOutWarning({ syncEnabled, pending: pendingCount() });
  if (warning && !(await confirm(warning))) return false;
  wipeLocalData();
  await endSession(client);
  return true;
}

/** Ends this phone's session. Offline the server call fails, so the stored session is dropped directly. */
export async function endSession(client: AuthClient = supabase): Promise<void> {
  const { error } = await client.auth.signOut({ scope: 'local' }).catch((e: unknown) => ({ error: e }));
  if (error) await forgetLocalSession();
  applySession(null);
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx jest src/features/account`
Expected: PASS (10 tests).

- [ ] **Step 5: The Account card**

Create `src/components/account/AccountCard.tsx`:

```tsx
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { LeaderRow, PocketCard } from '@/components/ui/PocketCard';
import type { AuthMethod } from '@/auth/session';
import { methodLabel } from '@/features/account/accountLines';
import { font, ink } from '@/theme/palette';

/** Profile → Account (spec §5): who you are, the backup line, and the account actions. */
export function AccountCard({
  email, method, backupLine, onBackupPress, onExport, onSignOut, onDelete, busy,
}: {
  email: string | null; method: AuthMethod | null; backupLine: string; onBackupPress?: () => void;
  onExport?: () => void; onSignOut: () => void; onDelete?: () => void; busy?: boolean;
}) {
  const backup = <LeaderRow label="Backup" value={backupLine} />;
  return (
    <PocketCard title="Account">
      {email ? (
        <View style={{ paddingVertical: 4 }} accessible accessibilityLabel={`Signed in as ${email} ${methodLabel(method)}`}>
          <Text style={{ fontFamily: font.bold, fontSize: 13, color: ink.soft }}>Signed in as</Text>
          <Text numberOfLines={1} ellipsizeMode="middle" style={{ fontFamily: font.black, fontSize: 15, color: ink.brown }}>{email}</Text>
          {method ? <Text style={{ fontFamily: font.bold, fontSize: 13, color: ink.soft }}>{methodLabel(method)}</Text> : null}
        </View>
      ) : null}
      {onBackupPress ? <Pressable accessibilityRole="button" onPress={onBackupPress}>{backup}</Pressable> : backup}
      <View style={{ gap: 10, marginTop: 10, marginBottom: 4 }}>
        {onExport ? <Button label="Export my library (CSV)" variant="ghost" disabled={busy} onPress={onExport} /> : null}
        <Button label="Sign out" variant="ghost" disabled={busy} onPress={onSignOut} />
        {onDelete ? (
          <Pressable accessibilityRole="button" disabled={busy} onPress={onDelete} hitSlop={8} style={{ alignSelf: 'center', paddingVertical: 6 }}>
            <Text style={{ fontFamily: font.heavy, fontSize: 14, color: ink.tomato, textDecorationLine: 'underline' }}>Delete account</Text>
          </Pressable>
        ) : null}
      </View>
    </PocketCard>
  );
}
```

- [ ] **Step 6: Put it at the top of Profile**

In `app/(tabs)/profile.tsx`:

1. Replace the first two import lines with:

```tsx
import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
```

and add after the `@tanstack/react-query` import:

```tsx
import { useRouter } from 'expo-router';
import { AccountCard } from '@/components/account/AccountCard';
import { useSession } from '@/auth/session';
import { BACKUP_COMING_SOON, SIGN_IN_AGAIN } from '@/features/account/accountLines';
import { signOut } from '@/features/account/signOut';
```

2. Add above `export default function ProfileScreen()`:

```tsx
function confirmSignOut(message: string): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert('Sign out?', message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Sign out', style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) })
  );
}
```

3. In `ProfileScreen`, after the two `useQuery` lines, add:

```tsx
  const router = useRouter();
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const expired = session.status === 'expired';
  const onSignOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (await signOut({ push: async () => {}, syncEnabled: false, confirm: confirmSignOut })) router.replace('/welcome');
    } finally {
      setBusy(false);
    }
  };
```

4. Replace

```tsx
        <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
          <PocketCard title="Library card">
```

with

```tsx
        <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
          <AccountCard
            email={session.email}
            method={session.method}
            backupLine={expired ? SIGN_IN_AGAIN : BACKUP_COMING_SOON}
            onBackupPress={expired ? () => router.push('/welcome') : undefined}
            onSignOut={onSignOut}
            busy={busy}
          />
          <PocketCard title="Library card" style={{ marginTop: 16 }}>
```

- [ ] **Step 7: Checkpoint**

Run `npx tsc --noEmit`, `npx jest`, `npx expo-doctor`.
Expected: all clean, with 201 tests passing.

Hand Sean the file list: `src/features/account/accountLines.ts`, `src/features/account/signOut.ts`, both tests, `src/components/account/AccountCard.tsx`, `app/(tabs)/profile.tsx`.

---

### Task 6: Export my library (CSV)

**Files:**
- Create: `src/features/export/libraryCsv.ts`, `src/features/export/shareCsv.ts`
- Modify: `src/db/repository.ts` (add `listExportRows`), `app/(tabs)/profile.tsx`
- Test: `src/features/export/__tests__/libraryCsv.test.ts`, `src/db/__tests__/exportRows.test.ts`

**Interfaces:**
- Consumes: `reactionFor`, `READING_LABEL`, `UNSHELVED` (existing); `freshDb`, `bookMeta` (Task 2); `AccountCard.onExport` (Task 5).
- Produces:
  ```ts
  // src/features/export/libraryCsv.ts
  export interface ExportRow {
    title: string; authors: string[]; isbn13: string | null; status: BookStatus | null; shelf: string | null;
    readingState: ReadingState | null; startedAt: string | null; finishedAt: string | null; rating: number | null;
    loanedTo: string | null; loanedSince: string | null;
  }
  export const CSV_HEADER: readonly string[];
  export function csvCell(raw: string | null | undefined): string;
  export function libraryCsv(rows: ExportRow[]): string;
  export function exportFileName(d: Date): string; // booklistd-library-YYYY-MM-DD.csv (local date)
  // src/db/repository.ts
  export function listExportRows(): ExportRow[];
  // src/features/export/shareCsv.ts
  export function shareLibraryCsv(now?: Date): Promise<void>;
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/features/export/__tests__/libraryCsv.test.ts`:

```ts
import { csvCell, exportFileName, libraryCsv, type ExportRow } from '../libraryCsv';

const row = (p: Partial<ExportRow> = {}): ExportRow => ({
  title: 'Dune', authors: ['Frank Herbert'], isbn13: '9780441172719', status: 'owned', shelf: 'Study',
  readingState: null, startedAt: null, finishedAt: null, rating: null, loanedTo: null, loanedSince: null, ...p,
});

describe('csvCell', () => {
  it('leaves plain text alone', () => expect(csvCell('Dune')).toBe('Dune'));
  it('quotes commas, quotes and newlines (RFC 4180)', () => {
    expect(csvCell('Herbert, Frank')).toBe('"Herbert, Frank"');
    expect(csvCell('The "Best" Book')).toBe('"The ""Best"" Book"');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });
  it.each(['=SUM(A1)', '+1', '-1', '@cmd'])('prefixes a formula start %p with a quote', (v) => {
    expect(csvCell(v)).toBe(`'${v}`);
  });
  it('prefixes and quotes together', () => expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"'));
  it('writes null as empty', () => expect(csvCell(null)).toBe(''));
});

describe('libraryCsv', () => {
  it('starts with a BOM and the header, and ends lines with CRLF', () => {
    expect(libraryCsv([])).toBe('﻿Title,Authors,ISBN-13,Status,Shelf,Reading,Started,Finished,Rating,On loan to,Loaned since\r\n');
  });
  it('writes one row per copy with readable labels', () => {
    const csv = libraryCsv([
      row({ readingState: 'read', startedAt: '2026-01-02', finishedAt: '2026-02-03', rating: 7, loanedTo: 'Ana', loanedSince: '2026-03-01 10:00:00' }),
    ]);
    expect(csv.split('\r\n')[1]).toBe('Dune,Frank Herbert,9780441172719,At home,Study,Read,2026-01-02,2026-02-03,Forever shelf,Ana,2026-03-01');
  });
  it('labels wishlist copies, unshelved copies and reading-only books', () => {
    const lines = libraryCsv([
      row({ status: 'wishlist', shelf: null }),
      row({ shelf: null }),
      row({ status: null, shelf: null, readingState: 'reading', authors: ['A', 'B'] }),
    ]).split('\r\n');
    expect(lines[1]).toBe('Dune,Frank Herbert,9780441172719,Wishlist,,,,,,,');
    expect(lines[2]).toBe('Dune,Frank Herbert,9780441172719,At home,Unshelved,,,,,,');
    expect(lines[3]).toBe('Dune,A; B,9780441172719,,,Reading,,,,,');
  });
});

describe('exportFileName', () => {
  it('uses the local date', () => expect(exportFileName(new Date(2026, 8, 5, 23, 30))).toBe('booklistd-library-2026-09-05.csv'));
});
```

Create `src/db/__tests__/exportRows.test.ts`:

```ts
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
```

(Both extra ISBNs are valid ISBN-13s: `9780141439587` and `9780141439518`.)

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest src/features/export src/db/__tests__/exportRows.test.ts`
Expected: FAIL with "Cannot find module '../libraryCsv'" and "listExportRows is not a function".

- [ ] **Step 3: Implement the CSV**

Create `src/features/export/libraryCsv.ts`:

```ts
/**
 * The library as a spreadsheet (spec §7.2): one row per copy (wishlist included), plus books that only have a reading.
 * RFC 4180 quoting. A cell starting with = + - @ (or tab/CR, per OWASP) gets a leading ' so spreadsheets never run it.
 */
import type { BookStatus, ReadingState } from '@/lib/types';
import { reactionFor } from '@/features/rating/reactions';
import { READING_LABEL } from '@/features/reading/readingLogic';
import { UNSHELVED } from '@/features/shelves/shelfRules';

export interface ExportRow {
  title: string;
  authors: string[];
  isbn13: string | null;
  status: BookStatus | null;
  shelf: string | null;
  readingState: ReadingState | null;
  startedAt: string | null;
  finishedAt: string | null;
  rating: number | null;
  loanedTo: string | null;
  loanedSince: string | null;
}

export const CSV_HEADER = ['Title', 'Authors', 'ISBN-13', 'Status', 'Shelf', 'Reading', 'Started', 'Finished', 'Rating', 'On loan to', 'Loaned since'] as const;
const STATUS_LABEL: Record<BookStatus, string> = { owned: 'At home', wishlist: 'Wishlist' };
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(raw: string | null | undefined): string {
  let v = raw ?? '';
  if (FORMULA_START.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function libraryCsv(rows: ExportRow[]): string {
  const lines = [CSV_HEADER.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.title,
        r.authors.join('; '),
        r.isbn13,
        r.status ? STATUS_LABEL[r.status] : '',
        r.status === 'owned' ? r.shelf ?? UNSHELVED : r.shelf,
        r.readingState ? READING_LABEL[r.readingState] : '',
        r.startedAt,
        r.finishedAt,
        reactionFor(r.rating)?.label ?? '',
        r.loanedTo,
        r.loanedSince ? r.loanedSince.slice(0, 10) : '',
      ].map(csvCell).join(',')
    );
  }
  // The BOM makes Excel read the file as UTF-8 (accented titles, curly quotes).
  return `﻿${lines.join('\r\n')}\r\n`;
}

const pad = (n: number) => String(n).padStart(2, '0');
export function exportFileName(d: Date): string {
  return `booklistd-library-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
}
```

- [ ] **Step 4: The export query**

In `src/db/repository.ts`, add to the imports:

```ts
import type { ExportRow } from '@/features/export/libraryCsv';
```

and append at the end of the file:

```ts
// ---------- export ----------
/** Every live copy (wishlist included) with its shelf, reading and open loan, then books that only have a reading. */
export function listExportRows(): ExportRow[] {
  return getDb()
    .getAllSync<any>(
      `SELECT b.title, b.authors, b.isbn13, ub.status, s.name AS shelf, r.state, r.started_at, r.finished_at, r.rating,
              l.borrower_name, l.loaned_at
         FROM user_books ub
         JOIN books_effective b ON b.id = ub.book_id
         LEFT JOIN shelves s ON s.id = ub.shelf_id AND s.deleted_at IS NULL
         LEFT JOIN readings r ON r.book_id = ub.book_id AND r.deleted_at IS NULL
         LEFT JOIN loans l ON l.user_book_id = ub.id AND l.returned_at IS NULL AND l.deleted_at IS NULL
        WHERE ub.deleted_at IS NULL
       UNION ALL
       SELECT b.title, b.authors, b.isbn13, NULL, NULL, r.state, r.started_at, r.finished_at, r.rating, NULL, NULL
         FROM readings r
         JOIN books_effective b ON b.id = r.book_id
        WHERE r.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM user_books ub WHERE ub.book_id = r.book_id AND ub.deleted_at IS NULL)
       ORDER BY 1 COLLATE NOCASE`
    )
    .map((r) => ({
      title: r.title,
      authors: JSON.parse(r.authors ?? '[]'),
      isbn13: r.isbn13 ?? null,
      status: r.status ?? null,
      shelf: r.shelf ?? null,
      readingState: r.state ?? null,
      startedAt: r.started_at ?? null,
      finishedAt: r.finished_at ?? null,
      rating: r.rating ?? null,
      loanedTo: r.borrower_name ?? null,
      loanedSince: r.loaned_at ?? null,
    }));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/features/export src/db/__tests__/exportRows.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 6: Share it**

Create `src/features/export/shareCsv.ts`:

```ts
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { listExportRows } from '@/db/repository';
import { exportFileName, libraryCsv } from './libraryCsv';

/** Works offline: built from the local database and handed to the share sheet. */
export async function shareLibraryCsv(now: Date = new Date()): Promise<void> {
  const file = new File(Paths.cache, exportFileName(now));
  if (file.exists) file.delete();
  file.create();
  file.write(libraryCsv(listExportRows()));
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: 'Export my library' });
}
```

In `app/(tabs)/profile.tsx`:
- add `import { shareLibraryCsv } from '@/features/export/shareCsv';` and `import { useToast } from '@/stores/toast';`;
- add under `const [busy, setBusy] = useState(false);`:

```tsx
  const showToast = useToast((s) => s.show);
  const onExport = () => {
    shareLibraryCsv().catch(() => showToast("Couldn't make the export. Try again."));
  };
```

- and pass `onExport={onExport}` to `<AccountCard … />`.

- [ ] **Step 7: Checkpoint**

Run `npx tsc --noEmit`, `npx jest`, `npx expo-doctor`.
Expected: all clean, with 214 tests passing.

Hand Sean the file list: `src/features/export/libraryCsv.ts`, `src/features/export/shareCsv.ts`, `src/features/export/__tests__/libraryCsv.test.ts`, `src/db/__tests__/exportRows.test.ts`, `src/db/repository.ts`, `app/(tabs)/profile.tsx`.

---

### Task 7: Delete account (edge function and screen)

**Files:**
- Create: `supabase/functions/_shared/accountCore.ts`, `supabase/functions/delete-account/index.ts`, `src/features/account/deleteAccount.ts`, `app/account/delete.tsx`
- Modify: `src/components/ui/Button.tsx` (`danger` variant), `app/_layout.tsx` (protected route), `app/(tabs)/profile.tsx` (`onDelete`)
- Test: `src/lib/__tests__/accountCore.test.ts`, `src/features/account/__tests__/deleteAccount.test.ts`

**Interfaces:**
- Consumes: `endSession` (Task 5); `wipeLocalData` (Task 2); `SignInCancelled` (Task 3); `useSession().providers` (Task 3); `shareLibraryCsv` (Task 6).
- Produces:
  ```ts
  // supabase/functions/_shared/accountCore.ts (no imports; Deno + Jest)
  export interface DeleteRequest { appleAuthorizationCode: string | null }
  export function parseDeleteRequest(body: unknown): DeleteRequest | null;
  export function isUuid(s: unknown): s is string;
  export function base64url(bytes: Uint8Array): string;
  export function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer>;
  export function appleClientSecretParts(p: { teamId: string; keyId: string; clientId: string; nowSec: number }): { header: { alg: 'ES256'; kid: string }; payload: { iss: string; iat: number; exp: number; aud: 'https://appleid.apple.com'; sub: string } };
  export function jwtSigningInput(header: object, payload: object): string;
  export function appleClientSecret(subtle: SubtleCrypto, pem: string, p: { teamId: string; keyId: string; clientId: string; nowSec: number }): Promise<string>;
  export function coverPaths(uid: string, names: string[]): string[];
  export function isMissingBucket(err: unknown): boolean;
  export function chunk<T>(xs: T[], n: number): T[][];
  // src/features/account/deleteAccount.ts
  export const DELETE_FAILED = "Couldn't delete your account. Check your connection and try again.";
  export function canConfirmDelete(typed: string): boolean;
  export function deleteAccount(p: { hasApple: boolean; platform?: string; client?: Pick<SupabaseClient, 'auth' | 'functions'> }): Promise<void>;
  // Button: variant?: 'primary' | 'ghost' | 'danger'
  ```
- **Apple revocation:**
  - The function revokes Apple tokens whenever the app sends an authorisation code. That happens on iOS, for any account with an `apple` identity.
  - An Android phone can't produce a code (native Apple sign-in is iOS-only). For that phone the deletion still goes ahead: the right to delete outranks revocation, and the person can revoke from their Apple ID settings.
  - If the Apple exchange fails, the function stops before deleting anything, so a retry is safe.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/accountCore.test.ts`:

```ts
/// <reference types="node" />
import { webcrypto } from 'crypto';
import {
  appleClientSecret, appleClientSecretParts, base64url, chunk, coverPaths, isMissingBucket, isUuid, jwtSigningInput,
  parseDeleteRequest, pemToPkcs8,
} from '../../../supabase/functions/_shared/accountCore';

const subtle = webcrypto.subtle as unknown as SubtleCrypto;

describe('parseDeleteRequest', () => {
  it('accepts an empty body or a null code', () => {
    expect(parseDeleteRequest(undefined)).toEqual({ appleAuthorizationCode: null });
    expect(parseDeleteRequest({})).toEqual({ appleAuthorizationCode: null });
    expect(parseDeleteRequest({ appleAuthorizationCode: null })).toEqual({ appleAuthorizationCode: null });
  });
  it('accepts an Apple authorization code', () => {
    expect(parseDeleteRequest({ appleAuthorizationCode: 'c1a2.b3-c_4' })).toEqual({ appleAuthorizationCode: 'c1a2.b3-c_4' });
  });
  it.each([[[]], ['x'], [{ userId: 'someone-else' }], [{ appleAuthorizationCode: 'has space' }], [{ appleAuthorizationCode: 'x'.repeat(2049) }]])(
    'rejects %p', (body) => expect(parseDeleteRequest(body)).toBeNull()
  );
});

describe('helpers', () => {
  it('isUuid', () => {
    expect(isUuid('6f1c1b8e-3b0a-4c55-9d7e-2a1f0c9b8d7e')).toBe(true);
    expect(isUuid('../other')).toBe(false);
  });
  it('base64url has no padding or +/', () => expect(base64url(new Uint8Array([251, 255, 191]))).toBe('-_-_'));
  it('coverPaths keeps flat names under the caller only', () => {
    expect(coverPaths('u1', ['a.jpg', '', 'nested/b.jpg', 'c.jpg'])).toEqual(['u1/a.jpg', 'u1/c.jpg']);
  });
  it('isMissingBucket', () => {
    expect(isMissingBucket({ message: 'Bucket not found' })).toBe(true);
    expect(isMissingBucket({ statusCode: '404' })).toBe(true);
    expect(isMissingBucket({ message: 'permission denied' })).toBe(false);
  });
  it('chunk', () => expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]));
});

describe('Apple client secret', () => {
  it('has the claims Apple expects, valid for five minutes', () => {
    expect(appleClientSecretParts({ teamId: 'TEAM', keyId: 'KEY', clientId: 'com.sean.booklistd', nowSec: 1000 })).toEqual({
      header: { alg: 'ES256', kid: 'KEY' },
      payload: { iss: 'TEAM', iat: 1000, exp: 1300, aud: 'https://appleid.apple.com', sub: 'com.sean.booklistd' },
    });
  });

  it('signs an ES256 JWT with a .p8 key', async () => {
    const pair = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey));
    const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString('base64')}\n-----END PRIVATE KEY-----`;
    expect(Array.from(pemToPkcs8(pem))).toEqual(Array.from(pkcs8));

    const jwt = await appleClientSecret(subtle, pem, { teamId: 'TEAM', keyId: 'KEY', clientId: 'com.sean.booklistd', nowSec: 1000 });
    const [h, p, s] = jwt.split('.');
    expect(`${h}.${p}`).toBe(jwtSigningInput({ alg: 'ES256', kid: 'KEY' }, { iss: 'TEAM', iat: 1000, exp: 1300, aud: 'https://appleid.apple.com', sub: 'com.sean.booklistd' }));
    const sig = new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
    expect(sig.length).toBe(64);
    const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, sig, new TextEncoder().encode(`${h}.${p}`));
    expect(ok).toBe(true);
  });
});
```

Create `src/features/account/__tests__/deleteAccount.test.ts`:

```ts
jest.mock('@/api/supabase', () => ({ supabase: {} }));
const mockApple = { signInAsync: jest.fn() };
jest.mock('expo-apple-authentication', () => ({ signInAsync: (...a: unknown[]) => mockApple.signInAsync(...a) }));
jest.mock('@/auth/signIn', () => ({ SignInCancelled: class SignInCancelled extends Error {} }));
const mockWipe = jest.fn();
jest.mock('@/db/localData', () => ({ wipeLocalData: () => mockWipe() }));
const mockEnd = jest.fn(async (_c?: unknown) => {});
jest.mock('@/features/account/signOut', () => ({ endSession: (c: unknown) => mockEnd(c) }));

import { SignInCancelled } from '@/auth/signIn';
import { canConfirmDelete, deleteAccount } from '../deleteAccount';

const client = (error: unknown = null) => ({ auth: {}, functions: { invoke: jest.fn(async (_n: string, _o: unknown) => ({ data: { deleted: true }, error })) } });

beforeEach(() => jest.clearAllMocks());

it('only DELETE enables the button', () => {
  expect(canConfirmDelete('DELETE')).toBe(true);
  expect(canConfirmDelete(' DELETE ')).toBe(true);
  expect(canConfirmDelete('delete')).toBe(false);
  expect(canConfirmDelete('')).toBe(false);
});

it('Apple accounts on iOS re-authorise first and send the code', async () => {
  mockApple.signInAsync.mockResolvedValue({ authorizationCode: 'apple-code' });
  const c = client();
  await deleteAccount({ hasApple: true, platform: 'ios', client: c as never });
  expect(c.functions.invoke).toHaveBeenCalledWith('delete-account', { body: { appleAuthorizationCode: 'apple-code' } });
  expect(mockWipe).toHaveBeenCalled();
  expect(mockEnd).toHaveBeenCalled();
});

it('other accounts send no code', async () => {
  const c = client();
  await deleteAccount({ hasApple: false, platform: 'ios', client: c as never });
  expect(mockApple.signInAsync).not.toHaveBeenCalled();
  expect(c.functions.invoke).toHaveBeenCalledWith('delete-account', { body: { appleAuthorizationCode: null } });
});

it('cancelling Apple stops before anything is deleted', async () => {
  mockApple.signInAsync.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
  const c = client();
  await expect(deleteAccount({ hasApple: true, platform: 'ios', client: c as never })).rejects.toBeInstanceOf(SignInCancelled);
  expect(c.functions.invoke).not.toHaveBeenCalled();
});

it('a failed call wipes nothing locally', async () => {
  const c = client(new Error('offline'));
  await expect(deleteAccount({ hasApple: false, platform: 'android', client: c as never })).rejects.toThrow();
  expect(mockWipe).not.toHaveBeenCalled();
  expect(mockEnd).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest src/lib/__tests__/accountCore.test.ts src/features/account/__tests__/deleteAccount.test.ts`
Expected: FAIL with "Cannot find module '../../../supabase/functions/_shared/accountCore'" and "'../deleteAccount'".

- [ ] **Step 3: Implement the shared core**

Create `supabase/functions/_shared/accountCore.ts`:

```ts
/**
 * delete-account core, shared by the edge function and Jest. Plain TypeScript with no imports and no
 * Deno or React Native APIs (only WebCrypto passed in, plus btoa/atob/TextEncoder), so it runs unchanged in both.
 */

export interface DeleteRequest {
  appleAuthorizationCode: string | null;
}

const APPLE_CODE = /^[A-Za-z0-9._-]{1,2048}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The body may be empty or { appleAuthorizationCode }. Anything else (a user id, say) is refused. */
export function parseDeleteRequest(body: unknown): DeleteRequest | null {
  if (body === undefined || body === null) return { appleAuthorizationCode: null };
  if (typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((k) => k !== 'appleAuthorizationCode')) return null;
  const code = record.appleAuthorizationCode;
  if (code === undefined || code === null) return { appleAuthorizationCode: null };
  return typeof code === 'string' && APPLE_CODE.test(code) ? { appleAuthorizationCode: code } : null;
}

export function isUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID.test(s);
}

export function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** An Apple .p8 file (PEM, possibly stored with literal \n) to PKCS#8 DER bytes. */
export function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const b64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

export function appleClientSecretParts(p: { teamId: string; keyId: string; clientId: string; nowSec: number }) {
  return {
    header: { alg: 'ES256' as const, kid: p.keyId },
    payload: { iss: p.teamId, iat: p.nowSec, exp: p.nowSec + 300, aud: 'https://appleid.apple.com' as const, sub: p.clientId },
  };
}

export function jwtSigningInput(header: object, payload: object): string {
  const enc = new TextEncoder();
  return `${base64url(enc.encode(JSON.stringify(header)))}.${base64url(enc.encode(JSON.stringify(payload)))}`;
}

/** Apple's client_secret: an ES256 JWT signed with the Sign in with Apple key. WebCrypto returns the raw r||s form JWTs need. */
export async function appleClientSecret(
  subtle: SubtleCrypto,
  pem: string,
  p: { teamId: string; keyId: string; clientId: string; nowSec: number },
): Promise<string> {
  const { header, payload } = appleClientSecretParts(p);
  const input = jwtSigningInput(header, payload);
  const key = await subtle.importKey('pkcs8', pemToPkcs8(pem), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input)));
  return `${input}.${base64url(sig)}`;
}

/** Storage list() names under covers/<uid>/ become removable paths, and never anything outside the caller's folder. */
export function coverPaths(uid: string, names: string[]): string[] {
  return names.filter((n) => n.length > 0 && !n.includes('/')).map((n) => `${uid}/${n}`);
}

export function isMissingBucket(err: unknown): boolean {
  const e = (err ?? {}) as { message?: unknown; statusCode?: unknown };
  return e.statusCode === '404' || e.statusCode === 404 || (typeof e.message === 'string' && /bucket not found/i.test(e.message));
}

export function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
```

- [ ] **Step 4: Implement the client flow**

Create `src/features/account/deleteAccount.ts`:

```ts
/** Spec §7.1: Apple re-authorisation (iOS), the delete-account function, then a local wipe. Nothing is wiped on failure. */
import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/api/supabase';
import { SignInCancelled } from '@/auth/signIn';
import { wipeLocalData } from '@/db/localData';
import { endSession } from '@/features/account/signOut';

export const DELETE_FAILED = "Couldn't delete your account. Check your connection and try again.";

export function canConfirmDelete(typed: string): boolean {
  return typed.trim() === 'DELETE';
}

export async function deleteAccount({
  hasApple, platform = Platform.OS, client = supabase,
}: { hasApple: boolean; platform?: string; client?: Pick<SupabaseClient, 'auth' | 'functions'> }): Promise<void> {
  let appleAuthorizationCode: string | null = null;
  if (hasApple && platform === 'ios') {
    try {
      const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
      appleAuthorizationCode = credential.authorizationCode ?? null;
    } catch (e) {
      if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw new SignInCancelled();
      throw e;
    }
  }
  const { error } = await client.functions.invoke('delete-account', { body: { appleAuthorizationCode } });
  if (error) throw error;
  wipeLocalData();
  await endSession(client);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/lib/__tests__/accountCore.test.ts src/features/account`
Expected: PASS (accountCore 14, deleteAccount 5, and Task 5's 10).

- [ ] **Step 6: The edge function**

Create `supabase/functions/delete-account/index.ts`:

```ts
// Supabase Edge Function: delete-account
// POST { appleAuthorizationCode?: string } with the caller's user JWT -> { deleted: true }
// The caller can only ever delete themselves: the uid comes from the verified JWT, never from the body.
// Order: Apple token revocation (when a code is sent), then every object under covers/<uid>/, then
// auth.admin.deleteUser(uid); its on delete cascade removes all their rows.
// Errors are generic. Logs carry only a request id and an outcome word.
// Deploy: Sean runs `supabase functions deploy delete-account`. Subagents never deploy.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2.116.0';
import { appleClientSecret, chunk, coverPaths, isMissingBucket, isUuid, parseDeleteRequest } from '../_shared/accountCore.ts';

const MAX_BODY_BYTES = 4096;
const APPLE_TIMEOUT_MS = 8000;
const LIST_PAGE = 1000;

Deno.serve(async (req) => {
  const reqId = crypto.randomUUID().slice(0, 8);
  const done = (outcome: string, status: number, body: unknown) => {
    console.log(JSON.stringify({ fn: 'delete-account', reqId, outcome }));
    return json(body, status);
  };
  try {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (Number(req.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) return done('rejected', 413, { error: 'invalid_request' });
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return done('rejected', 413, { error: 'invalid_request' });
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      return done('rejected', 400, { error: 'invalid_request' });
    }
    const request = parseDeleteRequest(body);
    if (!request) return done('rejected', 400, { error: 'invalid_request' });

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const auth = req.headers.get('Authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
    if (!token) return done('unauthorized', 401, { error: 'unauthorized' });
    const { data, error } = await admin.auth.getClaims(token);
    const uid = data?.claims?.sub;
    if (error || data?.claims?.role !== 'authenticated' || !isUuid(uid)) return done('unauthorized', 401, { error: 'unauthorized' });

    if (request.appleAuthorizationCode && !(await revokeApple(request.appleAuthorizationCode))) {
      return done('failed:apple', 502, { error: 'delete_failed' });
    }
    if (!(await removeCovers(admin, uid))) return done('failed:storage', 500, { error: 'delete_failed' });
    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) return done('failed:auth', 500, { error: 'delete_failed' });
    return done('deleted', 200, { deleted: true });
  } catch {
    return done('failed:unhandled', 500, { error: 'delete_failed' });
  }
});

/** Exchanges the fresh authorisation code, then revokes the token (Apple requires this when an account is deleted). */
async function revokeApple(code: string): Promise<boolean> {
  const clientId = Deno.env.get('APPLE_CLIENT_ID');
  const teamId = Deno.env.get('APPLE_TEAM_ID');
  const keyId = Deno.env.get('APPLE_KEY_ID');
  const pem = Deno.env.get('APPLE_PRIVATE_KEY');
  if (!clientId || !teamId || !keyId || !pem) return false;
  const secret = await appleClientSecret(crypto.subtle, pem, { teamId, keyId, clientId, nowSec: Math.floor(Date.now() / 1000) });
  const form = (fields: Record<string, string>): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(APPLE_TIMEOUT_MS),
  });
  const tokenRes = await fetch('https://appleid.apple.com/auth/token', form({ client_id: clientId, client_secret: secret, code, grant_type: 'authorization_code' }));
  if (!tokenRes.ok) {
    await tokenRes.body?.cancel();
    return false;
  }
  const tokens = (await tokenRes.json()) as { refresh_token?: string; access_token?: string };
  const token = tokens.refresh_token ?? tokens.access_token;
  if (!token) return false;
  const revokeRes = await fetch(
    'https://appleid.apple.com/auth/revoke',
    form({ client_id: clientId, client_secret: secret, token, token_type_hint: tokens.refresh_token ? 'refresh_token' : 'access_token' }),
  );
  await revokeRes.body?.cancel();
  return revokeRes.ok;
}

/** Deletes every object in covers/<uid>/. A missing bucket counts as nothing to delete. */
async function removeCovers(admin: SupabaseClient, uid: string): Promise<boolean> {
  const bucket = admin.storage.from('covers');
  for (let round = 0; round < 50; round++) {
    const { data, error } = await bucket.list(uid, { limit: LIST_PAGE });
    if (error) return isMissingBucket(error);
    const paths = coverPaths(uid, (data ?? []).map((o) => o.name));
    if (paths.length === 0) return true;
    for (const part of chunk(paths, 100)) {
      const { error: rmErr } = await bucket.remove(part);
      if (rmErr) return false;
    }
    if ((data ?? []).length < LIST_PAGE) return true;
  }
  return false;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
```

- [ ] **Step 7: The danger button**

In `src/components/ui/Button.tsx`:
- change the prop type `variant?: 'primary' | 'ghost'` to `variant?: 'primary' | 'ghost' | 'danger'`;
- change `backgroundColor: variant === 'primary' ? ink.bus : ink.white,` to:

```tsx
            backgroundColor: variant === 'primary' ? ink.bus : variant === 'danger' ? ink.tomato : ink.white,
```

- change the label style `color: ink.brown` to `color: variant === 'danger' ? ink.white : ink.brown`.

- [ ] **Step 8: The Delete account screen**

Create `app/account/delete.tsx`:

```tsx
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { useSession } from '@/auth/session';
import { SignInCancelled } from '@/auth/signIn';
import { canConfirmDelete, DELETE_FAILED, deleteAccount } from '@/features/account/deleteAccount';
import { shareLibraryCsv } from '@/features/export/shareCsv';
import { useToast } from '@/stores/toast';
import { font, ink, radius } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

export default function DeleteAccountScreen() {
  const { c } = useTheme();
  const router = useRouter();
  const providers = useSession((s) => s.providers);
  const showToast = useToast((s) => s.show);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const exportNow = () => {
    shareLibraryCsv().catch(() => showToast("Couldn't make the export. Try again."));
  };
  const remove = async () => {
    if (!canConfirmDelete(typed) || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await deleteAccount({ hasApple: providers.includes('apple') });
      router.replace('/welcome');
    } catch (e) {
      if (!(e instanceof SignInCancelled)) setProblem(DELETE_FAILED);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={10} style={{ paddingHorizontal: 20, paddingVertical: 8 }}>
            <Text style={{ fontFamily: font.heavy, fontSize: 14, color: c.text }}>Cancel</Text>
          </Pressable>
          <ScreenHeader title="Delete account" />
          <View style={{ paddingHorizontal: 20, marginTop: 12, gap: 14 }}>
            <Text style={{ fontFamily: font.bold, fontSize: 15, lineHeight: 21, color: c.text }}>
              Deleting your account removes your shelves, books, readings, loans and cover photos, on every device. This can't be undone.
            </Text>
            <Button label="Export my library" variant="ghost" disabled={busy} onPress={exportNow} />
            <Text style={{ fontFamily: font.heavy, fontSize: 14, color: c.text, marginTop: 8 }}>Type DELETE to confirm</Text>
            <TextInput
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel="Type DELETE to confirm"
              style={{
                minHeight: 46, paddingHorizontal: 12, borderWidth: 2, borderColor: c.line, borderRadius: radius.pill / 2,
                backgroundColor: ink.white, fontFamily: font.bold, fontSize: 16, color: ink.brown,
              }}
            />
            <Button label={busy ? 'Deleting…' : 'Delete my account'} variant="danger" disabled={busy || !canConfirmDelete(typed)} onPress={remove} />
            {problem ? <Text accessibilityRole="alert" style={{ fontFamily: font.bold, fontSize: 13, color: ink.tomato, textAlign: 'center' }}>{problem}</Text> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
```

In `app/_layout.tsx`, add `<Stack.Screen name="account/delete" />` inside the `guards.app` `Stack.Protected`, after `shelves`.

In `app/(tabs)/profile.tsx`, pass `onDelete={() => router.push('/account/delete')}` to `<AccountCard … />`.

- [ ] **Step 9: Checkpoint**

Run `npx tsc --noEmit`, `npx jest`, `npx expo-doctor`.
Expected: all clean, with 233 tests passing. `supabase/functions` is excluded from tsc, but the `_shared` core is type-checked through its test import.

Hand Sean the file list: `supabase/functions/_shared/accountCore.ts`, `supabase/functions/delete-account/index.ts`, `src/lib/__tests__/accountCore.test.ts`, `src/features/account/deleteAccount.ts`, `src/features/account/__tests__/deleteAccount.test.ts`, `app/account/delete.tsx`, `src/components/ui/Button.tsx`, `app/_layout.tsx`, `app/(tabs)/profile.tsx`.

---

### Task 8: Auth and native configuration, EAS, setup and privacy docs

**Files:**
- Modify: `supabase/config.toml`, `app.json`, `package.json` (via `npx expo install`), `.env.example`
- Create: `app.config.ts`, `eas.json`, `docs/setup-accounts.md`, `docs/privacy-policy.md`
- Test: `src/lib/__tests__/appConfig.test.ts`

**Interfaces:**
- Consumes: env names used by Task 3 (`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`); `PRIVACY_POLICY_URL` (Task 4).
- Produces: a dev-build-ready config (Apple capability, Google URL scheme) and the `development`/`preview`/`production` EAS profiles. Local Supabase auth mirrors production. Sean's setup checklist.

- [ ] **Step 1: Install the dev client**

Run: `npx expo install expo-dev-client`
Expected: `expo-dev-client` is added to `dependencies`.

- [ ] **Step 2: Write the failing config test**

Create `src/lib/__tests__/appConfig.test.ts`:

```ts
import appJson from '../../../app.json';
import makeConfig from '../../../app.config';

type Plugin = string | [string, Record<string, unknown>];
const base = { config: appJson.expo } as never;

describe('app config', () => {
  it('turns on Sign in with Apple and keeps the booklistd scheme for the email link', () => {
    const cfg = makeConfig(base);
    expect(cfg.ios?.usesAppleSignIn).toBe(true);
    expect(cfg.scheme).toBe('booklistd');
  });

  it('adds the secure-store, Apple and Google plugins', () => {
    process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME = 'com.googleusercontent.apps.123-abc';
    const plugins = makeConfig(base).plugins as Plugin[];
    const names = plugins.map((p) => (Array.isArray(p) ? p[0] : p));
    expect(names).toEqual(expect.arrayContaining(['expo-secure-store', 'expo-apple-authentication', '@react-native-google-signin/google-signin']));
    const google = plugins.find((p) => Array.isArray(p) && p[0] === '@react-native-google-signin/google-signin') as [string, { iosUrlScheme: string }];
    expect(google[1].iosUrlScheme).toBe('com.googleusercontent.apps.123-abc');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx jest src/lib/__tests__/appConfig.test.ts`
Expected: FAIL with "Cannot find module '../../../app.config'".

- [ ] **Step 4: app.json, app.config.ts, eas.json, .env.example**

In `app.json`:
- inside `"ios"`, add `"usesAppleSignIn": true,` after `"bundleIdentifier": "com.sean.booklistd",`;
- in `"plugins"`, add `"expo-secure-store",` and `"expo-apple-authentication",` after `"expo-font",`.

Create `app.config.ts`:

```ts
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * app.json plus the Google sign-in plugin. Its iOS URL scheme is the reversed iOS client id, which is
 * public but per-project. Set EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME in .env and in the EAS environment.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  plugins: [
    ...(config.plugins ?? []),
    [
      '@react-native-google-signin/google-signin',
      { iosUrlScheme: process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME ?? 'com.googleusercontent.apps.missing-EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME' },
    ],
  ],
});
```

Create `eas.json`:

```json
{
  "cli": { "version": ">= 16.0.0", "appVersionSource": "remote" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal", "environment": "development" },
    "preview": { "distribution": "internal", "environment": "preview" },
    "production": { "autoIncrement": true, "environment": "production" }
  },
  "submit": { "production": {} }
}
```

Append to `.env.example`:

```bash

# Google sign-in: public OAuth client ids, not secrets. See docs/setup-accounts.md.
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=YOUR-WEB-CLIENT-ID.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=YOUR-IOS-CLIENT-ID.apps.googleusercontent.com
# The iOS client id reversed, e.g. com.googleusercontent.apps.1234-abcd
EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME=com.googleusercontent.apps.YOUR-IOS-CLIENT-ID
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx jest src/lib/__tests__/appConfig.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Local Supabase auth mirrors production**

In `supabase/config.toml`, make these exact replacements:

| Find | Replace with |
|---|---|
| `site_url = "http://127.0.0.1:3000"` | `site_url = "booklistd://auth/callback"` |
| `additional_redirect_urls = ["https://127.0.0.1:3000"]` | `additional_redirect_urls = ["booklistd://auth/callback"]` |
| `minimum_password_length = 6` | `minimum_password_length = 8` |
| `enable_confirmations = false` (the one under `[auth.email]`) | `enable_confirmations = true` |
| `max_frequency = "1s"` (under `[auth.email]`) | `max_frequency = "60s"` |

Under `[auth.external.apple]`, set `enabled = true` and `client_id = "com.sean.booklistd"`. Leave `secret`, `redirect_uri` and `skip_nonce_check = false` as they are, because native Apple sign-in sends a nonce.

After the `[auth.external.apple]` block (after its `email_optional = false` line), add:

```toml

# Native Google sign-in (@react-native-google-signin). client_id lists the web client id and then the
# iOS client id, comma-separated. The iOS SDK embeds its own nonce, so the nonce check is skipped
# (Supabase's documented setting for native Google on iOS).
[auth.external.google]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
skip_nonce_check = true

# book-lookup accepts the anon key and verifies user tokens itself.
[functions.book-lookup]
verify_jwt = false

[functions.delete-account]
verify_jwt = true
```

- [ ] **Step 7: The setup checklist**

Create `docs/setup-accounts.md`:

````markdown
# Accounts and sync: setup checklist (Sean)

Everything here happens outside the repo. Secrets never go in the app or the repo.

## 1. Apple
1. developer.apple.com → Identifiers → `com.sean.booklistd` → enable **Sign in with Apple**.
2. Create a **Services ID** (for example `com.sean.booklistd.signin`). You only need it if Apple web sign-in is added later; native iOS uses the bundle id.
3. Keys → create a **Sign in with Apple** key. Note the **Key ID** and **Team ID**, and download the `.p8` (you can only download it once).
4. Supabase → Auth → Providers → Apple: enable it. Client IDs: `com.sean.booklistd` (plus the Services ID, if you made one). Paste the Team ID, the Key ID and the `.p8` contents.
5. Function secrets for token revocation when an account is deleted (Supabase → Edge Functions → Secrets):
   - `APPLE_CLIENT_ID` = `com.sean.booklistd`
   - `APPLE_TEAM_ID`, `APPLE_KEY_ID`
   - `APPLE_PRIVATE_KEY` = the `.p8` contents (newlines may be stored as `\n`)

## 2. Google Cloud
1. APIs & Services → OAuth consent screen: app name Booklistd, scopes `openid`, `email` and `profile` only.
2. Credentials → OAuth client IDs:
   - **iOS**: bundle id `com.sean.booklistd`.
   - **Android**: package `com.sean.booklistd` and the SHA-1 of the EAS keystore (`eas credentials` → Android → Keystore). Add the dev-build SHA-1 too.
   - **Web**: no redirect is needed for native sign-in.
3. Supabase → Auth → Providers → Google: enable it.
   - Client IDs: the **web** id, then the **iOS** id, comma-separated.
   - Client secret: the web client's secret.
   - Turn on **Skip nonce checks**, which native iOS needs.
4. App env (`.env` and the EAS environment): `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, and `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME` (the iOS id reversed). These are public ids, not secrets.

## 3. Supabase Auth
1. URL configuration: Site URL `booklistd://auth/callback`. Redirect URLs: **only** `booklistd://auth/callback`.
2. Providers: Apple, Google and Email only.
   - Email: turn on **Confirm email**, and set the magic link expiry to 3600s.
   - Anonymous sign-ins: off.
3. Password sign-up: Supabase has no separate "no passwords" switch. With **Confirm email** on, a password sign-up still has to prove the email address, exactly like a magic link does. The app never offers passwords, and the minimum length is 8 (F15).
4. Identity linking: leave automatic linking on verified email on (the default). An Apple private-relay email won't link to a Google account; that's expected.
5. Rate limits: leave the built-in limits on.
6. **Custom SMTP (launch blocker):** Auth → SMTP → Resend, or a similar service. Without it, magic links fail silently after a few emails per hour.

## 4. Phase 2 (sync)
1. Database → Extensions: enable `pg_cron` and `pg_net`. The migration also runs `create extension if not exists`.
2. Vault, run once in the SQL editor:
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
   select vault.create_secret('<long random string>', 'purge_covers_secret');
   ```
3. Function secret: set `PURGE_COVERS_SECRET` to the same long random string.
4. Apply `supabase/migrations/20260922180000_accounts_sync.sql`, then deploy `purge-covers`, `book-lookup` and `delete-account`.

## 5. EAS and dev builds
1. Run `eas init` to link the project. Then run `eas env:create` for the `EXPO_PUBLIC_*` values in each environment.
2. Run `eas build --profile development --platform ios` and `--platform android`, and install the builds on both phones.
3. Expo Go is no longer used, because native Google sign-in needs a development build.

## 6. Privacy
1. Host `docs/privacy-policy.md` publicly, and set `PRIVACY_POLICY_URL` in `src/lib/links.ts`.
2. App Store privacy labels and Play Data safety:
   - Data collected: email address, name, and user content (the library, borrower names and photos).
   - All of it is linked to the user and **none of it is used for tracking**.
   - No third-party advertising or analytics.
````

- [ ] **Step 8: The privacy policy draft**

Create `docs/privacy-policy.md`:

```markdown
# Booklistd privacy policy (draft)

_Last updated: 2026-09-22_

Booklistd keeps a record of the books you own, want and read. It backs that record up to your account, so it's on every phone you sign in to.

## What we collect
- **Your email address**, from Apple, Google or the email link you sign in with. If you use Apple's "Hide My Email", we only see the relay address.
- **Your name**, if Apple or Google shares it when you first sign in.
- **Your library:** your shelves, books, copies, reading dates, ratings, notes and the details you type in.
- **Loans:** the names of people you lend books to. You type these in, and only you can see them.
- **Cover photos** you take or choose for a book.

We don't use tracking, ads or analytics SDKs. We don't sell or share your data.

## Where it lives
Your data is stored on your phone and in our backup service (Supabase). Cover photos go in private storage that only your account can read.

Book details found by ISBN (title, author, cover link) come from public catalogs and are shared between all readers. What you type about a book stays yours.

## Deleting your data
Profile → Delete account deletes your account and everything above, on every device, straight away. It can't be undone, so export your library first if you'd like a copy.

Signing out removes your library from that phone only.

## Questions
- **I signed in with Apple and with Google, and now I have two libraries. Why?** Accounts join automatically when both share a verified email. Apple's "Hide My Email" address can't match your Google address, so those accounts stay separate.
- **How do I reach you?** Use the support link on the App Store or Google Play listing.
```

- [ ] **Step 9: Checkpoint**

Run `npx tsc --noEmit`, `npx jest`, `npx expo-doctor`.
Expected: all clean, with 235 tests passing. expo-doctor accepts `app.config.ts` extending `app.json`.

Hand Sean the file list: `app.json`, `app.config.ts`, `eas.json`, `.env.example`, `package.json`, `package-lock.json`, `supabase/config.toml`, `docs/setup-accounts.md`, `docs/privacy-policy.md`, `src/lib/__tests__/appConfig.test.ts`.

**Phase 1 manual check (EAS dev build) before moving on:**
- Sign in with Apple, with Google and with an email link, and sign out of each. Sign-out shows the "isn't backed up yet" warning.
- Delete an account (Apple and Google).
- Export the CSV.

---

# Phase 2 — Sync

### Task 9: Server migration (book_edits, ownership, caps, indexes, covers bucket, purge) and the purge-covers function

**Files:**
- Create: `supabase/migrations/20260922180000_accounts_sync.sql`, `supabase/functions/_shared/purgeCore.ts`, `supabase/functions/purge-covers/index.ts`
- Modify: `supabase/config.toml`
- Test: `src/lib/__tests__/syncMigration.test.ts` (contract test over the SQL text), `src/lib/__tests__/purgeCore.test.ts`

**Interfaces:**
- Consumes: the existing `public.touch_updated_at()` and tables.
- Produces (server contract every later task relies on):
  - `public.book_edits(user_id uuid default auth.uid(), book_id uuid → books, title, subtitle, authors jsonb, publisher, published_year, edition, cover_object, updated_at, deleted_at)`, with `primary key (user_id, book_id)`.
  - `updated_at` is stamped by the server on **insert and update** for shelves, user_books, readings, loans, profiles and book_edits.
  - An ownership trigger. It returns SQLSTATE `42501` (HTTP 403) for a row pointing at another user's shelf or copy, and for any change of `user_id`.
  - Length caps with SQLSTATE `23514` (HTTP 400).
  - `books.title` is nullable (for `ensure` placeholders).
  - A private bucket `covers`, with objects at `<uid>/<book_id>-<13-digit ms>.jpg`.
  - `public.purge_cover_queue`, filled by a trigger whenever a `book_edits.cover_object` is replaced, nulled or deleted.
  - `pg_cron` jobs `purge-soft-deleted` (03:17 daily) and `purge-covers` (03:47 daily, which calls the function).
  ```ts
  // supabase/functions/_shared/purgeCore.ts
  export function bearerToken(header: string | null): string;
  export function safeEqual(a: string, b: string): boolean;
  export function isCoverObjectPath(p: unknown): p is string;
  export function orphanedPaths(queued: string[], stillReferenced: string[]): string[];
  ```
- **Cover object path (resolves spec §6.7):** the spec's fixed `<uid>/<book_id>.jpg` path can't tell another phone that a photo was *replaced*, because the path never changes. So each upload gets a fresh `<uid>/<book_id>-<ms>.jpg`, and the replaced object is queued for purge. Folder scoping and the bucket policies are exactly as the spec says. `upsert: true` stays, but it is harmless.
- **Ownership trigger on readings/book_edits:** those rows only reference the shared catalog (`book_id`), so there is no cross-owner reference to check. The one trigger function still guards all four tables against changing `user_id`, as the spec requires.

- [ ] **Step 1: Write the failing contract tests**

Create `src/lib/__tests__/syncMigration.test.ts`:

```ts
/// <reference types="node" />
/**
 * No Postgres in CI, so this pins the Phase 2 migration to what the app relies on. Sean applies the SQL;
 * a change here must be mirrored in src/sync.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(join(__dirname, '../../../supabase/migrations/20260922180000_accounts_sync.sql'), 'utf8').replace(/\s+/g, ' ');
const SYNCED = ['shelves', 'user_books', 'readings', 'loans', 'profiles', 'book_edits'];

describe('accounts_sync migration', () => {
  it('lets ensure insert placeholder catalog rows', () => {
    expect(sql).toContain('alter table public.books alter column title drop not null');
  });

  it('creates book_edits keyed by (user_id, book_id) with owner RLS for every command', () => {
    expect(sql).toContain('create table public.book_edits');
    expect(sql).toContain('primary key (user_id, book_id)');
    expect(sql).toContain('alter table public.book_edits enable row level security');
    for (const cmd of ['select', 'insert', 'update', 'delete']) expect(sql).toMatch(new RegExp(`on public\\.book_edits for ${cmd} to authenticated`));
    expect(sql).toContain('with check (user_id = (select auth.uid()))');
  });

  it('stamps updated_at on insert and update for every synced table', () => {
    for (const t of SYNCED) {
      expect(sql).toContain(`create trigger trg_${t}_touch before insert or update on public.${t} for each row execute function public.touch_updated_at()`);
    }
  });

  it('guards ownership on user_books, loans, readings and book_edits', () => {
    expect(sql).toContain('security invoker set search_path = \'\'');
    for (const t of ['user_books', 'loans', 'readings', 'book_edits']) {
      expect(sql).toContain(`create trigger trg_${t}_same_owner before insert or update on public.${t} for each row execute function public.enforce_same_owner()`);
    }
  });

  it('caps lengths as the spec says', () => {
    expect(sql).toContain('check (char_length(btrim(name)) between 1 and 80)');
    expect(sql).toContain('check (char_length(btrim(borrower_name)) between 1 and 80)');
    expect(sql).toContain('check (char_length(notes) <= 2000)');
    expect(sql).toContain('check (char_length(review) <= 2000)');
    for (const c of ['title', 'subtitle', 'publisher', 'edition']) expect(sql).toContain(`check (char_length(${c}) <= 300)`);
    expect(sql).toContain('jsonb_array_length(authors) <= 20');
  });

  it('indexes every synced table for the pull query', () => {
    for (const t of ['shelves', 'user_books', 'readings', 'loans']) expect(sql).toContain(`on public.${t} (user_id, updated_at, id)`);
    expect(sql).toContain('on public.book_edits (user_id, updated_at, book_id)');
  });

  it('keeps covers private and scoped to the owner folder', () => {
    expect(sql).toContain("values ('covers', 'covers', false");
    expect(sql.match(/\(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text/g)?.length).toBe(5);
  });

  it('purges soft-deleted rows after 30 days, daily, and queues their covers', () => {
    expect(sql).toContain("interval '30 days'");
    expect(sql).toContain("cron.schedule('purge-soft-deleted'");
    expect(sql).toContain("cron.schedule('purge-covers'");
    expect(sql).toContain('insert into public.purge_cover_queue');
  });
});
```

Create `src/lib/__tests__/purgeCore.test.ts`:

```ts
import { bearerToken, isCoverObjectPath, orphanedPaths, safeEqual } from '../../../supabase/functions/_shared/purgeCore';

const U = '6f1c1b8e-3b0a-4c55-9d7e-2a1f0c9b8d7e';
const B = '0b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const p = (ms: number) => `${U}/${B}-${ms}.jpg`;

describe('purgeCore', () => {
  it('reads a bearer token', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('Basic abc')).toBe('');
    expect(bearerToken(null)).toBe('');
  });
  it('compares secrets without an early exit', () => {
    expect(safeEqual('same-secret', 'same-secret')).toBe(true);
    expect(safeEqual('same-secret', 'same-secreT')).toBe(false);
    expect(safeEqual('short', 'longer-one')).toBe(false);
  });
  it('recognises cover object paths only', () => {
    expect(isCoverObjectPath(p(1726963200000))).toBe(true);
    expect(isCoverObjectPath(`${U}/../other.jpg`)).toBe(false);
    expect(isCoverObjectPath(`${U}/${B}.jpg`)).toBe(false);
  });
  it('keeps queued paths that a live row still uses', () => {
    expect(orphanedPaths([p(1726963200000), p(1726963200001), 'junk'], [p(1726963200001)])).toEqual([p(1726963200000)]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest src/lib/__tests__/syncMigration.test.ts src/lib/__tests__/purgeCore.test.ts`
Expected: FAIL with "ENOENT … 20260922180000_accounts_sync.sql" and "Cannot find module '…/purgeCore'".

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260922180000_accounts_sync.sql`:

```sql
-- Accounts and sync, Phase 2 (spec §6.5). Sean applies this; nobody runs `supabase db push` for him.
--  1. ensure placeholders: catalog rows may have no title yet
--  2. book_edits: the user's per-field overrides of a catalog book, plus the synced cover photo path
--  3. updated_at is always the server clock, on insert as well as update, so device clocks never matter
--  4. ownership trigger (F5): no row may point at another user's shelf or copy, or change owner
--  5. length caps (F6); NOT VALID so old rows don't block the migration, new writes are checked
--  6. (user_id, updated_at, id) indexes for the pull query
--  7. private covers bucket, owner-folder policies
--  8. replaced/removed cover objects are queued; soft-deleted rows are purged after 30 days (F13)

-- 1 ---------------------------------------------------------------------------------------------
alter table public.books alter column title drop not null;

-- 2 ---------------------------------------------------------------------------------------------
create table public.book_edits (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_id uuid not null references public.books (id),
  title text,
  subtitle text,
  authors jsonb,
  publisher text,
  published_year int,
  edition text,
  cover_object text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, book_id),
  constraint book_edits_title_len check (char_length(title) <= 300),
  constraint book_edits_subtitle_len check (char_length(subtitle) <= 300),
  constraint book_edits_publisher_len check (char_length(publisher) <= 300),
  constraint book_edits_edition_len check (char_length(edition) <= 300),
  constraint book_edits_authors_shape check (
    authors is null
    or case when jsonb_typeof(authors) = 'array'
            then jsonb_array_length(authors) <= 20 and char_length(authors::text) <= 6300
            else false end
  ),
  constraint book_edits_cover_object_path check (
    cover_object is null or cover_object ~ ('^' || user_id::text || '/' || book_id::text || '-[0-9]{13}\.jpg$')
  )
);

alter table public.book_edits enable row level security;
create policy "own book_edits (select)" on public.book_edits for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own book_edits (insert)" on public.book_edits for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own book_edits (update)" on public.book_edits for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own book_edits (delete)" on public.book_edits for delete to authenticated
  using (user_id = (select auth.uid()));

-- 3 ---------------------------------------------------------------------------------------------
drop trigger if exists trg_user_books_touch on public.user_books;
drop trigger if exists trg_shelves_touch on public.shelves;
drop trigger if exists trg_loans_touch on public.loans;
drop trigger if exists trg_readings_touch on public.readings;
create trigger trg_shelves_touch before insert or update on public.shelves for each row execute function public.touch_updated_at();
create trigger trg_user_books_touch before insert or update on public.user_books for each row execute function public.touch_updated_at();
create trigger trg_readings_touch before insert or update on public.readings for each row execute function public.touch_updated_at();
create trigger trg_loans_touch before insert or update on public.loans for each row execute function public.touch_updated_at();
create trigger trg_profiles_touch before insert or update on public.profiles for each row execute function public.touch_updated_at();
create trigger trg_book_edits_touch before insert or update on public.book_edits for each row execute function public.touch_updated_at();

-- 4 ---------------------------------------------------------------------------------------------
-- security invoker: under RLS the caller only sees their own shelves/copies, so "not found" means
-- "someone else's" (the foreign key already guarantees the row exists).
create or replace function public.enforce_same_owner()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'rows cannot change owner' using errcode = '42501';
  end if;
  -- Nested IFs: PL/pgSQL resolves new.<column> when an expression first runs, so a column only one
  -- table has (shelf_id, user_book_id) must sit inside that table's branch.
  if tg_table_name = 'user_books' then
    if new.shelf_id is not null
       and not exists (select 1 from public.shelves s where s.id = new.shelf_id and s.user_id = new.user_id) then
      raise exception 'shelf belongs to another user' using errcode = '42501';
    end if;
  elsif tg_table_name = 'loans' then
    if not exists (select 1 from public.user_books ub where ub.id = new.user_book_id and ub.user_id = new.user_id) then
      raise exception 'copy belongs to another user' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger trg_user_books_same_owner before insert or update on public.user_books for each row execute function public.enforce_same_owner();
create trigger trg_loans_same_owner before insert or update on public.loans for each row execute function public.enforce_same_owner();
create trigger trg_readings_same_owner before insert or update on public.readings for each row execute function public.enforce_same_owner();
create trigger trg_book_edits_same_owner before insert or update on public.book_edits for each row execute function public.enforce_same_owner();

-- 5 ---------------------------------------------------------------------------------------------
alter table public.shelves
  add constraint shelves_name_len check (char_length(btrim(name)) between 1 and 80) not valid;
alter table public.loans
  add constraint loans_borrower_name_len check (char_length(btrim(borrower_name)) between 1 and 80) not valid;
alter table public.user_books
  add constraint user_books_notes_len check (char_length(notes) <= 2000) not valid,
  add constraint user_books_review_len check (char_length(review) <= 2000) not valid;
alter table public.profiles
  add constraint profiles_display_name_len check (char_length(display_name) <= 80) not valid;

-- 6 ---------------------------------------------------------------------------------------------
drop index if exists public.idx_user_books_user;
create index idx_shelves_sync on public.shelves (user_id, updated_at, id);
create index idx_user_books_sync on public.user_books (user_id, updated_at, id);
create index idx_readings_sync on public.readings (user_id, updated_at, id);
create index idx_loans_sync on public.loans (user_id, updated_at, id);
create index idx_book_edits_sync on public.book_edits (user_id, updated_at, book_id);
create index idx_profiles_sync on public.profiles (id, updated_at);
create index idx_book_edits_cover on public.book_edits (cover_object) where cover_object is not null;

-- 7 ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

create policy "covers: owner reads" on storage.objects for select to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "covers: owner uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "covers: owner replaces" on storage.objects for update to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "covers: owner deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 8 ---------------------------------------------------------------------------------------------
create table public.purge_cover_queue (
  object_path text primary key check (char_length(object_path) <= 200),
  queued_at timestamptz not null default now()
);
alter table public.purge_cover_queue enable row level security;
revoke all on table public.purge_cover_queue from anon, authenticated;
grant select, insert, delete on table public.purge_cover_queue to service_role;

-- A replaced, removed or deleted photo leaves its object behind; queue it. purge-covers deletes only
-- paths no live row references, so re-adding a photo before the purge runs is safe.
create or replace function public.queue_replaced_cover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.cover_object is not null and (tg_op = 'DELETE' or new.cover_object is distinct from old.cover_object) then
    insert into public.purge_cover_queue (object_path) values (old.cover_object) on conflict do nothing;
  end if;
  return coalesce(new, old);
end $$;

create trigger trg_book_edits_queue_cover after update or delete on public.book_edits
  for each row execute function public.queue_replaced_cover();

create or replace function public.purge_soft_deleted()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff constant timestamptz := now() - interval '30 days';
begin
  delete from public.loans where deleted_at < cutoff;
  delete from public.readings where deleted_at < cutoff;
  delete from public.book_edits where deleted_at < cutoff; -- the queue trigger records their covers
  delete from public.user_books where deleted_at < cutoff; -- their loans cascade
  update public.user_books set shelf_id = null
   where shelf_id in (select id from public.shelves where deleted_at < cutoff);
  delete from public.shelves where deleted_at < cutoff;
end $$;

revoke execute on function public.purge_soft_deleted() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule('purge-soft-deleted', '17 3 * * *', 'select public.purge_soft_deleted()');

-- Needs Vault secrets project_url and purge_covers_secret (docs/setup-accounts.md §4).
select cron.schedule('purge-covers', '47 3 * * *', $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/purge-covers',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'purge_covers_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$cron$);
```

- [ ] **Step 4: Implement the purge core**

Create `supabase/functions/_shared/purgeCore.ts`:

```ts
/** purge-covers core shared by the edge function and Jest. Plain TypeScript, no imports. */

export function bearerToken(header: string | null): string {
  return header && header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
}

/** Constant-time for equal lengths, so the shared secret can't be guessed a character at a time. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const COVER_OBJECT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-\d{13}\.jpg$/i;

export function isCoverObjectPath(p: unknown): p is string {
  return typeof p === 'string' && COVER_OBJECT.test(p);
}

/** Queued paths that are safe to delete: well-formed, and not the current photo of any live book_edits row. */
export function orphanedPaths(queued: string[], stillReferenced: string[]): string[] {
  const live = new Set(stillReferenced);
  return queued.filter((p) => isCoverObjectPath(p) && !live.has(p));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/lib/__tests__/syncMigration.test.ts src/lib/__tests__/purgeCore.test.ts`
Expected: PASS (8 and 4 tests).

- [ ] **Step 6: The purge-covers function and its config**

Create `supabase/functions/purge-covers/index.ts`:

```ts
// Supabase Edge Function: purge-covers
// Called daily by pg_cron (see the accounts_sync migration) with `Authorization: Bearer <PURGE_COVERS_SECRET>`.
// Drains public.purge_cover_queue: deletes each queued covers/ object that no live book_edits row still
// uses, then drops the queue rows. verify_jwt is off (config.toml); the shared secret is the gate.
// Deploy: Sean runs `supabase functions deploy purge-covers`. Subagents never deploy.
import { createClient } from 'jsr:@supabase/supabase-js@2.116.0';
import { bearerToken, orphanedPaths, safeEqual } from '../_shared/purgeCore.ts';

const BATCH = 500;
const MAX_BATCHES = 20;

Deno.serve(async (req) => {
  const reqId = crypto.randomUUID().slice(0, 8);
  const done = (outcome: string, status: number, body: unknown) => {
    console.log(JSON.stringify({ fn: 'purge-covers', reqId, outcome }));
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    if (req.method !== 'POST') return done('rejected', 405, { error: 'method_not_allowed' });
    const secret = Deno.env.get('PURGE_COVERS_SECRET') ?? '';
    if (!safeEqual(bearerToken(req.headers.get('Authorization')), secret)) return done('unauthorized', 401, { error: 'unauthorized' });

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let removed = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const { data: queued, error } = await admin.from('purge_cover_queue').select('object_path').order('queued_at').limit(BATCH);
      if (error) return done('failed:queue', 500, { error: 'purge_failed' });
      const paths = (queued ?? []).map((q) => String(q.object_path));
      if (paths.length === 0) break;
      const { data: live, error: liveErr } = await admin
        .from('book_edits').select('cover_object').in('cover_object', paths).is('deleted_at', null);
      if (liveErr) return done('failed:lookup', 500, { error: 'purge_failed' });
      const orphans = orphanedPaths(paths, (live ?? []).map((r) => String(r.cover_object)));
      if (orphans.length) {
        const { error: rmErr } = await admin.storage.from('covers').remove(orphans);
        if (rmErr) return done('failed:storage', 500, { error: 'purge_failed' });
        removed += orphans.length;
      }
      const { error: delErr } = await admin.from('purge_cover_queue').delete().in('object_path', paths);
      if (delErr) return done('failed:dequeue', 500, { error: 'purge_failed' });
      if (paths.length < BATCH) break;
    }
    return done('purged', 200, { removed });
  } catch {
    return done('failed:unhandled', 500, { error: 'purge_failed' });
  }
});
```

In `supabase/config.toml`, after the `[functions.delete-account]` block, add:

```toml

# Called by pg_cron with a shared secret (PURGE_COVERS_SECRET), not a user JWT.
[functions.purge-covers]
verify_jwt = false
```

- [ ] **Step 7: Checkpoint**

Run `npx tsc --noEmit`, `npx jest`, `npx expo-doctor`.
Expected: all clean.

Hand Sean the file list: `supabase/migrations/20260922180000_accounts_sync.sql`, `supabase/functions/_shared/purgeCore.ts`, `supabase/functions/purge-covers/index.ts`, `supabase/config.toml`, and the two tests. Sean applies the migration himself; never `supabase db push`.

---

### Task 10: `ensure` in book-lookup

**Files:**
- Modify: `supabase/functions/_shared/bookCore.ts`, `supabase/functions/book-lookup/index.ts`
- Test: `src/lib/__tests__/bookCore.test.ts` (append)

**Interfaces:**
- Consumes: `isValidIsbn13` (bookCore); `identifyCaller`, `hit`, `CALLER_LIMIT`, `cache`, `fetchJson` (book-lookup); the nullable `books.title` (Task 9).
- Produces:
  ```ts
  // bookCore.ts
  export function parseEnsureRequest(body: unknown): string | null; // exactly { ensure: { isbn13 } }, checksum-valid
  export function placeholderBook(isbn13: string): { isbn13: string; title: null; source: 'placeholder' };
  ```
  - HTTP: `POST book-lookup { ensure: { isbn13 } }` with a **user** JWT returns `200 { id: "<books.id uuid>" }`.
  - The anon key alone gets `401 { error: 'sign_in_required' }`.
  - Otherwise the call returns the lookup's usual `429`/`503`/`500` codes, and it counts against that user's rate limit.
  - A cached `placeholder` row is never served as a lookup hit. The normal lookup path re-asks the catalogs and upserts on `isbn13`, so the placeholder row keeps its id and gains real data.

- [ ] **Step 1: Write the failing tests**

In `src/lib/__tests__/bookCore.test.ts`, add `parseEnsureRequest` and `placeholderBook` to the import list, and append:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/lib/__tests__/bookCore.test.ts`
Expected: FAIL with "parseEnsureRequest is not a function".

- [ ] **Step 3: Implement the parser**

In `supabase/functions/_shared/bookCore.ts`, directly after `isValidIsbn10` (still in the ISBN section), add:

```ts
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

/** The catalog row ensure inserts when no source knows the ISBN. User-typed details stay in book_edits (F16). */
export function placeholderBook(isbn13: string): { isbn13: string; title: null; source: 'placeholder' } {
  return { isbn13, title: null, source: 'placeholder' };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest src/lib/__tests__/bookCore.test.ts`
Expected: PASS (existing tests plus 11 new).

- [ ] **Step 5: Wire `ensure` into the function**

In `supabase/functions/book-lookup/index.ts`:

1. Add `parseEnsureRequest,` and `placeholderBook,` to the `../_shared/bookCore.ts` import list. Add this line to the header comment block, after the `// POST { isbn: … }` line:

```ts
// POST { ensure: { isbn13 } } (signed-in users only) -> { id }: the catalog id for that ISBN, creating it if needed.
```

2. Replace

```ts
    const isbn13 = parseRequest(body);
    if (!isbn13) return json({ error: 'invalid_request' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
```

with

```ts
    const ensureIsbn = parseEnsureRequest(body);
    if (ensureIsbn) return await ensureBook(req, ensureIsbn, reqId);
    const isbn13 = parseRequest(body);
    if (!isbn13) return json({ error: 'invalid_request' }, 400);

    const admin = adminClient();
```

3. Replace `if (cached) return json(shape(cached));` with:

```ts
    // An ensure placeholder is not an answer: fall through, and a hit upserts over it (same id).
    if (cached && cached.source !== 'placeholder') return json(shape(cached));
```

4. Replace the whole `async function cache(…) { … }` with:

```ts
async function cacheRow(admin: Admin, meta: SourceBook, reqId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin
    .from('books')
    .upsert(
      {
        isbn13: meta.isbn13, isbn10: meta.isbn10,
        title: meta.title, subtitle: meta.subtitle, authors: meta.authors,
        publisher: meta.publisher, published_year: meta.publishedYear, edition: meta.edition,
        genres: meta.genres, page_count: meta.pageCount, cover_url: meta.coverUrl,
        description: meta.description, work_key: meta.workKey, source: meta.source,
      },
      { onConflict: 'isbn13' },
    )
    .select()
    .single();
  if (error) log(reqId, 'books upsert failed', error);
  return data ?? null;
}

async function cache(admin: Admin, meta: SourceBook, reqId: string) {
  const row = await cacheRow(admin, meta, reqId);
  return row ? shape(row) : meta;
}
```

5. Add a new section before `// Responses and logging`:

```ts
// ---------------------------------------------------------------------------
// Sync: ensure (spec §6.4)
// ---------------------------------------------------------------------------

function adminClient(): Admin {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function bookIdFor(admin: Admin, isbn13: string): Promise<string | null> {
  const { data, error } = await admin.from('books').select('id').eq('isbn13', isbn13).maybeSingle();
  if (error) throw new Error(`books read failed: ${error.message}`);
  return data ? String(data.id) : null;
}

/**
 * Returns the catalog id for an ISBN, creating the row if needed: a real lookup when a source knows it,
 * else a bare placeholder (service role only; clients never insert into books, F16).
 */
async function ensureBook(req: Request, isbn13: string, reqId: string): Promise<Response> {
  const admin = adminClient();
  const caller = await identifyCaller(req, admin);
  if (caller.anonymous) return json({ error: 'sign_in_required' }, 401);
  const limit = await hit(admin, caller.bucket, CALLER_LIMIT.windowSeconds, CALLER_LIMIT.max).catch((e) => {
    log(reqId, 'rate limiter unavailable (ensure)', e);
    return null;
  });
  if (!limit) return json({ error: 'lookup_unavailable' }, 503, { 'Retry-After': String(UNAVAILABLE_RETRY_SEC) });
  if (!limit.allowed) return tooMany(limit.retryAfter);

  const existing = await bookIdFor(admin, isbn13);
  if (existing) return json({ id: existing });

  let found: SourceBook | null = null;
  for (const [name, run] of [['google', lookupGoogleBooks], ['openlibrary', lookupOpenLibrary]] as const) {
    try {
      found = await run(isbn13, fetchJson);
    } catch (e) {
      log(reqId, `${name} lookup failed (ensure)`, e);
    }
    if (found) break;
  }
  if (found) {
    const row = await cacheRow(admin, found, reqId);
    if (row?.id) return json({ id: String(row.id) });
  }

  const { error } = await admin.from('books').upsert(placeholderBook(isbn13), { onConflict: 'isbn13', ignoreDuplicates: true });
  if (error) throw new Error(`placeholder insert failed: ${error.message}`);
  const id = await bookIdFor(admin, isbn13);
  if (!id) throw new Error('placeholder row missing');
  return json({ id });
}
```

Leave everything else in the file unchanged. The error bodies stay generic (`log` scrubs keys and JWTs).

- [ ] **Step 6: Checkpoint**

Run `npx tsc --noEmit`, `npx jest`, `npx expo-doctor`.
Expected: all clean.

Hand Sean the file list: `supabase/functions/_shared/bookCore.ts`, `supabase/functions/book-lookup/index.ts`, `src/lib/__tests__/bookCore.test.ts`. Sean redeploys `book-lookup` after applying Task 9's migration.

---

### Task 11: Local sync schema (v6), book_edits ops and the pure sync helpers

**Files:**
- Modify: `src/db/schema.ts` (v6), `src/db/repository.ts` (book_edits enqueue, `cover_object`), `src/lib/types.ts` (`'placeholder'` source)
- Create: `src/sync/logic.ts`
- Test: `src/sync/__tests__/logic.test.ts`, `src/db/__tests__/bookEditOps.test.ts`

**Interfaces:**
- Consumes: `enqueueOp` (Task 2); `freshDb` (Task 2).
- Produces:
  ```ts
  // local schema v6: books.server_known INTEGER (1 = the id is a catalog id), book_edits.cover_object TEXT,
  // sync_rejects(id, op_id, table_name, row_id, op, payload, error_code, rejected_at), books_effective gains cover_object.
  // src/sync/logic.ts
  export const SYNCED_TABLES: readonly ['shelves', 'user_books', 'readings', 'book_edits', 'loans', 'profiles'];
  export type SyncedTable = (typeof SYNCED_TABLES)[number];
  export const PUSH_ORDER: readonly SyncedTable[];
  export const PUSH_CHUNK = 200; export const PULL_PAGE = 500; export const STALE_AFTER_MS: number; // 30 days
  export const CONFLICT_TARGET: Record<SyncedTable, string>;
  export const ROW_KEY: Record<SyncedTable, 'id' | 'book_id'>;
  export function isSyncedTable(t: string): t is SyncedTable;
  export interface PendingOp { id: number; table_name: string; row_id: string; op: string; payload: string }
  export interface CoalescedOp { table: SyncedTable; rowId: string; op: 'upsert' | 'delete'; payload: Record<string, unknown>; maxOpId: number }
  export function coalesce(ops: PendingOp[]): { ops: CoalescedOp[]; dropped: number[] };
  export function pushOrder(tables: string[]): SyncedTable[];
  export function sqlToIso(v: unknown): unknown;
  export function isoToSql(v: unknown): unknown;
  export function toServerRow(table: SyncedTable, local: Record<string, unknown>): Record<string, unknown>;
  export function toLocalRow(table: SyncedTable, server: Record<string, unknown>): Record<string, unknown>;
  export function toLocalBook(server: Record<string, unknown>): Record<string, unknown>;
  export type PullDecision = 'keepLocal' | 'skip' | 'apply';
  export function applyPulled(localRow: object | null, pulledRow: { deleted_at?: unknown }, hasPending: boolean): PullDecision;
  export interface Cursor { updatedAt: string; id: string; pulledAt: number }
  export function nextCursor(rows: Record<string, unknown>[], key?: 'id' | 'book_id', prev?: Cursor | null, nowMs?: number): Cursor | null;
  export function parseCursor(raw: string | null): Cursor | null;
  export function serializeCursor(c: Cursor): string;
  export function isStale(c: Cursor | null, nowMs: number): boolean;
  export function keysetFilter(c: Cursor, key: 'id' | 'book_id'): string;
  export function classifyStatus(status: number): 'retry' | 'reject';
  export function backoffMs(attempt: number): number; // 5s, 10s, 20s … capped at 5 min
  export function rejectCode(error: { code?: string } | null, status: number): string;
  ```
- **Local book_edits deletes stay hard deletes.** The op carries a tombstone payload `{ book_id, deleted_at }`, and the server row is soft-deleted, so other phones delete theirs on pull.

- [ ] **Step 1: Write the failing tests**

Create `src/sync/__tests__/logic.test.ts`:

```ts
import {
  applyPulled, backoffMs, classifyStatus, coalesce, isoToSql, isStale, keysetFilter, nextCursor, parseCursor, pushOrder,
  rejectCode, serializeCursor, sqlToIso, STALE_AFTER_MS, toLocalBook, toLocalRow, toServerRow, type PendingOp,
} from '../logic';

const op = (id: number, table: string, rowId: string, payload: object, kind = 'upsert'): PendingOp => ({ id, table_name: table, row_id: rowId, op: kind, payload: JSON.stringify(payload) });

describe('coalesce', () => {
  it('keeps only the latest snapshot per row and remembers the max op id', () => {
    const { ops } = coalesce([op(1, 'shelves', 's1', { name: 'A' }), op(2, 'user_books', 'c1', { id: 'c1' }), op(3, 'shelves', 's1', { name: 'B' }, 'delete')]);
    expect(ops).toEqual([
      { table: 'user_books', rowId: 'c1', op: 'upsert', payload: { id: 'c1' }, maxOpId: 2 },
      { table: 'shelves', rowId: 's1', op: 'delete', payload: { name: 'B' }, maxOpId: 3 },
    ]);
  });
  it('drops ops for tables that never sync, and unreadable payloads', () => {
    const bad: PendingOp = { id: 5, table_name: 'user_books', row_id: 'c2', op: 'upsert', payload: 'null' };
    expect(coalesce([op(4, 'shelf_books', 'x', {}), bad]).dropped).toEqual([4, 5]);
  });
});

describe('pushOrder', () => {
  it('orders parents first and ignores unknown tables', () => {
    expect(pushOrder(['profiles', 'loans', 'shelf_books', 'book_edits', 'shelves', 'readings', 'user_books'])).toEqual(
      ['shelves', 'user_books', 'readings', 'book_edits', 'loans', 'profiles']
    );
  });
});

describe('row mapping', () => {
  it('never sends user_id or updated_at, converts SQLite times to UTC ISO and booleans', () => {
    const row = toServerRow('user_books', {
      id: 'c1', book_id: 'b1', status: 'owned', is_favorite: 1, shelf_id: null, location: 'Hall', rating: null,
      created_at: '2026-09-01 10:00:00', updated_at: '2026-09-02 10:00:00', deleted_at: null, user_id: 'x',
    });
    expect(row).not.toHaveProperty('user_id');
    expect(row).not.toHaveProperty('updated_at');
    expect(row).not.toHaveProperty('location');
    expect(row).toMatchObject({ id: 'c1', is_favorite: true, created_at: '2026-09-01T10:00:00Z', deleted_at: null });
  });
  it('sends book_edits authors as an array and a tombstone with every column', () => {
    expect(toServerRow('book_edits', { book_id: 'b1', authors: '["A","B"]', cover_path: 'covers/x.jpg' })).toEqual({
      book_id: 'b1', title: null, subtitle: null, authors: ['A', 'B'], publisher: null, published_year: null, edition: null, cover_object: null, deleted_at: null,
    });
    expect(toServerRow('book_edits', { book_id: 'b1', deleted_at: '2026-09-03 08:00:00' }).deleted_at).toBe('2026-09-03T08:00:00Z');
  });
  it('maps server rows back to SQLite shapes', () => {
    expect(toLocalRow('user_books', { id: 'c1', user_id: 'u', book_id: 'b1', status: 'owned', is_favorite: false, updated_at: '2026-09-22T10:00:01.123456+00:00', created_at: '2026-09-22T10:00:00+00:00', deleted_at: null })).toMatchObject({
      id: 'c1', is_favorite: 0, updated_at: '2026-09-22 10:00:01', created_at: '2026-09-22 10:00:00',
    });
    expect(toLocalRow('book_edits', { book_id: 'b1', authors: ['A'], updated_at: '2026-09-22T10:00:00Z' }).authors).toBe('["A"]');
  });
  it('gives placeholder catalog rows a readable title', () => {
    expect(toLocalBook({ id: 'b1', isbn13: '9780441172719', title: null, authors: [], genres: [], source: 'placeholder', updated_at: '2026-09-22T10:00:00+00:00' })).toMatchObject({
      id: 'b1', title: 'ISBN 9780441172719', authors: '[]', server_known: 1, source: 'placeholder',
    });
  });
  it('round-trips timestamps', () => {
    expect(sqlToIso('2026-09-01 10:00:00')).toBe('2026-09-01T10:00:00Z');
    expect(isoToSql('2026-09-01T10:00:00.5+00:00')).toBe('2026-09-01 10:00:00');
    expect(isoToSql('2026-09-01T12:00:00+02:00')).toBe('2026-09-01 10:00:00');
    expect(sqlToIso('2026-09-01')).toBe('2026-09-01');
  });
});

describe('applyPulled', () => {
  it('a pending local op wins', () => expect(applyPulled({ id: 'x' }, { deleted_at: null }, true)).toBe('keepLocal'));
  it('a delete applies to a row we have', () => expect(applyPulled({ id: 'x' }, { deleted_at: '2026-09-22T10:00:00Z' }, false)).toBe('apply'));
  it('a delete of a row we never had is skipped', () => expect(applyPulled(null, { deleted_at: '2026-09-22T10:00:00Z' }, false)).toBe('skip'));
  it('a newer server row replaces ours', () => expect(applyPulled({ id: 'x' }, { deleted_at: null }, false)).toBe('apply'));
});

describe('cursors', () => {
  it('advance to the last row of a page, keyed by the table row key', () => {
    expect(nextCursor([{ updated_at: 't1', id: 'a' }, { updated_at: 't2', id: 'b' }], 'id', null, 100)).toEqual({ updatedAt: 't2', id: 'b', pulledAt: 100 });
    expect(nextCursor([{ updated_at: 't3', book_id: 'k' }], 'book_id', null, 5)).toEqual({ updatedAt: 't3', id: 'k', pulledAt: 5 });
  });
  it('an empty page only refreshes pulledAt', () => {
    expect(nextCursor([], 'id', { updatedAt: 't', id: 'a', pulledAt: 1 }, 9)).toEqual({ updatedAt: 't', id: 'a', pulledAt: 9 });
    expect(nextCursor([], 'id', null, 9)).toBeNull();
  });
  it('serialise and parse', () => {
    const c = { updatedAt: '2026-09-22T10:00:00.123456+00:00', id: 'a', pulledAt: 7 };
    expect(parseCursor(serializeCursor(c))).toEqual(c);
    expect(parseCursor(null)).toBeNull();
    expect(parseCursor('garbage')).toBeNull();
  });
  it('is stale after 30 days without a pull', () => {
    const c = { updatedAt: 't', id: 'a', pulledAt: 0 };
    expect(isStale(c, STALE_AFTER_MS)).toBe(false);
    expect(isStale(c, STALE_AFTER_MS + 1)).toBe(true);
    expect(isStale(null, 10 ** 13)).toBe(false);
  });
  it('builds the keyset filter PostgREST expects', () => {
    expect(keysetFilter({ updatedAt: '2026-09-22T10:00:00+00:00', id: 'a', pulledAt: 0 }, 'id')).toBe(
      'updated_at.gt."2026-09-22T10:00:00+00:00",and(updated_at.eq."2026-09-22T10:00:00+00:00",id.gt."a")'
    );
  });
});

describe('failures', () => {
  it('retries network, timeouts, throttling and 5xx; rejects other 4xx', () => {
    for (const s of [0, 408, 429, 500, 503]) expect(classifyStatus(s)).toBe('retry');
    for (const s of [400, 401, 403, 404, 409, 422]) expect(classifyStatus(s)).toBe('reject');
  });
  it('backs off 5s, 10s, 20s… up to 5 minutes', () => {
    expect([1, 2, 3, 7, 20].map(backoffMs)).toEqual([5000, 10000, 20000, 300000, 300000]);
  });
  it('names a rejection by its Postgres code, else the HTTP status', () => {
    expect(rejectCode({ code: '23514' }, 400)).toBe('23514');
    expect(rejectCode({ code: '' }, 403)).toBe('http_403');
  });
});
```

Create `src/db/__tests__/bookEditOps.test.ts`:

```ts
jest.mock('@/features/bookEdits/coverFiles', () => ({
  ...jest.requireActual('@/features/bookEdits/coverFiles'),
  saveCoverFile: jest.fn(async (bookId: string) => `covers/${bookId}-1.jpg`),
  deleteCoverFile: jest.fn(),
}));

import { removeBookCover, resetBookEdits, saveBookEdit, setBookCover, upsertBook } from '@/db/repository';
import { bookMeta } from '@/test/fixtures';
import { freshDb } from '@/test/testDb';

const PATCH = { title: 'Mine', subtitle: null, authors: ['Me'], publisher: null, publishedYear: null, edition: null };
const EMPTY = { title: null, subtitle: null, authors: null, publisher: null, publishedYear: null, edition: null };

let db: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => {
  db = await freshDb();
});
const lastOp = () => db.getFirstSync<{ op: string; row_id: string; payload: string }>("SELECT op, row_id, payload FROM pending_ops WHERE table_name = 'book_edits' ORDER BY id DESC LIMIT 1");

it('saving details queues an upsert snapshot', () => {
  const b = upsertBook(bookMeta());
  saveBookEdit(b.id, PATCH);
  expect(lastOp()).toMatchObject({ op: 'upsert', row_id: b.id });
  expect(JSON.parse(lastOp()!.payload)).toMatchObject({ book_id: b.id, title: 'Mine', authors: '["Me"]' });
});

it('clearing every override queues a tombstone', () => {
  const b = upsertBook(bookMeta());
  saveBookEdit(b.id, PATCH);
  saveBookEdit(b.id, EMPTY);
  expect(lastOp()!.op).toBe('delete');
  expect(JSON.parse(lastOp()!.payload)).toEqual({ book_id: b.id, deleted_at: expect.stringMatching(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/) });
});

it('a new photo forgets the old synced object, and removing it queues the change', async () => {
  const b = upsertBook(bookMeta());
  await setBookCover(b.id, 'file:///tmp/pick.jpg');
  db.runSync("UPDATE book_edits SET cover_object = 'u/x-1.jpg' WHERE book_id = ?", [b.id]);
  await setBookCover(b.id, 'file:///tmp/pick2.jpg');
  expect(db.getFirstSync<{ cover_object: string | null }>('SELECT cover_object FROM book_edits WHERE book_id = ?', [b.id])!.cover_object).toBeNull();
  saveBookEdit(b.id, PATCH);
  removeBookCover(b.id);
  expect(JSON.parse(lastOp()!.payload)).toMatchObject({ cover_path: null, cover_object: null, title: 'Mine' });
});

it('reset to catalog queues a tombstone', () => {
  const b = upsertBook(bookMeta());
  saveBookEdit(b.id, PATCH);
  resetBookEdits(b.id);
  expect(lastOp()!.op).toBe('delete');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest src/sync/__tests__/logic.test.ts src/db/__tests__/bookEditOps.test.ts`
Expected: FAIL. "Cannot find module '../logic'" for the first. The second fails its assertions because `lastOp()` is null, since book_edits writes don't enqueue yet.

- [ ] **Step 3: Schema v6**

In `src/db/schema.ts`:
- change `SCHEMA_VERSION` to `6`;
- append to `MIGRATIONS`, after the v5 entry:

```ts
  // v6 — sync. books.server_known marks catalog ids (set by ensure or pull); book_edits.cover_object is
  // the synced photo's Storage path; sync_rejects holds rows the server refused. The view gains cover_object.
  // Keep books_effective in sync with applyEdits() in src/features/bookEdits/editLogic.ts.
  `
  ALTER TABLE books ADD COLUMN server_known INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE book_edits ADD COLUMN cover_object TEXT;

  CREATE TABLE IF NOT EXISTS sync_rejects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    op_id INTEGER NOT NULL,
    table_name TEXT NOT NULL,
    row_id TEXT NOT NULL,
    op TEXT NOT NULL,
    payload TEXT NOT NULL,
    error_code TEXT NOT NULL,
    rejected_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_pending_ops_row ON pending_ops(table_name, row_id);

  DROP VIEW IF EXISTS books_effective;
  CREATE VIEW books_effective AS
  SELECT b.id, b.isbn13, b.isbn10,
         COALESCE(e.title, b.title) AS title,
         COALESCE(e.subtitle, b.subtitle) AS subtitle,
         COALESCE(e.authors, b.authors) AS authors,
         COALESCE(e.publisher, b.publisher) AS publisher,
         COALESCE(e.published_year, b.published_year) AS published_year,
         COALESCE(e.edition, b.edition) AS edition,
         b.genres, b.page_count, b.cover_url, e.cover_path, e.cover_object,
         b.description, b.work_key, b.source,
         (e.book_id IS NOT NULL) AS edited
    FROM books b LEFT JOIN book_edits e ON e.book_id = b.id;
  `,
```

In `src/lib/types.ts`, change the `source` line of `Book` to:

```ts
  source: 'google' | 'openlibrary' | 'isbndb' | 'manual' | 'placeholder';
```

- [ ] **Step 4: book_edits writes enqueue**

In `src/db/repository.ts`, in the manual-details section, add after `getBookEdit`:

```ts
/** Queues the current book_edits row, or a tombstone once the row is gone (local deletes are hard deletes). */
function enqueueBookEdit(bookId: string) {
  const d = getDb();
  const row = d.getFirstSync<any>('SELECT * FROM book_edits WHERE book_id = ?', [bookId]);
  if (row) enqueue('book_edits', bookId, 'upsert', row);
  else enqueue('book_edits', bookId, 'delete', { book_id: bookId, deleted_at: d.getFirstSync<{ n: string }>("SELECT datetime('now') AS n")!.n });
}
```

Then:
- **`saveBookEdit`:**
  - after `d.runSync('DELETE FROM book_edits WHERE book_id = ?', [bookId]);` (inside the early-return branch), add `enqueueBookEdit(bookId);` before `return;`;
  - after the final `d.runSync(…)`, add `enqueueBookEdit(bookId);`.
- **`setBookCover`:**
  - change the SQL to

    ```ts
        `INSERT INTO book_edits (book_id, cover_path, cover_object, updated_at, contributed_at) VALUES (?, ?, NULL, datetime('now'), NULL)
         ON CONFLICT(book_id) DO UPDATE SET cover_path=excluded.cover_path, cover_object=NULL, updated_at=datetime('now'), contributed_at=NULL`,
    ```

  - add `enqueueBookEdit(bookId);` right after that `runSync`.
- **`removeBookCover`:**
  - change the `UPDATE` to ``d.runSync(`UPDATE book_edits SET cover_path = NULL, cover_object = NULL, updated_at = datetime('now'), contributed_at = NULL WHERE book_id = ?`, [bookId]);``;
  - add `enqueueBookEdit(bookId);` before `deleteCoverFile(coverPath);`.
- **`resetBookEdits`:** add `enqueueBookEdit(bookId);` after the `DELETE`.

- [ ] **Step 5: Implement the helpers**

Create `src/sync/logic.ts`:

```ts
/**
 * Pure sync decisions (spec §6.1). No I/O: push.ts, pull.ts and resolveBooks.ts read and write.
 * Timestamps: SQLite keeps 'YYYY-MM-DD HH:MM:SS' (UTC); the server speaks ISO-8601 timestamptz.
 */

export const SYNCED_TABLES = ['shelves', 'user_books', 'readings', 'book_edits', 'loans', 'profiles'] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];
/** Parents before children, so foreign keys resolve on the server (push) and locally (pull). */
export const PUSH_ORDER: readonly SyncedTable[] = SYNCED_TABLES;
export const PUSH_CHUNK = 200;
export const PULL_PAGE = 500;
export const STALE_AFTER_MS = 30 * 86_400_000;

export const CONFLICT_TARGET: Record<SyncedTable, string> = {
  shelves: 'id', user_books: 'id', readings: 'user_id,book_id', book_edits: 'user_id,book_id', loans: 'id', profiles: 'id',
};
/** Local primary key, pending_ops.row_id, and the pull cursor's tiebreaker. */
export const ROW_KEY: Record<SyncedTable, 'id' | 'book_id'> = {
  shelves: 'id', user_books: 'id', readings: 'id', book_edits: 'book_id', loans: 'id', profiles: 'id',
};

export const isSyncedTable = (t: string): t is SyncedTable => (SYNCED_TABLES as readonly string[]).includes(t);

export interface PendingOp { id: number; table_name: string; row_id: string; op: string; payload: string }
export interface CoalescedOp { table: SyncedTable; rowId: string; op: 'upsert' | 'delete'; payload: Record<string, unknown>; maxOpId: number }

/** Latest snapshot per (table, row), in the order rows were last touched. */
export function coalesce(ops: PendingOp[]): { ops: CoalescedOp[]; dropped: number[] } {
  const latest = new Map<string, CoalescedOp>();
  const dropped: number[] = [];
  for (const o of [...ops].sort((a, b) => a.id - b.id)) {
    let payload: unknown = null;
    try {
      payload = JSON.parse(o.payload);
    } catch {
      payload = null;
    }
    if (!isSyncedTable(o.table_name) || !payload || typeof payload !== 'object') {
      dropped.push(o.id);
      continue;
    }
    const key = `${o.table_name}\u0000${o.row_id}`;
    latest.delete(key);
    latest.set(key, { table: o.table_name, rowId: o.row_id, op: o.op === 'delete' ? 'delete' : 'upsert', payload: payload as Record<string, unknown>, maxOpId: o.id });
  }
  return { ops: [...latest.values()], dropped };
}

export function pushOrder(tables: string[]): SyncedTable[] {
  return PUSH_ORDER.filter((t) => tables.includes(t));
}

const SERVER_COLUMNS: Record<SyncedTable, readonly string[]> = {
  shelves: ['id', 'name', 'sort_order', 'icon', 'plank', 'created_at', 'deleted_at'],
  user_books: ['id', 'book_id', 'status', 'condition', 'purchase_date', 'purchase_price', 'currency', 'review', 'notes', 'reading_progress', 'is_favorite', 'shelf_id', 'created_at', 'deleted_at'],
  readings: ['id', 'book_id', 'state', 'started_at', 'finished_at', 'rating', 'created_at', 'deleted_at'],
  book_edits: ['book_id', 'title', 'subtitle', 'authors', 'publisher', 'published_year', 'edition', 'cover_object', 'deleted_at'],
  loans: ['id', 'user_book_id', 'borrower_name', 'loaned_at', 'due_reminder_at', 'returned_at', 'deleted_at'],
  profiles: ['id', 'display_name'],
};
const LOCAL_COLUMNS: Record<SyncedTable, readonly string[]> = {
  shelves: ['id', 'name', 'sort_order', 'icon', 'plank', 'created_at', 'updated_at', 'deleted_at'],
  user_books: ['id', 'book_id', 'status', 'condition', 'purchase_date', 'purchase_price', 'currency', 'review', 'notes', 'reading_progress', 'is_favorite', 'shelf_id', 'created_at', 'updated_at', 'deleted_at'],
  readings: ['id', 'book_id', 'state', 'started_at', 'finished_at', 'rating', 'created_at', 'updated_at', 'deleted_at'],
  book_edits: ['book_id', 'title', 'subtitle', 'authors', 'publisher', 'published_year', 'edition', 'cover_object', 'updated_at'],
  loans: ['id', 'user_book_id', 'borrower_name', 'loaned_at', 'due_reminder_at', 'returned_at', 'updated_at', 'deleted_at'],
  profiles: ['id', 'display_name', 'updated_at'],
};
const TIMESTAMPS = new Set(['created_at', 'updated_at', 'deleted_at', 'loaned_at', 'due_reminder_at', 'returned_at']);

export function sqlToIso(v: unknown): unknown {
  return typeof v === 'string' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(v) ? `${v.replace(' ', 'T')}Z` : v;
}

export function isoToSql(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const utc = /^(\d{4}-\d\d-\d\d)T(\d\d:\d\d:\d\d)(?:\.\d+)?(?:Z|\+00:00|\+00)$/.exec(v);
  if (utc) return `${utc[1]} ${utc[2]}`;
  if (/^\d{4}-\d\d-\d\dT/.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 19).replace('T', ' ');
  }
  return v;
}

function parseAuthors(v: unknown): unknown {
  if (typeof v !== 'string') return v ?? null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

/** Whitelisted server columns only: never user_id (auth.uid() default) or updated_at (server trigger). */
export function toServerRow(table: SyncedTable, local: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of SERVER_COLUMNS[table]) {
    let v = local[c] ?? null;
    if (TIMESTAMPS.has(c)) v = sqlToIso(v);
    if (c === 'is_favorite') v = !!v;
    if (table === 'book_edits' && c === 'authors') v = parseAuthors(v);
    out[c] = v;
  }
  return out;
}

export function toLocalRow(table: SyncedTable, server: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of LOCAL_COLUMNS[table]) {
    let v = server[c] ?? null;
    if (TIMESTAMPS.has(c)) v = isoToSql(v);
    if (c === 'is_favorite') v = v ? 1 : 0;
    if (table === 'book_edits' && c === 'authors' && v !== null) v = JSON.stringify(v);
    out[c] = v;
  }
  return out;
}

/** A catalog row for the local books cache. Placeholders get the same "ISBN …" title the scanner uses. */
export function toLocalBook(s: Record<string, unknown>): Record<string, unknown> {
  const isbn13 = (s.isbn13 as string | null) ?? null;
  return {
    id: s.id,
    isbn13,
    isbn10: s.isbn10 ?? null,
    title: (s.title as string | null) ?? (isbn13 ? `ISBN ${isbn13}` : 'Untitled'),
    subtitle: s.subtitle ?? null,
    authors: JSON.stringify(s.authors ?? []),
    publisher: s.publisher ?? null,
    published_year: s.published_year ?? null,
    edition: s.edition ?? null,
    genres: JSON.stringify(s.genres ?? []),
    page_count: s.page_count ?? null,
    cover_url: s.cover_url ?? null,
    description: s.description ?? null,
    work_key: s.work_key ?? null,
    source: s.source ?? 'manual',
    updated_at: isoToSql(s.updated_at) ?? '1970-01-01 00:00:00',
    server_known: 1,
  };
}

export type PullDecision = 'keepLocal' | 'skip' | 'apply';

/** Spec §6.3: a pending local op keeps local (it will push and win); otherwise the server row applies, deletes included. */
export function applyPulled(localRow: object | null, pulledRow: { deleted_at?: unknown }, hasPending: boolean): PullDecision {
  if (hasPending) return 'keepLocal';
  if (!localRow && pulledRow.deleted_at) return 'skip';
  return 'apply';
}

export interface Cursor { updatedAt: string; id: string; pulledAt: number }

export function nextCursor(rows: Record<string, unknown>[], key: 'id' | 'book_id' = 'id', prev: Cursor | null = null, nowMs: number = Date.now()): Cursor | null {
  const last = rows[rows.length - 1];
  if (!last) return prev ? { ...prev, pulledAt: nowMs } : null;
  return { updatedAt: String(last.updated_at), id: String(last[key]), pulledAt: nowMs };
}

export function serializeCursor(c: Cursor): string {
  return JSON.stringify(c);
}

export function parseCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw);
    return typeof c?.updatedAt === 'string' && typeof c?.id === 'string' && typeof c?.pulledAt === 'number' ? c : null;
  } catch {
    return null;
  }
}

/** Device time is only used for elapsed time here; ordering always uses the server's updated_at. */
export function isStale(c: Cursor | null, nowMs: number): boolean {
  return c !== null && nowMs - c.pulledAt > STALE_AFTER_MS;
}

/** (updated_at, key) > cursor, as a PostgREST or= filter. Values are quoted because timestamps contain ':' and '+'. */
export function keysetFilter(c: Cursor, key: 'id' | 'book_id'): string {
  return `updated_at.gt."${c.updatedAt}",and(updated_at.eq."${c.updatedAt}",${key}.gt."${c.id}")`;
}

export function classifyStatus(status: number): 'retry' | 'reject' {
  return status >= 400 && status < 500 && status !== 408 && status !== 429 ? 'reject' : 'retry';
}

export function backoffMs(attempt: number): number {
  return Math.min(5000 * 2 ** Math.max(0, attempt - 1), 300_000);
}

export function rejectCode(error: { code?: string } | null, status: number): string {
  return error?.code ? error.code : `http_${status}`;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest src/sync/__tests__/logic.test.ts src/db`
Expected: PASS. `logic` has 20 tests, `bookEditOps` has 4, and the earlier db tests still pass. `localData`'s claim test still counts 4 snapshots, because it deletes `pending_ops` before claiming.

- [ ] **Step 7: Checkpoint**

Run `npx tsc --noEmit`, `npx jest`, `npx expo-doctor`.
Expected: all clean.

Hand Sean the file list: `src/db/schema.ts`, `src/db/repository.ts`, `src/lib/types.ts`, `src/sync/logic.ts`, and the two tests.

---

### Task 12: Book-id rewrite, `resolveBooks`, shelf adoption and the fake server

**Files:**
- Create: `src/sync/client.ts`, `src/sync/resolveBooks.ts`, `src/sync/adoptShelves.ts`, `src/test/fakeSupabase.ts`
- Modify: `src/features/bookEdits/coverFiles.ts` (`renameCoverFile`)
- Test: `src/sync/__tests__/resolveBooks.test.ts`, `src/sync/__tests__/adoptShelves.test.ts`

**Interfaces:**
- Consumes: `classifyStatus` (Task 11); `getMeta`, `deleteMeta`, `ADOPT_SHELVES_KEY` (Task 2); `normaliseName` (existing); `coverFileName` (existing).
- Produces:
  ```ts
  // src/sync/client.ts
  export type SyncClient = Pick<SupabaseClient, 'from' | 'functions' | 'storage'>;
  export class SyncRetryable extends Error { readonly status: number } // 0 = no response
  export function statusOf(error: unknown): number;
  // src/sync/resolveBooks.ts
  export function rewriteBookId(fromId: string, toId: string): void;
  export function unknownBookIds(bookIds: string[]): string[];
  export function resolveBooks(client: SyncClient, bookIds: string[]): Promise<{ resolved: Map<string, string>; failed: Set<string> }>;
  // src/sync/adoptShelves.ts
  export function adoptionPlan(local: { id: string; name: string }[], server: { id: string; name: string }[]): { from: string; to: string }[];
  export function rewriteShelfId(fromId: string, toId: string): void;
  export function adoptShelvesOnClaim(client: SyncClient): Promise<void>;
  // src/features/bookEdits/coverFiles.ts
  export function renameCoverFile(coverPath: string, bookId: string): string | null;
  // src/test/fakeSupabase.ts
  export class FakeSupabase {
    userId: string | null; tables: Record<string, Record<string, unknown>[]>; objects: Map<string, Uint8Array>;
    upserts: { table: string; rows: Record<string, unknown>[] }[]; ensured: string[]; catalog: Record<string, string>;
    onUpsert: ((table: string) => void) | null;
    seed(table: string, row: Record<string, unknown>, userId?: string): Record<string, unknown>;
    rows(table: string, userId?: string | null): Record<string, unknown>[];
    failNext(table: string, status: number): void;
    reject(table: string, when: (row: Record<string, unknown>) => boolean, status?: number, code?: string): void;
    failEnsure(status: number): void;
    from(table: string): …; functions: { invoke }; storage: { from(bucket) };
  }
  export function asClient(f: FakeSupabase): SyncClient;
  ```

- [ ] **Step 1: The client types and the fake server**

Create `src/sync/client.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

/** The slice of supabase-js the engine uses; tests pass src/test/fakeSupabase.ts instead. */
export type SyncClient = Pick<SupabaseClient, 'from' | 'functions' | 'storage'>;

/** A failure worth retrying with backoff: offline (status 0), timeout, throttling or 5xx. */
export class SyncRetryable extends Error {
  constructor(readonly status: number) {
    super(`sync paused (${status})`);
    this.name = 'SyncRetryable';
  }
}

/** HTTP status carried by a functions.invoke error (FunctionsHttpError holds the Response as context). 0 = no response. */
export function statusOf(error: unknown): number {
  const s = (error as { context?: { status?: unknown } } | null)?.context?.status;
  return typeof s === 'number' ? s : 0;
}
```

Create `src/test/fakeSupabase.ts`:

```ts
/// <reference types="node" />
/**
 * An in-memory Supabase for sync tests. It implements exactly the calls src/sync makes, and anything
 * else throws, so a test can't pass by accident:
 * - PostgREST upsert and select, with owner-scoped rows (RLS);
 * - updated_at stamped by the "server";
 * - the book_id foreign key;
 * - `ensure` on book-lookup;
 * - a covers bucket.
 */
import { randomUUID } from 'crypto';
import type { SyncClient } from '@/sync/client';

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string; code: string } | null; status: number };

const OWNER: Record<string, 'user_id' | 'id' | null> = {
  shelves: 'user_id', user_books: 'user_id', readings: 'user_id', book_edits: 'user_id', loans: 'user_id', profiles: 'id', books: null,
};
const BOOK_FK = new Set(['user_books', 'readings', 'book_edits']);
const fail = (status: number, code: string, message: string): Result => ({ data: null, error: { message, code }, status });

export class FakeSupabase {
  userId: string | null = null;
  tables: Record<string, Row[]> = { shelves: [], user_books: [], readings: [], book_edits: [], loans: [], profiles: [], books: [] };
  objects = new Map<string, Uint8Array>();
  upserts: { table: string; rows: Row[] }[] = [];
  ensured: string[] = [];
  /** ISBNs the fake catalog knows (title); others become placeholders. */
  catalog: Record<string, string> = {};
  /** Called after each successful upsert, to simulate writes landing mid-push. */
  onUpsert: ((table: string) => void) | null = null;
  private clock = 0;
  private shots: { table: string; status: number }[] = [];
  private rules: { table: string; status: number; code: string; when: (r: Row) => boolean }[] = [];
  private ensureShots: number[] = [];

  stamp(): string {
    this.clock += 1;
    return new Date(Date.UTC(2026, 8, 22) + this.clock * 1000).toISOString().replace('Z', '+00:00');
  }
  failNext(table: string, status: number) { this.shots.push({ table, status }); }
  reject(table: string, when: (r: Row) => boolean, status = 400, code = '23514') { this.rules.push({ table, status, code, when }); }
  failEnsure(status: number) { this.ensureShots.push(status); }

  /** Insert a server row directly, stamped like a real write. */
  seed(table: string, row: Row, userId = this.userId ?? 'u1'): Row {
    const owner = OWNER[table];
    const full: Row = { created_at: this.stamp(), deleted_at: null, ...row, updated_at: this.stamp() };
    if (owner === 'user_id') full.user_id = userId;
    this.tables[table].push(full);
    return full;
  }
  rows(table: string, userId: string | null = this.userId): Row[] {
    const owner = OWNER[table];
    return this.tables[table].filter((r) => owner === null || r[owner] === userId);
  }
  takeShot(table: string): number | null {
    const i = this.shots.findIndex((s) => s.table === table);
    return i < 0 ? null : this.shots.splice(i, 1)[0].status;
  }

  from(table: string) {
    if (!(table in this.tables)) throw new Error(`fake: unknown table ${table}`);
    return {
      upsert: (rows: Row | Row[], opts?: { onConflict?: string }) =>
        Promise.resolve(this.upsert(table, Array.isArray(rows) ? rows : [rows], opts?.onConflict ?? 'id')),
      select: (_columns = '*') => new FakeQuery(this, table),
    };
  }

  private upsert(table: string, rows: Row[], onConflict: string): Result {
    if (!this.userId) return fail(401, 'PGRST301', 'JWT required');
    const shot = this.takeShot(table);
    if (shot !== null) return fail(shot, '', 'injected failure');
    for (const r of rows) {
      if ('user_id' in r || 'updated_at' in r) return fail(400, 'test_forbidden_column', 'payload carried user_id or updated_at');
      const rule = this.rules.find((x) => x.table === table && x.when(r));
      if (rule) return fail(rule.status, rule.code, 'rejected by rule');
      if (BOOK_FK.has(table) && !this.tables.books.some((b) => b.id === r.book_id)) return fail(409, '23503', 'book_id foreign key');
      if (table === 'profiles' && r.id !== this.userId) return fail(403, '42501', 'row-level security');
    }
    const keys = onConflict.split(',');
    const now = this.stamp();
    for (const r of rows) {
      const full: Row = { ...r };
      if (OWNER[table] === 'user_id') full.user_id = this.userId;
      const existing = this.tables[table].find((e) => keys.every((k) => e[k] === full[k]));
      if (existing) {
        const owner = OWNER[table];
        if (owner && existing[owner] !== this.userId) return fail(403, '42501', 'row-level security');
        Object.assign(existing, full, { updated_at: now });
      } else {
        this.tables[table].push({ created_at: now, deleted_at: null, ...full, updated_at: now });
      }
    }
    this.upserts.push({ table, rows });
    this.onUpsert?.(table);
    return { data: null, error: null, status: 201 };
  }

  functions = {
    invoke: async (name: string, opts: { body?: { ensure?: { isbn13?: string } } }) => {
      const isbn13 = opts?.body?.ensure?.isbn13;
      if (name !== 'book-lookup' || !isbn13) throw new Error(`fake: unsupported invoke ${name}`);
      const shot = this.ensureShots.shift();
      if (shot !== undefined) return { data: null, error: { message: 'injected', context: { status: shot } } };
      if (!this.userId) return { data: null, error: { message: 'sign_in_required', context: { status: 401 } } };
      this.ensured.push(isbn13);
      let book = this.tables.books.find((b) => b.isbn13 === isbn13);
      if (!book) {
        const known = this.catalog[isbn13];
        book = {
          id: randomUUID(), isbn13, isbn10: null, title: known ?? null, subtitle: null, authors: [], publisher: null,
          published_year: null, edition: null, genres: [], page_count: null, cover_url: null, description: null,
          work_key: null, source: known ? 'google' : 'placeholder', created_at: this.stamp(), updated_at: this.stamp(),
        };
        this.tables.books.push(book);
      }
      return { data: { id: book.id }, error: null };
    },
  };

  storage = {
    from: (bucket: string) => {
      if (bucket !== 'covers') throw new Error(`fake: unknown bucket ${bucket}`);
      const mine = (path: string) => !!this.userId && path.startsWith(`${this.userId}/`);
      return {
        upload: async (path: string, body: ArrayBuffer | Uint8Array, _opts?: unknown) => {
          if (!mine(path)) return { data: null, error: { message: 'new row violates row-level security policy', statusCode: '403', status: 403 } };
          this.objects.set(path, new Uint8Array(body instanceof Uint8Array ? body : new Uint8Array(body)));
          return { data: { path }, error: null };
        },
        createSignedUrl: async (path: string, expiresIn: number) =>
          mine(path) && this.objects.has(path)
            ? { data: { signedUrl: `https://fake.storage/${path}?expires=${expiresIn}` }, error: null }
            : { data: null, error: { message: 'Object not found', statusCode: '404', status: 404 } },
        remove: async (paths: string[]) => {
          for (const p of paths) if (mine(p)) this.objects.delete(p);
          return { data: [], error: null };
        },
      };
    },
  };
}

class FakeQuery implements PromiseLike<Result> {
  private filters: ((r: Row) => boolean)[] = [];
  private orders: string[] = [];
  private max = Infinity;
  constructor(private fake: FakeSupabase, private table: string) {}

  or(expr: string) {
    const m = /^updated_at\.gt\."([^"]+)",and\(updated_at\.eq\."([^"]+)",(\w+)\.gt\."([^"]+)"\)$/.exec(expr);
    if (!m || m[1] !== m[2]) throw new Error(`fake: unsupported or(${expr})`);
    const [, u, , key, id] = m;
    this.filters.push((r) => String(r.updated_at) > u || (r.updated_at === u && String(r[key]) > id));
    return this;
  }
  in(col: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[col]));
    return this;
  }
  is(col: string, value: null) {
    this.filters.push((r) => (r[col] ?? null) === value);
    return this;
  }
  order(col: string, _opts?: unknown) {
    this.orders.push(col);
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(ok, bad);
  }
  private run(): Result {
    if (!this.fake.userId) return fail(401, 'PGRST301', 'JWT required');
    const shot = this.fake.takeShot(this.table);
    if (shot !== null) return fail(shot, '', 'injected failure');
    const rows = this.fake.rows(this.table).filter((r) => this.filters.every((f) => f(r)));
    rows.sort((a, b) => {
      for (const c of this.orders) {
        const x = String(a[c] ?? '');
        const y = String(b[c] ?? '');
        if (x !== y) return x < y ? -1 : 1;
      }
      return 0;
    });
    return { data: rows.slice(0, this.max).map((r) => ({ ...r })), error: null, status: 200 };
  }
}

export const asClient = (f: FakeSupabase): SyncClient => f as unknown as SyncClient;
```

- [ ] **Step 2: Write the failing tests**

Create `src/sync/__tests__/resolveBooks.test.ts`:

```ts
jest.mock('@/features/bookEdits/coverFiles', () => ({
  ...jest.requireActual('@/features/bookEdits/coverFiles'),
  renameCoverFile: jest.fn((_p: string, bookId: string) => `covers/${bookId}-2.jpg`),
}));

import { addUserBook, saveBookEdit, setReadingState, upsertBook } from '@/db/repository';
import { asClient, FakeSupabase } from '@/test/fakeSupabase';
import { bookMeta } from '@/test/fixtures';
import { freshDb } from '@/test/testDb';
import { SyncRetryable } from '../client';
import { resolveBooks, rewriteBookId } from '../resolveBooks';

const SERVER_ID = '0b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
let db: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => {
  db = await freshDb();
});

function library() {
  const book = upsertBook(bookMeta());
  const copy = addUserBook(book.id, 'owned');
  setReadingState(book.id, 'reading', '2026-09-01');
  saveBookEdit(book.id, { title: 'Mine', subtitle: null, authors: null, publisher: null, publishedYear: null, edition: null });
  db.runSync("UPDATE book_edits SET cover_path = 'covers/old-1.jpg' WHERE book_id = ?", [book.id]);
  db.runSync(`INSERT INTO sync_rejects (op_id, table_name, row_id, op, payload, error_code) VALUES (1, 'readings', 'r', 'upsert', ?, '23514')`, [JSON.stringify({ book_id: book.id })]);
  return { book, copy };
}

describe('rewriteBookId', () => {
  it('moves the book and every reference, queued payloads included, in one go', () => {
    const { book, copy } = library();
    rewriteBookId(book.id, SERVER_ID);
    expect(db.getFirstSync<{ id: string; server_known: number }>('SELECT id, server_known FROM books')).toEqual({ id: SERVER_ID, server_known: 1 });
    expect(db.getFirstSync<{ book_id: string }>('SELECT book_id FROM user_books WHERE id = ?', [copy.id])!.book_id).toBe(SERVER_ID);
    expect(db.getFirstSync<{ book_id: string }>('SELECT book_id FROM readings')!.book_id).toBe(SERVER_ID);
    expect(db.getFirstSync<{ book_id: string; cover_path: string }>('SELECT book_id, cover_path FROM book_edits')).toEqual({ book_id: SERVER_ID, cover_path: `covers/${SERVER_ID}-2.jpg` });
    for (const op of db.getAllSync<{ table_name: string; row_id: string; payload: string }>('SELECT table_name, row_id, payload FROM pending_ops')) {
      expect(JSON.parse(op.payload).book_id).toBe(SERVER_ID);
      if (op.table_name === 'book_edits') expect(op.row_id).toBe(SERVER_ID);
    }
    expect(JSON.parse(db.getFirstSync<{ payload: string }>('SELECT payload FROM sync_rejects')!.payload).book_id).toBe(SERVER_ID);
    expect(db.getAllSync('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('merges into a catalog row that is already here', () => {
    const { book } = library();
    db.runSync("INSERT INTO books (id, isbn13, title, server_known) VALUES (?, NULL, 'Dune', 1)", [SERVER_ID]);
    rewriteBookId(book.id, SERVER_ID);
    expect(db.getAllSync<{ id: string }>('SELECT id FROM books').map((r) => r.id)).toEqual([SERVER_ID]);
    expect(db.getAllSync('PRAGMA foreign_key_check')).toEqual([]);
  });
});

describe('resolveBooks', () => {
  it('asks ensure for each unknown book and rewrites to the catalog id', async () => {
    const { book } = library();
    const fake = new FakeSupabase();
    fake.userId = 'u1';
    const { resolved, failed } = await resolveBooks(asClient(fake), [book.id, book.id]);
    const serverId = fake.tables.books[0].id as string;
    expect(fake.ensured).toEqual(['9780441172719']);
    expect(resolved.get(book.id)).toBe(serverId);
    expect(failed.size).toBe(0);
    expect(db.getFirstSync<{ id: string }>('SELECT id FROM books')!.id).toBe(serverId);
  });

  it('skips books the server already knows', async () => {
    const { book } = library();
    db.runSync('UPDATE books SET server_known = 1');
    const fake = new FakeSupabase();
    fake.userId = 'u1';
    await resolveBooks(asClient(fake), [book.id]);
    expect(fake.ensured).toEqual([]);
  });

  it('a refused ISBN is left for later, not fatal', async () => {
    const { book } = library();
    const fake = new FakeSupabase();
    fake.userId = 'u1';
    fake.failEnsure(400);
    const { failed } = await resolveBooks(asClient(fake), [book.id]);
    expect([...failed]).toEqual([book.id]);
  });

  it('offline or 5xx pauses the whole push', async () => {
    const { book } = library();
    const fake = new FakeSupabase();
    fake.userId = 'u1';
    fake.failEnsure(503);
    await expect(resolveBooks(asClient(fake), [book.id])).rejects.toBeInstanceOf(SyncRetryable);
  });
});
```

Create `src/sync/__tests__/adoptShelves.test.ts`:

```ts
import { addUserBook, createShelf, upsertBook } from '@/db/repository';
import { ADOPT_SHELVES_KEY, getMeta, setMeta } from '@/db/localData';
import { asClient, FakeSupabase } from '@/test/fakeSupabase';
import { bookMeta } from '@/test/fixtures';
import { freshDb } from '@/test/testDb';
import { adoptionPlan, adoptShelvesOnClaim } from '../adoptShelves';

describe('adoptionPlan', () => {
  it('matches on lower(trim(name))', () => {
    expect(adoptionPlan([{ id: 'l1', name: ' study' }, { id: 'l2', name: 'Hall' }], [{ id: 's1', name: 'Study ' }])).toEqual([{ from: 'l1', to: 's1' }]);
  });
  it('the first server shelf of a name wins, and a server shelf is adopted once', () => {
    expect(adoptionPlan([{ id: 'l1', name: 'Den' }, { id: 'l2', name: 'den' }], [{ id: 's1', name: 'Den' }, { id: 's2', name: 'DEN' }])).toEqual([{ from: 'l1', to: 's1' }]);
  });
  it('ignores a shelf that already has the server id', () => {
    expect(adoptionPlan([{ id: 's1', name: 'Den' }], [{ id: 's1', name: 'Den' }])).toEqual([]);
  });
});

describe('adoptShelvesOnClaim', () => {
  let db: Awaited<ReturnType<typeof freshDb>>;
  let fake: FakeSupabase;
  beforeEach(async () => {
    db = await freshDb();
    fake = new FakeSupabase();
    fake.userId = 'u1';
  });

  it('gives the local shelf the server id and rewrites copies and queued payloads', async () => {
    const shelf = createShelf('study');
    const copy = addUserBook(upsertBook(bookMeta()).id, 'owned', shelf.id);
    fake.seed('shelves', { id: 'server-shelf', name: 'Study ', sort_order: 0, plank: 'pool' });
    setMeta(ADOPT_SHELVES_KEY, '1');

    await adoptShelvesOnClaim(asClient(fake));

    expect(db.getAllSync<{ id: string }>('SELECT id FROM shelves').map((r) => r.id)).toEqual(['server-shelf']);
    expect(db.getFirstSync<{ shelf_id: string }>('SELECT shelf_id FROM user_books WHERE id = ?', [copy.id])!.shelf_id).toBe('server-shelf');
    const ops = db.getAllSync<{ table_name: string; row_id: string; payload: string }>('SELECT table_name, row_id, payload FROM pending_ops');
    expect(ops.filter((o) => o.table_name === 'shelves').every((o) => o.row_id === 'server-shelf' && JSON.parse(o.payload).id === 'server-shelf')).toBe(true);
    expect(ops.filter((o) => o.table_name === 'user_books').every((o) => JSON.parse(o.payload).shelf_id === 'server-shelf')).toBe(true);
    expect(getMeta(ADOPT_SHELVES_KEY)).toBeNull();
    expect(db.getAllSync('PRAGMA foreign_key_check')).toEqual([]);
  });

  it('does nothing unless a claim asked for it', async () => {
    createShelf('study');
    fake.seed('shelves', { id: 'server-shelf', name: 'Study', sort_order: 0, plank: 'pool' });
    await adoptShelvesOnClaim(asClient(fake));
    expect(db.getFirstSync<{ id: string }>('SELECT id FROM shelves')!.id).not.toBe('server-shelf');
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx jest src/sync/__tests__/resolveBooks.test.ts src/sync/__tests__/adoptShelves.test.ts`
Expected: FAIL with "Cannot find module '../resolveBooks'" / "'../adoptShelves'".

- [ ] **Step 4: Cover file rename**

Append to `src/features/bookEdits/coverFiles.ts`:

```ts
/** Best-effort: moves a cover photo to a name that uses the new book id. Returns the new relative path, or null. */
export function renameCoverFile(coverPath: string, bookId: string): string | null {
  try {
    const from = new File(Paths.document, coverPath);
    if (!from.exists) return null;
    const rel = coverFileName(bookId);
    from.moveSync(new File(Paths.document, rel));
    return rel;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Implement book resolution**

Create `src/sync/resolveBooks.ts`:

```ts
/**
 * Spec §6.4: a local book id the server doesn't know is swapped for the catalog id `ensure` returns.
 * Every reference moves in one transaction, queued and rejected payloads included, so nothing ever pushes a stale id.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb } from '@/db/database';
import { renameCoverFile } from '@/features/bookEdits/coverFiles';
import { statusOf, SyncRetryable, type SyncClient } from './client';
import { classifyStatus } from './logic';

function rewriteQueued(d: SQLiteDatabase, table: 'pending_ops' | 'sync_rejects', fromId: string, toId: string) {
  const rows = d.getAllSync<{ id: number; table_name: string; row_id: string; payload: string }>(
    `SELECT id, table_name, row_id, payload FROM ${table} WHERE table_name IN ('user_books', 'readings', 'book_edits') AND payload LIKE ?`,
    [`%${fromId}%`]
  );
  for (const op of rows) {
    let p: Record<string, unknown> | null = null;
    try {
      p = JSON.parse(op.payload);
    } catch {
      continue;
    }
    if (!p || p.book_id !== fromId) continue;
    p.book_id = toId;
    d.runSync(`UPDATE ${table} SET payload = ?, row_id = ? WHERE id = ?`, [JSON.stringify(p), op.table_name === 'book_edits' ? toId : op.row_id, op.id]);
  }
}

export function rewriteBookId(fromId: string, toId: string): void {
  if (fromId === toId) return;
  const d = getDb();
  let coverPath: string | null = null;
  d.withTransactionSync(() => {
    d.execSync('PRAGMA defer_foreign_keys = ON');
    const targetExists = !!d.getFirstSync('SELECT 1 FROM books WHERE id = ?', [toId]);
    d.runSync('UPDATE user_books SET book_id = ? WHERE book_id = ?', [toId, fromId]);
    // Merge only: if both ids already carry a live reading, the catalog row's reading stays live.
    d.runSync(
      `UPDATE readings SET deleted_at = COALESCE(deleted_at, datetime('now')), updated_at = datetime('now')
        WHERE book_id = ? AND EXISTS (SELECT 1 FROM readings r2 WHERE r2.book_id = ? AND r2.deleted_at IS NULL)`,
      [fromId, toId]
    );
    d.runSync('UPDATE readings SET book_id = ? WHERE book_id = ?', [toId, fromId]);
    d.runSync('DELETE FROM book_edits WHERE book_id = ? AND EXISTS (SELECT 1 FROM book_edits e2 WHERE e2.book_id = ?)', [fromId, toId]);
    coverPath = d.getFirstSync<{ cover_path: string | null }>('SELECT cover_path FROM book_edits WHERE book_id = ?', [fromId])?.cover_path ?? null;
    d.runSync('UPDATE book_edits SET book_id = ? WHERE book_id = ?', [toId, fromId]);
    if (targetExists) d.runSync('DELETE FROM books WHERE id = ?', [fromId]);
    else d.runSync('UPDATE books SET id = ?, server_known = 1 WHERE id = ?', [toId, fromId]);
    rewriteQueued(d, 'pending_ops', fromId, toId);
    rewriteQueued(d, 'sync_rejects', fromId, toId);
  });
  if (coverPath) {
    const moved = renameCoverFile(coverPath, toId);
    if (moved) d.runSync('UPDATE book_edits SET cover_path = ? WHERE book_id = ? AND cover_path = ?', [moved, toId, coverPath]);
  }
}

export function unknownBookIds(bookIds: string[]): string[] {
  const ids = [...new Set(bookIds)];
  const out: string[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    const q = part.map(() => '?').join(',');
    out.push(...getDb().getAllSync<{ id: string }>(`SELECT id FROM books WHERE server_known = 0 AND id IN (${q})`, part).map((r) => r.id));
  }
  return out;
}

/** failed = books the server refused (or with no ISBN): their rows stay queued and are skipped this run. */
export async function resolveBooks(client: SyncClient, bookIds: string[]): Promise<{ resolved: Map<string, string>; failed: Set<string> }> {
  const resolved = new Map<string, string>();
  const failed = new Set<string>();
  for (const localId of unknownBookIds(bookIds)) {
    const isbn13 = getDb().getFirstSync<{ isbn13: string | null }>('SELECT isbn13 FROM books WHERE id = ?', [localId])?.isbn13 ?? null;
    if (!isbn13) {
      failed.add(localId);
      continue;
    }
    const { data, error } = await client.functions.invoke<{ id?: string }>('book-lookup', { body: { ensure: { isbn13 } } });
    if (error) {
      const status = statusOf(error);
      if (classifyStatus(status) === 'retry') throw new SyncRetryable(status);
      failed.add(localId);
      continue;
    }
    const serverId = data?.id;
    if (typeof serverId !== 'string' || !serverId) {
      failed.add(localId);
      continue;
    }
    rewriteBookId(localId, serverId);
    getDb().runSync('UPDATE books SET server_known = 1 WHERE id = ?', [serverId]);
    resolved.set(localId, serverId);
  }
  return { resolved, failed };
}
```

- [ ] **Step 6: Implement shelf adoption**

Create `src/sync/adoptShelves.ts`:

```ts
/**
 * Spec §6.2 step 4: on the first push after a claim, a local shelf whose lower(trim(name)) matches a server
 * shelf takes the server id, so a reinstall or second phone doesn't end up with two "Study" shelves.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb } from '@/db/database';
import { ADOPT_SHELVES_KEY, deleteMeta, getMeta } from '@/db/localData';
import { normaliseName } from '@/features/shelves/shelfRules';
import { SyncRetryable, type SyncClient } from './client';
import { classifyStatus } from './logic';

export function adoptionPlan(local: { id: string; name: string }[], server: { id: string; name: string }[]): { from: string; to: string }[] {
  const byName = new Map<string, string>();
  for (const s of server) {
    const k = normaliseName(s.name);
    if (!byName.has(k)) byName.set(k, s.id);
  }
  const taken = new Set<string>();
  const plan: { from: string; to: string }[] = [];
  for (const l of local) {
    const to = byName.get(normaliseName(l.name));
    if (!to || to === l.id || taken.has(to)) continue;
    taken.add(to);
    plan.push({ from: l.id, to });
  }
  return plan;
}

function rewriteQueued(d: SQLiteDatabase, table: 'pending_ops' | 'sync_rejects', fromId: string, toId: string) {
  const rows = d.getAllSync<{ id: number; table_name: string; row_id: string; payload: string }>(
    `SELECT id, table_name, row_id, payload FROM ${table} WHERE table_name IN ('shelves', 'user_books') AND payload LIKE ?`,
    [`%${fromId}%`]
  );
  for (const op of rows) {
    let p: Record<string, unknown> | null = null;
    try {
      p = JSON.parse(op.payload);
    } catch {
      continue;
    }
    if (!p) continue;
    if (op.table_name === 'shelves' && p.id === fromId) {
      p.id = toId;
      d.runSync(`UPDATE ${table} SET payload = ?, row_id = ? WHERE id = ?`, [JSON.stringify(p), toId, op.id]);
    } else if (op.table_name === 'user_books' && p.shelf_id === fromId) {
      p.shelf_id = toId;
      d.runSync(`UPDATE ${table} SET payload = ? WHERE id = ?`, [JSON.stringify(p), op.id]);
    }
  }
}

export function rewriteShelfId(fromId: string, toId: string): void {
  const d = getDb();
  d.withTransactionSync(() => {
    d.execSync('PRAGMA defer_foreign_keys = ON');
    if (d.getFirstSync('SELECT 1 FROM shelves WHERE id = ?', [toId])) d.runSync('DELETE FROM shelves WHERE id = ?', [fromId]);
    else d.runSync('UPDATE shelves SET id = ? WHERE id = ?', [toId, fromId]);
    d.runSync('UPDATE user_books SET shelf_id = ? WHERE shelf_id = ?', [toId, fromId]);
    rewriteQueued(d, 'pending_ops', fromId, toId);
    rewriteQueued(d, 'sync_rejects', fromId, toId);
  });
}

export async function adoptShelvesOnClaim(client: SyncClient): Promise<void> {
  if (getMeta(ADOPT_SHELVES_KEY) !== '1') return;
  const { data, error, status } = await client.from('shelves').select('id,name').is('deleted_at', null);
  if (error) {
    if (classifyStatus(status) === 'retry') throw new SyncRetryable(status);
    throw new Error('shelf adoption failed');
  }
  const d = getDb();
  const local = d.getAllSync<{ id: string; name: string }>('SELECT id, name FROM shelves WHERE deleted_at IS NULL ORDER BY sort_order, created_at');
  // One transaction per shelf (expo-sqlite transactions can't nest); each rewrite is complete on its own.
  for (const { from, to } of adoptionPlan(local, (data ?? []) as { id: string; name: string }[])) rewriteShelfId(from, to);
  deleteMeta(ADOPT_SHELVES_KEY);
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx jest src/sync`
Expected: PASS (resolveBooks 6, adoptShelves 5, logic 20).

- [ ] **Step 8: Checkpoint**

Run `npx tsc --noEmit`, `npx jest`, `npx expo-doctor`.
Expected: all clean.

Hand Sean the file list: `src/sync/client.ts`, `src/sync/resolveBooks.ts`, `src/sync/adoptShelves.ts`, `src/test/fakeSupabase.ts`, `src/features/bookEdits/coverFiles.ts`, and the two tests.

---

### Task 13: Push

**Files:**
- Create: `src/sync/push.ts`
- Test: `src/sync/__tests__/push.test.ts`

**Interfaces:**
- Consumes: `coalesce`, `pushOrder`, `toServerRow`, `CONFLICT_TARGET`, `PUSH_CHUNK`, `classifyStatus`, `rejectCode` (Task 11); `resolveBooks`, `adoptShelvesOnClaim`, `SyncRetryable`, `SyncClient`, `FakeSupabase` (Task 12).
- Produces:
  ```ts
  export interface PushResult { pushed: number; rejected: number; skipped: number }
  export function push(client: SyncClient): Promise<PushResult>; // throws SyncRetryable on network/5xx
  ```
- **Behaviour (spec §6.2):**
  1. Adopt shelves after a claim.
  2. Coalesce the queue, dropping ops for unsynced tables.
  3. Resolve unknown book ids, then re-read the queue so payloads carry the catalog ids.
  4. Skip (don't reject) rows whose book the server refused, plus loans on such copies. They stay queued.
  5. Upsert per table in push order, in chunks of 200.
  6. On a chunk's 4xx, retry that chunk row by row. A row that still fails moves to `sync_rejects`.
  7. On success, delete that row's ops with `id <= maxOpId`. Ops written during the push stay.

- [ ] **Step 1: Write the failing test**

Create `src/sync/__tests__/push.test.ts`:

```ts
import { addUserBook, createShelf, renameShelf, setReadingState, upsertBook } from '@/db/repository';
import { asClient, FakeSupabase } from '@/test/fakeSupabase';
import { bookMeta } from '@/test/fixtures';
import { freshDb } from '@/test/testDb';
import { SyncRetryable } from '../client';
import { push } from '../push';

let db: Awaited<ReturnType<typeof freshDb>>;
let fake: FakeSupabase;
beforeEach(async () => {
  db = await freshDb();
  fake = new FakeSupabase();
  fake.userId = 'u1';
});
const pending = () => db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM pending_ops')!.n;
function library() {
  const shelf = createShelf('Study');
  const book = upsertBook(bookMeta());
  const copy = addUserBook(book.id, 'owned', shelf.id);
  setReadingState(book.id, 'reading', '2026-09-01');
  return { shelf, book, copy };
}

it('pushes parents first, never sends server-owned columns, and clears the queue', async () => {
  library();
  // The fake answers 400 test_forbidden_column if a payload carries user_id or updated_at.
  expect(await push(asClient(fake))).toEqual({ pushed: 3, rejected: 0, skipped: 0 });
  expect(fake.upserts.map((u) => u.table)).toEqual(['shelves', 'user_books', 'readings']);
  expect(pending()).toBe(0);
});

it('resolves books to catalog ids before pushing the rows that point at them', async () => {
  const { copy } = library();
  await push(asClient(fake));
  const catalogId = fake.tables.books[0].id;
  expect(fake.rows('user_books')[0]).toMatchObject({ id: copy.id, book_id: catalogId, user_id: 'u1' });
  expect(fake.rows('readings')[0].book_id).toBe(catalogId);
});

it('sends only the latest snapshot of a row', async () => {
  const shelf = createShelf('Study');
  renameShelf(shelf.id, 'Office');
  await push(asClient(fake));
  expect(fake.upserts[0].rows).toHaveLength(1);
  expect(fake.rows('shelves')[0].name).toBe('Office');
});

it('keeps ops written while the push was running', async () => {
  const shelf = createShelf('Study');
  fake.onUpsert = () => {
    fake.onUpsert = null;
    renameShelf(shelf.id, 'Office');
  };
  await push(asClient(fake));
  expect(db.getAllSync<{ payload: string }>('SELECT payload FROM pending_ops').map((o) => JSON.parse(o.payload).name)).toEqual(['Office']);
});

it('stops on a network error or 5xx and keeps everything queued', async () => {
  library();
  fake.failNext('shelves', 503);
  await expect(push(asClient(fake))).rejects.toBeInstanceOf(SyncRetryable);
  expect(pending()).toBe(3);
});

it('moves a refused row to sync_rejects and carries on with the rest', async () => {
  const a = createShelf('Study');
  const b = createShelf('Hall');
  fake.reject('shelves', (r) => r.id === b.id, 400, '23514');
  expect(await push(asClient(fake))).toMatchObject({ pushed: 1, rejected: 1 });
  expect(fake.rows('shelves').map((s) => s.id)).toEqual([a.id]);
  expect(db.getAllSync('SELECT row_id, error_code FROM sync_rejects')).toEqual([{ row_id: b.id, error_code: '23514' }]);
  expect(pending()).toBe(0);
});

it('leaves rows for a book the server refused in the queue, unrejected', async () => {
  library();
  fake.failEnsure(400);
  expect(await push(asClient(fake))).toMatchObject({ pushed: 1, rejected: 0, skipped: 2 });
  expect(pending()).toBe(2);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/sync/__tests__/push.test.ts`
Expected: FAIL with "Cannot find module '../push'".

- [ ] **Step 3: Implement push**

Create `src/sync/push.ts`:

```ts
/** Spec §6.2. Never logs payloads: they hold borrower names and notes. */
import { getDb } from '@/db/database';
import { adoptShelvesOnClaim } from './adoptShelves';
import { SyncRetryable, type SyncClient } from './client';
import {
  classifyStatus, coalesce, CONFLICT_TARGET, PUSH_CHUNK, pushOrder, rejectCode, toServerRow,
  type CoalescedOp, type PendingOp, type SyncedTable,
} from './logic';
import { resolveBooks } from './resolveBooks';

export interface PushResult { pushed: number; rejected: number; skipped: number }

function readQueue(): CoalescedOp[] {
  const d = getDb();
  const { ops, dropped } = coalesce(d.getAllSync<PendingOp>('SELECT id, table_name, row_id, op, payload FROM pending_ops ORDER BY id'));
  if (dropped.length) d.withTransactionSync(() => dropped.forEach((id) => d.runSync('DELETE FROM pending_ops WHERE id = ?', [id])));
  return ops;
}

const bookIdOf = (o: CoalescedOp): string | null =>
  (o.table === 'user_books' || o.table === 'readings' || o.table === 'book_edits') && typeof o.payload.book_id === 'string' ? o.payload.book_id : null;

function clearOps(chunk: CoalescedOp[]) {
  const d = getDb();
  d.withTransactionSync(() => {
    for (const o of chunk) d.runSync('DELETE FROM pending_ops WHERE table_name = ? AND row_id = ? AND id <= ?', [o.table, o.rowId, o.maxOpId]);
  });
}

function rejectOp(o: CoalescedOp, code: string) {
  const d = getDb();
  d.withTransactionSync(() => {
    d.runSync(
      'INSERT INTO sync_rejects (op_id, table_name, row_id, op, payload, error_code) VALUES (?, ?, ?, ?, ?, ?)',
      [o.maxOpId, o.table, o.rowId, o.op, JSON.stringify(o.payload), code]
    );
    d.runSync('DELETE FROM pending_ops WHERE table_name = ? AND row_id = ? AND id <= ?', [o.table, o.rowId, o.maxOpId]);
  });
}

async function pushChunk(client: SyncClient, table: SyncedTable, chunk: CoalescedOp[], result: PushResult): Promise<void> {
  const { error, status } = await client.from(table).upsert(chunk.map((o) => toServerRow(table, o.payload)), { onConflict: CONFLICT_TARGET[table] });
  if (!error) {
    clearOps(chunk);
    result.pushed += chunk.length;
    return;
  }
  if (classifyStatus(status) === 'retry') throw new SyncRetryable(status);
  if (chunk.length === 1) {
    rejectOp(chunk[0], rejectCode(error, status));
    result.rejected += 1;
    return;
  }
  // One bad row fails the whole statement; find it by sending the rest one at a time.
  for (const one of chunk) await pushChunk(client, table, [one], result);
}

export async function push(client: SyncClient): Promise<PushResult> {
  await adoptShelvesOnClaim(client);
  let ops = readQueue();
  const { resolved, failed } = await resolveBooks(client, ops.map(bookIdOf).filter((b): b is string => !!b));
  if (resolved.size) ops = readQueue();

  const blockedCopies = new Set(ops.filter((o) => o.table === 'user_books' && failed.has(String(o.payload.book_id))).map((o) => o.rowId));
  const ready = ops.filter((o) => {
    const b = bookIdOf(o);
    if (b && failed.has(b)) return false;
    return !(o.table === 'loans' && blockedCopies.has(String(o.payload.user_book_id)));
  });

  const result: PushResult = { pushed: 0, rejected: 0, skipped: ops.length - ready.length };
  for (const table of pushOrder(ready.map((o) => o.table))) {
    const rows = ready.filter((o) => o.table === table);
    for (let i = 0; i < rows.length; i += PUSH_CHUNK) await pushChunk(client, table, rows.slice(i, i + PUSH_CHUNK), result);
  }
  return result;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest src/sync/__tests__/push.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Checkpoint**

Run `npx tsc --noEmit`, `npx jest`, `npx expo-doctor`.
Expected: all clean.

Hand Sean the file list: `src/sync/push.ts`, `src/sync/__tests__/push.test.ts`.

---

### Task 14: Pull

**Files:**
- Create: `src/sync/pull.ts`
- Test: `src/sync/__tests__/pull.test.ts`

**Interfaces:**
- Consumes: `applyPulled`, `nextCursor`, `parseCursor`, `serializeCursor`, `keysetFilter`, `isStale`, `toLocalRow`, `toLocalBook`, `ROW_KEY`, `PUSH_ORDER`, `PULL_PAGE`, `classifyStatus` (Task 11); `rewriteBookId`, `SyncRetryable`, `FakeSupabase` (Task 12); `getMeta`, `setMeta`, `deleteMeta` (Task 2); `pendingCount` (Task 2); `deleteCoverFile`, `deleteAllCoverFiles`.
- Produces:
  ```ts
  export const cursorKey: (t: SyncedTable) => string; // 'pull:<table>' in sync_meta
  export function readCursor(t: SyncedTable): Cursor | null;
  export function pull(client: SyncClient, nowMs?: number): Promise<number>; // rows applied
  export function upsertServerBook(server: Record<string, unknown>): void;
  export function resetIfStale(nowMs?: number): boolean;
  ```
- **Behaviour (spec §6.3):**
  - Tables are pulled in push order. Each table is read in keyset pages of 500 until a short page. Each page is applied in one transaction, together with its cursor.
  - Referenced `books` are fetched by id **before** a page applies, because local foreign keys need them. A local unresolved row with the same ISBN is rewritten to the catalog id first.
  - **Readings:** a pulled reading replaces this phone's reading of the same book, even when it has a different id (readings conflict on `(user_id, book_id)`).
  - **book_edits:** a tombstone deletes the local row. A changed `cover_object` drops the stale local photo.
  - **Stale reset:**
    - It runs only when nothing is waiting (no pending ops and no un-uploaded photo), so no local edit is lost.
    - It clears **all** synced tables and all cursors together. Clearing a single table would break local foreign keys.
    - The next pull then fetches everything in full.

- [ ] **Step 1: Write the failing test**

Create `src/sync/__tests__/pull.test.ts`:

```ts
jest.mock('@/features/bookEdits/coverFiles', () => ({
  ...jest.requireActual('@/features/bookEdits/coverFiles'),
  deleteCoverFile: jest.fn(),
  deleteAllCoverFiles: jest.fn(),
}));

import { deleteCoverFile } from '@/features/bookEdits/coverFiles';
import { addUserBook, createShelf, getBook, listLibrary, listReadings, upsertBook } from '@/db/repository';
import { setMeta } from '@/db/localData';
import { asClient, FakeSupabase } from '@/test/fakeSupabase';
import { bookMeta } from '@/test/fixtures';
import { freshDb } from '@/test/testDb';
import { STALE_AFTER_MS, serializeCursor } from '../logic';
import { pull, readCursor, resetIfStale } from '../pull';

let db: Awaited<ReturnType<typeof freshDb>>;
let fake: FakeSupabase;
beforeEach(async () => {
  db = await freshDb();
  fake = new FakeSupabase();
  fake.userId = 'u1';
  jest.clearAllMocks();
});

const ISBN = '9780441172719';
const B1 = '0b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
function serverLibrary() {
  fake.seed('books', { id: B1, isbn13: ISBN, isbn10: null, title: 'Dune', authors: ['Frank Herbert'], genres: [], source: 'google' });
  fake.seed('shelves', { id: 'S1', name: 'Study', sort_order: 0, plank: 'pool', icon: null });
  fake.seed('user_books', { id: 'C1', book_id: B1, status: 'owned', is_favorite: false, shelf_id: 'S1' });
  fake.seed('readings', { id: 'R1', book_id: B1, state: 'reading', started_at: '2026-09-01', finished_at: null, rating: null });
  fake.seed('book_edits', { book_id: B1, title: 'Dune (mine)', subtitle: null, authors: null, publisher: null, published_year: null, edition: null, cover_object: null });
}
const touch = (table: string, match: (r: Record<string, unknown>) => boolean, patch: Record<string, unknown>) =>
  Object.assign(fake.tables[table].find(match)!, patch, { updated_at: fake.stamp() });

it('pulls every table into an empty phone, fetching referenced books first', async () => {
  serverLibrary();
  expect(await pull(asClient(fake))).toBe(4); // shelf, copy, reading, edits (books are fetched, not counted)
  expect(listLibrary()).toEqual([expect.objectContaining({ id: 'C1', shelfName: 'Study', book: expect.objectContaining({ id: B1, title: 'Dune (mine)', authors: ['Frank Herbert'] }) })]);
  expect(listReadings('reading')).toHaveLength(1);
  expect(readCursor('shelves')).toMatchObject({ id: 'S1' });
});

it('pages with the (updated_at, id) keyset, even when a whole page shares one timestamp', async () => {
  for (let i = 0; i < 501; i++) fake.seed('shelves', { id: `s${String(i).padStart(3, '0')}`, name: `Shelf ${i}`, sort_order: i, plank: 'bus', icon: null });
  for (const r of fake.tables.shelves) r.updated_at = '2026-09-22T00:00:00+00:00';
  await pull(asClient(fake));
  expect(db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM shelves')!.n).toBe(501);
  expect(readCursor('shelves')).toMatchObject({ id: 's500' });
});

it('a pending local op wins over the server row', async () => {
  const mine = createShelf('Study');
  fake.seed('shelves', { id: mine.id, name: 'Old name', sort_order: 0, plank: 'bus', icon: null });
  await pull(asClient(fake));
  expect(db.getFirstSync<{ name: string }>('SELECT name FROM shelves WHERE id = ?', [mine.id])!.name).toBe('Study');
});

it('applies soft deletes, and a book_edits tombstone removes the local row', async () => {
  serverLibrary();
  await pull(asClient(fake));
  touch('user_books', (r) => r.id === 'C1', { deleted_at: '2026-09-23T00:00:00+00:00' });
  touch('book_edits', (r) => r.book_id === B1, { deleted_at: '2026-09-23T00:00:00+00:00' });
  await pull(asClient(fake));
  expect(listLibrary()).toEqual([]);
  expect(getBook(B1)!.title).toBe('Dune');
});

it("another phone's reading replaces this phone's reading of the same book", async () => {
  db.runSync("INSERT INTO books (id, isbn13, title, server_known) VALUES (?, ?, 'Dune', 1)", [B1, ISBN]);
  db.runSync("INSERT INTO readings (id, book_id, state) VALUES ('Rlocal', ?, 'want')", [B1]);
  fake.seed('books', { id: B1, isbn13: ISBN, title: 'Dune', authors: [], genres: [], source: 'google' });
  fake.seed('readings', { id: 'R1', book_id: B1, state: 'reading', started_at: '2026-09-01', finished_at: null, rating: null });
  await pull(asClient(fake));
  expect(db.getAllSync('SELECT id, state FROM readings')).toEqual([{ id: 'R1', state: 'reading' }]);
});

it('a replaced synced photo drops the stale local file', async () => {
  db.runSync("INSERT INTO books (id, isbn13, title, server_known) VALUES (?, ?, 'Dune', 1)", [B1, ISBN]);
  db.runSync("INSERT INTO book_edits (book_id, cover_path, cover_object) VALUES (?, 'covers/old.jpg', 'u1/old.jpg')", [B1]);
  fake.seed('book_edits', { book_id: B1, title: null, subtitle: null, authors: null, publisher: null, published_year: null, edition: null, cover_object: 'u1/new.jpg' });
  await pull(asClient(fake));
  expect(db.getFirstSync('SELECT cover_path, cover_object FROM book_edits')).toEqual({ cover_path: null, cover_object: 'u1/new.jpg' });
  expect(deleteCoverFile).toHaveBeenCalledWith('covers/old.jpg');
});

it('a local book with the same ISBN takes the catalog id', async () => {
  const local = upsertBook(bookMeta());
  addUserBook(local.id, 'wishlist');
  db.execSync('DELETE FROM pending_ops');
  fake.seed('books', { id: B1, isbn13: ISBN, title: 'Dune', authors: ['Frank Herbert'], genres: [], source: 'google' });
  fake.seed('user_books', { id: 'C9', book_id: B1, status: 'owned', is_favorite: false, shelf_id: null });
  await pull(asClient(fake));
  expect(db.getAllSync<{ id: string }>('SELECT id FROM books').map((r) => r.id)).toEqual([B1]);
  expect(db.getAllSync<{ book_id: string }>('SELECT book_id FROM user_books').map((r) => r.book_id)).toEqual([B1, B1]);
});

describe('resetIfStale', () => {
  const old = (now: number) => serializeCursor({ updatedAt: '2026-01-01T00:00:00+00:00', id: 'x', pulledAt: now - STALE_AFTER_MS - 1 });

  it('after 30 days without a pull, clears synced tables and cursors so the next pull is full', () => {
    const now = Date.now();
    createShelf('Study');
    db.execSync('DELETE FROM pending_ops');
    setMeta('pull:shelves', old(now));
    expect(resetIfStale(now)).toBe(true);
    expect(db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM shelves')!.n).toBe(0);
    expect(readCursor('shelves')).toBeNull();
  });

  it('never resets while changes are waiting', () => {
    const now = Date.now();
    createShelf('Study');
    setMeta('pull:shelves', old(now));
    expect(resetIfStale(now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/sync/__tests__/pull.test.ts`
Expected: FAIL with "Cannot find module '../pull'".

- [ ] **Step 3: Implement pull**

Create `src/sync/pull.ts`:

```ts
/** Spec §6.3. Rows are applied inside one transaction per page; covers are deleted after it commits. */
import { getDb } from '@/db/database';
import { deleteMeta, getMeta, setMeta } from '@/db/localData';
import { pendingCount } from '@/db/pendingOps';
import { deleteAllCoverFiles, deleteCoverFile } from '@/features/bookEdits/coverFiles';
import { SyncRetryable, type SyncClient } from './client';
import {
  applyPulled, classifyStatus, isStale, keysetFilter, nextCursor, parseCursor, PULL_PAGE, PUSH_ORDER, ROW_KEY,
  serializeCursor, toLocalBook, toLocalRow, type Cursor, type SyncedTable,
} from './logic';
import { rewriteBookId } from './resolveBooks';

type Row = Record<string, unknown>;
const BOOK_TABLES = new Set<SyncedTable>(['user_books', 'readings', 'book_edits']);

export const cursorKey = (t: SyncedTable) => `pull:${t}`;
export function readCursor(t: SyncedTable): Cursor | null {
  return parseCursor(getMeta(cursorKey(t)));
}

/** Column names come from the fixed whitelists in logic.ts, never from the server. */
function upsertLocal(table: string, pk: string, row: Row) {
  const cols = Object.keys(row);
  const updates = cols.filter((c) => c !== pk).map((c) => `${c} = excluded.${c}`).join(', ');
  getDb().runSync(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT(${pk}) DO UPDATE SET ${updates}`,
    cols.map((c) => row[c] as string | number | null)
  );
}

export function upsertServerBook(server: Row): void {
  const d = getDb();
  const row = toLocalBook(server);
  // A book looked up on this phone before sync knew it becomes this catalog row (isbn13 is unique locally).
  const clash = row.isbn13 ? d.getFirstSync<{ id: string }>('SELECT id FROM books WHERE isbn13 = ? AND id != ?', [row.isbn13 as string, row.id as string]) : null;
  if (clash) rewriteBookId(clash.id, String(row.id));
  upsertLocal('books', 'id', row);
}

async function ensureBooksLocal(client: SyncClient, ids: string[]) {
  const d = getDb();
  const missing = [...new Set(ids)].filter((id) => !d.getFirstSync('SELECT 1 FROM books WHERE id = ?', [id]));
  for (let i = 0; i < missing.length; i += 100) {
    const { data, error, status } = await client.from('books').select('*').in('id', missing.slice(i, i + 100));
    if (error) {
      if (classifyStatus(status) === 'retry') throw new SyncRetryable(status);
      throw new Error('books fetch failed');
    }
    for (const b of (data ?? []) as Row[]) upsertServerBook(b);
  }
}

function applyRow(table: SyncedTable, row: Row, staleCovers: string[]): boolean {
  const d = getDb();
  const key = ROW_KEY[table];
  const id = String(row[key]);
  const bookId = row.book_id != null ? String(row.book_id) : null;
  const local =
    table === 'readings'
      ? d.getFirstSync<Row>('SELECT * FROM readings WHERE id = ? OR (book_id = ? AND deleted_at IS NULL) ORDER BY (id = ?) DESC LIMIT 1', [id, bookId, id])
      : d.getFirstSync<Row>(`SELECT * FROM ${table} WHERE ${key} = ?`, [id]);
  const rowIds = table === 'readings' && local ? [id, String(local.id)] : [id];
  const hasPending = !!d.getFirstSync(
    `SELECT 1 FROM pending_ops WHERE table_name = ? AND row_id IN (${rowIds.map(() => '?').join(', ')})`,
    [table, ...rowIds]
  );
  if (applyPulled(local, row, hasPending) !== 'apply') return false;
  if (BOOK_TABLES.has(table) && !d.getFirstSync('SELECT 1 FROM books WHERE id = ?', [bookId])) return false;

  if (table === 'book_edits') {
    const localCover = (local?.cover_path as string | null | undefined) ?? null;
    if (row.deleted_at) {
      d.runSync('DELETE FROM book_edits WHERE book_id = ?', [id]);
      if (localCover) staleCovers.push(localCover);
      return true;
    }
    const mapped = toLocalRow('book_edits', row);
    // A replaced or removed synced photo makes this phone's file stale; CoverArt fetches the new one when shown.
    if (localCover && (mapped.cover_object ?? null) !== ((local?.cover_object as string | null | undefined) ?? null)) {
      staleCovers.push(localCover);
      mapped.cover_path = null;
    }
    upsertLocal('book_edits', 'book_id', mapped);
    return true;
  }

  const mapped = toLocalRow(table, row);
  if (table === 'readings') d.runSync('DELETE FROM readings WHERE book_id = ? AND id != ?', [bookId, id]);
  if (table === 'user_books' && mapped.shelf_id && !d.getFirstSync('SELECT 1 FROM shelves WHERE id = ?', [mapped.shelf_id as string])) mapped.shelf_id = null;
  if (table === 'loans' && !d.getFirstSync('SELECT 1 FROM user_books WHERE id = ?', [mapped.user_book_id as string])) return false;
  upsertLocal(table, key, mapped);
  return true;
}

async function pullTable(client: SyncClient, table: SyncedTable, nowMs: number): Promise<number> {
  const key = ROW_KEY[table];
  let cursor = readCursor(table);
  let applied = 0;
  for (;;) {
    let query = client.from(table).select('*');
    if (cursor) query = query.or(keysetFilter(cursor, key));
    const { data, error, status } = await query.order('updated_at', { ascending: true }).order(key, { ascending: true }).limit(PULL_PAGE);
    if (error) {
      if (classifyStatus(status) === 'retry') throw new SyncRetryable(status);
      throw new Error(`pull ${table} failed`);
    }
    const rows = (data ?? []) as Row[];
    if (BOOK_TABLES.has(table)) await ensureBooksLocal(client, rows.map((r) => String(r.book_id)));
    const staleCovers: string[] = [];
    const next = nextCursor(rows, key, cursor, nowMs);
    const d = getDb();
    d.withTransactionSync(() => {
      for (const row of rows) if (applyRow(table, row, staleCovers)) applied++;
      if (next) setMeta(cursorKey(table), serializeCursor(next));
    });
    staleCovers.forEach(deleteCoverFile);
    cursor = next;
    if (rows.length < PULL_PAGE) return applied;
  }
}

export async function pull(client: SyncClient, nowMs: number = Date.now()): Promise<number> {
  let applied = 0;
  for (const table of PUSH_ORDER) applied += await pullTable(client, table, nowMs);
  return applied;
}

/** Spec §6.3 stale device (offline longer than the 30-day purge window): start again from the server. */
export function resetIfStale(nowMs: number = Date.now()): boolean {
  if (!PUSH_ORDER.some((t) => isStale(readCursor(t), nowMs))) return false;
  const d = getDb();
  const unsavedPhoto = d.getFirstSync('SELECT 1 FROM book_edits WHERE cover_path IS NOT NULL AND cover_object IS NULL');
  if (pendingCount() > 0 || unsavedPhoto) return false;
  d.withTransactionSync(() => {
    for (const t of [...PUSH_ORDER].reverse()) d.runSync(`DELETE FROM ${t}`);
    for (const t of PUSH_ORDER) deleteMeta(cursorKey(t));
  });
  deleteAllCoverFiles();
  return true;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest src/sync/__tests__/pull.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Checkpoint**

Run `npx tsc --noEmit`, `npx jest`, `npx expo-doctor`.
Expected: all clean.

Hand Sean the file list: `src/sync/pull.ts`, `src/sync/__tests__/pull.test.ts`.

---

### Task 15: Engine, triggers and the status store (plus the two-phone integration test)

**Files:**
- Create: `src/sync/status.ts`, `src/sync/engine.ts`
- Modify: `src/db/pendingOps.ts` (`setOnEnqueue`), `src/providers/QueryProvider.tsx` (export `queryClient`), `app/_layout.tsx` (start sync), `app/(tabs)/profile.tsx` (status line; sign-out pushes first)
- Test: `src/sync/__tests__/status.test.ts`, `src/sync/__tests__/engine.test.ts`, `src/sync/__tests__/sync.integration.test.ts`

**Interfaces:**
- Consumes: `push` (Task 13); `pull`, `resetIfStale` (Task 14); `backoffMs` (Task 11); `SyncRetryable`, `SyncClient`, `FakeSupabase` (Task 12); `useSession` (Task 3); `getOwner`, `bindOwner` (Task 2); `invalidateLibrary` (existing).
- Produces:
  ```ts
  // src/db/pendingOps.ts
  export function setOnEnqueue(fn: (() => void) | null): void;
  // src/sync/status.ts
  export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'signedOut';
  export interface SyncStatus { state: SyncState; lastSyncedAt: number | null; pending: number; rejected: number }
  export const useSyncStatus: UseBoundStore<StoreApi<SyncStatus>>;
  export function agoLabel(ms: number): string;
  export function statusLine(s: SyncStatus, now: number): string;
  // src/sync/engine.ts
  export const DEBOUNCE_MS = 2000;
  export interface SyncDeps { client: SyncClient; getUserId: () => Promise<string | null>; onPulled?: () => void }
  export function syncNow(override?: SyncDeps): Promise<void>;
  export function requestSync(delayMs?: number): void;
  export function refreshCounts(): void;
  export function startSync(options?: { onPulled?: () => void }): () => void;
  export function stopTimers(): void;
  // src/providers/QueryProvider.tsx
  export const queryClient: QueryClient;
  ```
- **Triggers (spec §6.1):**
  - 2s debounce after any repository write, via `setOnEnqueue`;
  - `AppState` → active;
  - a session becoming `signedIn`.
- **Runs:**
  - One run at a time. Any number of requests during a run schedule exactly one follow-up.
  - A run whose session user isn't the local owner does nothing. It shows `signedOut`, which renders as "Sign in again to back up".
  - After a network failure or 5xx, the next run is retried with backoff (5s → … → 5 min).
- **Error line (resolves spec §6.6):** the spec lists lines for idle, syncing, pending, offline and rejected, but none for `error` (5xx). This plan uses "Backup paused, will try again soon" for it.

- [ ] **Step 1: Write the failing tests**

Create `src/sync/__tests__/status.test.ts`:

```ts
import { agoLabel, statusLine, type SyncStatus } from '../status';

const s = (p: Partial<SyncStatus>): SyncStatus => ({ state: 'idle', lastSyncedAt: null, pending: 0, rejected: 0, ...p });
const NOW = 1_000_000_000;

describe('statusLine', () => {
  it('backed up, with how long ago', () => expect(statusLine(s({ lastSyncedAt: NOW - 120_000 }), NOW)).toBe('Backed up · 2 min ago'));
  it('backing up', () => expect(statusLine(s({ state: 'syncing' }), NOW)).toBe('Backing up…'));
  it('changes waiting', () => {
    expect(statusLine(s({ pending: 3 }), NOW)).toBe('3 changes waiting');
    expect(statusLine(s({ pending: 1 }), NOW)).toBe('1 change waiting');
  });
  it('offline', () => expect(statusLine(s({ state: 'offline', pending: 2 }), NOW)).toBe('Offline, will back up later'));
  it('rejected rows come first', () => {
    expect(statusLine(s({ state: 'syncing', rejected: 1 }), NOW)).toBe("1 change couldn't sync");
    expect(statusLine(s({ rejected: 4 }), NOW)).toBe("4 changes couldn't sync");
  });
  it('an expired session asks to sign in again', () => expect(statusLine(s({ state: 'signedOut' }), NOW)).toBe('Sign in again to back up'));
  it('a server error', () => expect(statusLine(s({ state: 'error' }), NOW)).toBe('Backup paused, will try again soon'));
  it('never synced yet', () => expect(statusLine(s({}), NOW)).toBe('Not backed up yet'));
});

describe('agoLabel', () => {
  it.each([[30_000, 'just now'], [59 * 60_000, '59 min ago'], [3 * 3_600_000, '3 hr ago'], [86_400_000, '1 day ago'], [5 * 86_400_000, '5 days ago']])(
    '%p ms is %p', (ms, label) => expect(agoLabel(ms)).toBe(label)
  );
});
```

Create `src/sync/__tests__/engine.test.ts`:

```ts
jest.mock('@/api/supabase', () => ({ supabase: {} }));

import { bindOwner } from '@/auth/ownership';
import { createShelf } from '@/db/repository';
import { asClient, FakeSupabase } from '@/test/fakeSupabase';
import { freshDb } from '@/test/testDb';
import { stopTimers, syncNow, type SyncDeps } from '../engine';
import { useSyncStatus } from '../status';

let fake: FakeSupabase;
beforeEach(async () => {
  await freshDb();
  fake = new FakeSupabase();
  fake.userId = 'u1';
  useSyncStatus.setState({ state: 'idle', lastSyncedAt: null, pending: 0, rejected: 0 });
});
afterEach(() => stopTimers());
const deps = (over: Partial<SyncDeps> = {}): SyncDeps => ({ client: asClient(fake), getUserId: async () => fake.userId, ...over });

it('runs one at a time; requests during a run collapse into one follow-up', async () => {
  let runs = 0;
  const d = deps({ getUserId: async () => { runs++; await new Promise((r) => setTimeout(r, 5)); return null; } });
  await Promise.all([syncNow(d), syncNow(d), syncNow(d)]);
  expect(runs).toBe(2);
});

it('never pushes under a session that does not own this library', async () => {
  bindOwner('u1');
  createShelf('Study');
  fake.userId = 'u2';
  await syncNow(deps());
  expect(fake.upserts).toEqual([]);
  expect(useSyncStatus.getState().state).toBe('signedOut');
});

it('a full run backs up, pulls, and reports idle', async () => {
  bindOwner('u1');
  createShelf('Study');
  const onPulled = jest.fn();
  await syncNow(deps({ onPulled }));
  expect(fake.rows('shelves')).toHaveLength(1);
  expect(useSyncStatus.getState()).toMatchObject({ state: 'idle', pending: 0, rejected: 0 });
  expect(useSyncStatus.getState().lastSyncedAt).not.toBeNull();
  expect(onPulled).toHaveBeenCalled();
});

it('offline shows as offline and keeps the change waiting', async () => {
  bindOwner('u1');
  createShelf('Study');
  fake.failNext('shelves', 0);
  await syncNow(deps());
  expect(useSyncStatus.getState()).toMatchObject({ state: 'offline', pending: 1 });
});

it('a 5xx shows as an error', async () => {
  bindOwner('u1');
  createShelf('Study');
  fake.failNext('shelves', 503);
  await syncNow(deps());
  expect(useSyncStatus.getState().state).toBe('error');
});
```

Create `src/sync/__tests__/sync.integration.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest src/sync/__tests__/status.test.ts src/sync/__tests__/engine.test.ts src/sync/__tests__/sync.integration.test.ts`
Expected: FAIL with "Cannot find module '../status'" / "'../engine'".

- [ ] **Step 3: The enqueue hook**

In `src/db/pendingOps.ts`:
- add below the imports:

```ts
let onEnqueue: (() => void) | null = null;

/** The sync engine listens here to debounce a run after every write (spec §6.1). */
export function setOnEnqueue(fn: (() => void) | null): void {
  onEnqueue = fn;
}
```

- add `onEnqueue?.();` as the last line of `enqueueOp`.

- [ ] **Step 4: The status store**

Create `src/sync/status.ts`:

```ts
/** Spec §6.6: the only sync UI is one line on Profile, rendered from this store. */
import { create } from 'zustand';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'signedOut';
export interface SyncStatus { state: SyncState; lastSyncedAt: number | null; pending: number; rejected: number }

export const useSyncStatus = create<SyncStatus>(() => ({ state: 'idle', lastSyncedAt: null, pending: 0, rejected: 0 }));

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export function agoLabel(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

export function statusLine(s: SyncStatus, now: number): string {
  if (s.state === 'signedOut') return 'Sign in again to back up';
  if (s.rejected > 0) return `${count(s.rejected, 'change', 'changes')} couldn't sync`;
  if (s.state === 'syncing') return 'Backing up…';
  if (s.state === 'offline') return 'Offline, will back up later';
  if (s.state === 'error') return 'Backup paused, will try again soon';
  if (s.pending > 0) return `${count(s.pending, 'change', 'changes')} waiting`;
  if (s.lastSyncedAt === null) return 'Not backed up yet';
  return `Backed up · ${agoLabel(now - s.lastSyncedAt)}`;
}
```

- [ ] **Step 5: The engine**

Create `src/sync/engine.ts`:

```ts
/**
 * Single-flight sync orchestrator (spec §6.1). No background tasks, no polling: runs come from a 2s
 * debounce after writes, the app coming to the foreground, and sign-in. Never logs rows or errors.
 */
import { AppState } from 'react-native';
import { supabase } from '@/api/supabase';
import { useSession } from '@/auth/session';
import { getDb } from '@/db/database';
import { getOwner } from '@/db/localData';
import { pendingCount, setOnEnqueue } from '@/db/pendingOps';
import { SyncRetryable, type SyncClient } from './client';
import { backoffMs } from './logic';
import { pull, resetIfStale } from './pull';
import { push } from './push';
import { useSyncStatus } from './status';

export const DEBOUNCE_MS = 2000;

export interface SyncDeps {
  client: SyncClient;
  /** The signed-in user's id, or null when there's no usable session. */
  getUserId: () => Promise<string | null>;
  /** Called after a run that changed local rows (the app refreshes its queries). */
  onPulled?: () => void;
}

const defaultDeps = (): SyncDeps => ({
  client: supabase,
  getUserId: async () => (await supabase.auth.getSession()).data.session?.user.id ?? null,
});

let deps: SyncDeps | null = null;
let current: Promise<void> | null = null;
let followUp = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;

export function refreshCounts(): void {
  const rejected = getDb().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM sync_rejects')?.n ?? 0;
  useSyncStatus.setState({ pending: pendingCount(), rejected });
}

function scheduleRetry(ms: number) {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void syncNow();
  }, ms);
}

async function runOnce(d: SyncDeps): Promise<void> {
  let userId: string | null = null;
  try {
    userId = await d.getUserId();
  } catch {
    userId = null;
  }
  // Only the library's owner ever pushes; signing in as someone else wipes first (spec §4).
  if (!userId || userId !== getOwner()) {
    useSyncStatus.setState({ state: 'signedOut' });
    refreshCounts();
    return;
  }
  useSyncStatus.setState({ state: 'syncing' });
  try {
    await push(d.client);
    resetIfStale();
    const applied = await pull(d.client);
    attempt = 0;
    useSyncStatus.setState({ state: 'idle', lastSyncedAt: Date.now() });
    if (applied > 0) d.onPulled?.();
  } catch (e) {
    attempt += 1;
    useSyncStatus.setState({ state: e instanceof SyncRetryable && e.status === 0 ? 'offline' : 'error' });
    scheduleRetry(backoffMs(attempt));
  } finally {
    refreshCounts();
  }
}

/** One run at a time; any requests during a run schedule exactly one follow-up. Resolves when both are done. */
export function syncNow(override?: SyncDeps): Promise<void> {
  const use = override ?? deps ?? defaultDeps();
  if (current) {
    followUp = true;
    return current;
  }
  current = (async () => {
    try {
      do {
        followUp = false;
        await runOnce(use);
      } while (followUp);
    } finally {
      current = null;
    }
  })();
  return current;
}

export function requestSync(delayMs: number = DEBOUNCE_MS): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void syncNow();
  }, delayMs);
}

export function stopTimers(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (retryTimer) clearTimeout(retryTimer);
  debounceTimer = null;
  retryTimer = null;
}

/** Call once from the root layout. Returns a cleanup. */
export function startSync(options: { onPulled?: () => void } = {}): () => void {
  deps = { ...defaultDeps(), onPulled: options.onPulled };
  setOnEnqueue(() => {
    useSyncStatus.setState({ pending: pendingCount() });
    requestSync();
  });
  const app = AppState.addEventListener('change', (s) => {
    if (s === 'active') requestSync(0);
  });
  const unsubscribe = useSession.subscribe((s, prev) => {
    if (s.status === 'signedIn' && prev.status !== 'signedIn') requestSync(0);
    if (s.status === 'expired') useSyncStatus.setState({ state: 'signedOut' });
  });
  const status = useSession.getState().status;
  if (status === 'signedIn') requestSync(0);
  if (status === 'expired') useSyncStatus.setState({ state: 'signedOut' });
  refreshCounts();
  return () => {
    setOnEnqueue(null);
    app.remove();
    unsubscribe();
    stopTimers();
    deps = null;
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest src/sync`
Expected: PASS (status 13, engine 5, integration 2, plus the earlier sync suites).

- [ ] **Step 7: Wire it into the app**

`src/providers/QueryProvider.tsx`: rename `const client` to `export const queryClient`, and use `client={queryClient}` in the provider.

`app/_layout.tsx`:
- add the imports:

```tsx
import { invalidateLibrary } from '@/lib/invalidateLibrary';
import { QueryProvider, queryClient } from '@/providers/QueryProvider';
import { startSync } from '@/sync/engine';
```

  (replacing the existing `QueryProvider` import);
- add after the `getDb()` effect:

```tsx
  // Pulled rows change what every library query shows.
  useEffect(() => startSync({ onPulled: () => invalidateLibrary(queryClient) }), []);
```

`app/(tabs)/profile.tsx`:
- change the React import to `import React, { useEffect, useState } from 'react';`;
- change the accountLines import to `import { SIGN_IN_AGAIN } from '@/features/account/accountLines';`;
- add `import { syncNow } from '@/sync/engine';` and `import { statusLine, useSyncStatus } from '@/sync/status';`;
- after `const expired = …`, add:

```tsx
  const sync = useSyncStatus();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
```

- in `onSignOut`, change the `signOut` call to `signOut({ push: () => syncNow(), syncEnabled: true, confirm: confirmSignOut })`;
- change the card's `backupLine` to `backupLine={expired ? SIGN_IN_AGAIN : statusLine(sync, now)}`.

- [ ] **Step 8: Checkpoint**

Run `npx tsc --noEmit`, `npx jest`, `npx expo-doctor`.
Expected: all clean.

Hand Sean the file list: `src/sync/status.ts`, `src/sync/engine.ts`, `src/db/pendingOps.ts`, `src/providers/QueryProvider.tsx`, `app/_layout.tsx`, `app/(tabs)/profile.tsx`, and the three tests.

---

### Task 16: Cover photo sync

**Files:**
- Create: `src/sync/covers.ts`
- Modify: `src/sync/engine.ts` (upload after push), `src/db/repository.ts` (`cover_object` in selects; `coverPending`), `src/lib/types.ts`, `src/components/shelf/CoverArt.tsx`, `app/book/[id].tsx`, `app/reading.tsx`, `src/components/reading/CurrentlyReadingStrip.tsx`, `src/features/scanner/VerdictSheet.tsx`
- Test: `src/sync/__tests__/covers.test.ts`

**Interfaces:**
- Consumes: `enqueueOp` (Task 2); `coverFileName`, `resolveCoverUri`, `documentUri` (existing); `SyncClient`, `SyncRetryable`, `FakeSupabase` (Task 12); `books_effective.cover_object` (Task 11).
- Produces:
  ```ts
  // src/sync/covers.ts
  export const SIGNED_URL_SECONDS = 60;
  export function coverObjectPath(userId: string, bookId: string, nowMs?: number): string; // <uid>/<book_id>-<ms>.jpg
  export function uploadPendingCovers(client: SyncClient, userId: string, now?: () => number): Promise<number>;
  export function ensureLocal(bookId: string, client?: Pick<SyncClient, 'storage'>): Promise<string | null>; // relative cover_path
  // Book gains: coverPending?: boolean  (a synced photo exists but isn't on this phone yet)
  // CoverArt gains optional props: bookId?: string; coverPending?: boolean
  ```
- **Behaviour (spec §6.7):**
  - A photo uploads only after its `book_edits` row has pushed (no pending op) and its book id is a catalog id. Then `cover_object` is queued, which triggers a follow-up run that pushes it.
  - "Remove photo" nulls `cover_object` (Task 11). The server trigger then queues the old object for purge (Task 9).
  - While a synced photo isn't on this phone yet, the painted fallback cover shows (`coverUrl` is null) until `ensureLocal` downloads it. The download uses a 60s signed URL and saves the file under documents/covers.

- [ ] **Step 1: Write the failing test**

Create `src/sync/__tests__/covers.test.ts`:

```ts
jest.mock('@/api/supabase', () => ({ supabase: {} }));
const mockBytes = jest.fn(async () => new Uint8Array([1, 2, 3]));
const mockDownload = jest.fn(async (_url: string, dest: unknown) => dest);
jest.mock('expo-file-system', () => {
  const join = (parts: unknown[]) => parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
  class File {
    uri: string;
    exists = true;
    constructor(...parts: unknown[]) { this.uri = join(parts); }
    static downloadFileAsync = (url: string, dest: unknown) => mockDownload(url, dest);
    bytes() { return mockBytes(); }
    delete() {}
    copySync() {}
    moveSync() {}
  }
  class Directory {
    uri: string;
    exists = true;
    constructor(...parts: unknown[]) { this.uri = join(parts); }
    create() {}
    delete() {}
  }
  return { File, Directory, Paths: { document: { uri: 'file:///docs' }, cache: { uri: 'file:///cache' } } };
});
jest.mock('@/features/bookEdits/coverFiles', () => ({
  ...jest.requireActual('@/features/bookEdits/coverFiles'),
  saveCoverFile: jest.fn(async (bookId: string) => `covers/${bookId}-1.jpg`),
}));

import { getBook, setBookCover, upsertBook } from '@/db/repository';
import { asClient, FakeSupabase } from '@/test/fakeSupabase';
import { bookMeta } from '@/test/fixtures';
import { freshDb } from '@/test/testDb';
import { ensureLocal, uploadPendingCovers } from '../covers';

let db: Awaited<ReturnType<typeof freshDb>>;
let fake: FakeSupabase;
beforeEach(async () => {
  db = await freshDb();
  fake = new FakeSupabase();
  fake.userId = 'u1';
  jest.clearAllMocks();
});
const AT = () => 1726963200000;

async function bookWithPhoto() {
  const b = upsertBook(bookMeta());
  await setBookCover(b.id, 'file:///picked.jpg');
  db.runSync('UPDATE books SET server_known = 1');
  return b;
}

it('waits until the book_edits row has pushed', async () => {
  await bookWithPhoto();
  expect(await uploadPendingCovers(asClient(fake), 'u1', AT)).toBe(0);
  expect(fake.objects.size).toBe(0);
});

it('uploads to covers/<uid>/<book>-<ms>.jpg, then queues cover_object to push', async () => {
  const b = await bookWithPhoto();
  db.execSync('DELETE FROM pending_ops');
  expect(await uploadPendingCovers(asClient(fake), 'u1', AT)).toBe(1);
  const path = `u1/${b.id}-1726963200000.jpg`;
  expect([...fake.objects.keys()]).toEqual([path]);
  const op = db.getFirstSync<{ payload: string }>("SELECT payload FROM pending_ops WHERE table_name = 'book_edits'");
  expect(JSON.parse(op!.payload).cover_object).toBe(path);
});

it('another phone shows the painted cover, then downloads the photo once when it is first shown', async () => {
  const b = upsertBook(bookMeta());
  db.runSync("UPDATE books SET cover_url = 'https://covers.openlibrary.org/b/id/1-L.jpg'");
  db.runSync('INSERT INTO book_edits (book_id, cover_object) VALUES (?, ?)', [b.id, `u1/${b.id}-1.jpg`]);
  fake.objects.set(`u1/${b.id}-1.jpg`, new Uint8Array([1]));
  expect(getBook(b.id)).toMatchObject({ coverPending: true, coverUrl: null });

  const [first, second] = await Promise.all([ensureLocal(b.id, asClient(fake)), ensureLocal(b.id, asClient(fake))]);
  expect(first).toMatch(/^covers\/.+\.jpg$/);
  expect(second).toBe(first);
  expect(mockDownload).toHaveBeenCalledTimes(1);
  expect(mockDownload.mock.calls[0][0]).toContain('expires=60');
  expect(getBook(b.id)!.coverPending).toBe(false);
});

it('has nothing to fetch when no photo is synced', async () => {
  const b = upsertBook(bookMeta());
  expect(await ensureLocal(b.id, asClient(fake))).toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/sync/__tests__/covers.test.ts`
Expected: FAIL with "Cannot find module '../covers'".

- [ ] **Step 3: Books know about synced covers**

In `src/lib/types.ts`, add to `Book` after `edited?: boolean;`:

```ts
  /** A synced cover photo exists but isn't on this phone yet (CoverArt downloads it when shown). */
  coverPending?: boolean;
```

In `src/db/repository.ts`:
- in `toBook`, replace the `coverUrl:` line with:

```ts
  // A synced photo that isn't downloaded yet shows the painted cover, not the catalog one (spec §6.7).
  coverUrl: resolveCoverUri(r.cover_path ?? null, docs()) ?? (r.cover_object ? null : r.cover_url),
  coverPending: !r.cover_path && !!r.cover_object,
```

- in `LIBRARY_SELECT`, change `b.cover_url, b.cover_path,` to `b.cover_url, b.cover_path, b.cover_object,`;
- in `listReadings`'s select list, change `b.cover_url, b.cover_path,` to `b.cover_url, b.cover_path, b.cover_object,`.

- [ ] **Step 4: Implement cover sync**

Create `src/sync/covers.ts`:

```ts
/** Spec §6.7: cover photos in the private covers bucket, under the owner's folder. Signed URLs are never logged. */
import { Directory, File, Paths } from 'expo-file-system';
import { supabase } from '@/api/supabase';
import { getDb } from '@/db/database';
import { enqueueOp } from '@/db/pendingOps';
import { coverFileName } from '@/features/bookEdits/coverFiles';
import { SyncRetryable, type SyncClient } from './client';

export const SIGNED_URL_SECONDS = 60;

/** A fresh path per upload, so other phones can tell a replaced photo from the old one. */
export function coverObjectPath(userId: string, bookId: string, nowMs: number = Date.now()): string {
  return `${userId}/${bookId}-${nowMs}.jpg`;
}

const storageStatus = (e: unknown): number => {
  const err = (e ?? {}) as { status?: unknown; statusCode?: unknown };
  const n = typeof err.status === 'number' ? err.status : Number(err.statusCode);
  return Number.isFinite(n) ? n : 0;
};

export async function uploadPendingCovers(client: SyncClient, userId: string, now: () => number = Date.now): Promise<number> {
  const d = getDb();
  const rows = d.getAllSync<{ book_id: string; cover_path: string }>(
    `SELECT e.book_id, e.cover_path FROM book_edits e JOIN books b ON b.id = e.book_id
      WHERE e.cover_path IS NOT NULL AND e.cover_object IS NULL AND b.server_known = 1
        AND NOT EXISTS (SELECT 1 FROM pending_ops p WHERE p.table_name = 'book_edits' AND p.row_id = e.book_id)`
  );
  let uploaded = 0;
  for (const r of rows) {
    const file = new File(Paths.document, r.cover_path);
    if (!file.exists) continue;
    const bytes = await file.bytes();
    const path = coverObjectPath(userId, r.book_id, now());
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const { error } = await client.storage.from('covers').upload(path, body, { contentType: 'image/jpeg', upsert: true });
    if (error) {
      const status = storageStatus(error);
      if (status === 0 || status === 429 || status >= 500) throw new SyncRetryable(status);
      continue; // 4xx: leave it; the row still syncs without a photo
    }
    // Only if the photo wasn't replaced while it uploaded.
    d.runSync(`UPDATE book_edits SET cover_object = ?, updated_at = datetime('now') WHERE book_id = ? AND cover_path = ?`, [path, r.book_id, r.cover_path]);
    const row = d.getFirstSync<Record<string, unknown>>('SELECT * FROM book_edits WHERE book_id = ? AND cover_object = ?', [r.book_id, path]);
    if (row) {
      enqueueOp('book_edits', r.book_id, 'upsert', row);
      uploaded++;
    }
  }
  return uploaded;
}

const inflight = new Map<string, Promise<string | null>>();

async function download(bookId: string, client: Pick<SyncClient, 'storage'>): Promise<string | null> {
  const d = getDb();
  const row = d.getFirstSync<{ cover_path: string | null; cover_object: string | null }>('SELECT cover_path, cover_object FROM book_edits WHERE book_id = ?', [bookId]);
  if (!row?.cover_object) return null;
  if (row.cover_path) return row.cover_path;
  const { data, error } = await client.storage.from('covers').createSignedUrl(row.cover_object, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) return null;
  const dir = new Directory(Paths.document, 'covers');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const rel = coverFileName(bookId);
  try {
    await File.downloadFileAsync(data.signedUrl, new File(Paths.document, rel));
  } catch {
    return null;
  }
  d.runSync('UPDATE book_edits SET cover_path = ? WHERE book_id = ? AND cover_object = ? AND cover_path IS NULL', [rel, bookId, row.cover_object]);
  return rel;
}

/** Downloads a synced photo the first time it's shown. Concurrent calls for one book share a download. */
export function ensureLocal(bookId: string, client: Pick<SyncClient, 'storage'> = supabase): Promise<string | null> {
  const running = inflight.get(bookId);
  if (running) return running;
  const p = download(bookId, client).finally(() => inflight.delete(bookId));
  inflight.set(bookId, p);
  return p;
}
```

In `src/sync/engine.ts`:
- add `import { uploadPendingCovers } from './covers';`;
- in `runOnce`, change `await push(d.client);` to:

```ts
    await push(d.client);
    await uploadPendingCovers(d.client, userId);
```

- [ ] **Step 5: CoverArt fetches pending photos**

In `src/components/shelf/CoverArt.tsx`:
- add the imports `import { documentUri, resolveCoverUri } from '@/features/bookEdits/coverFiles';` and `import { ensureLocal } from '@/sync/covers';`;
- change the signature to:

```tsx
export function CoverArt({
  id, title, author, coverUrl, width, height, bookId, coverPending,
}: {
  id: string; title: string; author?: string; coverUrl?: string | null; width: number; height: number;
  /** With coverPending, the synced photo for this book is downloaded once and shown. */
  bookId?: string; coverPending?: boolean;
}) {
```

- add after the existing `useEffect`:

```tsx
  const [fetched, setFetched] = useState<string | null>(null);
  useEffect(() => {
    if (!coverPending || !bookId) return;
    let alive = true;
    ensureLocal(bookId).then(
      (rel) => { if (alive && rel) setFetched(resolveCoverUri(rel, documentUri())); },
      () => {}
    );
    return () => { alive = false; };
  }, [bookId, coverPending]);
  const uri = coverUrl ?? fetched;
```

- replace both `coverUrl` uses in the render (`if (coverUrl && !failed)` and `source={{ uri: coverUrl }}`) with `uri`.

Pass the new props at the four display sites:
- `app/book/[id].tsx`: `<CoverArt id={focus?.id ?? book.id} … coverUrl={book.coverUrl} bookId={book.id} coverPending={book.coverPending} … />`
- `app/reading.tsx`: `<CoverArt id={r.bookId} … coverUrl={r.book.coverUrl} bookId={r.bookId} coverPending={r.book.coverPending} … />`
- `src/components/reading/CurrentlyReadingStrip.tsx`: `<CoverArt id={r.bookId} … bookId={r.bookId} coverPending={r.book.coverPending} … />`
- `src/features/scanner/VerdictSheet.tsx`: `<CoverArt id={v.book?.id ?? isbn13} … bookId={v.book?.id} coverPending={v.book?.coverPending} … />`

`CoverSlot` (the edit form) is left alone. It shows the picked or local photo only.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest src/sync src/db`
Expected: PASS (covers 4, and everything earlier).

- [ ] **Step 7: Checkpoint**

Run `npx tsc --noEmit`, `npx jest`, `npx expo-doctor`.
Expected: all clean.

Hand Sean the file list: `src/sync/covers.ts`, `src/sync/__tests__/covers.test.ts`, `src/sync/engine.ts`, `src/db/repository.ts`, `src/lib/types.ts`, `src/components/shelf/CoverArt.tsx`, `app/book/[id].tsx`, `app/reading.tsx`, `src/components/reading/CurrentlyReadingStrip.tsx`, `src/features/scanner/VerdictSheet.tsx`.

---

### Task 17: Profile backup status and the rejects list

**Files:**
- Create: `src/sync/rejects.ts`, `app/account/rejects.tsx`
- Modify: `app/(tabs)/profile.tsx` (tap the line), `app/_layout.tsx` (protected route)
- Test: `src/sync/__tests__/rejects.test.ts`

**Interfaces:**
- Consumes: `enqueueOp`, `OpKind` (Task 2); `deleteMeta` (Task 2); `refreshCounts`, `requestSync` (Task 15); `cursorKey` (Task 14); `isSyncedTable` (Task 11); `getBook` (existing).
- Produces:
  ```ts
  export interface RejectRow { id: number; tableName: string; rowId: string; op: OpKind; payload: Record<string, unknown>; errorCode: string; rejectedAt: string }
  export function listRejects(): RejectRow[];
  export function retryReject(id: number): void;   // back into pending_ops as the newest op, then sync
  export function discardReject(id: number): void; // drop it and re-pull that table, so this phone matches the backup again
  export function describeReject(r: RejectRow, titleFor: (bookId: string) => string | null): string;
  export function reasonFor(code: string): string;
  ```
- **Discard** removes the change from this phone's queue and clears that table's pull cursor, so the next run re-applies the server's version of the row. A row the server never had stays local and unsynced until it is edited again.

- [ ] **Step 1: Write the failing test**

Create `src/sync/__tests__/rejects.test.ts`:

```ts
const mockRequestSync = jest.fn();
jest.mock('@/sync/engine', () => ({ refreshCounts: jest.fn(), requestSync: (...a: unknown[]) => mockRequestSync(...a) }));

import { getMeta, setMeta } from '@/db/localData';
import { freshDb } from '@/test/testDb';
import { describeReject, discardReject, listRejects, reasonFor, retryReject, type RejectRow } from '../rejects';

let db: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => {
  db = await freshDb();
  jest.clearAllMocks();
});
const reject = (table: string, rowId: string, payload: object, code = '23514') =>
  db.runSync('INSERT INTO sync_rejects (op_id, table_name, row_id, op, payload, error_code) VALUES (9, ?, ?, ?, ?, ?)', [table, rowId, 'upsert', JSON.stringify(payload), code]);

it('lists what was refused', () => {
  reject('shelves', 's1', { id: 's1', name: 'x'.repeat(90) });
  expect(listRejects()).toEqual([expect.objectContaining({ tableName: 'shelves', rowId: 's1', op: 'upsert', errorCode: '23514', payload: { id: 's1', name: 'x'.repeat(90) } })]);
});

it('Try again puts it back as the newest op and asks for a sync', () => {
  db.runSync("INSERT INTO pending_ops (table_name, row_id, op, payload) VALUES ('shelves', 'other', 'upsert', '{}')");
  reject('shelves', 's1', { id: 's1', name: 'Study' });
  retryReject(listRejects()[0].id);
  expect(listRejects()).toEqual([]);
  const last = db.getFirstSync<{ row_id: string; payload: string }>('SELECT row_id, payload FROM pending_ops ORDER BY id DESC LIMIT 1');
  expect(last).toEqual({ row_id: 's1', payload: JSON.stringify({ id: 's1', name: 'Study' }) });
  expect(mockRequestSync).toHaveBeenCalledWith(0);
});

it('Discard drops it and re-pulls that table', () => {
  setMeta('pull:shelves', '{"updatedAt":"t","id":"a","pulledAt":1}');
  reject('shelves', 's1', { id: 's1', name: 'Study' });
  discardReject(listRejects()[0].id);
  expect(listRejects()).toEqual([]);
  expect(getMeta('pull:shelves')).toBeNull();
  expect(mockRequestSync).toHaveBeenCalledWith(0);
});

describe('copy', () => {
  const r = (tableName: string, payload: object): RejectRow => ({ id: 1, tableName, rowId: 'x', op: 'upsert', payload, errorCode: '23514', rejectedAt: '' });
  const title = (id: string) => (id === 'b1' ? 'Dune' : null);
  it.each([
    [r('shelves', { name: 'Study' }), 'The Study shelf'],
    [r('user_books', { book_id: 'b1' }), 'Your copy of Dune'],
    [r('readings', { book_id: 'b1' }), 'Your reading of Dune'],
    [r('book_edits', { book_id: 'b1' }), 'Your details for Dune'],
    [r('book_edits', { book_id: 'b2' }), 'Your details for a book'],
    [r('loans', { borrower_name: 'Ana' }), 'The loan to Ana'],
    [r('profiles', {}), 'Your name'],
  ])('describes %#', (row, text) => expect(describeReject(row, title)).toBe(text));
  it('explains the reason', () => {
    expect(reasonFor('23514')).toBe("It's longer than the backup allows. Shorten it, then try again.");
    expect(reasonFor('42501')).toBe('It belongs to a different account.');
    expect(reasonFor('23503')).toBe("Something it points to hasn't backed up yet. Try again in a moment.");
    expect(reasonFor('http_400')).toBe('The backup turned it down.');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/sync/__tests__/rejects.test.ts`
Expected: FAIL with "Cannot find module '../rejects'".

- [ ] **Step 3: Implement rejects**

Create `src/sync/rejects.ts`:

```ts
/** Rows the server refused (spec §6.2 4xx). Tapping "⟨N⟩ change(s) couldn't sync" on Profile lists them. */
import { getDb } from '@/db/database';
import { deleteMeta } from '@/db/localData';
import { enqueueOp, type OpKind } from '@/db/pendingOps';
import { refreshCounts, requestSync } from '@/sync/engine';
import { isSyncedTable } from './logic';
import { cursorKey } from './pull';

export interface RejectRow { id: number; tableName: string; rowId: string; op: OpKind; payload: Record<string, unknown>; errorCode: string; rejectedAt: string }

const toReject = (r: any): RejectRow => {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(r.payload) ?? {};
  } catch {
    payload = {};
  }
  return { id: r.id, tableName: r.table_name, rowId: r.row_id, op: r.op === 'delete' ? 'delete' : 'upsert', payload, errorCode: r.error_code, rejectedAt: r.rejected_at };
};

export function listRejects(): RejectRow[] {
  return getDb().getAllSync<any>('SELECT * FROM sync_rejects ORDER BY id').map(toReject);
}

export function retryReject(id: number): void {
  const d = getDb();
  const row = d.getFirstSync<any>('SELECT * FROM sync_rejects WHERE id = ?', [id]);
  if (!row) return;
  const r = toReject(row);
  d.withTransactionSync(() => {
    enqueueOp(r.tableName, r.rowId, r.op, r.payload);
    d.runSync('DELETE FROM sync_rejects WHERE id = ?', [id]);
  });
  refreshCounts();
  requestSync(0);
}

export function discardReject(id: number): void {
  const d = getDb();
  const row = d.getFirstSync<{ table_name: string }>('SELECT table_name FROM sync_rejects WHERE id = ?', [id]);
  if (!row) return;
  d.runSync('DELETE FROM sync_rejects WHERE id = ?', [id]);
  if (isSyncedTable(row.table_name)) deleteMeta(cursorKey(row.table_name));
  refreshCounts();
  requestSync(0);
}

export function describeReject(r: RejectRow, titleFor: (bookId: string) => string | null): string {
  const book = () => (typeof r.payload.book_id === 'string' ? titleFor(r.payload.book_id) : null) ?? 'a book';
  switch (r.tableName) {
    case 'shelves': return `The ${String(r.payload.name ?? 'unnamed')} shelf`;
    case 'user_books': return `Your copy of ${book()}`;
    case 'readings': return `Your reading of ${book()}`;
    case 'book_edits': return `Your details for ${book()}`;
    case 'loans': return `The loan to ${String(r.payload.borrower_name ?? 'a friend')}`;
    case 'profiles': return 'Your name';
    default: return 'A change';
  }
}

export function reasonFor(code: string): string {
  if (code === '23514') return "It's longer than the backup allows. Shorten it, then try again.";
  if (code === '42501') return 'It belongs to a different account.';
  if (code === '23503') return "Something it points to hasn't backed up yet. Try again in a moment.";
  if (code === '23505') return 'It clashes with something already backed up.';
  return 'The backup turned it down.';
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest src/sync/__tests__/rejects.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: The rejects screen**

Create `app/account/rejects.tsx`:

```tsx
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { PocketCard } from '@/components/ui/PocketCard';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { getBook } from '@/db/repository';
import { describeReject, discardReject, listRejects, reasonFor, retryReject, type RejectRow } from '@/sync/rejects';
import { font, ink } from '@/theme/palette';
import { useTheme } from '@/theme/useTheme';

export default function RejectsScreen() {
  const { c } = useTheme();
  const router = useRouter();
  const [rows, setRows] = useState<RejectRow[]>(() => listRejects());
  const refresh = () => setRows(listRejects());
  const titleFor = (bookId: string) => getBook(bookId)?.title ?? null;
  const discard = (r: RejectRow) =>
    Alert.alert('Discard this change?', 'This phone goes back to what your backup has.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => { discardReject(r.id); refresh(); } },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.paper }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={10} style={{ paddingHorizontal: 20, paddingVertical: 8 }}>
          <Text style={{ fontFamily: font.heavy, fontSize: 14, color: c.text }}>Done</Text>
        </Pressable>
        <ScreenHeader title="Couldn't sync" sub="These changes stayed on this phone. Try again, or discard them to match your backup." />
        <View style={{ paddingHorizontal: 16, marginTop: 14, gap: 14 }}>
          {rows.length === 0 ? (
            <Text style={{ fontFamily: font.bold, fontSize: 15, color: c.soft }}>Everything's backed up.</Text>
          ) : (
            rows.map((r) => (
              <PocketCard key={r.id}>
                <Text style={{ fontFamily: font.black, fontSize: 15, color: ink.brown }}>{describeReject(r, titleFor)}</Text>
                <Text style={{ fontFamily: font.bold, fontSize: 13, color: ink.soft, marginTop: 2 }}>{reasonFor(r.errorCode)}</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 10, marginBottom: 4 }}>
                  <Button label="Try again" variant="ghost" flex onPress={() => { retryReject(r.id); refresh(); }} />
                  <Button label="Discard" variant="ghost" flex onPress={() => discard(r)} />
                </View>
              </PocketCard>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
```

In `app/_layout.tsx`, add `<Stack.Screen name="account/rejects" />` inside the `guards.app` `Stack.Protected`, after `account/delete`.

In `app/(tabs)/profile.tsx`, change the card's `onBackupPress` to:

```tsx
            onBackupPress={expired ? () => router.push('/welcome') : sync.rejected > 0 ? () => router.push('/account/rejects') : undefined}
```

- [ ] **Step 6: Checkpoint**

Run `npx tsc --noEmit`, `npx jest`, `npx expo-doctor`.
Expected: all clean.

Hand Sean the file list: `src/sync/rejects.ts`, `src/sync/__tests__/rejects.test.ts`, `app/account/rejects.tsx`, `app/_layout.tsx`, `app/(tabs)/profile.tsx`.

**Phase 2 manual check (EAS dev builds on an iPhone and an Android):** run spec §9 manual steps 2–9:
1. An existing install claims its library on sign-in, and it appears on the second phone.
2. Sign out while offline with changes pending: the warning shows. Then sign in as someone else: nothing leaks.
3. Edit the same book on both phones.
4. Add a book by hand with a cover photo; it syncs, cover included.
5. Delete a copy; it disappears on the other phone.
6. Export the CSV.
7. Delete the account (Apple and Google). Signing in again gives an empty account.
8. Use Store Mode in airplane mode.

---

## Spec coverage check

| Spec section | Task |
|---|---|
| §1 decisions (account required, Apple/Google/email, two-way sync, own engine, cover sync, immediate deletion) | 3, 4, 7, 11–16 |
| §2 phases; Phase 1 sign-out warning copy | 5 (`signOutWarning` with `syncEnabled: false`), 15 flips it |
| §3.1 Welcome, button order, privacy link, error copy, Dewey silent, resend after 60s, expired session never blocks | 3 (session rule), 4 |
| §3.2 Apple nonce/scopes/one-time name; Google scopes and idToken; email PKCE + callback | 3 |
| §3.3 LargeSecureStore, client options, AppState refresh | 1 |
| §3.4 Supabase auth config and config.toml (8-char minimum) | 8 |
| §4 owner binding (claim / continue / wipe), sign-out flow, UUID ids | 2, 5, 15 |
| §5 Profile → Account | 5, 6, 7, 15, 17 |
| §6.1 engine shape, pure helpers, triggers, single flight, synced tables | 11, 15 |
| §6.2 push: coalesce, resolve, order, chunks, onConflict, no user_id, shelf adoption, outcomes | 12, 13 |
| §6.3 pull: cursor, keyset, pending wins, books by id, stale device | 14 |
| §6.4 ensure (server and client), id rewrite incl. queued payloads, cover file move | 10, 12 |
| §6.5 book_edits, ownership trigger, caps, indexes, purge (and purge-covers), bucket and policies | 9 |
| §6.6 status store and lines; rejects list with Try again / Discard | 15, 17 |
| §6.7 cover upload, removal, lazy download via 60s signed URL | 11, 16 (+9 queue) |
| §7.1 delete account (screen, DELETE confirm, Apple re-auth, function, local wipe, failure copy) | 7 |
| §7.2 CSV export | 6 |
| §7.3 privacy (no logging, policy draft, links.ts, store disclosures) | Global Constraints, 4, 8 |
| §8 Sean's setup | 8 (`docs/setup-accounts.md`) |
| §9 unit, integration and manual tests | every task; integration in 15; manual lists after 8 and 17 |

## Decisions this plan makes where the spec is silent or ambiguous

1. **Expired session:** no session plus a local owner is `expired`. The app stays usable, sync pauses, and Profile says "Sign in again to back up". Only sign-out and delete-account clear the owner, and so only they reach Welcome. The spec says an expiry "never blocks", while the root gate shows Welcome "while there is no session".
2. **Sign-out scope** is `local`, not global, so the owner's other phones stay signed in. If the call fails offline, the stored session is deleted directly.
3. **Cover object path** is `<uid>/<book_id>-<ms>.jpg` rather than the fixed `<uid>/<book_id>.jpg`, so other phones can see that a photo was replaced. Replaced, removed and deleted objects are queued by a trigger, and `purge-covers` deletes them (only if no live row uses them).
4. **Ownership trigger** on `readings` and `book_edits`: those rows only point at the shared catalog. The trigger still blocks any `user_id` change on all four tables.
5. **`books.title` becomes nullable** on the server, as the spec's bare `{ title: null }` placeholder requires. Placeholders are never served as lookup hits, and a later real lookup upserts over them, keeping the id. Locally they show as "ISBN …".
6. **`updated_at` on insert:** the existing touch triggers only fired on UPDATE, so a first insert could carry a device-clock value. They now fire on INSERT OR UPDATE (and cover `profiles` and `book_edits`). Payloads also never include `updated_at`.
7. **Local `book_edits` deletes stay hard deletes.** The op carries a `{ book_id, deleted_at }` tombstone, and a pulled tombstone deletes the local row.
8. **Readings pull** replaces this phone's reading of the same book even when its id differs, because the server row is unique per `(user_id, book_id)` and ids can differ across phones.
9. **Stale-device reset** clears all synced tables and cursors together, not one table, to keep local foreign keys intact. It only runs when nothing is waiting to push and no photo is un-uploaded.
10. **Rows whose book `ensure` refused** (a 4xx, or no ISBN) are skipped and stay queued rather than rejected. That's a book-level problem, not a row validation error.
11. **Delete account and Apple on Android:** revocation happens whenever a code can be obtained (iOS). If none can be, deletion still proceeds, and it is never blocked. An Apple exchange that fails aborts before anything is deleted.
12. **Status line for `error` (5xx):** "Backup paused, will try again soon". There's also "Not backed up yet" before the first run. The spec lists neither.
13. **Password sign-up:** Supabase has no separate "no passwords" switch. Local config and the setup doc turn on email confirmation, so a password sign-up still has to prove the address. The minimum length is 8.
14. **Length caps** are added `NOT VALID` so existing rows don't block the migration. New and updated rows are checked.
15. **CSV:** also neutralises cells starting with tab or CR (OWASP), writes a UTF-8 BOM for Excel, and labels owned copies without a shelf "Unshelved".
16. **Book-id rewrite ordering:** `resolveBooks` (Task 12) is built before push (Task 13) because push depends on it. The spec's module list is unchanged.
