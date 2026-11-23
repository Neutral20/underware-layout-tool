// Long straight runs. A straight can be drawn any length on the board; for
// printing it's cut into segments that fit the printer's bed.
//
// How segments join: none of the straights have a joint of their own.
// David D's clip-on straights are literally a 1-cell piece repeated every
// 28 mm, Monokini's straights end flush on a cell line, and the QuackWorks
// I channel's base and top are plain boxes along their length. Every
// segment clips (or snaps or screws) to the grid on its own, so the grid
// holds the run in line. Segments are therefore butt-jointed on cell
// boundaries: no connector to print, and a cut never lands mid-cell.

import { generatorById } from "./library";
import { maxLengthOnBed, balancedSplit, printerFor } from "./printers";
import type { Board, ParamValue, PartType } from "./types";

export interface RunSpec {
  /** Param that holds the length in cells. */
  lengthParam: string;
  /** Width of the printed piece across the run, in mm. */
  widthMm(p: Record<string, ParamValue>, pitch: number): number;
}

const cells = (v: ParamValue | undefined, d = 1) => Math.max(1, Math.round(Number(v ?? d)) || d);

export const RUNS: Record<string, RunSpec> = {
  // Monokini: walls sit 0.8 mm inside the cells (26.4 mm for 1 cell).
  "mk-i": { lengthParam: "Channel_Length_Units", widthMm: (p, pitch) => cells(p.Channel_Width_in_Units) * pitch - 1.6 },
  "og-straight": { lengthParam: "Length_Units", widthMm: () => 26.4 },
  // QuackWorks base is a whole number of cells wide; allow a hair for the flare.
  "uw-i": { lengthParam: "Channel_Length_Units", widthMm: (p, pitch) => cells(p.Channel_Width_in_Units) * pitch + 1 },
};

/** Longest a run can be drawn, in cells. */
export const MAX_RUN_CELLS = 400;

export const runSpec = (pt: PartType): RunSpec | undefined => (pt.generatorId ? RUNS[pt.generatorId] : undefined);

export const runLength = (pt: PartType): number => {
  const r = runSpec(pt);
  return r ? cells(pt.params[r.lengthParam], 5) : 0;
};

/** Most cells one printed segment can have on this board's printer (0: too wide for the bed). */
export function maxSegmentCells(board: Board, pt: PartType): number {
  const r = runSpec(pt);
  if (!r) return 0;
  const { bed } = printerFor(board.printer);
  const pitch = board.pitchMm;
  // A straight of n cells is n pitches long (Monokini adds 0.01 mm).
  const len = maxLengthOnBed(bed, r.widthMm(pt.params, pitch), !!board.printer?.diagonal);
  return Math.floor((len - 0.05) / pitch);
}

/**
 * Segment lengths (cells) a straight prints as, longest first, or null if
 * the part isn't a straight. One entry means it prints whole.
 */
export function segmentsFor(board: Board, pt: PartType): number[] | null {
  const r = runSpec(pt);
  if (!r || !generatorById(pt.generatorId)) return null;
  const n = runLength(pt);
  const max = maxSegmentCells(board, pt);
  // Too wide for the bed at all: leave it whole; the bed check reports it.
  if (max < 1) return [n];
  return balancedSplit(n, max);
}

/** The part type one segment of a run prints as. */
export function segmentPart(pt: PartType, len: number): PartType {
  const r = runSpec(pt)!;
  return { ...pt, params: { ...pt.params, [r.lengthParam]: len } };
}
