// Real outlines for generated parts, so the board can draw and check each
// part's true shape.
//
// Lookup order: memory, then this browser's saved outlines, then the
// outlines shipped with the tool (pre-computed for every fixed piece and
// every generator's defaults, see scripts/build-outlines.ts), and only then
// a render. Renders go through the shared render service, so the STL is
// reused if the part is exported later.

import { useEffect, useMemo, useState } from "react";
import { generatorById } from "../model/library";
import { outlineFromStl, type Outline } from "../model/outline";
import type { Board, PartType } from "../model/types";
import { outlineKey, rendersFor } from "./plan";

export { outlineKey };
import { render } from "./service";

export type OutlineState = { status: "ready"; outline: Outline } | { status: "measuring" } | { status: "failed"; error: string };

const STORE_PREFIX = "underware-outline:v1:";
const known = new Map<string, OutlineState>();
/** Keys whose render failed, with the error. Not retried until asked. */
const failures = new Map<string, string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

let prebuilt: Record<string, Outline> | null = null;
const prebuiltReady: Promise<void> = import("../model/outlines.prebuilt.json")
  .then((m) => {
    prebuilt = (m.default ?? m) as unknown as Record<string, Outline>;
    notify();
  })
  .catch(() => {
    prebuilt = {};
  });

function readStored(key: string): Outline | null {
  try {
    const raw = localStorage.getItem(STORE_PREFIX + key);
    return raw ? (JSON.parse(raw) as Outline) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, o: Outline) {
  try {
    localStorage.setItem(STORE_PREFIX + key, JSON.stringify(o));
  } catch {
    /* storage full or blocked: it will be measured again next visit */
  }
}

/** The outline for a key if it's known without rendering. */
export function peekOutline(key: string): OutlineState | undefined {
  const hit = known.get(key);
  if (hit) return hit;
  const o = prebuilt?.[key] ?? readStored(key);
  if (o) {
    const s: OutlineState = { status: "ready", outline: o };
    known.set(key, s);
    return s;
  }
  return undefined;
}

/** Start measuring a part's outline (no-op if known or under way). */
export async function measure(board: Board, pt: PartType) {
  const key = outlineKey(board, pt);
  const g = generatorById(pt.generatorId);
  if (!key || !g) return;
  await prebuiltReady;
  if (peekOutline(key)) return;
  const piece = rendersFor(board, pt)[0];
  known.set(key, { status: "measuring" });
  notify();
  const r = await render(piece.scadPath, piece.defines);
  let s: OutlineState;
  if (!r.ok) s = { status: "failed", error: r.error };
  else {
    const o = outlineFromStl(r.stl, g.boardAxes ?? "xy");
    s = o ? { status: "ready", outline: o } : { status: "failed", error: "The render came back empty." };
    if (o) writeStored(key, o);
  }
  if (s.status === "failed") {
    known.delete(key);
    failures.set(key, s.error);
  } else known.set(key, s);
  notify();
}

/**
 * Outline states for every generated part type on the board, measuring
 * missing ones in the background. Waits a moment after a change so typing
 * a number doesn't queue a render per keystroke.
 */
export function useOutlines(board: Board, partTypes: PartType[]) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const f = () => setVersion((v) => v + 1);
    listeners.add(f);
    return () => void listeners.delete(f);
  }, []);

  const used = useMemo(() => {
    const ids = new Set(board.placements.map((p) => p.partTypeId));
    return partTypes.filter((pt) => ids.has(pt.id) && pt.generatorId);
  }, [board.placements, partTypes]);

  const keys = useMemo(() => new Map(used.map((pt) => [pt.id, outlineKey(board, pt)])), [used, board]);

  useEffect(() => {
    const t = setTimeout(() => {
      for (const pt of used) {
        const k = keys.get(pt.id);
        if (k && !failures.has(k)) void measure(board, pt);
      }
    }, 700);
    return () => clearTimeout(t);
  }, [keys, used, board]);

  return useMemo(() => {
    const states = new Map<string, OutlineState>();
    for (const [id, k] of keys) {
      if (!k) continue;
      const s = peekOutline(k) ?? (failures.has(k) ? { status: "failed" as const, error: failures.get(k)! } : { status: "measuring" as const });
      states.set(id, s);
    }
    return states;
    // version: re-read when a measurement lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, version]);
}

/** Forget a failed measurement so it can be tried again. */
export function retryOutline(board: Board, pt: PartType) {
  const k = outlineKey(board, pt);
  if (!k) return;
  failures.delete(k);
  void measure(board, pt);
}
