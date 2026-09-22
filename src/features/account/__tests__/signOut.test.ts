jest.mock('@/api/supabase', () => ({ supabase: {} }));
const mockForget = jest.fn(async () => {});
jest.mock('@/auth/secureStorage', () => ({ forgetLocalSession: () => mockForget() }));
const mockApply = jest.fn();
jest.mock('@/auth/session', () => ({ applySession: (...a: unknown[]) => mockApply(...a) }));
let mockPending = 0;
jest.mock('@/db/pendingOps', () => ({ pendingCount: () => mockPending }));
const mockWipe = jest.fn();
let mockRejected = 0;
// F7 (controller ruling): the warning also counts sync_rejects rows via localData's rejectedCount.
jest.mock('@/db/localData', () => ({ wipeLocalData: () => mockWipe(), rejectedCount: () => mockRejected }));

import { SIGN_OUT_FAILED, signOut, signOutOrReport } from '../signOut';

const client = (result: unknown = { error: null }) => ({ auth: { signOut: jest.fn(async (_o?: unknown) => result) } });

beforeEach(() => {
  mockPending = 0;
  mockRejected = 0;
  jest.clearAllMocks();
  mockWipe.mockReset();
});

it('before sync ships it always warns, and cancelling keeps everything', async () => {
  const confirm = jest.fn(async () => false);
  const c = client();
  expect(await signOut({ push: async () => {}, syncEnabled: false, confirm, client: c as never })).toBe(false);
  expect(confirm).toHaveBeenCalledWith("Your library isn't backed up yet. Signing out deletes it from this phone.");
  expect(mockWipe).not.toHaveBeenCalled();
  expect(c.auth.signOut).not.toHaveBeenCalled();
});

it("confirmed: tries a push, wipes, then ends only this phone's session", async () => {
  const order: string[] = [];
  const push = jest.fn(async () => { order.push('push'); });
  mockWipe.mockImplementation(() => order.push('wipe'));
  const c = client();
  c.auth.signOut.mockImplementation(async () => { order.push('signOut'); return { error: null }; });
  expect(await signOut({ push, syncEnabled: false, confirm: async () => true, client: c as never })).toBe(true);
  expect(order).toEqual(['push', 'wipe', 'signOut']);
  expect(c.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(mockApply).toHaveBeenCalledWith(null);
  expect(mockForget).not.toHaveBeenCalled();
});

it('with sync on and nothing waiting, signs out without asking', async () => {
  const confirm = jest.fn(async () => true);
  await signOut({ push: async () => {}, syncEnabled: true, confirm, client: client() as never });
  expect(confirm).not.toHaveBeenCalled();
  expect(mockWipe).toHaveBeenCalled();
});

it('names the changes still waiting after the push', async () => {
  mockPending = 2;
  const confirm = jest.fn(async () => false);
  await signOut({ push: async () => {}, syncEnabled: true, confirm, client: client() as never });
  expect(confirm).toHaveBeenCalledWith("2 changes haven't backed up yet. Sign out anyway?");
});

it('a failed push still lets you sign out', async () => {
  await signOut({ push: async () => { throw new Error('offline'); }, syncEnabled: true, confirm: async () => true, client: client() as never });
  expect(mockWipe).toHaveBeenCalled();
});

it('offline, the stored session is still forgotten', async () => {
  await signOut({ push: async () => {}, syncEnabled: false, confirm: async () => true, client: client({ error: new Error('Network request failed') }) as never });
  expect(mockForget).toHaveBeenCalled();
  expect(mockApply).toHaveBeenCalledWith(null);
});

it("rejected rows count too (F7): sync_rejects alone still triggers the warning", async () => {
  mockRejected = 1;
  const confirm = jest.fn(async () => false);
  await signOut({ push: async () => {}, syncEnabled: true, confirm, client: client() as never });
  expect(confirm).toHaveBeenCalledWith("1 change hasn't backed up yet. Sign out anyway?");
});

it('waits for sync to settle after the confirm and before the wipe', async () => {
  const order: string[] = [];
  mockPending = 1;
  mockWipe.mockImplementation(() => order.push('wipe'));
  await signOut({
    push: async () => { order.push('push'); },
    settle: async () => { order.push('settle'); },
    syncEnabled: true,
    confirm: async () => { order.push('confirm'); return true; },
    client: client() as never,
  });
  expect(order).toEqual(['push', 'confirm', 'settle', 'wipe']);
});

describe('signOutOrReport (S4)', () => {
  it('a failed wipe never rejects: it reports plain copy and keeps you signed in', async () => {
    mockWipe.mockImplementation(() => { throw new Error('disk I/O error'); });
    const c = client();
    const report = jest.fn();
    await expect(signOutOrReport({ push: async () => {}, syncEnabled: true, confirm: async () => true, client: c as never }, report)).resolves.toBe(false);
    expect(report).toHaveBeenCalledWith("Couldn't sign out. Try again.");
    expect(SIGN_OUT_FAILED).toBe("Couldn't sign out. Try again.");
    expect(c.auth.signOut).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('passes a normal result through without reporting', async () => {
    const report = jest.fn();
    expect(await signOutOrReport({ push: async () => {}, syncEnabled: true, confirm: async () => true, client: client() as never }, report)).toBe(true);
    expect(report).not.toHaveBeenCalled();
  });
});
