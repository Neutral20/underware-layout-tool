// Board tiles. The board is printed as a grid of openGrid tiles, made by
// BlackjackDuck's openGrid tile generator (openGrid design by David D).
//
// Two ways to size them:
// - "printer": the biggest tiles the printer's bed takes, split as evenly
//   as possible (a 60-cell board on a 256 mm bed: 9,9,9,9,8,8,8).
// - "fixed": tiles of a set size, with a smaller tile at the end where
//   the board doesn't divide evenly (21 x 60 in 7s: three columns of 7,
//   rows of 7 and a last row of 4).
//
// Tiles line up in rows and columns, so every seam runs the full board.
// Each tile edge has a connector hole on every inner cell line (k - 1
// holes on a k-cell edge), so a seam of k cells takes k - 1 connectors.

import { balancedSplit, printerFor, usableBed } from "./printers";
import type { Board } from "./types";

export type TileVariant = "Full" | "Lite" | "Heavy";
export type ScrewMounting = "Corners" | "Everywhere" | "None";

export interface TileLayout {
  /** Tile widths left to right, and heights top to bottom, in cells. */
  cols: number[];
  rows: number[];
}

const fixedSplit = (n: number, size: number) => {
  if (size < 1) return [n];
  const out = Array(Math.floor(n / size)).fill(size);
  if (n % size) out.push(n % size);
  return out;
};

/** Most cells a tile can have each way on the board's printer. */
export function maxTileCells(board: Board): [number, number] {
  const u = usableBed(printerFor(board.printer).bed);
  const p = board.pitchMm;
  // Square-ish beds: the tile can be turned, so use the larger count both ways
  // only when both fit. Keep it simple and safe: each axis on its own.
  return [Math.max(1, Math.floor(u.x / p + 1e-6)), Math.max(1, Math.floor(u.y / p + 1e-6))];
}

export function tileLayout(board: Board): TileLayout {
  const t = board.tile;
  if (t.mode === "printer") {
    const [mx, my] = maxTileCells(board);
    return { cols: balancedSplit(board.widthCells, mx), rows: balancedSplit(board.heightCells, my) };
  }
  // Fixed size 0 means "no seams": one tile.
  return { cols: fixedSplit(board.widthCells, t.widthCells), rows: fixedSplit(board.heightCells, t.heightCells) };
}

/** Seam positions (cells from the left / top) between tiles. */
export function seams(l: TileLayout): { x: number[]; y: number[] } {
  const acc = (a: number[]) => a.slice(0, -1).map((_, i) => a.slice(0, i + 1).reduce((s, n) => s + n, 0));
  return { x: acc(l.cols), y: acc(l.rows) };
}

export interface TileCount {
  w: number;
  h: number;
  quantity: number;
}

/** Each distinct tile size and how many of it, biggest first. */
export function tileCounts(l: TileLayout): TileCount[] {
  const m = new Map<string, TileCount>();
  for (const h of l.rows)
    for (const w of l.cols) {
      // A tile turned 90° is the same print.
      const [a, b] = w >= h ? [w, h] : [h, w];
      const k = `${a}x${b}`;
      const c = m.get(k) ?? { w: a, h: b, quantity: 0 };
      c.quantity++;
      m.set(k, c);
    }
  return [...m.values()].sort((p, q) => q.w * q.h - p.w * p.h || q.quantity - p.quantity);
}

/** Connectors to join the tiles: k - 1 per seam of k cells. */
export function connectorCount(l: TileLayout): number {
  const inner = (a: number[]) => a.reduce((s, n) => s + n - 1, 0);
  return (l.cols.length - 1) * inner(l.rows) + (l.rows.length - 1) * inner(l.cols);
}

/** Thickness of a tile in mm, for the height check. */
export const tileThickness = (v: TileVariant) => (v === "Lite" ? 4 : v === "Heavy" ? 13.8 : 6.8);

/** Tiles that don't fit the bed (fixed-size mode can ask for too much). */
export function oversizeTiles(board: Board, l = tileLayout(board)): TileCount[] {
  const [mx, my] = maxTileCells(board);
  return tileCounts(l).filter((t) => !((t.w <= mx && t.h <= my) || (t.h <= mx && t.w <= my)));
}

/** Board size in cells for a space in mm, and what's left over each way. */
export function fitSpace(wMm: number, hMm: number, pitch: number) {
  const w = Math.max(1, Math.floor(wMm / pitch + 1e-6)), h = Math.max(1, Math.floor(hMm / pitch + 1e-6));
  return { widthCells: w, heightCells: h, spareX: Math.max(0, wMm - w * pitch), spareY: Math.max(0, hMm - h * pitch) };
}
