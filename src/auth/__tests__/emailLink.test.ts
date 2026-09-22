import { isPlausibleEmail, RESEND_AFTER_MS, resendLabel } from '../emailLink';

describe('isPlausibleEmail', () => {
  it.each(['reader@example.com', ' a.b+c@sub.example.co.uk '])('accepts %p', (s) => expect(isPlausibleEmail(s)).toBe(true));
  it.each(['', 'reader', 'reader@', '@example.com', 'a b@example.com', 'reader@example'])('rejects %p', (s) => expect(isPlausibleEmail(s)).toBe(false));
});

describe('resendLabel', () => {
  it('counts down for 60 seconds', () => {
    expect(resendLabel(0, 18_200)).toEqual({ label: 'Resend in 42s', enabled: false });
  });
  it('enables Resend after 60 seconds', () => {
    expect(resendLabel(0, RESEND_AFTER_MS)).toEqual({ label: 'Resend', enabled: true });
  });
});
