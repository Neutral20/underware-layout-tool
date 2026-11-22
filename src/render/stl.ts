// Bounding box of a binary STL, for checking a part's footprint against a real render.

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
}

export function stlBounds(buf: ArrayBuffer): Bounds | null {
  if (buf.byteLength < 84) return null;
  const v = new DataView(buf);
  const n = v.getUint32(80, true);
  if (n === 0 || 84 + n * 50 > buf.byteLength) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12; // skip the normal
    for (let k = 0; k < 9; k++) {
      const c = v.getFloat32(o + k * 4, true);
      const a = k % 3;
      if (c < min[a]) min[a] = c;
      if (c > max[a]) max[a] = c;
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}
