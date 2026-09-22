const mockAuth = { startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn() };
const mockCreateClient = jest.fn((..._args: unknown[]) => ({ auth: mockAuth }));
jest.mock('@supabase/supabase-js', () => ({ createClient: (...a: unknown[]) => mockCreateClient(...a) }));
jest.mock('react-native-url-polyfill/auto', () => ({}));
jest.mock('@/auth/secureStorage', () => ({ LargeSecureStore: { name: 'LargeSecureStore' }, AUTH_STORAGE_KEY: 'booklistd-auth' }));

// Spy on the real AppState rather than jest.mock('react-native', ...): a wholesale mock of the
// 'react-native' module leaves out Platform, NativeModules etc. that the jest-expo preset's own
// setup (expo-modules-core's lazy global.fetch installer) needs on every test file, and crashes
// or logs after teardown in ways unrelated to this test's intent.
import { AppState } from 'react-native';
let mockOnAppState: ((s: string) => void) | null = null;
jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, fn: (s: string) => void) => {
  mockOnAppState = fn;
  return { remove: jest.fn() };
}) as typeof AppState.addEventListener);

// require(), not import: babel hoists ES imports above the const mock declarations above,
// which would run supabase.ts before mockCreateClient/mockAuth exist.
require('../supabase');

describe('supabase client', () => {
  it('uses PKCE and the encrypted store, and never reads sessions from URLs', () => {
    const options = mockCreateClient.mock.calls[0][2] as { auth: Record<string, unknown> };
    expect(options.auth).toEqual({
      storage: { name: 'LargeSecureStore' },
      storageKey: 'booklistd-auth',
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    });
  });

  it('refreshes tokens only while the app is in the foreground', () => {
    mockOnAppState!('active');
    expect(mockAuth.startAutoRefresh).toHaveBeenCalledTimes(1);
    mockOnAppState!('background');
    expect(mockAuth.stopAutoRefresh).toHaveBeenCalledTimes(1);
  });
});
