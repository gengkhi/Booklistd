jest.mock('@/api/supabase', () => ({ supabase: {} }));
const mockApple = { signInAsync: jest.fn() };
jest.mock('expo-apple-authentication', () => ({ signInAsync: (...a: unknown[]) => mockApple.signInAsync(...a) }));
jest.mock('@/auth/signIn', () => ({ SignInCancelled: class SignInCancelled extends Error {} }));
const mockWipe = jest.fn();
jest.mock('@/db/localData', () => ({ wipeLocalData: () => mockWipe() }));
const mockEnd = jest.fn(async (_c?: unknown) => {});
jest.mock('@/features/account/signOut', () => ({ endSession: (c: unknown) => mockEnd(c) }));
const mockSettle = jest.fn(async () => {});
jest.mock('@/sync/engine', () => ({ settleSync: () => mockSettle() }));

import { SignInCancelled } from '@/auth/signIn';
import { canConfirmDelete, deleteAccount, deleteNeedsSignIn } from '../deleteAccount';

const client = (error: unknown = null) => ({ auth: {}, functions: { invoke: jest.fn(async (_n: string, _o: unknown) => ({ data: { deleted: true }, error })) } });

beforeEach(() => jest.clearAllMocks());

it('only DELETE enables the button', () => {
  expect(canConfirmDelete('DELETE')).toBe(true);
  expect(canConfirmDelete(' DELETE ')).toBe(true);
  expect(canConfirmDelete('delete')).toBe(false);
  expect(canConfirmDelete('')).toBe(false);
});

it('an expired session signs in again first instead of calling delete (H2)', () => {
  expect(deleteNeedsSignIn('expired')).toBe(true);
  expect(deleteNeedsSignIn('signedIn')).toBe(false);
});

it('Apple accounts on iOS re-authorise first and send the code', async () => {
  mockApple.signInAsync.mockResolvedValue({ authorizationCode: 'apple-code' });
  const c = client();
  await deleteAccount({ hasApple: true, platform: 'ios', client: c as never });
  expect(c.functions.invoke).toHaveBeenCalledWith('delete-account', { body: { appleAuthorizationCode: 'apple-code' } });
  expect(mockWipe).toHaveBeenCalled();
  expect(mockEnd).toHaveBeenCalled();
});

it('Apple on iOS without an authorization code fails before anything is deleted (I3: no silent skip of revocation)', async () => {
  mockApple.signInAsync.mockResolvedValue({ authorizationCode: null });
  const c = client();
  await expect(deleteAccount({ hasApple: true, platform: 'ios', client: c as never })).rejects.not.toBeInstanceOf(SignInCancelled);
  expect(c.functions.invoke).not.toHaveBeenCalled();
  expect(mockWipe).not.toHaveBeenCalled();
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

it('waits for sync to settle after the server delete and before the wipe', async () => {
  const order: string[] = [];
  const c = client();
  c.functions.invoke.mockImplementation(async () => { order.push('delete'); return { data: { deleted: true }, error: null }; });
  mockSettle.mockImplementation(async () => { order.push('settle'); });
  mockWipe.mockImplementation(() => order.push('wipe'));
  await deleteAccount({ hasApple: false, platform: 'android', client: c as never });
  expect(order).toEqual(['delete', 'settle', 'wipe']);
});

it('a failed call does not stop sync', async () => {
  await expect(deleteAccount({ hasApple: false, platform: 'android', client: client(new Error('offline')) as never })).rejects.toThrow();
  expect(mockSettle).not.toHaveBeenCalled();
});
