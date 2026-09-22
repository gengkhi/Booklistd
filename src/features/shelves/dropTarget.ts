export interface DropZone {
  key: string; // 'bin' | 'shelf:<id>' | 'shelf:unshelved'
  id: string | null; // shelf id; null = Unshelved (or the bin)
  kind: 'shelf' | 'bin';
  rect: { x: number; y: number; width: number; height: number }; // window coordinates
}

/** The zone under the finger; the bin wins where it overlaps a shelf. Runs on the UI thread. */
export function dropTarget(point: { x: number; y: number }, zones: DropZone[]): DropZone | null {
  'worklet';
  let hit: DropZone | null = null;
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    const r = z.rect;
    if (point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height) {
      if (z.kind === 'bin') return z;
      if (!hit) hit = z;
    }
  }
  return hit;
}
