// Core data model. Cells are the unit of truth for positions; mm is used
// only for envelopes (overhang) and for display.

import type { PrinterSetting } from "./printers";

export type Rotation = 0 | 90 | 180 | 270;

export type Category = "underware-channel" | "underware-item" | "holder" | "other";

/** Extra space a part's body takes beyond its mount footprint, per side, in mm. */
export interface Envelope {
  leftMm: number;
  rightMm: number;
  topMm: number;
  bottomMm: number;
  /** Height off the board. Not checked yet; kept for the later depth view. */
  depthMm: number;
}

export interface TileSpec {
  /** Tile size for "fixed" mode. 0 means one tile (no seams). */
  widthCells: number;
  heightCells: number;
  variant: "Full" | "Lite" | "Heavy";
  /** "printer": as big as the printer's bed takes. Missing means "fixed" (older layouts). */
  mode?: "printer" | "fixed";
  /** Screw holes in the tiles (Full and Heavy). Missing means "Corners". */
  screws?: "Corners" | "Everywhere" | "None";
  /** Render the tiles with the export. Missing means no (older layouts). */
  export?: boolean;
}

export interface Board {
  id: string;
  name: string;
  widthCells: number;
  heightCells: number;
  /** Grid pitch in mm. openGrid is 28, Multiboard (stock Underware) is 25. */
  pitchMm: number;
  tile: TileSpec;
  /** How channels attach (see render/mounts.ts). Missing means the default. */
  channelMount?: string;
  /** Printer the parts are cut and packed for. Missing means the default (see printers.ts). */
  printer?: PrinterSetting;
  placements: Placement[];
}

export type ParamValue = number | string | boolean;

export interface PartType {
  id: string;
  name: string;
  category: Category;
  color: string;
  /**
   * Built-in parts reference a generator in the library (see library.ts),
   * and their mount size comes from the generator's params. Custom parts
   * have a fixed mount size.
   */
  generatorId?: string;
  params: Record<string, ParamValue>;
  /** Picker choices (see catalog.ts). Old parts without them are matched by generator. */
  shape?: string;
  connection?: string;
  /** Used only when there's no generator. */
  mount?: { wCells: number; hCells: number };
  envelope: Envelope;
  notes?: string;
}

export interface Placement {
  id: string;
  partTypeId: string;
  /** Top-left mount cell, in board coordinates (x right, y down). */
  x: number;
  y: number;
  rotation: Rotation;
  label?: string;
}

export interface Layout {
  version: 1;
  board: Board;
  partTypes: PartType[];
}

export type IssueKind =
  | "mount-off-board"
  | "envelope-overhang"
  | "mount-overlap"
  | "envelope-overlap"
  | "too-big-for-bed";

export interface Issue {
  severity: "error" | "warning";
  kind: IssueKind;
  placementIds: string[];
  detail: string;
}
