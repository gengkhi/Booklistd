/** Binds the local library to the signed-in user (spec §4, fixes F1). */
import { claimLibrary, getOwner, OWNER_KEY, setMeta, wipeLocalData } from '@/db/localData';

export type OwnershipAction = 'claim' | 'continue' | 'wipe';

export function ownershipAction(ownerId: string | null, signedInId: string): OwnershipAction {
  if (!ownerId) return 'claim';
  return ownerId === signedInId ? 'continue' : 'wipe';
}

/** Idempotent: safe to call on every session start. A wipe always happens before anything can push. */
export function bindOwner(userId: string): OwnershipAction {
  const action = ownershipAction(getOwner(), userId);
  if (action === 'claim') claimLibrary(userId);
  if (action === 'wipe') {
    wipeLocalData();
    setMeta(OWNER_KEY, userId);
  }
  return action;
}
