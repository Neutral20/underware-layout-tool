// The part picker: choose a shape, then how it attaches to the board.
// Each (shape, connection) pair maps to one generator in library.ts, plus
// any params the connection pins (like QuackWorks' Mounting_Method). Pairs
// with no generator are listed with the reason, so the picker can grey
// them out instead of pretending.

import { defaultParams, generatorById, type Generator, type ParamSpec } from "./library";
import type { ParamValue, PartType } from "./types";

export type ConnectionId = "clip" | "snap" | "multiconnect" | "screw";

export interface Connection {
  id: ConnectionId;
  label: string;
  note: string;
}

export const CONNECTIONS: Connection[] = [
  {
    id: "clip",
    label: "Clip-in (openGrid)",
    note: "One-piece channels that clip straight onto the openGrid bars. Monokini by Pedro Leite for any size, David D's fixed pieces for curves, Y splits and ends. 28 mm grid only.",
  },
  {
    id: "snap",
    label: "Threaded snap",
    note: "QuackWorks Underware 2.0: base + top, held by threaded snaps. The snaps are made for Multiboard holes and don't fit openGrid.",
  },
  {
    id: "multiconnect",
    label: "Multiconnect",
    note: "Multiconnect slots on the back. Only the QuackWorks item holder has them; no Underware channel SCAD offers a Multiconnect back.",
  },
  {
    id: "screw",
    label: "Screw, magnet or flat",
    note: "QuackWorks Underware 2.0 base + top, screwed, glued to magnets or left flat.",
  },
];

export const DEFAULT_CONNECTION: ConnectionId = "clip";

export interface Option {
  generatorId: string;
  /** Params the connection decides. Set on the part and hidden in the inspector. */
  fixed?: Record<string, ParamValue>;
  /** Narrower choices for a param (e.g. the non-snap mounting methods). */
  choices?: Record<string, string[]>;
}

export interface Shape {
  id: string;
  label: string;
  /** SVG path in a 24x24 box, drawn as a stroke. */
  icon: string;
  options: Partial<Record<ConnectionId, Option>>;
  /** Why a connection isn't offered for this shape. Falls back to a generic reason. */
  missing?: Partial<Record<ConnectionId, string>>;
}

const SNAP: Option["fixed"] = { Mounting_Method: "Threaded Snap Connector" };
const screw = (generatorId: string): Option => ({
  generatorId,
  choices: {
    Mounting_Method: ["Wood Screw", "Direct Multiboard Screw", ...(generatorId === "uw-i" ? ["Direct Multipoint Screw"] : []), "Magnet", "Flat"],
  },
});
/** The usual pair: a Monokini clip-in and a QuackWorks channel. */
const both = (mk: string | null, uw: string | null): Shape["options"] => ({
  ...(mk ? { clip: { generatorId: mk } } : {}),
  ...(uw ? { snap: { generatorId: uw, fixed: SNAP }, screw: screw(uw) } : {}),
});

const NO_MC_CHANNEL = "No Underware channel has a Multiconnect back, in QuackWorks or Monokini. Only the item holder does.";
const QW_ONLY = "Only available as a clip-in piece; QuackWorks Underware 2.0 has no snap or screw version.";

export const SHAPES: Shape[] = [
  { id: "straight", label: "Straight", icon: "M12 3v18", options: both("mk-i", "uw-i") },
  { id: "corner", label: "Corner (L)", icon: "M6 3v15h15", options: both("mk-l", "uw-l") },
  {
    id: "curve",
    label: "Curve",
    icon: "M5 3v4a12 12 0 0 0 12 12h4",
    options: { clip: { generatorId: "og-curve" }, snap: { generatorId: "uw-c", fixed: SNAP }, screw: screw("uw-c") },
  },
  { id: "t", label: "T", icon: "M3 6h18M12 6v15", options: both("mk-t", "uw-t") },
  { id: "x", label: "Cross (X)", icon: "M12 3v18M3 12h18", options: both("mk-x", "uw-x") },
  { id: "s", label: "S jog", icon: "M8 3v6l8 6v6", options: both("mk-s", "uw-s") },
  { id: "diagonal", label: "Diagonal", icon: "M7 3v5l10 8v5", options: both("mk-diag", "uw-diag") },
  {
    id: "y",
    label: "Y split",
    icon: "M12 21v-8l-6-6V3M12 13l6-6V3",
    options: { clip: { generatorId: "og-y" }, snap: { generatorId: "uw-y", fixed: SNAP }, screw: screw("uw-y") },
  },
  {
    id: "branch",
    label: "Branch split",
    icon: "M9 3v18M9 14l8-6v-5",
    options: both(null, "uw-branch"),
    missing: { clip: "No clip-in branch split. The clip-in Y split has straight-through versions that do the same job." },
  },
  {
    id: "end",
    label: "End",
    icon: "M12 21V7M7 7h10",
    options: { clip: { generatorId: "og-end" } },
    missing: { snap: QW_ONLY, screw: QW_ONLY },
  },
  {
    id: "bridge",
    label: "Bridge",
    icon: "M12 3v4M12 17v4M8 7h8M8 17h8M8 7v10M16 7v10",
    options: both("mk-bridge", null),
    missing: { snap: QW_ONLY, screw: QW_ONLY },
  },
  {
    id: "holder",
    label: "Item holder",
    icon: "M4 6h16v12H4zM4 10h16",
    options: {
      snap: { generatorId: "uw-item", fixed: { Mounting_Style: "Threaded Snap" } },
      multiconnect: { generatorId: "uw-item", fixed: { Mounting_Style: "Multiconnect" } },
    },
    missing: {
      clip: "The item holder has no clip-in back. Use Multiconnect or a threaded snap.",
      screw: "The item holder mounts by Multiconnect or threaded snap only.",
    },
  },
  {
    id: "other",
    label: "Other clip-in piece",
    icon: "M5 5h6v6H5zM13 13h6v6h-6z",
    options: { clip: { generatorId: "og-piece" } },
    missing: { snap: "These are David D's fixed clip-in pieces (open curves, Z, extreme X, half bridge and the rest)." },
  },
];

export const shapeById = (id?: string) => SHAPES.find((s) => s.id === id);

/** The generator behind a pair, or why there isn't one. */
export function lookup(shapeId: string, conn: ConnectionId): { option: Option; generator: Generator } | { reason: string } {
  const shape = shapeById(shapeId);
  if (!shape) return { reason: "Unknown shape." };
  const option = shape.options[conn];
  const generator = option && generatorById(option.generatorId);
  if (option && generator) return { option, generator };
  if (shape.missing?.[conn]) return { reason: shape.missing[conn]! };
  if (conn === "multiconnect") return { reason: NO_MC_CHANNEL };
  const label = CONNECTIONS.find((c) => c.id === conn)?.label ?? conn;
  return { reason: `No ${shape.label.toLowerCase()} with ${label.toLowerCase()} in the tool yet.` };
}

export const isAvailable = (shapeId: string, conn: ConnectionId) => "option" in lookup(shapeId, conn);

/** Default params for a pair, carrying over any matching values from `from`. */
export function paramsFor(option: Option, generator: Generator, from: Record<string, ParamValue> = {}): Record<string, ParamValue> {
  const params = defaultParams(generator);
  for (const spec of generator.params) if (spec.name in from && spec.name !== "Piece") params[spec.name] = from[spec.name];
  Object.assign(params, option.fixed);
  for (const [name, list] of Object.entries(option.choices ?? {})) {
    if (!list.includes(String(params[name]))) params[name] = list[0];
  }
  return params;
}

/** The params the inspector should show, with narrowed choices applied. */
export function visibleParams(generator: Generator, option?: Option): ParamSpec[] {
  return generator.params
    .filter((s) => !(option?.fixed && s.name in option.fixed))
    // The item holder's mount spacing follows the board's grid pitch.
    .filter((s) => s.name !== "Mounting_Surface")
    .map((s) => (option?.choices?.[s.name] ? { ...s, choices: option.choices[s.name], choiceLabels: undefined } : s));
}

/**
 * The shape and connection of a part type. Parts from before the picker
 * (or loaded from an old layout) are matched by generator and params.
 */
export function kindOf(pt: PartType): { shape: string; connection: ConnectionId } | null {
  if (pt.shape && pt.connection && isAvailable(pt.shape, pt.connection as ConnectionId)) {
    return { shape: pt.shape, connection: pt.connection as ConnectionId };
  }
  if (!pt.generatorId) return null;
  if (pt.generatorId === "og-straight") return { shape: "straight", connection: "clip" };
  let fallback: { shape: string; connection: ConnectionId } | null = null;
  for (const shape of SHAPES) {
    for (const c of CONNECTIONS) {
      const o = shape.options[c.id];
      if (!o || o.generatorId !== pt.generatorId) continue;
      const fixedOk = Object.entries(o.fixed ?? {}).every(([k, v]) => pt.params[k] === v);
      const choicesOk = Object.entries(o.choices ?? {}).every(([k, list]) => list.includes(String(pt.params[k])));
      if (fixedOk && choicesOk) return { shape: shape.id, connection: c.id };
      fallback ??= { shape: shape.id, connection: c.id };
    }
  }
  return fallback;
}

/** The option a part type renders with, if it came from the picker. */
export function optionOf(pt: PartType): Option | undefined {
  const k = kindOf(pt);
  if (!k) return undefined;
  const r = lookup(k.shape, k.connection);
  return "option" in r && r.option.generatorId === pt.generatorId ? r.option : undefined;
}
