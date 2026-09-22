import { authErrorMessage, callbackResult, GENERIC_SIGN_IN_ERROR } from '../authErrors';
import { SignInCancelled } from '../signIn';

jest.mock('@/api/supabase', () => ({ supabase: {} }));
jest.mock('@/auth/ownership', () => ({ bindOwner: jest.fn() }));
jest.mock('@/db/localData', () => ({ saveProfileName: jest.fn() }));
jest.mock('expo-apple-authentication', () => ({}));
jest.mock('@react-native-google-signin/google-signin', () => ({}));

describe('authErrorMessage', () => {
  it('says nothing when the person cancelled', () => {
    expect(authErrorMessage(new SignInCancelled())).toBeNull();
  });
  it('names an expired or used link and the fix', () => {
    expect(authErrorMessage({ code: 'otp_expired', message: 'Email link is invalid or has expired' })).toBe('That link has expired. Send a new one.');
  });
  it('explains a link opened on another phone', () => {
    expect(authErrorMessage({ code: 'flow_state_not_found' })).toBe('Open the link on the phone you asked from, or send a new one.');
  });
  it('handles email throttling', () => {
    expect(authErrorMessage({ code: 'over_email_send_rate_limit', status: 429 })).toBe('Lots of links sent just now. Wait a minute, then send another.');
  });
  it('handles a bad email', () => {
    expect(authErrorMessage({ code: 'email_address_invalid' })).toBe("That email doesn't look right. Check it and try again.");
  });
  it('handles no connection', () => {
    expect(authErrorMessage(new TypeError('Network request failed'))).toBe("Couldn't reach the library. Check your connection and try again.");
  });
  it('falls back to a plain message', () => {
    expect(authErrorMessage(new Error('boom'))).toBe(GENERIC_SIGN_IN_ERROR);
  });
});

describe('callbackResult', () => {
  it('returns the PKCE code', () => {
    expect(callbackResult({ code: 'abc' })).toEqual({ code: 'abc' });
  });
  it('turns an expired-link redirect into copy', () => {
    expect(callbackResult({ error: 'access_denied', error_code: 'otp_expired' })).toEqual({ error: 'That link has expired. Send a new one.' });
  });
  it('treats anything else as a plain failure', () => {
    expect(callbackResult({})).toEqual({ error: GENERIC_SIGN_IN_ERROR });
  });
});
