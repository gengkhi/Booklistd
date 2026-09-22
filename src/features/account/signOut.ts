/** Spec §4 sign-out: try a push, confirm if anything is left, wipe, end the session (the gate then shows Welcome). */
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/api/supabase';
import { forgetLocalSession } from '@/auth/secureStorage';
import { applySession } from '@/auth/session';
import { rejectedCount, wipeLocalData } from '@/db/localData';
import { pendingCount } from '@/db/pendingOps';
import { signOutWarning } from './accountLines';

type AuthClient = Pick<SupabaseClient, 'auth'>;

export const SIGN_OUT_FAILED = "Couldn't sign out. Try again.";

export interface SignOutDeps {
  /** One sync run (Phase 2). Before sync ships: async () => {}. */
  push: () => Promise<void>;
  /** Cancels scheduled sync runs and waits out one in flight, so nothing it pulls lands after the wipe. */
  settle?: () => Promise<void>;
  syncEnabled: boolean;
  confirm: (message: string) => Promise<boolean>;
  client?: AuthClient;
}

export async function signOut({ push, settle, syncEnabled, confirm, client = supabase }: SignOutDeps): Promise<boolean> {
  try {
    await push();
  } catch {
    // Offline or failing: whatever didn't go up is counted below.
  }
  // F7: a row stuck in pending_ops and a row the server rejected both mean "not backed up".
  const warning = signOutWarning({ syncEnabled, pending: pendingCount() + rejectedCount() });
  if (warning && !(await confirm(warning))) return false;
  await settle?.();
  wipeLocalData();
  await endSession(client);
  return true;
}

/**
 * For the Profile button: never rejects (S4). A failure before the session ends (the wipe runs in one
 * transaction, so it rolls back) keeps you signed in with your library, and `report` shows SIGN_OUT_FAILED.
 */
export async function signOutOrReport(deps: SignOutDeps, report: (message: string) => void): Promise<boolean> {
  try {
    return await signOut(deps);
  } catch {
    report(SIGN_OUT_FAILED);
    return false;
  }
}

/** Ends this phone's session. Offline the server call fails, so the stored session is dropped directly. */
export async function endSession(client: AuthClient = supabase): Promise<void> {
  const { error } = await client.auth.signOut({ scope: 'local' }).catch((e: unknown) => ({ error: e }));
  if (error) await forgetLocalSession();
  applySession(null);
}
