import * as Crypto from 'expo-crypto';

/** RFC 4122 v4 UUID from the platform CSPRNG (F9). Server id columns for user-owned tables are text, so older ids stay valid. */
export function newId(): string {
  return Crypto.randomUUID();
}
