import { classifyInvokeError, isRateLimited, LookupRateLimitedError, rateLimitedMessage } from '../lookupErrors';

const httpError = (status: number, headers: Record<string, string> = {}) => ({
  name: 'FunctionsHttpError',
  context: { status, headers: { get: (n: string) => headers[n] ?? null } },
});

describe('classifyInvokeError', () => {
  it('reads 429 and its Retry-After', () => {
    expect(classifyInvokeError(httpError(429, { 'Retry-After': '17' }))).toEqual({ kind: 'rate_limited', retryAfterSec: 17 });
  });

  it('defaults and clamps a missing or silly Retry-After', () => {
    expect(classifyInvokeError(httpError(429))).toEqual({ kind: 'rate_limited', retryAfterSec: 60 });
    expect(classifyInvokeError(httpError(429, { 'Retry-After': 'soon' }))).toEqual({ kind: 'rate_limited', retryAfterSec: 60 });
    expect(classifyInvokeError(httpError(429, { 'Retry-After': '999999' }))).toEqual({ kind: 'rate_limited', retryAfterSec: 3600 });
  });

  it('maps 400/413 to invalid and 404 to not_found', () => {
    expect(classifyInvokeError(httpError(400)).kind).toBe('invalid');
    expect(classifyInvokeError(httpError(413)).kind).toBe('invalid');
    expect(classifyInvokeError(httpError(404)).kind).toBe('not_found');
  });

  it('treats 5xx, relay and network errors as other', () => {
    expect(classifyInvokeError(httpError(503)).kind).toBe('other');
    expect(classifyInvokeError({ name: 'FunctionsFetchError', context: new Error('offline') }).kind).toBe('other');
    expect(classifyInvokeError(null).kind).toBe('other');
  });
});

describe('rate-limited error', () => {
  it('is recognisable and carries the wait', () => {
    const e = new LookupRateLimitedError(30);
    expect(isRateLimited(e)).toBe(true);
    expect(isRateLimited(new Error('x'))).toBe(false);
    expect(e.retryAfterSec).toBe(30);
  });

  it('has friendly copy that never says "not found"', () => {
    expect(rateLimitedMessage(30)).toMatch(/again in a minute, or add the details yourself\.$/);
    expect(rateLimitedMessage(300, false)).toMatch(/again in 5 minutes\.$/);
    expect(rateLimitedMessage(30)).not.toMatch(/not found|couldn't find/i);
  });
});
