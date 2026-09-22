import { dropTarget, type DropZone } from '../dropTarget';

const z = (key: string, kind: 'shelf' | 'bin', x: number, y: number, w: number, h: number, id: string | null = key): DropZone =>
  ({ key, id, kind, rect: { x, y, width: w, height: h } });

describe('dropTarget', () => {
  const zones = [z('shelf:a', 'shelf', 0, 100, 300, 150, 'a'), z('shelf:unshelved', 'shelf', 0, 260, 300, 150, null), z('bin', 'bin', 110, 380, 80, 60, null)];
  it('finds the shelf under the finger', () => {
    expect(dropTarget({ x: 50, y: 120 }, zones)?.key).toBe('shelf:a');
    expect(dropTarget({ x: 50, y: 300 }, zones)?.id).toBeNull();
  });
  it('prefers the bin where it overlaps a shelf', () => {
    expect(dropTarget({ x: 150, y: 400 }, zones)?.kind).toBe('bin');
  });
  it('returns null in gaps and outside', () => {
    expect(dropTarget({ x: 50, y: 255 }, zones)).toBeNull();
    expect(dropTarget({ x: 500, y: 120 }, zones)).toBeNull();
  });
});
