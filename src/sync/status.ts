/** Spec §6.6: the only sync UI is one line on Profile, rendered from this store. */
import { create } from 'zustand';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'signedOut';
export interface SyncStatus { state: SyncState; lastSyncedAt: number | null; pending: number; rejected: number }

export const useSyncStatus = create<SyncStatus>(() => ({ state: 'idle', lastSyncedAt: null, pending: 0, rejected: 0 }));

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export function agoLabel(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

export function statusLine(s: SyncStatus, now: number): string {
  if (s.state === 'signedOut') return 'Sign in again to back up';
  if (s.rejected > 0) return `${count(s.rejected, 'change', 'changes')} couldn't sync`;
  if (s.state === 'syncing') return 'Backing up…';
  if (s.state === 'offline') return 'Offline, will back up later';
  if (s.state === 'error') return 'Backup paused, will try again soon';
  if (s.pending > 0) return `${count(s.pending, 'change', 'changes')} waiting`;
  if (s.lastSyncedAt === null) return 'Not backed up yet';
  return `Backed up · ${agoLabel(now - s.lastSyncedAt)}`;
}
