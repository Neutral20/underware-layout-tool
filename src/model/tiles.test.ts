import { describe, expect, it } from "vitest";
import { connectorCount, fitSpace, oversizeTiles, seams, tileCounts, tileLayout } from "./tiles";
import { buildExportPlan, partsCsv } from "../render/plan";
import type { Board, TileSpec } from "./types";

const board = (w: number, h: number, tile: Partial<TileSpec> = {}, printer?: Board["printer"]): Board => ({
  id: "b", name: "t", widthCells: w, heightCells: h, pitchMm: 28,
  tile: { widthCells: 7, heightCells: 7, variant: "Full", ...tile },
  printer,
  placements: [],
});

describe("tiles", () => {
  it("older layouts keep fixed 7x7 tiles with a short last row", () => {
    const l = tileLayout(board(21, 60));
    expect(l.cols).toEqual([7, 7, 7]);
    expect(l.rows).toEqual([7, 7, 7, 7, 7, 7, 7, 7, 4]);
    expect(seams(l)).toEqual({ x: [7, 14], y: [7, 14, 21, 28, 35, 42, 49, 56] });
  });
  it("printer mode uses the biggest tiles the bed takes, evenly", () => {
    const l = tileLayout(board(21, 60, { mode: "printer" }));
    expect(l.cols).toEqual([7, 7, 7]);
    expect(l.rows).toEqual([9, 9, 9, 9, 8, 8, 8]);
    expect(tileCounts(l)).toEqual([
      { w: 9, h: 7, quantity: 12 },
      { w: 8, h: 7, quantity: 9 },
    ]);
    // Smaller bed, smaller tiles.
    expect(tileLayout(board(21, 21, { mode: "printer" }, { id: "bambu-a1-mini" })).cols).toEqual([6, 5, 5, 5]);
  });
  it("counts k - 1 connectors per seam of k cells", () => {
    // 2x1 tiles of 7x7: one seam of 7 cells.
    expect(connectorCount({ cols: [7, 7], rows: [7] })).toBe(6);
    // 2x2 of 7x7: two vertical seams of 7, two horizontal of 7.
    expect(connectorCount({ cols: [7, 7], rows: [7, 7] })).toBe(24);
    expect(connectorCount({ cols: [9], rows: [9] })).toBe(0);
  });
  it("flags fixed tiles too big for the bed", () => {
    expect(oversizeTiles(board(20, 20, { widthCells: 10, heightCells: 10 }))).toHaveLength(1);
    expect(oversizeTiles(board(20, 20, { widthCells: 9, heightCells: 9 }))).toHaveLength(0);
  });
  it("sizes the board from a space in mm", () => {
    expect(fitSpace(600, 1700, 28)).toEqual({ widthCells: 21, heightCells: 60, spareX: 12, spareY: 20 });
  });
  it("exports one render per tile size with the openGrid generator", () => {
    const plan = buildExportPlan(board(21, 60, { mode: "printer", export: true }), []);
    expect(plan.jobs.map((j) => [j.fileName, j.defines.Board_Width, j.defines.Board_Height])).toEqual([
      ["opengrid-tile_9x7-full_x12.stl", 9, 7],
      ["opengrid-tile_8x7-full_x9.stl", 8, 7],
    ]);
    expect(plan.jobs[0].defines).toMatchObject({ Full_or_Lite: "Full", Screw_Mounting: "Corners", Tile_Size: 28 });
    expect(plan.connectors).toBe(2 * 53 + 6 * 18);
    expect(partsCsv(plan)).toContain("openGrid connector");
    // Off unless asked, and never for Multiboard.
    expect(buildExportPlan(board(21, 60), []).jobs).toHaveLength(0);
    expect(buildExportPlan({ ...board(21, 60, { export: true }), pitchMm: 25 }, []).jobs).toHaveLength(0);
  });
});
