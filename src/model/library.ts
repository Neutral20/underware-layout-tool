// Built-in part generators, one per QuackWorks Underware 2.0 SCAD file.
//
// Each generator lists the SCAD params that change a part's size, and a
// footprint() that turns those params into a mount size in grid cells.
// Footprints were checked by rendering the SCADs with OpenSCAD (Manifold
// backend, Grid_Size=28, Base only) and reading the STL bounding box:
//
//   I 1x5 (w=2)   -> 2x5        L x=1,y=1 -> 2x2     L x=3,y=2 -> 4x3
//   T             -> 2x3        X 1x1     -> 3x3     C r=2     -> 3x3
//   S over2 up2   -> 3x3        Y over1 up1 -> 3x2   Diagonal 2,2 -> 3x3
//   Branch split (len 4, out 1, up 1) -> 2x4
//
// Every channel footprint came out as whole cells, so channels get no
// envelope by default. Generators marked `approx` extrapolate beyond the
// rendered cases and should be checked against a real render.
//
// Source: https://github.com/AndyLevesque/QuackWorks/tree/main/Underware
// Licence of the SCADs: CC BY-NC-SA 4.0 (Hands on Katie / BlackjackDuck).

import type { Category, Envelope, ParamValue } from "./types";
import OG_PIECES from "./ogPieces.json";

export interface ParamSpec {
  name: string;
  label: string;
  kind: "int" | "number" | "choice" | "bool";
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  choices?: string[];
  /** Display text for each choice, when it differs from the value. */
  choiceLabels?: string[];
  /** Only shown, never sent to the footprint math. */
  hint?: string;
}

export interface Footprint {
  wCells: number;
  hCells: number;
  /** Extra body beyond the mount, when the part isn't a whole number of cells. */
  envelope?: Partial<Envelope>;
}

export interface Generator {
  id: string;
  name: string;
  category: Category;
  scadFile: string;
  /** Folder the SCAD is vendored into under public/scad (default "Underware"). */
  scadDir?: string;
  /**
   * Which two axes of the rendered STL lie flat on the board, as [across,
   * down] before rotation. Channels print flat ("xy"); item holders print
   * standing on their backer, so the board face is X by Z.
   */
  boardAxes?: "xy" | "xz";
  color: string;
  params: ParamSpec[];
  footprint(p: Record<string, ParamValue>, pitchMm: number): Footprint;
  approx?: boolean;
  notes?: string;
  /** One printed piece. Otherwise channels render as separate base and top. */
  onePiece?: boolean;
  /** Where the SCAD came from, for the inspector link. */
  sourceUrl?: string;
  /** Part name that follows the params (e.g. the chosen piece). */
  nameFor?(p: Record<string, ParamValue>): string;
  /** True when the part is a bridge, built to pass over other channels. */
  passesOver?(p: Record<string, ParamValue>): boolean;
}

const UW_BASE = "https://github.com/AndyLevesque/QuackWorks/blob/main/Underware/";
export const scadUrl = (g: Generator) => g.sourceUrl ?? UW_BASE + g.scadFile;
/** Where the renderer finds the SCAD in its file system. */
export const scadPath = (g: Generator) => `/${g.scadDir ?? "Underware"}/${g.scadFile}`;

const int = (v: ParamValue | undefined, d = 1) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : d;
};

// Params every channel shares.
const height: ParamSpec = {
  name: "Channel_Internal_Height",
  label: "Internal height (mm)",
  kind: "int",
  default: 12,
  min: 12,
  max: 72,
  step: 6,
};
const width = (name = "Channel_Width_in_Units", label = "Width (units)"): ParamSpec => ({
  name,
  label,
  kind: "int",
  default: 1,
  min: 1,
  max: 6,
});
// Only the I channel SCAD offers Direct Multipoint Screw.
const mountingFor = (multipoint: boolean): ParamSpec => ({
  name: "Mounting_Method",
  label: "Mounting",
  kind: "choice",
  default: "Threaded Snap Connector",
  choices: [
    "Threaded Snap Connector",
    "Direct Multiboard Screw",
    ...(multipoint ? ["Direct Multipoint Screw"] : []),
    "Magnet",
    "Wood Screw",
    "Flat",
  ],
});
const mounting = mountingFor(false);

const CHANNEL = "underware-channel" as const;

export const GENERATORS: Generator[] = [
  {
    id: "uw-i",
    name: "I channel (straight)",
    category: CHANNEL,
    scadFile: "Underware_I_Channel.scad",
    color: "#6a5acd",
    params: [
      width(),
      { name: "Channel_Length_Units", label: "Length (units)", kind: "int", default: 5, min: 1, max: 400},
      height,
      mountingFor(true),
    ],
    footprint: (p) => ({ wCells: int(p.Channel_Width_in_Units), hCells: int(p.Channel_Length_Units, 5) }),
  },
  {
    id: "uw-l",
    name: "L channel (corner)",
    category: CHANNEL,
    scadFile: "Underware_L_Channel.scad",
    color: "#3b82f6",
    params: [
      width(),
      { name: "L_Channel_Length_in_Units_X_Axis", label: "Arm X (units)", kind: "int", default: 1, min: 1, max: 20 },
      { name: "L_Channel_Length_in_Units_Y_Axis", label: "Arm Y (units)", kind: "int", default: 1, min: 1, max: 20 },
      height,
      mounting,
    ],
    footprint: (p) => {
      const w = int(p.Channel_Width_in_Units);
      return {
        wCells: int(p.L_Channel_Length_in_Units_X_Axis) + w,
        hCells: int(p.L_Channel_Length_in_Units_Y_Axis) + w,
      };
    },
  },
  {
    id: "uw-t",
    name: "T channel",
    category: CHANNEL,
    scadFile: "Underware_T_Channel.scad",
    color: "#0ea5e9",
    params: [
      width(),
      height,
      { name: "Corner_Style", label: "Corners", kind: "choice", default: "Sharp", choices: ["Sharp", "Mitered"] },
      mounting,
    ],
    footprint: (p) => {
      const w = int(p.Channel_Width_in_Units);
      return { wCells: w + 1, hCells: w + 2 };
    },
    approx: true,
    notes: "Rendered only at width 1 (2x3). Wider T's are extrapolated.",
  },
  {
    id: "uw-x",
    name: "X channel (cross)",
    category: CHANNEL,
    scadFile: "Underware_X_Channel.scad",
    color: "#14b8a6",
    params: [
      width("Channel_X_Width_X_in_Units", "Width X (units)"),
      width("Channel_Y_Width_in_Units", "Width Y (units)"),
      height,
      mounting,
    ],
    // From the SCAD: x_channel_X = channelXWidth + Grid_Size*2.
    footprint: (p) => ({
      wCells: int(p.Channel_X_Width_X_in_Units) + 2,
      hCells: int(p.Channel_Y_Width_in_Units) + 2,
    }),
  },
  {
    id: "uw-c",
    name: "C channel (curve)",
    category: CHANNEL,
    scadFile: "Underware_C_Channel.scad",
    color: "#22c55e",
    params: [
      width(),
      { name: "Curve_Radius_in_Units", label: "Curve radius (units)", kind: "int", default: 2, min: 1, max: 10 },
      height,
      mounting,
    ],
    // From the SCAD: partWidth = Curve_Radius_in_Units*Grid + Grid*Width.
    footprint: (p) => {
      const s = int(p.Curve_Radius_in_Units, 2) + int(p.Channel_Width_in_Units);
      return { wCells: s, hCells: s };
    },
  },
  {
    id: "uw-s",
    name: "S channel (jog)",
    category: CHANNEL,
    scadFile: "Underware_S_Channel.scad",
    color: "#84cc16",
    params: [
      width(),
      { name: "Units_Over", label: "Units over", kind: "int", default: 2, min: -10, max: 10 },
      { name: "Units_Up", label: "Units up", kind: "int", default: 2, min: 1, max: 10 },
      height,
      mounting,
    ],
    footprint: (p) => {
      const w = int(p.Channel_Width_in_Units);
      return { wCells: Math.abs(int(p.Units_Over, 2)) + w, hCells: int(p.Units_Up, 2) + w };
    },
    approx: true,
  },
  {
    id: "uw-diag",
    name: "Diagonal channel",
    category: CHANNEL,
    scadFile: "Underware_Diagonal_Channel.scad",
    color: "#eab308",
    params: [
      width(),
      { name: "Units_Over", label: "Units over", kind: "int", default: 2, min: -10, max: 10 },
      { name: "Units_Up", label: "Units up", kind: "int", default: 2, min: -10, max: 10 },
      { name: "Output_Direction", label: "Output", kind: "choice", default: "Turn", choices: ["Forward", "Turn"] },
      height,
      mounting,
    ],
    footprint: (p) => {
      const w = int(p.Channel_Width_in_Units);
      return { wCells: Math.abs(int(p.Units_Over, 2)) + w, hCells: Math.abs(int(p.Units_Up, 2)) + w };
    },
    approx: true,
  },
  {
    id: "uw-y",
    name: "Y channel (split)",
    category: CHANNEL,
    scadFile: "Underware_Y_Channel.scad",
    color: "#f97316",
    params: [
      width(),
      { name: "Y_Units_Over", label: "Units over", kind: "int", default: 1, min: 1, max: 10 },
      { name: "Y_Units_Up", label: "Units up", kind: "int", default: 1, min: 1, max: 10 },
      { name: "Y_Output_Direction", label: "Output", kind: "choice", default: "Forward", choices: ["Forward", "Turn"] },
      height,
      mounting,
    ],
    footprint: (p) => ({
      wCells: 2 * int(p.Y_Units_Over) + int(p.Channel_Width_in_Units),
      hCells: int(p.Y_Units_Up) + 1,
    }),
    approx: true,
    notes: "Y_Straight_Distance is in mm, not units, so it doesn't scale with the grid.",
  },
  {
    id: "uw-branch",
    name: "Branch split channel",
    category: CHANNEL,
    scadFile: "Underware_Branch_Split_Channel.scad",
    color: "#ef4444",
    params: [
      width("Straight_Channel_Width_in_Units", "Main width (units)"),
      { name: "Straight_Section_Length_in_Units", label: "Main length (units)", kind: "int", default: 4, min: 1, max: 20 },
      width("Branch_Channel_Width_in_Units", "Branch width (units)"),
      { name: "Branch_Units_Out", label: "Branch out (units)", kind: "int", default: 1, min: 1, max: 10 },
      { name: "Branch_Units_Up", label: "Branch up (units)", kind: "int", default: 1, min: 1, max: 10 },
      height,
      mounting,
    ],
    footprint: (p) => ({
      wCells: int(p.Straight_Channel_Width_in_Units) + int(p.Branch_Units_Out),
      hCells: int(p.Straight_Section_Length_in_Units, 4),
    }),
    approx: true,
  },
  itemHolder("uw-item", "Item holder", "Underware_Item_Holder.scad", "#a855f7"),
];

// Underware for openGrid (David D): one-piece channels that clip straight
// onto the openGrid bars. Fixed pieces from the original 3MF, plus
// straights of any length built from the 1-cell straight. Sizes are the
// real mesh sizes, so these footprints are exact (for a 28 mm grid).
const OG_URL = "https://www.printables.com/model/1214427-underware-for-opengrid-manage-your-cables-lite-ly";
const OG_NOTE = "Underware for openGrid by David D. Sized for openGrid's 28 mm grid.";

interface OgPiece {
  id: string;
  label: string;
  sizeMm: number[];
}
const ogPieces = (OG_PIECES as OgPiece[]).filter((p) => p.id !== "straight-1");
const ogPiece = (id: ParamValue | undefined) => ogPieces.find((p) => p.id === id) ?? ogPieces[0];

/** Cells a fixed-size piece covers (nearest whole cells), with any excess as envelope. */
export function fixedFootprint(wMm: number, hMm: number, depthMm: number, pitch: number): Footprint {
  const wCells = Math.max(1, Math.round(wMm / pitch));
  const hCells = Math.max(1, Math.round(hMm / pitch));
  const r = (n: number) => Math.round(Math.max(0, n) * 10) / 10;
  const exW = r((wMm - wCells * pitch) / 2);
  const exH = r((hMm - hCells * pitch) / 2);
  return { wCells, hCells, envelope: { leftMm: exW, rightMm: exW, topMm: exH, bottomMm: exH, depthMm } };
}

const OG_PIECE: Generator = {
  id: "og-piece",
  name: "Clip-on piece",
  category: CHANNEL,
  scadDir: "openGridUnderware",
  scadFile: "openGrid_Underware.scad",
  sourceUrl: OG_URL,
  color: "#0891b2",
  onePiece: true,
  params: [{ name: "Piece", label: "Piece", kind: "choice", default: "curve-1", choices: ogPieces.map((p) => p.id), choiceLabels: ogPieces.map((p) => p.label) }],
  footprint: (p, pitch) => {
    const [w, h, d] = ogPiece(p.Piece).sizeMm;
    return fixedFootprint(w, h, d, pitch);
  },
  nameFor: (p) => `Clip-on ${ogPiece(p.Piece).label.toLowerCase()}`,
  passesOver: (p) => ogPiece(p.Piece).id.startsWith("bridge"),
  notes: OG_NOTE,
};

export const OG_GENERATORS: Generator[] = [
  {
    id: "og-straight",
    name: "Clip-on straight",
    category: CHANNEL,
    scadDir: "openGridUnderware",
    scadFile: "openGrid_Underware.scad",
    sourceUrl: OG_URL,
    color: "#0d9488",
    onePiece: true,
    params: [{ name: "Length_Units", label: "Length (cells)", kind: "int", default: 5, min: 1, max: 400}],
    footprint: (p, pitch) => fixedFootprint(26.4, int(p.Length_Units, 5) * 28, 22, pitch),
    notes: OG_NOTE,
  },
  OG_PIECE,
  // The same fixed pieces, narrowed to one shape for the shape picker.
  ogSubset("og-curve", "Clip-on curve", "Radius", (id) => id.startsWith("curve-"), "#0891b2"),
  ogSubset("og-y", "Clip-on Y split", "Version", (id) => id.startsWith("y"), "#0e7490"),
  ogSubset("og-end", "Clip-on end piece", "Length", (id) => id.startsWith("end-"), "#155e75"),
];

function ogSubset(id: string, name: string, label: string, keep: (pieceId: string) => boolean, color: string): Generator {
  const list = ogPieces.filter((p) => keep(p.id));
  return {
    ...OG_PIECE,
    id,
    name,
    color,
    params: [{ name: "Piece", label, kind: "choice", default: list[0].id, choices: list.map((p) => p.id), choiceLabels: list.map((p) => p.label) }],
  };
}

// Item holder. Kept as a factory so other holder SCADs with the same
// backer can reuse it.
function itemHolder(id: string, name: string, scadFile: string, color: string): Generator {
  return {
    id,
    name,
    category: "underware-item",
    scadFile,
    color,
    boardAxes: "xz",
    params: [
      { name: "Internal_Width", label: "Internal width (mm)", kind: "number", default: 60, min: 5, max: 600, step: 0.1 },
      { name: "Internal_Depth", label: "Internal depth (mm)", kind: "number", default: 50, min: 5, max: 600, step: 0.1 },
      { name: "Internal_Height", label: "Internal height (mm)", kind: "number", default: 15, min: 5, max: 300, step: 0.1 },
      { name: "Mounting_Surface", label: "Mounts to", kind: "choice", default: "openGrid", choices: ["openGrid", "Multiboard", "Custom"] },
      { name: "Mounting_Style", label: "Mount style", kind: "choice", default: "Multiconnect", choices: ["Multiconnect", "Threaded Snap"] },
    ],
    // Backer from the SCAD: width = Internal_Width + 2*wall (2), height =
    // Internal_Depth + base (3). The mount covers the whole cells the
    // backer spans; the rest is envelope, split evenly.
    footprint: (p, pitch) => {
      const bodyW = Number(p.Internal_Width) + 4;
      const bodyH = Number(p.Internal_Depth) + 3;
      return cellsWithEnvelope(bodyW, bodyH, pitch, Number(p.Internal_Height) + 2);
    },
    approx: true,
    notes: "Mount is the whole cells under the backer. Overhang is split evenly left/right and top/bottom.",
  };
}

/** Whole cells fully covered by a body, with the leftover as envelope. */
export function cellsWithEnvelope(bodyWMm: number, bodyHMm: number, pitch: number, depthMm = 0): Footprint {
  const wCells = Math.max(1, Math.floor(bodyWMm / pitch + 1e-6));
  const hCells = Math.max(1, Math.floor(bodyHMm / pitch + 1e-6));
  const exW = Math.max(0, bodyWMm - wCells * pitch) / 2;
  const exH = Math.max(0, bodyHMm - hCells * pitch) / 2;
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    wCells,
    hCells,
    envelope: { leftMm: r(exW), rightMm: r(exW), topMm: r(exH), bottomMm: r(exH), depthMm },
  };
}

// Monokini by Pedro Leite: parametric Underware for openGrid, the same
// clip-on profile as David D's pieces but any width, length and curve size.
// Footprints were measured by rendering each SCAD at its defaults and at a
// second, wider/longer size (Manifold, openscad-wasm), see plan.test.ts.
const MK_URL = "https://github.com/pleite/Monokini/blob/main/";
const mkHeight: ParamSpec = { name: "Channel_Total_Height", label: "Height incl. clip (mm)", kind: "int", default: 22, min: 10, max: 72, step: 6 };
const mkWidth = (name = "Channel_Width_in_Units", label = "Width (cells)"): ParamSpec => ({ name, label, kind: "int", default: 1, min: 1, max: 6 });
const mkLen = (name: string, label: string, d = 1, min = 1): ParamSpec => ({ name, label, kind: "int", default: d, min, max: 30 });
const mkFp = (w: number, h: number, p: Record<string, ParamValue>): Footprint => ({
  wCells: Math.max(1, w),
  hCells: Math.max(1, h),
  envelope: { depthMm: int(p.Channel_Total_Height, 22) },
});
const mk = (g: Omit<Generator, "category" | "scadDir" | "onePiece" | "sourceUrl">): Generator => ({
  ...g,
  category: CHANNEL,
  scadDir: "Monokini",
  onePiece: true,
  sourceUrl: MK_URL + g.scadFile,
  notes: [g.notes, "Monokini by Pedro Leite. openGrid (28 mm) only."].filter(Boolean).join(" "),
});

export const MK_GENERATORS: Generator[] = [
  mk({
    id: "mk-i",
    name: "Monokini straight",
    scadFile: "monokini_I_channel.scad",
    color: "#0f766e",
    params: [mkWidth(), { ...mkLen("Channel_Length_Units", "Length (cells)", 5), max: 400}, mkHeight],
    footprint: (p) => mkFp(int(p.Channel_Width_in_Units), int(p.Channel_Length_Units, 5), p),
  }),
  mk({
    id: "mk-l",
    name: "Monokini corner (L)",
    scadFile: "monokini_L_channel.scad",
    color: "#0e7490",
    params: [
      mkWidth(),
      mkLen("L_Channel_Length_in_Units_X_Axis", "Arm X (cells)"),
      mkLen("L_Channel_Length_in_Units_Y_Axis", "Arm Y (cells)"),
      mkLen("Added_Radius", "Extra curve radius (cells)", 0, 0),
      { name: "Mirror_Channel", label: "Mirror", kind: "bool", default: false },
      mkHeight,
    ],
    // Rendered: 1,1,1,r0 -> 2x2; r2 -> 4x4; w2 x3 y2 -> 5x4.
    footprint: (p) => {
      const w = int(p.Channel_Width_in_Units), r = int(p.Added_Radius, 0);
      return mkFp(int(p.L_Channel_Length_in_Units_X_Axis) + w + r, int(p.L_Channel_Length_in_Units_Y_Axis) + w + r, p);
    },
  }),
  mk({
    id: "mk-t",
    name: "Monokini T",
    scadFile: "monokini_T_channel.scad",
    color: "#155e75",
    params: [
      mkWidth("Channel_Width_in_Units_Bottom", "Stem width (cells)"),
      mkWidth("Channel_Width_in_Units_Left", "Left arm width (cells)"),
      mkWidth("Channel_Width_in_Units_Right", "Right arm width (cells)"),
      mkLen("T_Channel_Length_in_Units_Y_Axis", "Stem (cells)"),
      mkLen("T_Channel_Length_in_Units_X_Axis_Left", "Left arm (cells)"),
      mkLen("T_Channel_Length_in_Units_X_Axis_Right", "Right arm (cells)"),
      mkHeight,
    ],
    // Rendered: all 1 -> 3x2; stem width 2, left 2, stem 3 -> 5x4.
    footprint: (p) =>
      mkFp(
        int(p.T_Channel_Length_in_Units_X_Axis_Left) + int(p.Channel_Width_in_Units_Bottom) + int(p.T_Channel_Length_in_Units_X_Axis_Right),
        int(p.T_Channel_Length_in_Units_Y_Axis) + Math.max(int(p.Channel_Width_in_Units_Left), int(p.Channel_Width_in_Units_Right)),
        p,
      ),
    approx: true,
    notes: "Arm widths other than 1 are extrapolated.",
  }),
  mk({
    id: "mk-x",
    name: "Monokini cross (X)",
    scadFile: "monokini_X_channel.scad",
    color: "#164e63",
    params: [
      mkWidth(),
      mkLen("X_Channel_Length_in_Units_X_Axis_Left", "Left arm (cells)"),
      mkLen("X_Channel_Length_in_Units_X_Axis_Right", "Right arm (cells)"),
      mkLen("X_Channel_Length_in_Units_Y_Axis_Top", "Top arm (cells)"),
      mkLen("X_Channel_Length_in_Units_Y_Axis_Bottom", "Bottom arm (cells)"),
      mkHeight,
    ],
    // Rendered: all 1 -> 3x3; w2, bottom 2, left 3 -> 6x5.
    footprint: (p) => {
      const w = int(p.Channel_Width_in_Units);
      return mkFp(
        int(p.X_Channel_Length_in_Units_X_Axis_Left) + w + int(p.X_Channel_Length_in_Units_X_Axis_Right),
        int(p.X_Channel_Length_in_Units_Y_Axis_Top) + w + int(p.X_Channel_Length_in_Units_Y_Axis_Bottom),
        p,
      );
    },
  }),
  ...(["S", "diagonal"] as const).map((kind) =>
    mk({
      id: kind === "S" ? "mk-s" : "mk-diag",
      name: kind === "S" ? "Monokini S jog" : "Monokini diagonal",
      scadFile: `monokini_${kind}_channel.scad`,
      color: kind === "S" ? "#0369a1" : "#075985",
      params: [
        mkWidth(),
        mkLen(`${kind === "S" ? "S" : "Diagonal"}_Channel_Length_in_Units_Y_Axis_Bottom`, "Straight in (cells)"),
        mkLen(`${kind === "S" ? "S" : "Diagonal"}_Channel_Length_in_Units_Y_Axis_Top`, "Straight out (cells)"),
        { name: "Units_Over", label: "Cells over", kind: "int", default: 2, min: -10, max: 10 },
        { name: "Units_Up", label: "Cells up", kind: "int", default: 2, min: 1, max: 10 },
        mkHeight,
      ],
      // Rendered (S and diagonal alike): w1 over2 up2 -> 3x4; S over-3 up4 out2 -> 4x7; diag w2 over3 up2 -> 5x4.
      footprint: (p) => {
        const pre = kind === "S" ? "S" : "Diagonal";
        return mkFp(
          Math.abs(int(p.Units_Over, 2)) + int(p.Channel_Width_in_Units),
          int(p[`${pre}_Channel_Length_in_Units_Y_Axis_Bottom`]) + int(p[`${pre}_Channel_Length_in_Units_Y_Axis_Top`]) + int(p.Units_Up, 2),
          p,
        );
      },
    }),
  ),
  mk({
    id: "mk-bridge",
    name: "Monokini bridge",
    scadFile: "monokini_bridge_channel.scad",
    color: "#1e40af",
    passesOver: () => true,
    params: [
      mkWidth(),
      mkLen("Bridge_Channel_Length_in_Units_Y_Axis_Bottom", "Straight in (cells)"),
      mkLen("Bridge_Channel_Length_in_Units_Y_Axis_Top", "Straight out (cells)"),
      { name: "Units_Over", label: "Ramp length (cells)", kind: "number", default: 1, min: 0, max: 10, step: 0.5 },
      mkLen("Units_Up", "Bridge length (cells)"),
      { name: "Bridge_Height", label: "Bridge height (mm)", kind: "int", default: 22, min: 0, max: 72, step: 6 },
      mkHeight,
    ],
    // Rendered: defaults -> 82.4 x 140 mm (3x5); ramp 2, bridge 3, out 2 -> 3x10.
    footprint: (p) => {
      const ramp = Number(p.Units_Over ?? 1);
      const fp = mkFp(
        int(p.Channel_Width_in_Units) + 2,
        int(p.Bridge_Channel_Length_in_Units_Y_Axis_Bottom) + int(p.Bridge_Channel_Length_in_Units_Y_Axis_Top) + Math.ceil(2 * ramp) + int(p.Units_Up),
        p,
      );
      fp.envelope = { depthMm: int(p.Channel_Total_Height, 22) + int(p.Bridge_Height, 22) };
      return fp;
    },
    approx: true,
    notes: "Rendered only at width 1; the side supports make it 2 cells wider than the channel.",
  }),
];

export const ALL_GENERATORS: Generator[] = [...GENERATORS, ...OG_GENERATORS, ...MK_GENERATORS];
export const generatorById = (id?: string) => ALL_GENERATORS.find((g) => g.id === id);

export function defaultParams(g: Generator): Record<string, ParamValue> {
  return Object.fromEntries(g.params.map((s) => [s.name, s.default]));
}
