import fs from "node:fs";
import { checkBoard, resolve } from "./geometry";
import { defaultParams, generatorById } from "./library";
import { fitOffset, outlineArea, outlineFromStl, outlineFromTriangles, overlap, placeLoops, type Outline, type Pt } from "./outline";
import type { Board, PartType, Placement } from "./types";

const piece = (id: string): Outline => {
  const b = fs.readFileSync(`public/scad/openGridUnderware/pieces/${id}.stl`);
  return outlineFromStl(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)!;
};

describe("outlineFromTriangles", () => {
  it("traces the union of triangles as one L-shaped loop", () => {
    // Three 10 mm squares in an L, each as two triangles.
    const sq = (x: number, y: number) => [x, y, x + 10, y, x + 10, y + 10, x, y, x + 10, y + 10, x, y + 10];
    const o = outlineFromTriangles([...sq(0, 0), ...sq(0, 10), ...sq(10, 10)], [0, 0, 20, 20], 5)!;
    expect(o.loops).toHaveLength(1);
    expect(o.loops[0]).toHaveLength(6);
    expect(outlineArea(o.loops)).toBeCloseTo(300, 0);
    expect(o.sizeMm).toEqual([20, 20, 5]);
  });
});

describe("clip-on piece outlines", () => {
  it("a radius-1 curve is an L with a rounded outside, not its 2x2 box", () => {
    const o = piece("curve-1");
    expect(o.sizeMm).toEqual([55.2, 55.2, 22]);
    const box = 55.2 * 55.2;
    const area = outlineArea(o.loops);
    // Missing the inner corner cell and the rounded outer corner.
    expect(area).toBeLessThan(box * 0.75);
    expect(area).toBeGreaterThan(box * 0.55);
  });

  it("sits its walls 0.8 mm inside the cells and its ends on the cell lines", () => {
    expect(fitOffset(piece("curve-1"), 2, 2, 28)).toEqual([0.8, 0.8]);
    expect(fitOffset(piece("straight-1"), 1, 1, 28)).toEqual([0.8, 0]);
    expect(fitOffset(piece("t"), 2, 3, 28)).toEqual([0, 0]);
  });
});

describe("placeLoops", () => {
  it("rotates clockwise about the mount, like the mount rectangle", () => {
    // A 10 x 20 box at the top-left of a 1 x 2 cell mount, rotated 90°: the mount becomes 2 x 1.
    const loop: Pt[] = [[0, 0], [10, 0], [10, 20], [0, 20]];
    const [r] = placeLoops([loop], [0, 0], 28, 56, 90, [100, 200]);
    const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
    // Left edge of the part ends up along the top, against the right of the 56 mm wide mount.
    expect(Math.min(...xs)).toBe(100 + 56 - 20);
    expect(Math.max(...xs)).toBe(156);
    expect(Math.min(...ys)).toBe(200);
    expect(Math.max(...ys)).toBe(210);
  });
});

describe("overlap", () => {
  const rect = (x0: number, y0: number, x1: number, y1: number): Pt[][] => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]];
  it("counts touching edges as no overlap", () => {
    expect(overlap(rect(0, 0, 10, 10), rect(10, 0, 20, 10)).depthMm).toBe(0);
  });
  it("measures a real overlap by its thickness", () => {
    const o = overlap(rect(0, 0, 10, 10), rect(7, 2, 20, 30));
    expect(o.depthMm).toBeCloseTo(3, 0);
    expect(o.areaMm2).toBeCloseTo(24, 0);
  });
});

describe("checkBoard with real shapes", () => {
  const board = (placements: Placement[]): Board => ({
    id: "b",
    name: "t",
    widthCells: 10,
    heightCells: 10,
    pitchMm: 28,
    tile: { widthCells: 7, heightCells: 7, variant: "Full" },
    placements,
  });
  const og = (id: string, pieceId: string): PartType => {
    const g = generatorById("og-piece")!;
    return { id, name: pieceId, category: g.category, color: "#000", generatorId: g.id, params: { ...defaultParams(g), Piece: pieceId }, envelope: { leftMm: 0, rightMm: 0, topMm: 0, bottomMm: 0, depthMm: 0 } };
  };
  const straight: PartType = {
    id: "s",
    name: "straight",
    category: "underware-channel",
    color: "#000",
    generatorId: "og-straight",
    params: { Length_Units: 1 },
    envelope: { leftMm: 0, rightMm: 0, topMm: 0, bottomMm: 0, depthMm: 0 },
  };
  const outlines = new Map<string, Outline>([
    ["c", piece("curve-1")],
    ["s", piece("straight-1")],
    ["br", piece("bridge-open")],
  ]);
  const lookup = (pt: PartType) => outlines.get(pt.id);
  const types = [og("c", "curve-1"), straight, og("br", "bridge-open")];
  const at = (id: string, partTypeId: string, x: number, y: number, rotation: Placement["rotation"] = 0): Placement => ({ id, partTypeId, x, y, rotation });

  it("lets a part sit in the empty corner of a curve's box", () => {
    // The curve's open cell is bottom-right of its 2x2 box.
    const b = board([at("c", "c", 2, 2), at("s", "s", 3, 3)]);
    expect(checkBoard(b, types, lookup)).toEqual([]);
    // Without real shapes the same layout is a mount overlap.
    expect(checkBoard(b, types).map((i) => i.kind)).toEqual(["mount-overlap"]);
  });

  it("flags a part that hits the curve itself", () => {
    const issues = checkBoard(board([at("c", "c", 2, 2), at("s", "s", 2, 3)]), types, lookup);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", kind: "mount-overlap" });
    expect(issues[0].detail).toContain("parts collide");
  });

  it("treats pieces that join end to end as touching, not colliding", () => {
    // Straight below the curve's downward leg (left column), and one right of its arm.
    expect(checkBoard(board([at("c", "c", 2, 2), at("s1", "s", 2, 4), at("s2", "s", 4, 2, 90)]), types, lookup)).toEqual([]);
  });

  it("lets a bridge pass over a channel", () => {
    expect(checkBoard(board([at("br", "br", 0, 0), at("s", "s", 0, 1, 90)]), types, lookup)).toEqual([]);
  });

  it("reports the real size, swapped by rotation", () => {
    const [r] = resolve(board([at("s", "s", 0, 0, 90)]), types, lookup);
    expect(r.sizeMm).toEqual([28, 26.4, 22]);
    expect(r.shapeKind).toBe("measured");
  });
});
