// A part's real top-down shape, taken from its rendered mesh.
//
// The mesh is projected onto the board (seen from the side the parts are on,
// i.e. a slicer's top view of a part printed mounting-face down), rasterised
// at a fine resolution, traced back into polygons and simplified. Everything
// here is plain math with no imports, so the build script that pre-computes
// outlines can use it too.

export type Pt = [number, number];

/** A part's silhouette in mm, x right and y down, with its bounding box starting at 0,0. */
export interface Outline {
  /** Closed loops. Outer loops and holes together; fill with the even-odd rule. */
  loops: Pt[][];
  /** Bounding box size on the board: [across, down, height off the board]. */
  sizeMm: [number, number, number];
}

/**
 * Which mesh axes lie on the board: "xy" for parts printed flat (channels),
 * "xz" for parts printed standing on their backer (item holders).
 */
export type BoardAxes = "xy" | "xz";

const RES_MM = 0.2;
const MAX_PIXELS = 4_000_000;

/** Project a binary STL onto the board and trace its outline. Null for an empty mesh. */
export function outlineFromStl(buf: ArrayBuffer, axes: BoardAxes = "xy"): Outline | null {
  if (buf.byteLength < 84) return null;
  const v = new DataView(buf);
  const n = v.getUint32(80, true);
  if (n === 0 || 84 + n * 50 > buf.byteLength) return null;
  const tris = new Float64Array(n * 6);
  const ax = 0, ay = axes === "xz" ? 2 : 1, ah = axes === "xz" ? 1 : 2;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, h0 = Infinity, h1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12;
    for (let k = 0; k < 3; k++) {
      const c = [v.getFloat32(o + k * 12, true), v.getFloat32(o + k * 12 + 4, true), v.getFloat32(o + k * 12 + 8, true)];
      // Screen y points down, mesh y (or z) points up.
      const sx = c[ax], sy = -c[ay];
      tris[i * 6 + k * 2] = sx;
      tris[i * 6 + k * 2 + 1] = sy;
      if (sx < x0) x0 = sx;
      if (sx > x1) x1 = sx;
      if (sy < y0) y0 = sy;
      if (sy > y1) y1 = sy;
      if (c[ah] < h0) h0 = c[ah];
      if (c[ah] > h1) h1 = c[ah];
    }
  }
  return outlineFromTriangles(tris, [x0, y0, x1, y1], h1 - h0);
}

/** Trace the union of 2D triangles (flat array of x,y triples). */
export function outlineFromTriangles(tris: Float64Array | number[], box: [number, number, number, number], heightMm: number): Outline | null {
  const [x0, y0, x1, y1] = box;
  const wMm = x1 - x0, hMm = y1 - y0;
  if (!(wMm > 0 && hMm > 0)) return null;
  let res = RES_MM;
  while ((wMm / res) * (hMm / res) > MAX_PIXELS) res *= 1.5;
  const W = Math.ceil(wMm / res - 1e-6), H = Math.ceil(hMm / res - 1e-6);
  const grid = new Uint8Array(W * H);

  for (let t = 0; t + 5 < tris.length; t += 6) {
    const ax = tris[t] - x0, ay = tris[t + 1] - y0;
    const bx = tris[t + 2] - x0, by = tris[t + 3] - y0;
    const cx = tris[t + 4] - x0, cy = tris[t + 5] - y0;
    // Walls project to slivers with no area; they add nothing.
    if (Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) < 1e-9) continue;
    const jMin = Math.max(0, Math.ceil(Math.min(ay, by, cy) / res - 0.5));
    const jMax = Math.min(H - 1, Math.floor(Math.max(ay, by, cy) / res - 0.5));
    const edges: [number, number, number, number][] = [
      [ax, ay, bx, by],
      [bx, by, cx, cy],
      [cx, cy, ax, ay],
    ];
    for (let j = jMin; j <= jMax; j++) {
      const yc = (j + 0.5) * res;
      let lo = Infinity, hi = -Infinity;
      for (const [px, py, qx, qy] of edges) {
        if ((py <= yc && qy >= yc) || (qy <= yc && py >= yc)) {
          if (py === qy) {
            lo = Math.min(lo, px, qx);
            hi = Math.max(hi, px, qx);
          } else {
            const x = px + ((yc - py) / (qy - py)) * (qx - px);
            lo = Math.min(lo, x);
            hi = Math.max(hi, x);
          }
        }
      }
      if (!(hi >= lo)) continue;
      const iMin = Math.max(0, Math.ceil(lo / res - 0.5 - 1e-9));
      const iMax = Math.min(W - 1, Math.floor(hi / res - 0.5 + 1e-9));
      grid.fill(1, j * W + iMin, j * W + iMax + 1);
    }
  }

  const loops = traceGrid(grid, W, H)
    .map((loop) => simplifyClosed(loop, 0.75).map(([i, j]) => [round2(i * res), round2(j * res)] as Pt))
    .filter((l) => l.length >= 3 && Math.abs(signedArea(l)) >= 1);
  if (!loops.length) return null;
  return { loops, sizeMm: [round2(wMm), round2(hMm), round2(heightMm)] };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Boundary loops of the filled pixels, in pixel-corner coordinates. Diagonal touches stay separate. */
function traceGrid(g: Uint8Array, W: number, H: number): Pt[][] {
  const filled = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < H && g[j * W + i] === 1;
  // Directed boundary edges, filled pixel on the right when walking (screen
  // coordinates, y down): top edge runs left to right, and so on.
  const out = new Map<number, number[]>(); // vertex -> edge ids
  const ex: number[] = [], ey: number[] = [], dx: number[] = [], dy: number[] = [];
  const key = (i: number, j: number) => j * (W + 1) + i;
  const add = (i: number, j: number, ddx: number, ddy: number) => {
    const id = ex.length;
    ex.push(i), ey.push(j), dx.push(ddx), dy.push(ddy);
    const k = key(i, j);
    const l = out.get(k);
    if (l) l.push(id);
    else out.set(k, [id]);
  };
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (!filled(i, j)) continue;
      if (!filled(i, j - 1)) add(i, j, 1, 0);
      if (!filled(i + 1, j)) add(i + 1, j, 0, 1);
      if (!filled(i, j + 1)) add(i + 1, j + 1, -1, 0);
      if (!filled(i - 1, j)) add(i, j + 1, 0, -1);
    }
  }
  const used = new Uint8Array(ex.length);
  const loops: Pt[][] = [];
  for (let s = 0; s < ex.length; s++) {
    if (used[s]) continue;
    const loop: Pt[] = [];
    let e = s;
    while (!used[e]) {
      used[e] = 1;
      const i = ex[e], j = ey[e];
      loop.push([i, j]);
      const ni = i + dx[e], nj = j + dy[e];
      const cands = (out.get(key(ni, nj)) ?? []).filter((c) => !used[c]);
      if (!cands.length) break;
      if (cands.length === 1) e = cands[0];
      else {
        // Saddle: turn right (towards the filled side) so diagonal pixels don't merge.
        const right = cands.find((c) => dx[c] === -dy[e] && dy[c] === dx[e]);
        e = right ?? cands[0];
      }
    }
    if (loop.length >= 4) loops.push(dropCollinear(loop));
  }
  return loops;
}

function dropCollinear(l: Pt[]): Pt[] {
  const r: Pt[] = [];
  const n = l.length;
  for (let k = 0; k < n; k++) {
    const a = l[(k + n - 1) % n], b = l[k], c = l[(k + 1) % n];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) r.push(b);
  }
  return r;
}

/** Ramer-Douglas-Peucker on a closed loop, tolerance in the loop's own units. */
function simplifyClosed(l: Pt[], tol: number): Pt[] {
  if (l.length <= 4) return l;
  // Split at the two points farthest apart, simplify each half.
  let a = 0, b = 0, best = -1;
  for (let k = 0; k < l.length; k++) {
    const d = (l[k][0] - l[0][0]) ** 2 + (l[k][1] - l[0][1]) ** 2;
    if (d > best) (best = d), (b = k);
  }
  best = -1;
  for (let k = 0; k < l.length; k++) {
    const d = (l[k][0] - l[b][0]) ** 2 + (l[k][1] - l[b][1]) ** 2;
    if (d > best) (best = d), (a = k);
  }
  const [i, j] = a < b ? [a, b] : [b, a];
  const first = rdp(l.slice(i, j + 1), tol);
  const second = rdp([...l.slice(j), ...l.slice(0, i + 1)], tol);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

function rdp(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let far = 0, idx = 0;
  for (let k = 1; k < pts.length - 1; k++) {
    const d = Math.abs((bx - ax) * (ay - pts[k][1]) - (ax - pts[k][0]) * (by - ay)) / len;
    if (d > far) (far = d), (idx = k);
  }
  if (far <= tol) return [pts[0], pts[pts.length - 1]];
  return [...rdp(pts.slice(0, idx + 1), tol).slice(0, -1), ...rdp(pts.slice(idx), tol)];
}

export function signedArea(l: Pt[]): number {
  let a = 0;
  for (let k = 0; k < l.length; k++) {
    const [x1, y1] = l[k], [x2, y2] = l[(k + 1) % l.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Area of a set of even-odd loops. */
export const outlineArea = (loops: Pt[][]) => Math.abs(loops.reduce((s, l) => s + signedArea(l), 0));

// ---------------------------------------------------------------------------
// Fitting an outline onto its grid cells.

/**
 * Where the outline sits inside its w x h mount cells, as the offset of the
 * outline's bounding box from the mount's top-left corner.
 *
 * Clip-on channels follow the openGrid layout: a channel's side walls sit
 * 0.8 mm inside its cell and its open ends sit on a cell line. So the
 * offset is the one that puts the most straight outline edges on those
 * lines. Parts without that structure (holders) are centred.
 */
export function fitOffset(o: Outline, wCells: number, hCells: number, pitch: number): Pt {
  const [W, H] = o.sizeMm;
  const edges = axisEdges(o.loops);
  return [axisOffset(edges.vertical, W, wCells * pitch, pitch), axisOffset(edges.horizontal, H, hCells * pitch, pitch)];
}

const WALL_INSET_MM = 0.8;

function axisOffset(edges: [number, number][], size: number, span: number, pitch: number): number {
  const centre = Math.round(((span - size) / 2) * 100) / 100;
  // The box has to stay inside the cells; if it can't, centre it.
  if (size > span + 0.1 || !edges.length) return centre;
  const lo = 0, hi = span - size;
  const cands = new Set<number>([centre]);
  for (const [pos] of edges) {
    for (const r of [0, WALL_INSET_MM, -WALL_INSET_MM]) {
      // Offset that puts this edge on a cell line plus r.
      const base = r - pos;
      for (let k = Math.floor((lo - base) / pitch) - 1; k <= Math.ceil((hi - base) / pitch) + 1; k++) {
        const off = base + k * pitch;
        if (off >= lo - 0.1 && off <= hi + 0.1) cands.add(Math.round(off * 100) / 100);
      }
    }
  }
  const score = (off: number) => {
    let s = 0;
    for (const [pos, len] of edges) {
      const m = (((pos + off) % pitch) + pitch) % pitch;
      const d = Math.min(m, pitch - m, Math.abs(m - WALL_INSET_MM), Math.abs(pitch - WALL_INSET_MM - m));
      if (d < 0.25) s += len;
    }
    return s;
  };
  const total = edges.reduce((s, [, l]) => s + l, 0);
  let best = centre, bestScore = score(centre);
  for (const c of cands) {
    const s = score(c);
    if (s > bestScore + 1e-6 || (Math.abs(s - bestScore) < 1e-6 && Math.abs(c - centre) < Math.abs(best - centre))) (best = c), (bestScore = s);
  }
  // Only move off centre for a clear grid match.
  return bestScore - score(centre) > total * 0.1 ? best : centre;
}

/** Straight axis-aligned outline edges longer than 3 mm: [position, length]. */
function axisEdges(loops: Pt[][]) {
  const vertical: [number, number][] = [], horizontal: [number, number][] = [];
  for (const l of loops) {
    for (let k = 0; k < l.length; k++) {
      const [x1, y1] = l[k], [x2, y2] = l[(k + 1) % l.length];
      if (Math.abs(x1 - x2) < 0.01 && Math.abs(y1 - y2) > 3) vertical.push([x1, Math.abs(y1 - y2)]);
      if (Math.abs(y1 - y2) < 0.01 && Math.abs(x1 - x2) > 3) horizontal.push([y1, Math.abs(x1 - x2)]);
    }
  }
  return { vertical, horizontal };
}

// ---------------------------------------------------------------------------
// Placing and comparing shapes on the board.

/**
 * Move an outline onto the board: offset inside the unrotated mount, then
 * rotate clockwise in 90° steps about the mount (the same rule as the mount
 * rectangle), then move to the mount's board position.
 */
export function placeLoops(loops: Pt[][], offset: Pt, wMm: number, hMm: number, rotation: number, originMm: Pt): Pt[][] {
  const steps = ((Math.round(rotation / 90) % 4) + 4) % 4;
  return loops.map((l) =>
    l.map(([x, y]) => {
      let u = x + offset[0], v = y + offset[1], w = wMm, h = hMm;
      for (let s = 0; s < steps; s++) {
        [u, v] = [h - v, u];
        [w, h] = [h, w];
      }
      return [originMm[0] + u, originMm[1] + v] as Pt;
    }),
  );
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function loopsBox(loops: Pt[][]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of loops)
    for (const [x, y] of l) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  return { x0, y0, x1, y1 };
}

export const rectLoop = (b: Box): Pt[] => [
  [b.x0, b.y0],
  [b.x1, b.y0],
  [b.x1, b.y1],
  [b.x0, b.y1],
];

/** Inside intervals of even-odd loops along the line y = c (or x = c when vertical). */
function spans(loops: Pt[][], c: number, vertical: boolean): [number, number][] {
  const xs: number[] = [];
  const a = vertical ? 1 : 0, b = vertical ? 0 : 1;
  for (const l of loops) {
    for (let k = 0; k < l.length; k++) {
      const p = l[k], q = l[(k + 1) % l.length];
      if ((p[b] <= c && q[b] > c) || (q[b] <= c && p[b] > c)) xs.push(p[a] + ((c - p[b]) / (q[b] - p[b])) * (q[a] - p[a]));
    }
  }
  xs.sort((m, n) => m - n);
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < xs.length; k += 2) out.push([xs[k], xs[k + 1]]);
  return out;
}

function intersectSpans(s: [number, number][], t: [number, number][]) {
  let i = 0, j = 0, total = 0, longest = 0;
  while (i < s.length && j < t.length) {
    const lo = Math.max(s[i][0], t[j][0]), hi = Math.min(s[i][1], t[j][1]);
    if (hi > lo) {
      total += hi - lo;
      longest = Math.max(longest, hi - lo);
    }
    if (s[i][1] < t[j][1]) i++;
    else j++;
  }
  return { total, longest };
}

const SCAN_MM = 0.25;

/**
 * How two shapes overlap. `depthMm` is the thickness of the overlap: the
 * longest run through it measured across both axes, whichever is smaller,
 * so a hairline where two parts touch counts as ~0 even if it is long.
 */
export function overlap(a: Pt[][], b: Pt[][], ba = loopsBox(a), bb = loopsBox(b)): { areaMm2: number; depthMm: number } {
  const x0 = Math.max(ba.x0, bb.x0), x1 = Math.min(ba.x1, bb.x1);
  const y0 = Math.max(ba.y0, bb.y0), y1 = Math.min(ba.y1, bb.y1);
  if (x1 - x0 <= 1e-6 || y1 - y0 <= 1e-6) return { areaMm2: 0, depthMm: 0 };
  let area = 0, rowRun = 0, colRun = 0;
  const step = Math.max(SCAN_MM, Math.max(y1 - y0, x1 - x0) / 2000);
  for (let y = y0 + step / 2; y < y1; y += step) {
    const r = intersectSpans(spans(a, y, false), spans(b, y, false));
    area += r.total * step;
    rowRun = Math.max(rowRun, r.longest);
  }
  if (area < 1e-6) return { areaMm2: 0, depthMm: 0 };
  for (let x = x0 + step / 2; x < x1; x += step) colRun = Math.max(colRun, intersectSpans(spans(a, x, true), spans(b, x, true)).longest);
  return { areaMm2: area, depthMm: Math.min(rowRun, colRun) };
}

/** A point well inside the shape, for its label (falls back to the box centre). */
export function labelPoint(loops: Pt[][], box = loopsBox(loops)): Pt {
  let best: Pt = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
  let bestLen = -1;
  const N = 24;
  for (let k = 1; k < N; k++) {
    const y = box.y0 + ((box.y1 - box.y0) * k) / N;
    for (const [lo, hi] of spans(loops, y, false)) {
      // Prefer wide spans near the middle.
      const len = (hi - lo) * (1 - 0.6 * Math.abs(k / N - 0.5));
      if (len > bestLen) (bestLen = len), (best = [(lo + hi) / 2, y]);
    }
  }
  return best;
}

/** SVG path data for even-odd loops. */
export const loopsPath = (loops: Pt[][]) =>
  loops.map((l) => "M" + l.map(([x, y]) => `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`).join("L") + "Z").join("");
