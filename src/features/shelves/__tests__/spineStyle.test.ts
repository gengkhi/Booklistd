import { spineStyle, hashString } from '../spineStyle';

describe('spineStyle', () => {
  it('is deterministic per id', () => {
    expect(spineStyle('abc', 'Dune')).toEqual(spineStyle('abc', 'Dune'));
    expect(hashString('abc')).toBe(hashString('abc'));
  });
  it('stays within size ranges for many ids', () => {
    for (let i = 0; i < 500; i++) {
      const s = spineStyle(`id-${i}`, 'Title');
      expect(s.width).toBeGreaterThanOrEqual(22);
      expect(s.width).toBeLessThanOrEqual(36);
      expect(s.height).toBeGreaterThanOrEqual(96);
      expect(s.height).toBeLessThanOrEqual(122);
    }
  });
  it('never prints a title on dotted or narrow spines, or when the title is blank', () => {
    for (let i = 0; i < 500; i++) {
      const s = spineStyle(`id-${i}`, 'Title');
      if (s.pattern === 'dots' || s.width < 24) expect(s.showTitle).toBe(false);
    }
    expect(spineStyle('x', '   ').showTitle).toBe(false);
  });
});
