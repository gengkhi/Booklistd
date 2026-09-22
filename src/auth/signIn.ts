/**
 * The three sign-in methods (spec §3.2). Each ends by binding the owner, which is idempotent with the
 * session listener's call, so a wipe for a different user always happens before anything else runs.
 */
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } from '@react-native-google-signin/google-signin';
import type { AuthTokenResponse, SupabaseClient, User } from '@supabase/supabase-js';
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

/** Every sign-in path ends the same way: surface the error, guard against a missing user, then bind the owner. */
function requireUser({ data, error }: AuthTokenResponse): User {
  if (error) throw error;
  if (!data.user) throw new Error('no_user');
  bindOwner(data.user.id);
  return data.user;
}

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
  const result = await client.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken, nonce: rawNonce });
  const user = requireUser(result);
  const name = appleDisplayName(credential.fullName);
  if (name) saveProfileName(user.id, name);
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
  const result = await client.auth.signInWithIdToken({ provider: 'google', token: idToken });
  requireUser(result);
}

export async function sendEmailLink(email: string, client: AuthClient = supabase): Promise<void> {
  const { error } = await client.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: EMAIL_REDIRECT, shouldCreateUser: true },
  });
  if (error) throw error;
}

export async function completeEmailLink(code: string, client: AuthClient = supabase): Promise<void> {
  const result = await client.auth.exchangeCodeForSession(code);
  requireUser(result);
}
