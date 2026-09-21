import { spineStyle, hashString } from '../spineStyle';

describe('spineStyle', () => {
  it('is deterministic per id', () => {
    expect(spineStyle('abc', 'Dune')).toEqual(spineStyle('abc', 'Dune'));
    expect(hashString('abc')).toBe(hashString('abc'));
  });
  it('stays within size ranges for many ids', () => {
    for (let i = 0; i < 500; i++) {
      const s = spineStyle(`id-${i}`, 'Title');
      expect(s.width).toBeGreaterThanOrEqual(26);
      expect(s.width).toBeLessThanOrEqual(36);
      expect(s.height).toBeGreaterThanOrEqual(96);
      expect(s.height).toBeLessThanOrEqual(122);
    }
  });
  it('prints the title on every spine, dotted or narrow, so you can tell books apart', () => {
    for (let i = 0; i < 500; i++) {
      expect(spineStyle(`id-${i}`, 'Title').showTitle).toBe(true);
    }
  });
  it('prints nothing when the title is blank', () => {
    expect(spineStyle('x', '   ').showTitle).toBe(false);
  });
});
