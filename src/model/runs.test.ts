import { describe, expect, it } from "vitest";
import { balancedSplit, fitsBed, maxLengthOnBed, printerFor } from "./printers";
import { maxSegmentCells, segmentsFor } from "./runs";
import { cutLines, checkBoard, resolve } from "./geometry";
import { buildExportPlan, partsCsv } from "../render/plan";
import { defaultParams, generatorById } from "./library";
import type { Board, PartType } from "./types";

const env0 = { leftMm: 0, rightMm: 0, topMm: 0, bottomMm: 0, depthMm: 0 };
const part = (id: string, gen: string, over = {}): PartType => {
  const g = generatorById(gen)!;
  return { id, name: g.name, category: g.category, color: g.color, generatorId: gen, params: { ...defaultParams(g), ...over }, envelope: env0 };
};
const board = (pts: string[], printer?: Board["printer"]): Board => ({
  id: "b", name: "t", widthCells: 21, heightCells: 60, pitchMm: 28,
  tile: { widthCells: 7, heightCells: 7, variant: "Full" },
  printer,
  placements: pts.map((pt, i) => ({ id: `p${i}`, partTypeId: pt, x: i * 2, y: 0, rotation: 0 })),
});

describe("printers", () => {
  it("defaults to the X2D", () => {
    expect(printerFor(undefined)).toMatchObject({ id: "bambu-x2d", bed: { x: 256, y: 256, z: 260 } });
  });
  it("custom size", () => {
    expect(printerFor({ id: "custom", bed: { x: 200, y: 150, z: 100 } }).bed).toEqual({ x: 200, y: 150, z: 100 });
  });
  it("fits either way round, inside the edge margin", () => {
    const bed = { x: 250, y: 210, z: 220 };
    expect(fitsBed(bed, 200, 248)).toBe(true);
    expect(fitsBed(bed, 249, 200)).toBe(false);
  });
  it("diagonal gives a longer straight", () => {
    const bed = { x: 256, y: 256, z: 256 };
    expect(maxLengthOnBed(bed, 26.4)).toBeCloseTo(254);
    const d = maxLengthOnBed(bed, 26.4, true);
    // Corner to corner of the usable 254 mm square, less the width.
    expect(d).toBeGreaterThan(330);
    expect(d).toBeLessThan(254 * Math.SQRT2 - 26.4 + 0.5);
  });
  it("splits evenly into the fewest pieces", () => {
    expect(balancedSplit(30, 9)).toEqual([8, 8, 7, 7]);
    expect(balancedSplit(9, 9)).toEqual([9]);
    expect(balancedSplit(60, 9)).toEqual([9, 9, 9, 9, 8, 8, 8]);
    expect(balancedSplit(0, 9)).toEqual([]);
  });
});

describe("long runs", () => {
  it("X2D fits 9-cell straights (252 mm), 11 corner to corner", () => {
    expect(maxSegmentCells(board([]), part("a", "mk-i"))).toBe(9);
    expect(maxSegmentCells(board([], { id: "bambu-x2d", diagonal: true }), part("a", "mk-i"))).toBe(11);
    expect(maxSegmentCells(board([], { id: "bambu-a1-mini" }), part("a", "og-straight"))).toBe(6);
  });
  it("cuts a 30-cell run and leaves short ones whole", () => {
    expect(segmentsFor(board([]), part("a", "mk-i", { Channel_Length_Units: 30 }))).toEqual([8, 8, 7, 7]);
    expect(segmentsFor(board([]), part("a", "mk-i", { Channel_Length_Units: 5 }))).toEqual([5]);
    expect(segmentsFor(board([]), part("a", "mk-l"))).toBeNull();
  });
  it("export renders each segment length once with the right count", () => {
    const pts = [part("a", "mk-i", { Channel_Length_Units: 30 }), part("b", "og-straight", { Length_Units: 20 })];
    const plan = buildExportPlan(board(["a", "a", "b"]), pts);
    const byLen = plan.jobs.map((j) => [j.scadPath.split("/")[1], j.defines.Channel_Length_Units ?? j.defines.Length_Units, j.quantity]);
    expect(byLen).toEqual([
      ["Monokini", 8, 4],
      ["Monokini", 7, 4],
      ["openGridUnderware", 7, 2],
      ["openGridUnderware", 6, 1],
    ]);
    expect(plan.runs).toHaveLength(2);
    expect(partsCsv(plan)).toContain("run of 30 cells, printed as 8 + 8 + 7 + 7");
  });
  it("two-piece channels split base and top alike", () => {
    const plan = buildExportPlan(board(["a"]), [part("a", "uw-i", { Channel_Length_Units: 12 })]);
    expect(plan.jobs.map((j) => [j.piece, j.defines.Channel_Length_Units, j.quantity])).toEqual([
      ["Base", 6, 2],
      ["Top", 6, 2],
    ]);
  });
  it("draws cuts across the run, from the far end when turned around", () => {
    expect(cutLines([8, 7], 0, 0, 1, 15, 0, 28)).toEqual([[[0, 224], [28, 224]]]);
    expect(cutLines([8, 7], 0, 0, 1, 15, 180, 28)).toEqual([[[0, 196], [28, 196]]]);
    expect(cutLines([8, 7], 2, 3, 15, 1, 90, 28)).toEqual([[[280, 84], [280, 112]]]);
  });
  it("flags a part too big for the bed", () => {
    const pts = [part("x", "mk-x", { X_Channel_Length_in_Units_X_Axis_Left: 8, X_Channel_Length_in_Units_X_Axis_Right: 8 })];
    const b = board(["x"]);
    const issues = checkBoard(b, pts);
    expect(issues.some((i) => i.kind === "too-big-for-bed")).toBe(true);
    // A long straight is cut, so it's fine.
    const s = [part("s", "mk-i", { Channel_Length_Units: 40 })];
    expect(checkBoard(board(["s"]), s).some((i) => i.kind === "too-big-for-bed")).toBe(false);
    expect(resolve(board(["s"]), s)[0].cuts).toHaveLength(4);
  });
});
