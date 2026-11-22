// One render pool for the whole page, with results cached by SCAD path and
// params. Exporting twice, or checking a part's size and then exporting,
// renders each unique piece only once.

import { RenderPool } from "./renderer";
import { renderKey } from "./plan";
import type { RenderResponse } from "./types";
import type { ParamValue } from "../model/types";

let pool: RenderPool | null = null;
const cache = new Map<string, Promise<RenderResponse>>();

const scadBase = () => new URL("scad/", document.baseURI).href;

export function render(scadPath: string, defines: Record<string, ParamValue>, onStart?: () => void): Promise<RenderResponse> {
  const key = renderKey(scadPath, defines);
  const hit = cache.get(key);
  if (hit) {
    onStart?.();
    return hit;
  }
  pool ??= new RenderPool();
  const p = pool.render({ scadBase: scadBase(), scadPath, defines }, onStart).then((r) => {
    // Keep successes only, so a cancelled or failed render can be retried.
    if (!r.ok) cache.delete(key);
    return r;
  });
  cache.set(key, p);
  return p;
}

/** Stop every queued and running render. Finished results stay cached. */
export function cancelAll() {
  pool?.dispose();
  pool = null;
}
