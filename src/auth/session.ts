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
import { queryClient } from '@/providers/QueryProvider';

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

/** Longest the splash waits for Supabase to report a session when the phone has no library owner yet. */
export const AUTH_WAIT_MS = 2000;

/**
 * The status to show before Supabase reports (I1). supabase-js refreshes an expired token before INITIAL_SESSION,
 * which can take 25s+ offline, so an owned library opens straight away as 'expired' (sync paused) and the first
 * session event upgrades it. With no owner there's nothing to show yet: keep the splash, capped by AUTH_WAIT_MS.
 */
export function launchStatus(ownerId: string | null): 'expired' | 'loading' {
  return ownerId ? 'expired' : 'loading';
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
  const previousUserId = useSession.getState().userId;
  const nextUserId = user?.id ?? owner;
  if (nextUserId !== previousUserId) queryClient.clear();
  useSession.setState({
    status: sessionStatus(!!user, owner),
    userId: nextUserId,
    email: user?.email ?? null,
    method: user ? methodOf(user) : null,
    providers: Array.isArray(providers) ? providers.filter((p): p is string => typeof p === 'string') : [],
  });
}

/**
 * Call once from the root layout. Never await Supabase calls inside this callback (supabase-js deadlocks).
 * Launch never blocks on auth (see launchStatus); any later session event (INITIAL_SESSION, SIGNED_IN,
 * TOKEN_REFRESHED) moves 'expired' to 'signedIn', and the sync engine resumes on that transition.
 */
export function startSessionListener(client: Pick<SupabaseClient, 'auth'> = supabase, waitMs: number = AUTH_WAIT_MS): () => void {
  let fallback: ReturnType<typeof setTimeout> | null = null;
  if (useSession.getState().status === 'loading') {
    if (launchStatus(getOwner()) === 'expired') applySession(null);
    else {
      fallback = setTimeout(() => {
        fallback = null;
        if (useSession.getState().status === 'loading') applySession(null);
      }, waitMs);
    }
  }
  const cancelFallback = () => {
    if (fallback) clearTimeout(fallback);
    fallback = null;
  };
  const { data } = client.auth.onAuthStateChange((event, session) => {
    cancelFallback();
    const user = session?.user ?? null;
    if (user && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')) bindOwner(user.id);
    applySession(user);
  });
  return () => {
    cancelFallback();
    data.subscription.unsubscribe();
  };
}
