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

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as aesjs from 'aes-js';
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
    expect(stored).toMatch(/^[01]:[0-9a-f]{32}:[0-9a-f]+$/);
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
    const keys = () => jest.mocked(SecureStore.setItemAsync).mock.calls.map((c) => c[1]);
    await LargeSecureStore.setItem(AUTH_STORAGE_KEY, SESSION);
    const firstCipher = mockAsync.get(AUTH_STORAGE_KEY);
    await LargeSecureStore.setItem(AUTH_STORAGE_KEY, SESSION);
    expect(keys()).toHaveLength(2);
    expect(keys()[1]).not.toBe(keys()[0]);
    expect(mockAsync.get(AUTH_STORAGE_KEY)).not.toBe(firstCipher);
    expect(await LargeSecureStore.getItem(AUTH_STORAGE_KEY)).toBe(SESSION);
  });

  it('a crash between writing the new key and the new ciphertext keeps the old session readable (H4)', async () => {
    await LargeSecureStore.setItem(AUTH_STORAGE_KEY, SESSION);
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('app killed'));
    await expect(LargeSecureStore.setItem(AUTH_STORAGE_KEY, JSON.stringify({ refresh_token: 'newer' }))).rejects.toThrow();
    expect(await LargeSecureStore.getItem(AUTH_STORAGE_KEY)).toBe(SESSION);
    // And the next write after the crash still round-trips.
    await LargeSecureStore.setItem(AUTH_STORAGE_KEY, 'after');
    expect(await LargeSecureStore.getItem(AUTH_STORAGE_KEY)).toBe('after');
  });

  it('reads a session stored in the earlier "iv:body" format under booklistd-auth.key', async () => {
    const k = new Uint8Array(32).fill(7);
    const iv = new Uint8Array(16).fill(3);
    const body = new aesjs.ModeOfOperation.ctr(k, new aesjs.Counter(iv)).encrypt(aesjs.utils.utf8.toBytes(SESSION));
    mockSecure.set('booklistd-auth.key', aesjs.utils.hex.fromBytes(k));
    mockAsync.set(AUTH_STORAGE_KEY, `${aesjs.utils.hex.fromBytes(iv)}:${aesjs.utils.hex.fromBytes(body)}`);
    expect(await LargeSecureStore.getItem(AUTH_STORAGE_KEY)).toBe(SESSION);
  });

  it("overlapping writes never pair one write's key with another's ciphertext", async () => {
    await Promise.all([LargeSecureStore.setItem(AUTH_STORAGE_KEY, 'one'), LargeSecureStore.setItem(AUTH_STORAGE_KEY, 'two')]);
    expect(await LargeSecureStore.getItem(AUTH_STORAGE_KEY)).toBe('two');
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
    expect(mockSecure.size).toBe(0);
  });

  it('forgetLocalSession clears the session and the PKCE verifier', async () => {
    await LargeSecureStore.setItem(AUTH_STORAGE_KEY, SESSION);
    await LargeSecureStore.setItem(`${AUTH_STORAGE_KEY}-code-verifier`, 'verifier');
    await forgetLocalSession();
    expect(mockAsync.size).toBe(0);
    expect(mockSecure.size).toBe(0);
  });
});
