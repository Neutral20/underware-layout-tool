export interface RenderRequest {
  id: number;
  /** URL prefix where public/scad is served, ending in "/". */
  scadBase: string;
  scadFile: string;
  defines: Record<string, number | string | boolean>;
}

export type RenderResponse =
  | { id: number; ok: true; stl: ArrayBuffer; ms: number; warnings: string[] }
  | { id: number; ok: false; error: string; ms: number };

/** Turn a JS value into an OpenSCAD -D literal. */
export function scadLiteral(v: number | string | boolean): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "0";
  return JSON.stringify(v);
}
