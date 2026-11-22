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

export interface ParamSpec {
  name: string;
  label: string;
  kind: "int" | "number" | "choice" | "bool";
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  choices?: string[];
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
  color: string;
  params: ParamSpec[];
  footprint(p: Record<string, ParamValue>, pitchMm: number): Footprint;
  approx?: boolean;
  notes?: string;
}

const UW_BASE = "https://github.com/AndyLevesque/QuackWorks/blob/main/Underware/";
export const scadUrl = (g: Generator) => UW_BASE + g.scadFile;

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
const mounting: ParamSpec = {
  name: "Mounting_Method",
  label: "Mounting",
  kind: "choice",
  default: "Threaded Snap Connector",
  choices: [
    "Threaded Snap Connector",
    "Direct Multiboard Screw",
    "Direct Multipoint Screw",
    "Magnet",
    "Wood Screw",
    "Flat",
  ],
};

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
      { name: "Channel_Length_Units", label: "Length (units)", kind: "int", default: 5, min: 1, max: 30 },
      height,
      mounting,
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
  {
    id: "uw-item",
    name: "Item holder",
    category: "underware-item",
    scadFile: "Underware_Item_Holder.scad",
    color: "#a855f7",
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
  },
];

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

export const generatorById = (id?: string) => GENERATORS.find((g) => g.id === id);

export function defaultParams(g: Generator): Record<string, ParamValue> {
  return Object.fromEntries(g.params.map((s) => [s.name, s.default]));
}
