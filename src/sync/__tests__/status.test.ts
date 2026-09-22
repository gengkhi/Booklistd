import { agoLabel, statusLine, type SyncStatus } from '../status';

const s = (p: Partial<SyncStatus>): SyncStatus => ({ state: 'idle', lastSyncedAt: null, pending: 0, rejected: 0, ...p });
const NOW = 1_000_000_000;

describe('statusLine', () => {
  it('backed up, with how long ago', () => expect(statusLine(s({ lastSyncedAt: NOW - 120_000 }), NOW)).toBe('Backed up · 2 min ago'));
  it('backing up', () => expect(statusLine(s({ state: 'syncing' }), NOW)).toBe('Backing up…'));
  it('changes waiting', () => {
    expect(statusLine(s({ pending: 3 }), NOW)).toBe('3 changes waiting');
    expect(statusLine(s({ pending: 1 }), NOW)).toBe('1 change waiting');
  });
  it('offline', () => expect(statusLine(s({ state: 'offline', pending: 2 }), NOW)).toBe('Offline, will back up later'));
  it('rejected rows come first', () => {
    expect(statusLine(s({ state: 'syncing', rejected: 1 }), NOW)).toBe("1 change couldn't sync");
    expect(statusLine(s({ rejected: 4 }), NOW)).toBe("4 changes couldn't sync");
  });
  it('an expired session asks to sign in again', () => expect(statusLine(s({ state: 'signedOut' }), NOW)).toBe('Sign in again to back up'));
  it('a server error', () => expect(statusLine(s({ state: 'error' }), NOW)).toBe('Backup paused, will try again soon'));
  it('never synced yet', () => expect(statusLine(s({}), NOW)).toBe('Not backed up yet'));
});

describe('agoLabel', () => {
  it.each([[30_000, 'just now'], [59 * 60_000, '59 min ago'], [3 * 3_600_000, '3 hr ago'], [86_400_000, '1 day ago'], [5 * 86_400_000, '5 days ago']])(
    '%p ms is %p', (ms, label) => expect(agoLabel(ms)).toBe(label)
  );
});
