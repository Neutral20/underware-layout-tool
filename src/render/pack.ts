// Packs printed pieces onto build plates. Pure, so it can be unit tested.
//
// MaxRects (best short side fit), pieces sorted biggest first, each piece
// may be turned 90°. A piece that only fits corner to corner (a long
// straight cut for a diagonal bed) gets a plate of its own, laid on the
// diagonal.

export interface PackItem {
  id: string;
  /** Footprint on the bed in mm, as rendered. */
  w: number;
  h: number;
}

export interface Placed {
  id: string;
  /** Lower-left corner of the footprint on the plate, in mm from the usable area's corner. */
  x: number;
  y: number;
  /** Footprint after turning. */
  w: number;
  h: number;
  /** Turned 90° counter-clockwise. */
  rotated: boolean;
  /** Laid at this angle (radians) around the plate centre instead (diagonal pieces only). */
  angle?: number;
}

export interface Plate {
  items: Placed[];
}

export interface PackResult {
  plates: Plate[];
  /** Pieces that don't fit the bed at all. */
  tooBig: string[];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const EPS = 1e-6;

class Bin {
  free: Rect[];
  items: Placed[] = [];
  constructor(public W: number, public H: number) {
    this.free = [{ x: 0, y: 0, w: W, h: H }];
  }

  /** Best spot for a w x h rect (either way round), or null. */
  find(w: number, h: number): { r: Rect; rotated: boolean; score: [number, number] } | null {
    let best: { r: Rect; rotated: boolean; score: [number, number] } | null = null;
    for (const f of this.free) {
      for (const rotated of [false, true]) {
        const [rw, rh] = rotated ? [h, w] : [w, h];
        if (rw > f.w + EPS || rh > f.h + EPS) continue;
        const a = Math.min(f.w - rw, f.h - rh), b = Math.max(f.w - rw, f.h - rh);
        if (!best || a < best.score[0] - EPS || (Math.abs(a - best.score[0]) < EPS && b < best.score[1])) {
          best = { r: { x: f.x, y: f.y, w: rw, h: rh }, rotated, score: [a, b] };
        }
      }
    }
    return best;
  }

  place(r: Rect) {
    const next: Rect[] = [];
    for (const f of this.free) {
      if (r.x >= f.x + f.w - EPS || r.x + r.w <= f.x + EPS || r.y >= f.y + f.h - EPS || r.y + r.h <= f.y + EPS) {
        next.push(f);
        continue;
      }
      // Split the free rect around the placed one.
      if (r.x > f.x + EPS) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
      if (r.x + r.w < f.x + f.w - EPS) next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - r.x - r.w, h: f.h });
      if (r.y > f.y + EPS) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
      if (r.y + r.h < f.y + f.h - EPS) next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - r.y - r.h });
    }
    // Drop free rects contained in another.
    this.free = next.filter(
      (a, i) => !next.some((b, j) => j !== i && a.x >= b.x - EPS && a.y >= b.y - EPS && a.x + a.w <= b.x + b.w + EPS && a.y + a.h <= b.y + b.h + EPS && (j < i || a.w * a.h < b.w * b.h - EPS)),
    );
  }
}

/** Angle that fits a w x h piece (w <= h) on a W x H bed corner to corner, or null. */
export function diagonalAngle(w: number, h: number, W: number, H: number): number | null {
  for (let i = 1; i < 900; i++) {
    const t = (i / 900) * (Math.PI / 2);
    const c = Math.cos(t), s = Math.sin(t);
    // Footprint of the turned rectangle (long side h along the angle).
    if (h * c + w * s <= W + EPS && h * s + w * c <= H + EPS) return t;
  }
  return null;
}

/**
 * Pack pieces onto as few W x H plates as the heuristic manages, keeping
 * `gap` mm between pieces.
 */
export function pack(items: PackItem[], W: number, H: number, gap = 4): PackResult {
  const order = [...items].sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h || a.id.localeCompare(b.id));
  const bins: Bin[] = [];
  const plates: Plate[] = [];
  const binPlate = new Map<Bin, Plate>();
  const tooBig: string[] = [];
  // Inflate each piece and the bin by the gap, so pieces end up gap apart and flush to the edges.
  const BW = W + gap, BH = H + gap;

  for (const it of order) {
    const w = it.w + gap, h = it.h + gap;
    const fitsFlat = (w <= BW + EPS && h <= BH + EPS) || (h <= BW + EPS && w <= BH + EPS);
    if (!fitsFlat) {
      const [a, b] = it.w <= it.h ? [it.w, it.h] : [it.h, it.w];
      const t = diagonalAngle(a, b, W, H);
      if (t === null) {
        tooBig.push(it.id);
        continue;
      }
      plates.push({ items: [{ id: it.id, x: 0, y: 0, w: it.w, h: it.h, rotated: false, angle: it.w <= it.h ? t - Math.PI / 2 : t }] });
      continue;
    }
    let placed = false;
    for (const bin of bins) {
      const spot = bin.find(w, h);
      if (!spot) continue;
      bin.place(spot.r);
      binPlate.get(bin)!.items.push({ id: it.id, x: spot.r.x, y: spot.r.y, w: spot.r.w - gap, h: spot.r.h - gap, rotated: spot.rotated });
      placed = true;
      break;
    }
    if (!placed) {
      const bin = new Bin(BW, BH);
      const plate: Plate = { items: [] };
      bins.push(bin);
      plates.push(plate);
      binPlate.set(bin, plate);
      const spot = bin.find(w, h)!;
      bin.place(spot.r);
      plate.items.push({ id: it.id, x: spot.r.x, y: spot.r.y, w: spot.r.w - gap, h: spot.r.h - gap, rotated: spot.rotated });
    }
  }
  // Fullest plates first reads better; diagonal plates last.
  plates.sort((a, b) => Number(!!a.items[0]?.angle) - Number(!!b.items[0]?.angle));
  return { plates, tooBig };
}
