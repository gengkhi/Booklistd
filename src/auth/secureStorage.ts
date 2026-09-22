/**
 * LargeSecureStore: the supabase-js storage adapter (spec §3.3).
 * A session is too big for the Keychain/Keystore (about 2 KB on Android), so the JSON is AES-256-CTR
 * encrypted into AsyncStorage and only the 256-bit key lives in expo-secure-store. Every write uses a
 * fresh key and IV, so a counter is never reused under one key. Never log what passes through here.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as aesjs from 'aes-js';

export const AUTH_STORAGE_KEY = 'booklistd-auth';

const KEY_OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const { hex, utf8 } = aesjs.utils;
/**
 * Two key slots, and the ciphertext names its slot ("<slot>:<iv>:<body>"). A write puts its new key in the slot
 * the stored ciphertext isn't using, then the ciphertext: a crash between the two leaves the old pair intact (H4).
 * The earlier "<iv>:<body>" format is slot 0. Secure-store keys allow only [A-Za-z0-9._-]; supabase-js keys are
 * "booklistd-auth" and "booklistd-auth-code-verifier".
 */
type Slot = '0' | '1';
const SLOTS: readonly Slot[] = ['0', '1'];
const keyName = (key: string, slot: Slot) => (slot === '0' ? `${key}.key` : `${key}.key.${slot}`);
const ctr = (key: Uint8Array, iv: Uint8Array) => new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(iv));

function parseStored(stored: string): { slot: Slot; ivHex: string; bodyHex: string } | null {
  const parts = stored.split(':');
  if (parts.length === 2) return { slot: '0', ivHex: parts[0], bodyHex: parts[1] };
  if (parts.length === 3 && (parts[0] === '0' || parts[0] === '1')) return { slot: parts[0], ivHex: parts[1], bodyHex: parts[2] };
  return null;
}

async function encrypt(key: string, value: string, current: string | null): Promise<string> {
  const slot: Slot = (current && parseStored(current)?.slot) === '0' ? '1' : '0';
  const k = Crypto.getRandomBytes(32);
  const iv = Crypto.getRandomBytes(16);
  const body = ctr(k, iv).encrypt(utf8.toBytes(value));
  await SecureStore.setItemAsync(keyName(key, slot), hex.fromBytes(k), KEY_OPTIONS);
  return `${slot}:${hex.fromBytes(iv)}:${hex.fromBytes(body)}`;
}

async function decrypt(key: string, stored: string): Promise<string | null> {
  const parsed = parseStored(stored);
  if (!parsed || !parsed.ivHex || !parsed.bodyHex) return null;
  const k = await SecureStore.getItemAsync(keyName(key, parsed.slot), KEY_OPTIONS);
  if (!k) return null;
  try {
    return utf8.fromBytes(ctr(hex.toBytes(k), hex.toBytes(parsed.ivHex)).decrypt(hex.toBytes(parsed.bodyHex)));
  } catch {
    return null;
  }
}

/** Writes and removes for one key run one at a time, so overlapping writes can't pair one's key with another's ciphertext. */
const queues = new Map<string, Promise<unknown>>();
function serial<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(task, task);
  queues.set(key, run.catch(() => {}));
  return run;
}

export const LargeSecureStore = {
  async getItem(key: string): Promise<string | null> {
    const stored = await AsyncStorage.getItem(key);
    return stored ? decrypt(key, stored) : null;
  },
  setItem(key: string, value: string): Promise<void> {
    return serial(key, async () => {
      const current = await AsyncStorage.getItem(key);
      await AsyncStorage.setItem(key, await encrypt(key, value, current));
    });
  },
  removeItem(key: string): Promise<void> {
    return serial(key, async () => {
      await AsyncStorage.removeItem(key);
      for (const slot of SLOTS) await SecureStore.deleteItemAsync(keyName(key, slot), KEY_OPTIONS);
    });
  },
};

/** Drops this phone's session even when the sign-out request can't reach the server. */
export async function forgetLocalSession(): Promise<void> {
  for (const k of [AUTH_STORAGE_KEY, `${AUTH_STORAGE_KEY}-code-verifier`, `${AUTH_STORAGE_KEY}-user`]) {
    await LargeSecureStore.removeItem(k).catch(() => {});
  }
}
