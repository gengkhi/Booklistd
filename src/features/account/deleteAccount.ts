/** Spec §7.1: Apple re-authorisation (iOS), the delete-account function, then a local wipe. Nothing is wiped on failure. */
import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/api/supabase';
import type { SessionStatus } from '@/auth/session';
import { SignInCancelled } from '@/auth/signIn';
import { wipeLocalData } from '@/db/localData';
import { endSession } from '@/features/account/signOut';
import { settleSync } from '@/sync/engine';

export const DELETE_FAILED = "Couldn't delete your account. Check your connection and try again.";

export function canConfirmDelete(typed: string): boolean {
  return typed.trim() === 'DELETE';
}

/** H2: with an expired session the call can only fail, so the person signs in again (Welcome) first. */
export function deleteNeedsSignIn(status: SessionStatus): boolean {
  return status === 'expired';
}

export async function deleteAccount({
  hasApple, platform = Platform.OS, client = supabase, settle = settleSync,
}: {
  hasApple: boolean;
  platform?: string;
  client?: Pick<SupabaseClient, 'auth' | 'functions'>;
  /** Waits out any sync run in flight (closing Apple's sheet makes the app active, which starts one), so nothing it pulls lands after the wipe. */
  settle?: () => Promise<void>;
}): Promise<void> {
  let appleAuthorizationCode: string | null = null;
  if (hasApple && platform === 'ios') {
    try {
      const credential = await AppleAuthentication.signInAsync({ requestedScopes: [] });
      appleAuthorizationCode = credential.authorizationCode ?? null;
    } catch (e) {
      if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw new SignInCancelled();
      throw e;
    }
    // Apple requires the token revoked when the account goes; without a code the server can't, so this is a
    // retryable failure (the screen shows DELETE_FAILED), never a delete that skips revocation.
    if (!appleAuthorizationCode) throw new Error('apple_code_missing');
  }
  const { error } = await client.functions.invoke('delete-account', { body: { appleAuthorizationCode } });
  if (error) throw error;
  await settle();
  wipeLocalData();
  await endSession(client);
}
