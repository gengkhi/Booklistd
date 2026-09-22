/// <reference types="node" />
// (tsconfig limits global types to jest; this file needs Node's crypto.)
import { createHash } from 'crypto';

const mockApple = { signInAsync: jest.fn() };
jest.mock('expo-apple-authentication', () => ({
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
  signInAsync: (...a: unknown[]) => mockApple.signInAsync(...a),
}));
const mockGoogle = { configure: jest.fn(), hasPlayServices: jest.fn(async (..._args: unknown[]) => true), signIn: jest.fn() };
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
