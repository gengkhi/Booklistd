import { resolveScheme } from '../resolveScheme';

describe('resolveScheme', () => {
  it('honours an explicit preference', () => {
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('lamp', 'light')).toBe('lamp');
  });
  it('follows the system when set to system', () => {
    expect(resolveScheme('system', 'dark')).toBe('lamp');
    expect(resolveScheme('system', 'light')).toBe('light');
    expect(resolveScheme('system', null)).toBe('light');
  });
});
