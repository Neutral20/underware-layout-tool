import { generatorById } from "./library";
import { fitOffset, loopsBox, overlap, placeLoops, rectLoop, type Box, type Outline, type Pt } from "./outline";
import { fitsBed, printerFor } from "./printers";
import { maxSegmentCells, segmentsFor } from "./runs";
import type { Board, Envelope, Issue, PartType, Placement, Rotation } from "./types";

export const ZERO_ENVELOPE: Envelope = { leftMm: 0, rightMm: 0, topMm: 0, bottomMm: 0, depthMm: 0 };

/** Looks up the real outline for a part type, when one is known (see render/outlines.ts). */
export type OutlineLookup = (pt: PartType) => Outline | null | undefined;

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

/**
 * Where a part's shape comes from:
 * - "measured": the real outline, projected from a rendered mesh.
 * - "estimate": a generated part whose outline isn't known yet; its mount cells stand in.
 * - "box": a custom part, which is the mount cells plus its envelope by definition.
 */
export type ShapeKind = "measured" | "estimate" | "box";

export interface Resolved {
  placement: Placement;
  partType: PartType;
  /** Mount rectangle in cells. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Extra space around the shape (rotated), in mm. */
  env: Envelope;
  approx: boolean;
  /** The part's footprint on the board, in board mm (even-odd loops). */
  shape: Pt[][];
  shapeBox: Box;
  shapeKind: ShapeKind;
  /** Real size on the board in mm (after rotation) and height off it, when measured. */
  sizeMm: [number, number, number] | null;
  /** Shape box plus envelope: everything the part takes up, in board mm. */
  body: Box;
  /** Bridges are made to pass over other channels. */
  passesOver: boolean;
  /** Segment lengths (cells) for a straight cut to fit the printer; null if it's not a straight. */
  segments: number[] | null;
  /** Where those cuts fall on the board, as lines in board mm. */
  cuts: [Pt, Pt][];
}

/** Cut lines across a straight of the given segments, placed at x, y (cells) with a rotation. */
export function cutLines(segments: number[], x: number, y: number, w: number, h: number, rotation: Rotation, pitch: number): [Pt, Pt][] {
  const out: [Pt, Pt][] = [];
  const total = segments.reduce((a, b) => a + b, 0);
  let at = 0;
  for (let i = 0; i < segments.length - 1; i++) {
    at += segments[i];
    // Unrotated, the run goes down the board; 180 and 270 count from the far end.
    const d = rotation === 180 || rotation === 270 ? total - at : at;
    if (rotation % 180 === 0) out.push([[x * pitch, (y + d) * pitch], [(x + w) * pitch, (y + d) * pitch]]);
    else out.push([[(x + d) * pitch, y * pitch], [(x + d) * pitch, (y + h) * pitch]]);
  }
  return out;
}

const isZeroEnv = (e: Envelope) => !e.leftMm && !e.rightMm && !e.topMm && !e.bottomMm;

// Fitting an outline onto the grid is a little work; parts that share a type share the result.
const fitCache = new WeakMap<Outline, Map<string, Pt>>();
function cachedFit(o: Outline, w: number, h: number, pitch: number): Pt {
  let m = fitCache.get(o);
  if (!m) fitCache.set(o, (m = new Map()));
  const k = `${w}x${h}@${pitch}`;
  let off = m.get(k);
  if (!off) m.set(k, (off = fitOffset(o, w, h, pitch)));
  return off;
}

export function resolve(board: Board, partTypes: PartType[], outlineFor: OutlineLookup = () => null): Resolved[] {
  const byId = new Map(partTypes.map((p) => [p.id, p]));
  const out: Resolved[] = [];
  const p = board.pitchMm;
  for (const pl of board.placements) {
    const pt = byId.get(pl.partTypeId);
    if (!pt) continue;
    const g = generatorById(pt.generatorId);
    const b = baseShape(pt, p);
    const outline = g ? outlineFor(pt) : null;
    const mount: Box = { x0: pl.x * p, y0: pl.y * p, x1: 0, y1: 0 };

    let r, shape: Pt[][], shapeKind: ShapeKind, sizeMm: Resolved["sizeMm"] = null;
    if (outline) {
      // The outline replaces the generator's own guess at the body; only the
      // part type's extra envelope (cables and so on) is added around it.
      r = rotateShape(b.w, b.h, pt.envelope, pl.rotation);
      const off = cachedFit(outline, b.w, b.h, p);
      shape = placeLoops(outline.loops, off, b.w * p, b.h * p, pl.rotation, [mount.x0, mount.y0]);
      shapeKind = "measured";
      const [sw, sh, sd] = outline.sizeMm;
      sizeMm = pl.rotation % 180 ? [sh, sw, sd] : [sw, sh, sd];
    } else {
      r = rotateShape(b.w, b.h, b.env, pl.rotation);
      mount.x1 = mount.x0 + r.w * p;
      mount.y1 = mount.y0 + r.h * p;
      shape = [rectLoop(mount)];
      shapeKind = g ? "estimate" : "box";
    }
    const shapeBox = loopsBox(shape);
    const segments = g ? segmentsFor(board, pt) : null;
    out.push({
      placement: pl,
      partType: pt,
      x: pl.x,
      y: pl.y,
      w: r.w,
      h: r.h,
      env: r.env,
      approx: !outline && b.approx,
      shape,
      shapeBox,
      shapeKind,
      sizeMm,
      body: {
        x0: shapeBox.x0 - r.env.leftMm,
        y0: shapeBox.y0 - r.env.topMm,
        x1: shapeBox.x1 + r.env.rightMm,
        y1: shapeBox.y1 + r.env.bottomMm,
      },
      passesOver: !!g?.passesOver?.(pt.params),
      segments,
      cuts: segments && segments.length > 1 ? cutLines(segments, pl.x, pl.y, r.w, r.h, pl.rotation, p) : [],
    });
  }
  return out;
}

const nameOf = (r: Resolved) => r.placement.label || r.partType.name;
const fmt = (mm: number) => `${Math.round(mm * 10) / 10} mm`;

/** Overlap thinner than this is two parts touching, not colliding (outlines are traced at 0.2 mm). */
const TOUCH_MM = 0.6;

/** All fit problems for a board. Pure: same input, same output. */
export function checkBoard(board: Board, partTypes: PartType[], outlineFor?: OutlineLookup, resolved?: Resolved[]): Issue[] {
  const rs = resolved ?? resolve(board, partTypes, outlineFor);
  const issues: Issue[] = [];
  const W = board.widthCells, H = board.heightCells, p = board.pitchMm;

  for (const r of rs) {
    const id = r.placement.id;
    if (r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H) {
      issues.push({ severity: "error", kind: "mount-off-board", placementIds: [id], detail: `${nameOf(r)}: mount is off the board` });
      continue;
    }
    const over: string[] = [];
    const e = 0.05;
    if (r.body.x0 < -e) over.push(`${fmt(-r.body.x0)} left`);
    if (r.body.x1 > W * p + e) over.push(`${fmt(r.body.x1 - W * p)} right`);
    if (r.body.y0 < -e) over.push(`${fmt(-r.body.y0)} top`);
    if (r.body.y1 > H * p + e) over.push(`${fmt(r.body.y1 - H * p)} bottom`);
    if (over.length) {
      issues.push({ severity: "warning", kind: "envelope-overhang", placementIds: [id], detail: `${nameOf(r)}: overhangs board edge by ${over.join(", ")}` });
    }
  }

  // Does each generated part fit the printer? Straights are cut to fit, so
  // only their width matters. Parts printed on their backer (item holders)
  // lie differently on the bed than on the board, so they aren't checked.
  const { bed, name: printerName } = printerFor(board.printer);
  for (const r of rs) {
    const g = generatorById(r.partType.generatorId);
    if (!g || (g.boardAxes ?? "xy") !== "xy") continue;
    const wMm = r.sizeMm?.[0] ?? r.w * p, hMm = r.sizeMm?.[1] ?? r.h * p, dMm = r.sizeMm?.[2] ?? r.env.depthMm;
    const tooBig = r.segments ? maxSegmentCells(board, r.partType) < 1 : !fitsBed(bed, wMm, hMm);
    if (tooBig || dMm > bed.z) {
      issues.push({
        severity: "warning",
        kind: "too-big-for-bed",
        placementIds: [r.placement.id],
        detail: `${nameOf(r)}: ${fmt(wMm)} × ${fmt(hMm)}${dMm > bed.z ? ` × ${fmt(dMm)}` : ""} doesn't fit the ${printerName} bed (${bed.x} × ${bed.y} × ${bed.z} mm)`,
      });
    }
  }

  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j];
      const ids = [a.placement.id, b.placement.id];
      const ov = overlap(a.shape, b.shape, a.shapeBox, b.shapeBox);
      if (ov.depthMm > TOUCH_MM) {
        // A bridge is built to cross a channel; leave that to the person.
        if (a.passesOver !== b.passesOver) continue;
        const real = a.shapeKind === "measured" && b.shapeKind === "measured";
        issues.push({
          severity: "error",
          kind: "mount-overlap",
          placementIds: ids,
          detail: real
            ? `${nameOf(a)} and ${nameOf(b)}: parts collide (overlap ${fmt(ov.depthMm)} deep, ${Math.round(ov.areaMm2)} mm²)`
            : `${nameOf(a)} and ${nameOf(b)}: mounts overlap`,
        });
        continue;
      }
      // Envelopes are rough boxes, so their overlap is only a warning, and
      // only matters when a part has one beyond its real shape.
      if (isZeroEnv(a.env) && isZeroEnv(b.env)) continue;
      const t = 1e-6;
      const bodyHit = a.body.x0 < b.body.x1 - t && b.body.x0 < a.body.x1 - t && a.body.y0 < b.body.y1 - t && b.body.y0 < a.body.y1 - t;
      if (bodyHit) {
        issues.push({ severity: "warning", kind: "envelope-overlap", placementIds: ids, detail: `${nameOf(a)} and ${nameOf(b)}: bodies overlap` });
      }
    }
  }
  return issues;
}
