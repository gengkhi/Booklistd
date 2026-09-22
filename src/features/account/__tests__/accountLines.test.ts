import { methodLabel, signOutWarning } from '../accountLines';

describe('methodLabel', () => {
  it('names each method', () => {
    expect(methodLabel('apple')).toBe('with Apple');
    expect(methodLabel('google')).toBe('with Google');
    expect(methodLabel('email')).toBe('by email');
    expect(methodLabel(null)).toBe('');
  });
});

describe('signOutWarning', () => {
  it('before sync ships, every library counts as not backed up', () => {
    expect(signOutWarning({ syncEnabled: false, pending: 0 })).toBe("Your library isn't backed up yet. Signing out deletes it from this phone.");
  });
  it('with sync and nothing waiting, no warning', () => {
    expect(signOutWarning({ syncEnabled: true, pending: 0 })).toBeNull();
  });
  it('names the waiting changes', () => {
    expect(signOutWarning({ syncEnabled: true, pending: 3 })).toBe("3 changes haven't backed up yet. Sign out anyway?");
    expect(signOutWarning({ syncEnabled: true, pending: 1 })).toBe("1 change hasn't backed up yet. Sign out anyway?");
  });
});
