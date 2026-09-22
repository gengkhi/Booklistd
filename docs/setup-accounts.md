# Accounts and sync: setup checklist (Sean)

Everything here happens outside the repo. Secrets never go in the app or the repo.

## 1. Apple
1. developer.apple.com → Identifiers → `com.sean.booklistd` → enable **Sign in with Apple**.
2. Create a **Services ID** (for example `com.sean.booklistd.signin`). You only need it if Apple web sign-in is added later; native iOS uses the bundle id.
3. Keys → create a **Sign in with Apple** key. Note the **Key ID** and **Team ID**, and download the `.p8` (you can only download it once).
4. Supabase → Auth → Providers → Apple: enable it. Client IDs: `com.sean.booklistd` (plus the Services ID, if you made one). Paste the Team ID, the Key ID and the `.p8` contents.
5. Function secrets for token revocation when an account is deleted (Supabase → Edge Functions → Secrets):
   - `APPLE_CLIENT_ID` = `com.sean.booklistd` — the bundle id, not the Services ID. Native iOS authorization codes are issued to the bundle id, so `delete-account`'s Apple token revocation call needs that value, not the Services ID from step 2.
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

## 7. delete-account: manual post-deploy checks
Run these against the deployed `delete-account` function before trusting it in production:
- No `Authorization` header → 401.
- The anon key or the service-role key as the token → 401 (only a real user token is accepted).
- A request body containing `userId` → 400 (the function only ever deletes the caller, never an id from the body).
- A valid user's token → deletes only that user's account, and no one else's.
- A bad or already-used Apple authorization code → 502, and the user account still exists (the delete is not applied if Apple token revocation fails).
