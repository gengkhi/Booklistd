const mockGetItem = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: (...a: unknown[]) => mockGetItem(...a), setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}) },
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('settings hydration readiness', () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetItem.mockReset();
  });

  it('is ready after a successful rehydrate, with the stored theme applied', async () => {
    mockGetItem.mockResolvedValue(JSON.stringify({ state: { theme: 'lamp', quiet: true }, version: 0 }));
    const { useSettings, useSettingsReady } = require('../settings');
    await flush();
    expect(useSettingsReady.getState()).toBe(true);
    expect(useSettings.getState().theme).toBe('lamp');
  });

  it('is still ready when storage rejects', async () => {
    mockGetItem.mockRejectedValue(new Error('disk on fire'));
    const { useSettings, useSettingsReady } = require('../settings');
    await flush();
    expect(useSettingsReady.getState()).toBe(true);
    expect(useSettings.getState().theme).toBe('system');
  });

  it('is still ready when stored JSON is corrupt', async () => {
    mockGetItem.mockResolvedValue('{not json');
    const { useSettingsReady } = require('../settings');
    await flush();
    expect(useSettingsReady.getState()).toBe(true);
  });
});
