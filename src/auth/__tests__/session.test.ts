jest.mock('@/api/supabase', () => ({ supabase: {} }));
const mockBindOwner = jest.fn();
jest.mock('@/auth/ownership', () => ({ bindOwner: (...a: unknown[]) => mockBindOwner(...a) }));
let mockOwner: string | null = null;
jest.mock('@/db/localData', () => ({ getOwner: () => mockOwner }));

import { AUTH_WAIT_MS, launchStatus, methodOf, routeGuards, sessionStatus, startSessionListener, useSession } from '../session';
import { queryClient } from '@/providers/QueryProvider';

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

describe('launchStatus (I1: launch never blocks on auth with a local owner)', () => {
  it('an owned library opens straight away as expired', () => expect(launchStatus('u1')).toBe('expired'));
  it('with no owner it waits for Supabase', () => expect(launchStatus(null)).toBe('loading'));
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

describe('startSessionListener at launch (I1)', () => {
  afterEach(() => jest.useRealTimers());

  it('with a local owner, opens as expired before Supabase reports anything', () => {
    mockOwner = 'u1';
    const { client } = fakeClient();
    startSessionListener(client as never);
    expect(useSession.getState()).toMatchObject({ status: 'expired', userId: 'u1' });
  });

  it('upgrades expired to signed in on INITIAL_SESSION', () => {
    mockOwner = 'u1';
    const { client, emit } = fakeClient();
    startSessionListener(client as never);
    emit('INITIAL_SESSION', { user: { id: 'u1', app_metadata: {} } });
    expect(useSession.getState().status).toBe('signedIn');
  });

  it('a later TOKEN_REFRESHED returns an expired session to signed in without user action', () => {
    mockOwner = 'u1';
    const { client, emit } = fakeClient();
    startSessionListener(client as never);
    emit('INITIAL_SESSION', null); // the refresh failed offline
    expect(useSession.getState().status).toBe('expired');
    emit('TOKEN_REFRESHED', { user: { id: 'u1', app_metadata: {} } });
    expect(useSession.getState()).toMatchObject({ status: 'signedIn', userId: 'u1' });
  });

  it('with no owner, keeps loading until the capped wait, then falls back to signed out', () => {
    jest.useFakeTimers();
    const { client } = fakeClient();
    startSessionListener(client as never);
    expect(useSession.getState().status).toBe('loading');
    jest.advanceTimersByTime(AUTH_WAIT_MS - 1);
    expect(useSession.getState().status).toBe('loading');
    jest.advanceTimersByTime(1);
    expect(useSession.getState().status).toBe('signedOut');
  });

  it('with no owner, a session that arrives in time wins and the fallback never fires', () => {
    jest.useFakeTimers();
    const { client, emit } = fakeClient();
    startSessionListener(client as never);
    mockOwner = 'u1';
    emit('INITIAL_SESSION', { user: { id: 'u1', app_metadata: {} } });
    jest.advanceTimersByTime(AUTH_WAIT_MS);
    expect(useSession.getState().status).toBe('signedIn');
  });

  it('a session that arrives after the fallback still signs in', () => {
    jest.useFakeTimers();
    const { client, emit } = fakeClient();
    startSessionListener(client as never);
    jest.advanceTimersByTime(AUTH_WAIT_MS);
    expect(useSession.getState().status).toBe('signedOut');
    mockOwner = 'u1';
    emit('INITIAL_SESSION', { user: { id: 'u1', app_metadata: {} } });
    expect(useSession.getState().status).toBe('signedIn');
  });

  it('cleanup cancels the fallback', () => {
    jest.useFakeTimers();
    const { client } = fakeClient();
    const stop = startSessionListener(client as never);
    stop();
    jest.advanceTimersByTime(AUTH_WAIT_MS);
    expect(useSession.getState().status).toBe('loading');
  });
});

describe('applySession clears the query cache when the signed-in user changes (ruling F4)', () => {
  let clearSpy: jest.SpyInstance;

  beforeEach(() => {
    clearSpy = jest.spyOn(queryClient, 'clear').mockImplementation(() => {});
  });

  afterEach(() => {
    clearSpy.mockRestore();
  });

  it('clears when the first session arrives: no session -> signed in', () => {
    const { client, emit } = fakeClient();
    startSessionListener(client as never);
    mockOwner = 'u1';
    emit('INITIAL_SESSION', { user: { id: 'u1', app_metadata: {} } });
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it('clears when a different user signs in: signed in -> different user', () => {
    const { client, emit } = fakeClient();
    startSessionListener(client as never);
    mockOwner = 'u1';
    emit('INITIAL_SESSION', { user: { id: 'u1', app_metadata: {} } });
    clearSpy.mockClear();
    mockOwner = 'u2';
    emit('SIGNED_IN', { user: { id: 'u2', app_metadata: {} } });
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it('clears on sign-out: signed in -> signed out', () => {
    const { client, emit } = fakeClient();
    startSessionListener(client as never);
    mockOwner = 'u1';
    emit('INITIAL_SESSION', { user: { id: 'u1', app_metadata: {} } });
    clearSpy.mockClear();
    mockOwner = null;
    emit('SIGNED_OUT', null);
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it('does not clear on a token refresh for the same user', () => {
    const { client, emit } = fakeClient();
    startSessionListener(client as never);
    mockOwner = 'u1';
    emit('INITIAL_SESSION', { user: { id: 'u1', app_metadata: {} } });
    clearSpy.mockClear();
    emit('TOKEN_REFRESHED', { user: { id: 'u1', app_metadata: {} } });
    expect(clearSpy).not.toHaveBeenCalled();
  });
});
