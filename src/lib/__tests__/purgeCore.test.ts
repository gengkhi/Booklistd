import { bearerToken, isCoverObjectPath, orphanedPaths, safeEqual } from '../../../supabase/functions/_shared/purgeCore';

const U = '6f1c1b8e-3b0a-4c55-9d7e-2a1f0c9b8d7e';
const B = '0b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const p = (ms: number) => `${U}/${B}-${ms}.jpg`;

describe('purgeCore', () => {
  it('reads a bearer token', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('Basic abc')).toBe('');
    expect(bearerToken(null)).toBe('');
  });
  it('compares secrets without an early exit', () => {
    expect(safeEqual('same-secret', 'same-secret')).toBe(true);
    expect(safeEqual('same-secret', 'same-secreT')).toBe(false);
    expect(safeEqual('short', 'longer-one')).toBe(false);
  });
  it('recognises cover object paths only', () => {
    expect(isCoverObjectPath(p(1726963200000))).toBe(true);
    expect(isCoverObjectPath(`${U}/../other.jpg`)).toBe(false);
    expect(isCoverObjectPath(`${U}/${B}.jpg`)).toBe(false);
  });
  it('keeps queued paths that a live row still uses', () => {
    expect(orphanedPaths([p(1726963200000), p(1726963200001), 'junk'], [p(1726963200001)])).toEqual([p(1726963200000)]);
  });
});
