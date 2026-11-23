import { defaultParams, generatorById } from "../model/library";
import { lookup, paramsFor, type ConnectionId } from "../model/catalog";
import { ZERO_ENVELOPE } from "../model/geometry";
import type { Board, Layout, PartType, Placement, Rotation } from "../model/types";

export interface State {
  layout: Layout;
  selectedId: string | null;
}

export type Action =
  | { type: "board"; patch: Partial<Omit<Board, "placements" | "tile">> & { tile?: Partial<Board["tile"]> } }
  | { type: "addFromGenerator"; generatorId: string }
  | { type: "addPart"; shape: string; connection: ConnectionId }
  | { type: "setKind"; partTypeId: string; shape: string; connection: ConnectionId }
  | { type: "addCustom" }
  | { type: "duplicate"; placementId: string }
  | { type: "move"; placementId: string; x: number; y: number }
  | { type: "rotate"; placementId: string }
  | { type: "removePlacement"; placementId: string }
  | { type: "updatePlacement"; placementId: string; patch: Partial<Placement> }
  | { type: "updatePartType"; partTypeId: string; patch: Partial<PartType> }
  | { type: "select"; id: string | null }
  | { type: "load"; layout: Layout };

let counter = 0;
export const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}`;

export function newLayout(): Layout {
  return {
    version: 1,
    board: {
      id: uid("board"),
      name: "Under-desk",
      widthCells: 21,
      heightCells: 60,
      pitchMm: 28,
      tile: { widthCells: 7, heightCells: 7, variant: "Full" },
      placements: [],
    },
    partTypes: [],
  };
}

/** First spot from the top-left where a w x h mount fits without hitting another mount. */
/** A placed part: its mount cells, and the cells its whole body reaches (shape plus envelope), if known. */
export interface Occupied {
  x: number;
  y: number;
  w: number;
  h: number;
  cells?: { x: number; y: number; w: number; h: number };
}

/** Whole cells a part's body reaches past its mount on each side. */
export interface Margin {
  l: number;
  t: number;
  r: number;
  b: number;
}
const NO_MARGIN: Margin = { l: 0, t: 0, r: 0, b: 0 };

function freeSpot(board: Board, w: number, h: number, occupied: Occupied[], m: Margin = NO_MARGIN) {
  for (let y = m.t; y + h + m.b <= board.heightCells; y++) {
    for (let x = m.l; x + w + m.r <= board.widthCells; x++) {
      const [bx, by, bw, bh] = [x - m.l, y - m.t, w + m.l + m.r, h + m.t + m.b];
      const hit = occupied.some((r) => {
        const o = r.cells ?? r;
        return bx < o.x + o.w && o.x < bx + bw && by < o.y + o.h && o.y < by + bh;
      });
      if (!hit) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

function withPlacement(s: State, pt: PartType, extraPartType: boolean, size: { w: number; h: number }, occupied: Occupied[], margin?: Margin): State {
  const { x, y } = freeSpot(s.layout.board, size.w, size.h, occupied, margin);
  const pl: Placement = { id: uid("pl"), partTypeId: pt.id, x, y, rotation: 0 };
  return {
    selectedId: pl.id,
    layout: {
      ...s.layout,
      partTypes: extraPartType ? [...s.layout.partTypes, pt] : s.layout.partTypes,
      board: { ...s.layout.board, placements: [...s.layout.board.placements, pl] },
    },
  };
}

/** Apply a patch; a name that was derived from the params follows them. */
function patchPartType(t: PartType, patch: Partial<PartType>): PartType {
  const g = generatorById(t.generatorId);
  const next = { ...t, ...patch };
  if (g?.nameFor && patch.params && patch.name === undefined && t.name === g.nameFor(t.params)) next.name = g.nameFor(next.params);
  return next;
}

const mapPlacement = (s: State, id: string, f: (p: Placement) => Placement): State => ({
  ...s,
  layout: { ...s.layout, board: { ...s.layout.board, placements: s.layout.board.placements.map((p) => (p.id === id ? f(p) : p)) } },
});

export function reducer(s: State, a: Action, occupied: (s: State) => Occupied[] = () => []): State {
  switch (a.type) {
    case "board": {
      const { tile, ...rest } = a.patch;
      const b = s.layout.board;
      return { ...s, layout: { ...s.layout, board: { ...b, ...rest, tile: { ...b.tile, ...tile } } } };
    }
    case "addPart":
    case "addFromGenerator": {
      let g = a.type === "addFromGenerator" ? generatorById(a.generatorId) : undefined;
      let params = g ? defaultParams(g) : {};
      if (a.type === "addPart") {
        const r = lookup(a.shape, a.connection);
        if (!("option" in r)) return s;
        g = r.generator;
        params = paramsFor(r.option, g);
      }
      if (!g) return s;
      const pt: PartType = {
        id: uid("pt"),
        name: g.nameFor?.(params) ?? g.name,
        category: g.category,
        color: g.color,
        generatorId: g.id,
        params,
        ...(a.type === "addPart" ? { shape: a.shape, connection: a.connection } : {}),
        envelope: { ...ZERO_ENVELOPE },
      };
      const p = s.layout.board.pitchMm;
      const fp = g.footprint(params, p);
      const e = fp.envelope ?? {};
      const c = (mm = 0) => Math.ceil(mm / p - 1e-6);
      const margin = { l: c(e.leftMm), t: c(e.topMm), r: c(e.rightMm), b: c(e.bottomMm) };
      return withPlacement(s, pt, true, { w: fp.wCells, h: fp.hCells }, occupied(s), margin);
    }
    case "addCustom": {
      const pt: PartType = {
        id: uid("pt"),
        name: "Custom part",
        category: "holder",
        color: "#64748b",
        params: {},
        mount: { wCells: 2, hCells: 2 },
        envelope: { ...ZERO_ENVELOPE },
      };
      return withPlacement(s, pt, true, { w: 2, h: 2 }, occupied(s));
    }
    case "duplicate": {
      const src = s.layout.board.placements.find((p) => p.id === a.placementId);
      const pt = src && s.layout.partTypes.find((t) => t.id === src.partTypeId);
      if (!src || !pt) return s;
      const o = occupied(s);
      const me = o.find((r) => r.x === src.x && r.y === src.y);
      const next = withPlacement(s, pt, false, me ? { w: me.w, h: me.h } : { w: 1, h: 1 }, o);
      const newId = next.selectedId!;
      return mapPlacement(next, newId, (p) => ({ ...p, rotation: src.rotation }));
    }
    case "move":
      return mapPlacement(s, a.placementId, (p) => ({ ...p, x: a.x, y: a.y }));
    case "rotate":
      return mapPlacement(s, a.placementId, (p) => ({ ...p, rotation: (((p.rotation + 90) % 360) as Rotation) }));
    case "updatePlacement":
      return mapPlacement(s, a.placementId, (p) => ({ ...p, ...a.patch }));
    case "removePlacement": {
      const placements = s.layout.board.placements.filter((p) => p.id !== a.placementId);
      // Drop part types nothing uses any more, so the library doesn't fill with orphans.
      const used = new Set(placements.map((p) => p.partTypeId));
      return {
        selectedId: s.selectedId === a.placementId ? null : s.selectedId,
        layout: { ...s.layout, partTypes: s.layout.partTypes.filter((t) => used.has(t.id)), board: { ...s.layout.board, placements } },
      };
    }
    case "updatePartType":
      return {
        ...s,
        layout: { ...s.layout, partTypes: s.layout.partTypes.map((t) => (t.id === a.partTypeId ? patchPartType(t, a.patch) : t)) },
      };
    case "setKind": {
      const r = lookup(a.shape, a.connection);
      if (!("option" in r)) return s;
      const g = r.generator;
      return {
        ...s,
        layout: {
          ...s.layout,
          partTypes: s.layout.partTypes.map((t) => {
            if (t.id !== a.partTypeId) return t;
            const old = generatorById(t.generatorId);
            const params = paramsFor(r.option, g, t.params);
            // Keep a name or colour the user picked; follow the part otherwise.
            const autoName = !old || t.name === (old.nameFor?.(t.params) ?? old.name);
            const autoColor = !old || t.color === old.color;
            return {
              ...t,
              generatorId: g.id,
              category: g.category,
              params,
              shape: a.shape,
              connection: a.connection,
              name: autoName ? g.nameFor?.(params) ?? g.name : t.name,
              color: autoColor ? g.color : t.color,
            };
          }),
        },
      };
    }
    case "select":
      return { ...s, selectedId: a.id };
    case "load":
      return { layout: a.layout, selectedId: null };
  }
}

const KEY = "underware-layout-tool:v1";

export function loadSaved(): Layout | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseLayout(raw) : null;
  } catch {
    return null;
  }
}

export function save(layout: Layout) {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    /* storage blocked or full: autosave is a convenience only */
  }
}

/** Parse and sanity-check a layout JSON file. Throws with a readable message. */
export function parseLayout(text: string): Layout {
  const d = JSON.parse(text);
  if (!d || d.version !== 1 || !d.board || !Array.isArray(d.partTypes) || !Array.isArray(d.board.placements)) {
    throw new Error("Not a layout file from this tool (expected version 1 with board and partTypes).");
  }
  return d as Layout;
}
