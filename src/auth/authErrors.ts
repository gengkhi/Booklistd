/** Plain librarian copy for sign-in failures (spec §3.1): name the problem and the fix. Never log the error itself. */
import { SignInCancelled } from './signIn';

export const GENERIC_SIGN_IN_ERROR = "Couldn't sign you in. Try again.";
const EXPIRED = 'That link has expired. Send a new one.';

export function authErrorMessage(e: unknown): string | null {
  if (e instanceof SignInCancelled) return null;
  const err = (typeof e === 'object' && e !== null ? e : {}) as { code?: unknown; status?: unknown; message?: unknown; name?: unknown };
  const code = typeof err.code === 'string' ? err.code : '';
  const message = typeof err.message === 'string' ? err.message : '';
  if (code === 'otp_expired' || /expired/i.test(message)) return EXPIRED;
  if (code === 'flow_state_not_found' || code === 'flow_state_expired' || code === 'bad_code_verifier') {
    return 'Open the link on the phone you asked from, or send a new one.';
  }
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || err.status === 429) {
    return 'Lots of links sent just now. Wait a minute, then send another.';
  }
  if (code === 'email_address_invalid' || code === 'validation_failed') return "That email doesn't look right. Check it and try again.";
  if (code === 'PLAY_SERVICES_NOT_AVAILABLE') return 'Google sign-in needs Google Play services on this phone.';
  if (e instanceof TypeError || err.name === 'AuthRetryableFetchError' || /network/i.test(message)) {
    return "Couldn't reach the library. Check your connection and try again.";
  }
  return GENERIC_SIGN_IN_ERROR;
}

/** What the email-link redirect carried: a PKCE code, or an error to explain. */
export function callbackResult(params: { code?: string; error?: string; error_code?: string }): { code: string } | { error: string } {
  if (params.code) return { code: params.code };
  if (params.error_code === 'otp_expired') return { error: EXPIRED };
  return { error: GENERIC_SIGN_IN_ERROR };
}
