import { generatorById } from "./library";
import type { Board, Envelope, Issue, PartType, Placement, Rotation } from "./types";

export const ZERO_ENVELOPE: Envelope = { leftMm: 0, rightMm: 0, topMm: 0, bottomMm: 0, depthMm: 0 };

/** Mount size and envelope of a part type before rotation. */
export function baseShape(pt: PartType, pitchMm: number): { w: number; h: number; env: Envelope; approx: boolean } {
  const g = generatorById(pt.generatorId);
  if (g) {
    const fp = g.footprint(pt.params, pitchMm);
    const ge = { ...ZERO_ENVELOPE, ...fp.envelope };
    // The part type's own envelope is extra on top of whatever the generator
    // says the body needs (e.g. cables sticking out of a holder).
    return {
      w: fp.wCells,
      h: fp.hCells,
      env: {
        leftMm: ge.leftMm + pt.envelope.leftMm,
        rightMm: ge.rightMm + pt.envelope.rightMm,
        topMm: ge.topMm + pt.envelope.topMm,
        bottomMm: ge.bottomMm + pt.envelope.bottomMm,
        depthMm: Math.max(ge.depthMm, pt.envelope.depthMm),
      },
      approx: !!g.approx,
    };
  }
  const m = pt.mount ?? { wCells: 1, hCells: 1 };
  return { w: m.wCells, h: m.hCells, env: pt.envelope, approx: false };
}

/** Rotate clockwise in 90° steps (screen coordinates, y down). */
export function rotateShape(w: number, h: number, env: Envelope, rot: Rotation) {
  let cw = w, ch = h, e = { ...env };
  for (let i = 0; i < rot / 90; i++) {
    [cw, ch] = [ch, cw];
    e = { ...e, topMm: e.leftMm, rightMm: e.topMm, bottomMm: e.rightMm, leftMm: e.bottomMm };
  }
  return { w: cw, h: ch, env: e };
}

export interface Resolved {
  placement: Placement;
  partType: PartType;
  /** Mount rectangle in cells. */
  x: number;
  y: number;
  w: number;
  h: number;
  env: Envelope;
  approx: boolean;
  /** Body rectangle in mm, board origin top-left. */
  body: { x0: number; y0: number; x1: number; y1: number };
}

export function resolve(board: Board, partTypes: PartType[]): Resolved[] {
  const byId = new Map(partTypes.map((p) => [p.id, p]));
  const out: Resolved[] = [];
  for (const pl of board.placements) {
    const pt = byId.get(pl.partTypeId);
    if (!pt) continue;
    const b = baseShape(pt, board.pitchMm);
    const r = rotateShape(b.w, b.h, b.env, pl.rotation);
    const p = board.pitchMm;
    out.push({
      placement: pl,
      partType: pt,
      x: pl.x,
      y: pl.y,
      w: r.w,
      h: r.h,
      env: r.env,
      approx: b.approx,
      body: {
        x0: pl.x * p - r.env.leftMm,
        y0: pl.y * p - r.env.topMm,
        x1: (pl.x + r.w) * p + r.env.rightMm,
        y1: (pl.y + r.h) * p + r.env.bottomMm,
      },
    });
  }
  return out;
}

const nameOf = (r: Resolved) => r.placement.label || r.partType.name;
const fmt = (mm: number) => `${Math.round(mm * 10) / 10} mm`;

/** All fit problems for a board. Pure: same input, same output. */
export function checkBoard(board: Board, partTypes: PartType[]): Issue[] {
  const rs = resolve(board, partTypes);
  const issues: Issue[] = [];
  const W = board.widthCells, H = board.heightCells, p = board.pitchMm;

  for (const r of rs) {
    const id = r.placement.id;
    if (r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H) {
      issues.push({ severity: "error", kind: "mount-off-board", placementIds: [id], detail: `${nameOf(r)}: mount is off the board` });
      continue;
    }
    const over: string[] = [];
    if (r.body.x0 < -1e-6) over.push(`${fmt(-r.body.x0)} left`);
    if (r.body.x1 > W * p + 1e-6) over.push(`${fmt(r.body.x1 - W * p)} right`);
    if (r.body.y0 < -1e-6) over.push(`${fmt(-r.body.y0)} top`);
    if (r.body.y1 > H * p + 1e-6) over.push(`${fmt(r.body.y1 - H * p)} bottom`);
    if (over.length) {
      issues.push({ severity: "warning", kind: "envelope-overhang", placementIds: [id], detail: `${nameOf(r)}: overhangs board edge by ${over.join(", ")}` });
    }
  }

  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j];
      const ids = [a.placement.id, b.placement.id];
      const mountHit = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      if (mountHit) {
        issues.push({ severity: "error", kind: "mount-overlap", placementIds: ids, detail: `${nameOf(a)} and ${nameOf(b)}: mounts overlap` });
        continue;
      }
      const e = 1e-6;
      const bodyHit = a.body.x0 < b.body.x1 - e && b.body.x0 < a.body.x1 - e && a.body.y0 < b.body.y1 - e && b.body.y0 < a.body.y1 - e;
      if (bodyHit) {
        issues.push({ severity: "warning", kind: "envelope-overlap", placementIds: ids, detail: `${nameOf(a)} and ${nameOf(b)}: bodies overlap` });
      }
    }
  }
  return issues;
}
